-- Migration 201: Carrier API integrations (Punto a Punto)
--
-- Platform upsell: each PY store connects its own Punto a Punto account once
-- and Ordefy pushes orders to the courier automatically when the order reaches
-- the status the merchant chose. No tracking ingestion in v1 (future phase).
--
-- Reuses shipping_integrations (existing, store-scoped) instead of a new table.
-- Reuses shipments for the per-order push outcome. Gated by plan feature
-- (has_carrier_integrations / has_feature_access) and by store country (PY).
--
-- Idempotency is server-side: CreatePaquete has no cancel and no per-account
-- sandbox, so a double push = double dispatch. claim_carrier_push() uses a
-- transaction-scoped advisory lock per order (same pattern as migration 066)
-- plus an existing-external-id check, so concurrent transitions never create
-- two shipments at the courier.

-- ================================================================
-- STEP 1: shipping_integrations carrier columns
-- ================================================================
ALTER TABLE shipping_integrations
  ADD COLUMN IF NOT EXISTS provider VARCHAR(30),
  ADD COLUMN IF NOT EXISTS credentials_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS auto_push BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS trigger_status VARCHAR(50) NOT NULL DEFAULT 'ready_to_ship',
  ADD COLUMN IF NOT EXISTS last_validated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS validation_status VARCHAR(20);

COMMENT ON COLUMN shipping_integrations.provider IS 'Carrier provider key, e.g. punto_a_punto. One row per (store_id, provider).';
COMMENT ON COLUMN shipping_integrations.credentials_encrypted IS 'AES-256-GCM blob of {username,password,tenantId,baseUrl} encrypted with CARRIER_ENCRYPTION_KEY. Never plaintext, never returned to the client.';
COMMENT ON COLUMN shipping_integrations.trigger_status IS 'Order status that triggers the push to the carrier. Merchant-configurable.';
COMMENT ON COLUMN shipping_integrations.validation_status IS 'Result of the last validateCredentials run: valid | invalid | null (never validated).';

-- One carrier connection per provider per store. Partial unique so legacy
-- rows with provider IS NULL (the old shipping_integrations usage) coexist.
CREATE UNIQUE INDEX IF NOT EXISTS shipping_integrations_store_provider_uidx
  ON shipping_integrations (store_id, provider)
  WHERE provider IS NOT NULL;

-- ================================================================
-- STEP 2: shipments carrier push columns
-- ================================================================
ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS carrier_provider VARCHAR(30),
  ADD COLUMN IF NOT EXISTS carrier_external_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS carrier_nro_guia VARCHAR(100),
  ADD COLUMN IF NOT EXISTS carrier_push_status VARCHAR(20),
  ADD COLUMN IF NOT EXISTS carrier_push_error TEXT,
  ADD COLUMN IF NOT EXISTS carrier_pushed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS carrier_push_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS carrier_push_next_attempt_at TIMESTAMPTZ;

COMMENT ON COLUMN shipments.carrier_external_id IS 'Punto a Punto CreatePaqueteV2 result.id (String). Presence means the package exists at the courier; primary idempotency guard.';
COMMENT ON COLUMN shipments.carrier_nro_guia IS 'Punto a Punto result.nroGuia, the human-facing tracking number shown to staff.';
COMMENT ON COLUMN shipments.carrier_push_status IS 'pending | sent | failed. Drives the retry worker sweep.';

-- Retry worker sweeps failed pushes per store.
CREATE INDEX IF NOT EXISTS idx_shipments_store_carrier_push_status
  ON shipments (store_id, carrier_push_status)
  WHERE carrier_push_status IS NOT NULL;

-- Due-failed sweep for the retry worker (backoff-aware).
CREATE INDEX IF NOT EXISTS idx_shipments_carrier_retry_due
  ON shipments (carrier_push_next_attempt_at)
  WHERE carrier_push_status = 'failed';

-- ================================================================
-- STEP 3: plan feature flag
-- ================================================================
ALTER TABLE plan_limits
  ADD COLUMN IF NOT EXISTS has_carrier_integrations BOOLEAN NOT NULL DEFAULT false;

UPDATE plan_limits SET has_carrier_integrations = true  WHERE plan IN ('growth', 'professional');
UPDATE plan_limits SET has_carrier_integrations = false WHERE plan IN ('free', 'starter');

-- has_feature_access (live version: migration 056) resolves a feature by
-- reading the matching has_<feature> column off plan_limits via dynamic SQL.
-- We replace it IN PLACE with the exact live signature has_feature_access(
-- p_store_id UUID, p_feature TEXT) so every live caller (planLimits.ts,
-- stripe.service.ts) keeps matching the p_feature named arg. No DROP, no
-- rename. The only behavioural change is that the has_carrier_integrations
-- column added in STEP 3 (true for growth/professional) now gates the
-- 'carrier_integrations' feature automatically through the same column lookup.
CREATE OR REPLACE FUNCTION has_feature_access(
  p_store_id UUID,
  p_feature TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
  v_owner_id UUID;
  v_current_plan subscription_plan_type;
  v_has_access BOOLEAN;
BEGIN
  SELECT user_id INTO v_owner_id
  FROM user_stores
  WHERE store_id = p_store_id
    AND role = 'owner'
    AND is_active = true
  LIMIT 1;

  IF v_owner_id IS NULL THEN
    v_current_plan := 'free';
  ELSE
    SELECT COALESCE(s.plan, 'free'::subscription_plan_type) INTO v_current_plan
    FROM subscriptions s
    WHERE s.user_id = v_owner_id
      AND s.is_primary = true
    LIMIT 1;

    IF v_current_plan IS NULL THEN
      v_current_plan := 'free';
    END IF;
  END IF;

  EXECUTE format(
    'SELECT %I FROM plan_limits WHERE plan = $1',
    'has_' || p_feature
  ) INTO v_has_access USING v_current_plan;

  RETURN COALESCE(v_has_access, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ================================================================
-- STEP 4: RLS for the new carrier columns
-- ================================================================
-- shipping_integrations did not have RLS enabled in this database, so enable it
-- and add the full CRUD policies. The carrier connect/disconnect flow goes
-- through supabaseAdmin (service role, bypasses RLS) but the policies keep any
-- user-scoped client correctly tenant-isolated.
--
-- Tenant scoping uses realtime_user_store_ids(), the live helper every other
-- store-scoped policy in this database relies on (see orders, product_variants).
-- It resolves the set of store_ids the current auth.uid() can access.
ALTER TABLE shipping_integrations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'shipping_integrations'
      AND policyname = 'carrier_integrations_store_select'
  ) THEN
    CREATE POLICY carrier_integrations_store_select ON shipping_integrations
      FOR SELECT USING (store_id IN (SELECT realtime_user_store_ids()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'shipping_integrations'
      AND policyname = 'carrier_integrations_store_insert'
  ) THEN
    CREATE POLICY carrier_integrations_store_insert ON shipping_integrations
      FOR INSERT WITH CHECK (store_id IN (SELECT realtime_user_store_ids()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'shipping_integrations'
      AND policyname = 'carrier_integrations_store_update'
  ) THEN
    CREATE POLICY carrier_integrations_store_update ON shipping_integrations
      FOR UPDATE USING (store_id IN (SELECT realtime_user_store_ids()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'shipping_integrations'
      AND policyname = 'carrier_integrations_store_delete'
  ) THEN
    CREATE POLICY carrier_integrations_store_delete ON shipping_integrations
      FOR DELETE USING (store_id IN (SELECT realtime_user_store_ids()));
  END IF;
END $$;

-- shipments RLS (migration 027 created the table; ensure it is enabled + scoped
-- so the carrier columns are never readable cross-tenant).
ALTER TABLE shipments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'shipments' AND policyname = 'shipments_store_select'
  ) THEN
    CREATE POLICY shipments_store_select ON shipments
      FOR SELECT USING (store_id IN (SELECT realtime_user_store_ids()));
  END IF;
END $$;

-- ================================================================
-- STEP 5: atomic carrier push claim (advisory lock + idempotency)
-- ================================================================
-- claim_carrier_push() is the single mutation entrypoint for the push service.
-- supabase-js runs through PgBouncer in transaction mode, so a JS-side
-- BEGIN/advisory-lock/COMMIT spanning multiple round-trips is not reliable.
-- Doing the lock + claim inside one function keeps it transaction-scoped.
--
-- Returns the claim outcome the service acts on as (status, shipment_id):
--   ('claimed', <id>)       -> caller is the single owner, may call the API,
--                              and must pass <id> back to the recorders
--   ('already_sent', NULL)  -> a shipment with carrier_external_id already
--                              exists, skip
--
-- Returning the claimed id is what makes the result/failure recorders safe:
-- the advisory lock is transaction-scoped to this function, so the recorders
-- (which run in a later, separate transaction) cannot rely on it. They update
-- the exact claimed row by id instead of re-deriving "the latest pending row",
-- which would race with a concurrent claim that created a second row.
DROP FUNCTION IF EXISTS claim_carrier_push(UUID, UUID, VARCHAR);

CREATE OR REPLACE FUNCTION claim_carrier_push(
  p_store_id UUID,
  p_order_id UUID,
  p_provider VARCHAR
)
RETURNS TABLE(status TEXT, shipment_id UUID) AS $$
DECLARE
  v_lock_key BIGINT;
  v_carrier_shipment_id UUID;
BEGIN
  v_lock_key := ('x' || substr(md5(p_order_id::text || 'carrier_push'), 1, 15))::bit(60)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- Any carrier shipment for this order that already dispatched ends the push.
  -- Checked across all rows, not just the latest: a manual/re-ship row created
  -- after a successful push must not reopen a second dispatch.
  IF EXISTS (
    SELECT 1 FROM shipments
    WHERE store_id = p_store_id
      AND order_id = p_order_id
      AND carrier_external_id IS NOT NULL
  ) THEN
    RETURN QUERY SELECT 'already_sent'::TEXT, NULL::UUID;
    RETURN;
  END IF;

  -- Reuse a pending/failed carrier row if one exists, else create one.
  SELECT id INTO v_carrier_shipment_id
  FROM shipments
  WHERE store_id = p_store_id
    AND order_id = p_order_id
    AND carrier_provider = p_provider
    AND carrier_external_id IS NULL
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_carrier_shipment_id IS NULL THEN
    INSERT INTO shipments (store_id, order_id, carrier_provider, carrier_push_status)
    VALUES (p_store_id, p_order_id, p_provider, 'pending')
    RETURNING id INTO v_carrier_shipment_id;
  ELSE
    UPDATE shipments
    SET carrier_push_status = 'pending',
        carrier_push_error = NULL
    WHERE id = v_carrier_shipment_id;
  END IF;

  RETURN QUERY SELECT 'claimed'::TEXT, v_carrier_shipment_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION claim_carrier_push(UUID, UUID, VARCHAR) IS
'Transaction-scoped advisory lock per order + existing-external-id check. Returns (status, shipment_id): (claimed,<id>) or (already_sent,null). The id anchors the result/failure recorders so they never update the wrong row. Prevents double dispatch to a carrier with no cancel endpoint.';

-- Persist the result of a successful CreatePaquete. Separate from the claim so
-- the external API call happens outside any DB transaction (it can take
-- seconds and must never hold a lock). Updates by the claimed shipment id, not
-- by "latest pending row", so a concurrent claim never gets clobbered. Still
-- guards carrier_external_id IS NULL so a double record is a no-op.
CREATE OR REPLACE FUNCTION record_carrier_push_result(
  p_shipment_id UUID,
  p_external_id VARCHAR,
  p_nro_guia VARCHAR
)
RETURNS VOID AS $$
BEGIN
  UPDATE shipments
  SET carrier_external_id = p_external_id,
      carrier_nro_guia = p_nro_guia,
      carrier_push_status = 'sent',
      carrier_push_error = NULL,
      carrier_pushed_at = NOW()
  WHERE id = p_shipment_id
    AND carrier_external_id IS NULL;
END;
$$ LANGUAGE plpgsql;

-- The previous (store_id, order_id, external_id, nro_guia) overload is replaced
-- by the id-anchored one above. Drop it so callers cannot bind the unsafe shape.
DROP FUNCTION IF EXISTS record_carrier_push_result(UUID, UUID, VARCHAR, VARCHAR);

-- Records a failed push and schedules the next retry with exponential backoff
-- (2, 4, 8, 16, 32, cap 60 minutes). Updates the claimed row by id and only
-- when it has not already succeeded (carrier_external_id IS NULL), so a late
-- success is never undone.
CREATE OR REPLACE FUNCTION record_carrier_push_failure(
  p_shipment_id UUID,
  p_error TEXT
)
RETURNS VOID AS $$
DECLARE
  v_attempts INTEGER;
  v_backoff_min INTEGER;
BEGIN
  SELECT COALESCE(carrier_push_attempts, 0) + 1
  INTO v_attempts
  FROM shipments
  WHERE id = p_shipment_id
    AND carrier_external_id IS NULL;

  IF v_attempts IS NULL THEN
    RETURN;
  END IF;

  v_backoff_min := LEAST(POWER(2, v_attempts)::INTEGER, 60);

  UPDATE shipments
  SET carrier_push_status = 'failed',
      carrier_push_error = LEFT(p_error, 1000),
      carrier_push_attempts = v_attempts,
      carrier_push_next_attempt_at = NOW() + (v_backoff_min || ' minutes')::INTERVAL
  WHERE id = p_shipment_id
    AND carrier_external_id IS NULL;
END;
$$ LANGUAGE plpgsql;

-- Drop the previous (store_id, order_id, error) overload of the failure
-- recorder for the same reason: callers must anchor on the claimed id.
DROP FUNCTION IF EXISTS record_carrier_push_failure(UUID, UUID, TEXT);

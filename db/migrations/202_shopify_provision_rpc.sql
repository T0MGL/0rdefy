-- ================================================================
-- MIGRATION 202: Shopify provision RPC (atomic, serialized per shop)
-- ================================================================
-- Replaces the loose chain of supabaseAdmin.from().insert() calls in
-- api/services/shopify-provision.service.ts with a single Postgres
-- function that runs the entire provisioning flow inside one
-- transaction.
--
-- Why a function:
--   - Atomicity. A mid-way failure (e.g. integration insert) previously
--     orphaned the user + store + user_stores rows it had already
--     written. Inside a function every statement shares one implicit
--     transaction, so a RAISE/error rolls the whole thing back.
--   - Serialization. pg_advisory_xact_lock(hashtext(shop_domain))
--     guarantees at-most-one provisioning runs concurrently for a given
--     shop. Two parallel installs of the same shop (App Store retries,
--     double-clicked install) now queue instead of racing into a
--     duplicate user/store. The lock auto-releases at COMMIT/ROLLBACK.
--
-- The function mirrors the three install scenarios the service handled:
--   1. First install for a new shop_domain  -> create everything.
--   2. Reinstall (uninstalled or inactive)   -> reactivate existing rows.
--   3. New shop owned by an existing direct  -> link to that user and
--      Ordefy user (matched by email)           reuse/create a store.
--
-- It does NOT call the Shopify Admin API or sign the Ordefy JWT: those
-- stay in the service (network + secret handling). The function returns
-- the IDs the service needs to sign the token.
--
-- Idempotent install of the function itself via CREATE OR REPLACE.
--
-- Also folds in the WITH CHECK fix for the install-attempts RLS policy
-- that migration 188 shipped without (188 is already applied in prod, so
-- the fix lives here as an ALTER POLICY instead of editing 188).
--
-- Author: Bright Idea
-- Date:   2026-06-06
-- ================================================================

BEGIN;

-- ----------------------------------------------------------------
-- RLS hardening carried over from 188 (already-applied, do not edit)
-- ----------------------------------------------------------------
-- 188 created service_role_only_install_attempts with a USING clause but
-- no WITH CHECK, so the policy filtered reads but not the INSERT path.
-- Add WITH CHECK so writes are equally constrained to service_role.
ALTER POLICY "service_role_only_install_attempts"
  ON shopify_install_attempts
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ----------------------------------------------------------------
-- provision_shopify_merchant
-- ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION provision_shopify_merchant(
  p_shop_domain    TEXT,
  p_access_token   TEXT,
  p_scope          TEXT,
  p_shop_email     TEXT,
  p_shop_name      TEXT,
  p_shop_currency  TEXT,
  p_country_code   TEXT,
  p_shopify_api_key TEXT
)
RETURNS TABLE (
  user_id                 UUID,
  store_id                UUID,
  integration_id          UUID,
  user_email              TEXT,
  is_new_provision        BOOLEAN,
  is_reinstall            BOOLEAN,
  linked_from_direct_user BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
-- OUT params user_id/store_id share names with columns we insert into.
-- Tell PL/pgSQL that inside SQL statements a bare column name resolves to
-- the column, not the variable (needed for ON CONFLICT (user_id, store_id)
-- and the INSERT column lists below).
#variable_conflict use_column
DECLARE
  v_existing        shopify_integrations%ROWTYPE;
  v_direct_user_id  UUID;
  v_user_id         UUID;
  v_user_email      TEXT;
  v_store_id        UUID;
  v_integration_id  UUID;
  v_owner_store_id  UUID;
  v_display_name    TEXT;
  v_linked          BOOLEAN := FALSE;
  v_supported       TEXT[] := ARRAY['PY','AR','BR','UY','CL','MX','US','ES'];
  v_country         TEXT;
  v_sub_exists      BOOLEAN;
BEGIN
  -- Serialize all installs of this shop. Held until COMMIT/ROLLBACK.
  PERFORM pg_advisory_xact_lock(hashtext(p_shop_domain));

  -- stores.country has a CHECK on the supported set; map anything else
  -- to US (merchant can change it later in Settings).
  v_country := upper(coalesce(trim(p_country_code), ''));
  IF NOT (v_country = ANY (v_supported)) THEN
    v_country := 'US';
  END IF;

  -- ----------------- LOOKUP (any status) -----------------
  SELECT * INTO v_existing
  FROM shopify_integrations
  WHERE shop_domain = p_shop_domain
  LIMIT 1;

  -- ----------------- REINSTALL PATH -----------------
  IF FOUND THEN
    IF v_existing.user_id IS NULL THEN
      RAISE EXCEPTION 'integration row missing user_id (legacy data, manual fix required)';
    END IF;

    UPDATE shopify_integrations
    SET access_token    = p_access_token,
        scope           = p_scope,
        status          = 'active',
        uninstalled_at  = NULL,
        sync_error      = NULL,
        shop_email      = p_shop_email,
        shop_name       = p_shop_name,
        shop_currency   = p_shop_currency,
        updated_at      = NOW()
    WHERE id = v_existing.id;

    SELECT u.id, u.email INTO v_user_id, v_user_email
    FROM users u
    WHERE u.id = v_existing.user_id;

    IF v_user_id IS NULL THEN
      RAISE EXCEPTION 'reinstall: user % not found', v_existing.user_id;
    END IF;

    RETURN QUERY SELECT
      v_user_id,
      v_existing.store_id,
      v_existing.id,
      v_user_email,
      FALSE,
      (v_existing.status IS DISTINCT FROM 'active'),
      FALSE;
    RETURN;
  END IF;

  -- ----------------- NEW INSTALL PATH -----------------
  -- Email collision: does a direct user already exist?
  SELECT id INTO v_direct_user_id
  FROM users
  WHERE email = p_shop_email
  LIMIT 1;

  IF v_direct_user_id IS NOT NULL THEN
    v_user_id := v_direct_user_id;
    v_user_email := p_shop_email;
    v_linked := TRUE;
  ELSE
    v_display_name := NULLIF(trim(coalesce(p_shop_name, '')), '');
    IF v_display_name IS NULL THEN
      v_display_name := split_part(p_shop_email, '@', 1);
    END IF;

    INSERT INTO users (email, password_hash, name, is_active, auth_provider, source)
    VALUES (p_shop_email, NULL, v_display_name, TRUE, 'shopify', 'shopify')
    RETURNING id, email INTO v_user_id, v_user_email;
  END IF;

  -- Resolve a store: reuse an owned/admin store for a linked direct user,
  -- otherwise create one and link it.
  IF v_linked THEN
    SELECT store_id INTO v_owner_store_id
    FROM user_stores
    WHERE user_id = v_user_id
      AND role IN ('owner', 'admin')
    LIMIT 1;
  END IF;

  IF v_owner_store_id IS NOT NULL THEN
    v_store_id := v_owner_store_id;
  ELSE
    INSERT INTO stores (name, country)
    VALUES (coalesce(NULLIF(trim(coalesce(p_shop_name,'')), ''), p_shop_domain), v_country)
    RETURNING id INTO v_store_id;

    INSERT INTO user_stores (user_id, store_id, role, is_active)
    VALUES (v_user_id, v_store_id, 'owner', TRUE)
    ON CONFLICT (user_id, store_id) DO NOTHING;
  END IF;

  -- Integration row.
  INSERT INTO shopify_integrations (
    store_id, user_id, shop_domain, shop, api_key, api_secret_key,
    access_token, scope, status, auto_provisioned,
    linked_from_direct_user_at, shop_email, shop_name, shop_currency,
    installed_at
  )
  VALUES (
    v_store_id, v_user_id, p_shop_domain, p_shop_domain,
    coalesce(p_shopify_api_key, ''), '',
    p_access_token, p_scope, 'active', TRUE,
    CASE WHEN v_linked THEN NOW() ELSE NULL END,
    p_shop_email, p_shop_name, p_shop_currency,
    NOW()
  )
  RETURNING id INTO v_integration_id;

  -- Free, Shopify-billed subscription. Only insert if the user has no
  -- primary subscription (do not overwrite a Stripe sub on a linked user).
  SELECT EXISTS (
    SELECT 1 FROM subscriptions
    WHERE user_id = v_user_id AND is_primary = TRUE
  ) INTO v_sub_exists;

  IF NOT v_sub_exists THEN
    INSERT INTO subscriptions (
      user_id, store_id, is_primary, plan, status, billing_source,
      shopify_shop_domain, shopify_charge_id
    )
    VALUES (
      v_user_id, v_store_id, TRUE, 'free', 'active', 'shopify',
      NULL, NULL
    );
  END IF;

  RETURN QUERY SELECT
    v_user_id,
    v_store_id,
    v_integration_id,
    v_user_email,
    TRUE,
    FALSE,
    v_linked;
END;
$$;

COMMENT ON FUNCTION provision_shopify_merchant(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) IS
  'Atomic Shopify managed-install provisioning. Serialized per shop_domain via pg_advisory_xact_lock. Handles first install, reinstall, and direct-user link in one transaction. Called by api/services/shopify-provision.service.ts via supabaseAdmin.rpc().';

REVOKE ALL ON FUNCTION provision_shopify_merchant(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION provision_shopify_merchant(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO service_role;

COMMIT;

-- ================================================================
-- MIGRATION 202 COMPLETE
-- ================================================================

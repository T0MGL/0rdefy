-- ================================================================
-- Migration 174: Courier Operators (Phase 1 of Courier Portal)
-- ================================================================
-- Created: 2026-05-08
-- Author: Bright Idea
--
-- DEPENDENCIES:
--   - Migration 004: user_stores table
--   - Migration 008b: carriers table
--   - Migration 030: collaborator_invitations + role plumbing
--   - Migration 036: subscriptions / plan_limits
--   - Migration 078: accept_invitation_atomic baseline
--
-- PURPOSE:
--   Wire up the auth + permissions backbone for the embedded courier
--   portal. Couriers are external operators (not store team members)
--   that authenticate into Ordefy with a restricted role bound to a
--   specific carrier. They never see the admin app, only the portal.
--
-- DESIGN INVARIANTS:
--   1. role='courier' <=> carrier_id IS NOT NULL on user_stores.
--      Same invariant on collaborator_invitations.assigned_role.
--      Both halves are enforced by CHECK constraints, not application
--      code. A misconfigured row cannot exist.
--   2. Couriers do NOT consume plan seats. They are an external operator
--      tier. Internal team headcount caps from plan_limits stay scoped
--      to non-courier roles only.
--   3. Cross-carrier and cross-store isolation is enforced by the
--      portal middleware via is_courier_of_carrier(). The function is
--      SECURITY DEFINER with a hard search_path so the auth check
--      cannot be subverted by a malicious search_path on the caller.
--   4. last_active_at is best-effort, rate-limited at the application
--      layer to avoid hot writes.
-- ================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='user_stores') THEN
    RAISE EXCEPTION 'Missing dependency: user_stores table not found.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='collaborator_invitations') THEN
    RAISE EXCEPTION 'Missing dependency: collaborator_invitations table not found.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='carriers') THEN
    RAISE EXCEPTION 'Missing dependency: carriers table not found.';
  END IF;
END $$;

-- 1. user_stores: add carrier_id + last_active_at + courier invariant

ALTER TABLE user_stores
  ADD COLUMN IF NOT EXISTS carrier_id UUID REFERENCES carriers(id) ON DELETE CASCADE;

ALTER TABLE user_stores
  ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;

COMMENT ON COLUMN user_stores.carrier_id IS
  'Carrier the operator works for. NOT NULL iff role=courier (enforced by courier_role_requires_carrier).';
COMMENT ON COLUMN user_stores.last_active_at IS
  'Last observed activity from the courier portal. Updated rate-limited (1 write per 60s per user_store row).';

CREATE INDEX IF NOT EXISTS idx_user_stores_carrier_id
  ON user_stores(carrier_id, store_id)
  WHERE carrier_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_stores_courier_lookup
  ON user_stores(user_id, store_id, role)
  WHERE is_active = true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.user_stores'::regclass
      AND conname='courier_role_requires_carrier'
  ) THEN
    ALTER TABLE user_stores
      ADD CONSTRAINT courier_role_requires_carrier
      CHECK (
        (role = 'courier' AND carrier_id IS NOT NULL)
        OR
        (role <> 'courier' AND carrier_id IS NULL)
      );
  END IF;
END $$;

-- 2. collaborator_invitations: extend valid_role + add carrier_id

ALTER TABLE collaborator_invitations
  DROP CONSTRAINT IF EXISTS valid_role;

ALTER TABLE collaborator_invitations
  ADD CONSTRAINT valid_role CHECK (
    assigned_role IN (
      'owner', 'admin', 'logistics', 'confirmador',
      'contador', 'inventario', 'courier'
    )
  );

ALTER TABLE collaborator_invitations
  ADD COLUMN IF NOT EXISTS carrier_id UUID REFERENCES carriers(id) ON DELETE CASCADE;

COMMENT ON COLUMN collaborator_invitations.carrier_id IS
  'Carrier the courier-invitation binds to. NOT NULL iff assigned_role=courier (enforced by courier_invitation_requires_carrier).';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.collaborator_invitations'::regclass
      AND conname='courier_invitation_requires_carrier'
  ) THEN
    ALTER TABLE collaborator_invitations
      ADD CONSTRAINT courier_invitation_requires_carrier
      CHECK (
        (assigned_role = 'courier' AND carrier_id IS NOT NULL)
        OR
        (assigned_role <> 'courier' AND carrier_id IS NULL)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_invitations_carrier_id
  ON collaborator_invitations(carrier_id)
  WHERE carrier_id IS NOT NULL;

-- 3. View: v_carrier_operators

CREATE OR REPLACE VIEW v_carrier_operators AS
SELECT
  us.id              AS user_store_id,
  us.user_id,
  us.store_id,
  us.carrier_id,
  c.name             AS carrier_name,
  u.email,
  u.name,
  u.phone,
  us.is_active,
  us.invited_by,
  us.invited_at,
  us.last_active_at,
  us.created_at
FROM user_stores us
JOIN users u    ON u.id = us.user_id
JOIN carriers c ON c.id = us.carrier_id
WHERE us.role = 'courier';

COMMENT ON VIEW v_carrier_operators IS
  'Active+inactive couriers per carrier+store. Filter by is_active=true for live operators only.';

-- 4. is_courier_of_carrier

CREATE OR REPLACE FUNCTION is_courier_of_carrier(
  p_user_id UUID,
  p_store_id UUID,
  p_carrier_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_match BOOLEAN;
BEGIN
  IF p_user_id IS NULL OR p_store_id IS NULL OR p_carrier_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT EXISTS(
    SELECT 1
    FROM user_stores
    WHERE user_id    = p_user_id
      AND store_id   = p_store_id
      AND carrier_id = p_carrier_id
      AND role       = 'courier'
      AND is_active  = TRUE
  ) INTO v_match;

  RETURN v_match;
END;
$$;

COMMENT ON FUNCTION is_courier_of_carrier(UUID, UUID, UUID) IS
  'Returns true iff (user_id, store_id, carrier_id) is an active courier link. NULL inputs return false.';

GRANT EXECUTE ON FUNCTION is_courier_of_carrier(UUID, UUID, UUID)
  TO authenticated, service_role;

-- 5. get_user_courier_carrier_id

CREATE OR REPLACE FUNCTION get_user_courier_carrier_id(
  p_user_id UUID,
  p_store_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_carrier_id UUID;
BEGIN
  IF p_user_id IS NULL OR p_store_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT carrier_id
  INTO v_carrier_id
  FROM user_stores
  WHERE user_id   = p_user_id
    AND store_id  = p_store_id
    AND role      = 'courier'
    AND is_active = TRUE
  LIMIT 1;

  RETURN v_carrier_id;
END;
$$;

COMMENT ON FUNCTION get_user_courier_carrier_id(UUID, UUID) IS
  'Returns carrier_id if the user is an active courier in the store, otherwise NULL. Used by portal middleware.';

GRANT EXECUTE ON FUNCTION get_user_courier_carrier_id(UUID, UUID)
  TO authenticated, service_role;

-- 6. can_add_user_to_store: exclude couriers from seat count

CREATE OR REPLACE FUNCTION can_add_user_to_store(p_store_id UUID)
RETURNS TABLE(
  can_add BOOLEAN,
  current_users INTEGER,
  max_users INTEGER,
  plan_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner_id UUID;
  v_current_plan subscription_plan_type;
  v_max_users INTEGER;
  v_current_users INTEGER;
  v_pending_invites INTEGER;
BEGIN
  SELECT us.user_id INTO v_owner_id
  FROM user_stores us
  WHERE us.store_id = p_store_id
    AND us.role     = 'owner'
    AND us.is_active = true
  LIMIT 1;

  IF v_owner_id IS NOT NULL THEN
    SELECT s.plan INTO v_current_plan
    FROM subscriptions s
    WHERE s.user_id    = v_owner_id
      AND s.is_primary = true
      AND s.status IN ('active', 'trialing')
    LIMIT 1;

    IF v_current_plan IS NULL THEN
      SELECT st.plan INTO v_current_plan
      FROM subscription_trials st
      WHERE st.user_id   = v_owner_id
        AND st.is_active = true
        AND st.trial_ends_at > NOW()
      LIMIT 1;
    END IF;
  END IF;

  IF v_current_plan IS NULL THEN
    v_current_plan := 'free';
  END IF;

  SELECT pl.max_users INTO v_max_users
  FROM plan_limits pl
  WHERE pl.plan = v_current_plan;

  IF v_max_users IS NULL THEN
    v_max_users := 1;
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_current_users
  FROM user_stores us2
  WHERE us2.store_id = p_store_id
    AND us2.is_active = true
    AND us2.role <> 'courier';

  SELECT COUNT(*)::INTEGER INTO v_pending_invites
  FROM collaborator_invitations ci
  WHERE ci.store_id = p_store_id
    AND ci.used = false
    AND ci.expires_at > NOW()
    AND ci.assigned_role <> 'courier';

  RETURN QUERY
  SELECT
    (v_max_users = -1) OR ((v_current_users + v_pending_invites) < v_max_users) AS can_add,
    v_current_users,
    v_max_users,
    v_current_plan::TEXT;
END;
$$;

COMMENT ON FUNCTION can_add_user_to_store(UUID) IS
  'Plan-seat check. Excludes role=courier from both active count and pending-invite count.';

GRANT EXECUTE ON FUNCTION can_add_user_to_store(UUID)
  TO authenticated, service_role;

-- 7. accept_invitation_atomic: courier-aware (signature change adds carrier_id)

DROP FUNCTION IF EXISTS accept_invitation_atomic(TEXT, UUID, TEXT);

CREATE OR REPLACE FUNCTION accept_invitation_atomic(
  p_token TEXT,
  p_user_id UUID,
  p_invited_email TEXT
)
RETURNS TABLE(
  success BOOLEAN,
  error_code TEXT,
  error_message TEXT,
  store_id UUID,
  assigned_role TEXT,
  inviting_user_id UUID,
  carrier_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_invitation collaborator_invitations%ROWTYPE;
  v_store_users INT;
  v_max_users INT;
  v_current_plan subscription_plan_type;
  v_owner_id UUID;
  v_can_add BOOLEAN;
  v_link_exists BOOLEAN;
  v_is_courier BOOLEAN;
BEGIN
  SELECT *
  INTO v_invitation
  FROM collaborator_invitations
  WHERE token         = p_token
    AND used          = false
    AND expires_at    > NOW()
    AND invited_email = p_invited_email
  FOR UPDATE NOWAIT;

  IF NOT FOUND THEN
    RETURN QUERY SELECT
      false, 'INVALID_TOKEN'::TEXT,
      'La invitacion no es valida, ya fue usada, o expiro'::TEXT,
      NULL::UUID, NULL::TEXT, NULL::UUID, NULL::UUID;
    RETURN;
  END IF;

  v_is_courier := (v_invitation.assigned_role = 'courier');

  IF v_is_courier AND v_invitation.carrier_id IS NULL THEN
    RETURN QUERY SELECT
      false, 'INVALID_INVITATION'::TEXT,
      'Invitacion de courier sin carrier_id asignado'::TEXT,
      NULL::UUID, NULL::TEXT, NULL::UUID, NULL::UUID;
    RETURN;
  END IF;

  IF NOT v_is_courier THEN
    SELECT us.user_id INTO v_owner_id
    FROM user_stores us
    WHERE us.store_id = v_invitation.store_id
      AND us.role     = 'owner'
      AND us.is_active = true
    LIMIT 1;

    IF v_owner_id IS NOT NULL THEN
      SELECT COALESCE(s.plan, 'free'::subscription_plan_type)
      INTO v_current_plan
      FROM subscriptions s
      WHERE s.user_id    = v_owner_id
        AND s.is_primary = true
        AND s.status IN ('active', 'trialing')
      LIMIT 1;
    END IF;

    IF v_current_plan IS NULL THEN
      v_current_plan := 'free';
    END IF;

    SELECT pl.max_users INTO v_max_users
    FROM plan_limits pl
    WHERE pl.plan = v_current_plan;

    IF v_max_users IS NULL THEN
      v_max_users := 1;
    END IF;

    SELECT COUNT(*)::INT
    INTO v_store_users
    FROM user_stores
    WHERE store_id  = v_invitation.store_id
      AND is_active = true
      AND role     <> 'courier';

    v_can_add := (v_max_users = -1) OR (v_store_users < v_max_users);

    IF NOT v_can_add THEN
      RETURN QUERY SELECT
        false, 'USER_LIMIT_REACHED'::TEXT,
        format('La tienda alcanzo el limite de usuarios (%s/%s) del plan %s',
          v_store_users, v_max_users, v_current_plan)::TEXT,
        NULL::UUID, NULL::TEXT, NULL::UUID, NULL::UUID;
      RETURN;
    END IF;
  END IF;

  SELECT EXISTS(
    SELECT 1
    FROM user_stores
    WHERE user_id   = p_user_id
      AND store_id  = v_invitation.store_id
      AND is_active = true
  ) INTO v_link_exists;

  IF v_link_exists THEN
    RETURN QUERY SELECT
      false, 'ALREADY_MEMBER'::TEXT,
      'Ya eres miembro de esta tienda'::TEXT,
      NULL::UUID, NULL::TEXT, NULL::UUID, NULL::UUID;
    RETURN;
  END IF;

  UPDATE collaborator_invitations
  SET used            = true,
      used_at         = NOW(),
      used_by_user_id = p_user_id
  WHERE id = v_invitation.id;

  INSERT INTO user_stores (
    user_id, store_id, role, carrier_id,
    invited_by, invited_at, is_active
  )
  VALUES (
    p_user_id,
    v_invitation.store_id,
    v_invitation.assigned_role,
    v_invitation.carrier_id,
    v_invitation.inviting_user_id,
    NOW(),
    true
  );

  RETURN QUERY SELECT
    true, NULL::TEXT, NULL::TEXT,
    v_invitation.store_id,
    v_invitation.assigned_role::TEXT,
    v_invitation.inviting_user_id,
    v_invitation.carrier_id;

EXCEPTION
  WHEN lock_not_available THEN
    RETURN QUERY SELECT
      false, 'CONCURRENT_CLAIM'::TEXT,
      'Otro usuario esta procesando esta invitacion. Intenta nuevamente en unos segundos.'::TEXT,
      NULL::UUID, NULL::TEXT, NULL::UUID, NULL::UUID;
  WHEN OTHERS THEN
    RETURN QUERY SELECT
      false, 'INTERNAL_ERROR'::TEXT,
      format('Error interno: %s', SQLERRM)::TEXT,
      NULL::UUID, NULL::TEXT, NULL::UUID, NULL::UUID;
END;
$$;

COMMENT ON FUNCTION accept_invitation_atomic(TEXT, UUID, TEXT) IS
  'Atomic invitation acceptance. Courier-aware: returns carrier_id, propagates it to user_stores, bypasses seat-cap for couriers.';

GRANT EXECUTE ON FUNCTION accept_invitation_atomic(TEXT, UUID, TEXT)
  TO authenticated, service_role;

-- ROLLBACK (manual)
-- ALTER TABLE user_stores DROP CONSTRAINT IF EXISTS courier_role_requires_carrier;
-- DROP INDEX IF EXISTS idx_user_stores_carrier_id;
-- DROP INDEX IF EXISTS idx_user_stores_courier_lookup;
-- ALTER TABLE user_stores DROP COLUMN IF EXISTS carrier_id;
-- ALTER TABLE user_stores DROP COLUMN IF EXISTS last_active_at;
-- ALTER TABLE collaborator_invitations DROP CONSTRAINT IF EXISTS courier_invitation_requires_carrier;
-- DROP INDEX IF EXISTS idx_invitations_carrier_id;
-- ALTER TABLE collaborator_invitations DROP COLUMN IF EXISTS carrier_id;
-- ALTER TABLE collaborator_invitations DROP CONSTRAINT IF EXISTS valid_role;
-- ALTER TABLE collaborator_invitations ADD CONSTRAINT valid_role CHECK
--   (assigned_role IN ('owner','admin','logistics','confirmador','contador','inventario'));
-- DROP VIEW IF EXISTS v_carrier_operators;
-- DROP FUNCTION IF EXISTS is_courier_of_carrier(UUID, UUID, UUID);
-- DROP FUNCTION IF EXISTS get_user_courier_carrier_id(UUID, UUID);
-- (Restore prior bodies of accept_invitation_atomic and can_add_user_to_store
--  from migrations 078/030 plus any subsequent patches.)

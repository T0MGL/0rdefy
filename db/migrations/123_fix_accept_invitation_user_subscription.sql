-- ================================================================
-- Migration 123: Fix accept_invitation_atomic to use user-level subscriptions
-- ================================================================
-- Created: 2026-02-04
-- Author: Bright Idea
--
-- CRITICAL BUG FIX:
-- accept_invitation_atomic() from migration 078 reads deprecated columns:
--   stores.subscription_plan (always 'free' - never updated since migration 030)
--   stores.max_users (always 1 - never updated since migration 030)
--
-- This caused the function to use stale per-store plan data instead of
-- the owner's user-level subscription from the subscriptions table.
--
-- FIX: Look up store owner -> read owner's subscription from subscriptions
--      table -> get max_users from plan_limits (same pattern as migration 054)
--
-- DEPENDENCIES:
-- - Migration 030: collaborator_invitations table, user_stores table
-- - Migration 036: subscriptions table, plan_limits table, subscription_plan_type enum
-- - Migration 052: subscriptions.user_id, subscriptions.is_primary
-- - Migration 054: establishes owner-lookup pattern for plan resolution
--
-- IDEMPOTENT: Yes (CREATE OR REPLACE)
-- ROLLBACK: Re-run migration 078 to restore old (broken) version
-- ================================================================

BEGIN;

-- ================================================================
-- DEPENDENCY CHECK
-- ================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'subscriptions'
    ) THEN
        RAISE EXCEPTION 'Missing dependency: subscriptions table not found. Run migration 036 first.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'subscriptions'
          AND column_name = 'user_id'
    ) THEN
        RAISE EXCEPTION 'Missing dependency: subscriptions.user_id not found. Run migration 052 first.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'subscriptions'
          AND column_name = 'is_primary'
    ) THEN
        RAISE EXCEPTION 'Missing dependency: subscriptions.is_primary not found. Run migration 052 first.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'plan_limits'
    ) THEN
        RAISE EXCEPTION 'Missing dependency: plan_limits table not found. Run migration 036 first.';
    END IF;

    RAISE NOTICE 'Migration 123: All dependencies verified';
END $$;

-- ================================================================
-- FUNCTION: accept_invitation_atomic (FIXED)
-- ================================================================
-- Changes from migration 078:
--   BEFORE: SELECT s.subscription_plan, s.max_users FROM stores s
--   AFTER:  Lookup owner -> subscriptions.user_id -> plan_limits.max_users
--
-- Follows exact same pattern as can_add_user_to_store() from migration 054
-- ================================================================

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
  inviting_user_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER  -- Required: bypasses RLS for cross-table lookups
AS $$
DECLARE
  v_invitation collaborator_invitations%ROWTYPE;
  v_store_users INT;
  v_max_users INT;
  v_current_plan subscription_plan_type;  -- Proper enum type (not TEXT)
  v_owner_id UUID;
  v_can_add BOOLEAN;
  v_link_exists BOOLEAN;
BEGIN
  -- ============================================================
  -- STEP 1: Claim invitation atomically with row-level lock
  -- ============================================================
  -- FOR UPDATE NOWAIT: acquires exclusive row lock immediately
  -- If another transaction holds the lock, fails with lock_not_available
  -- This prevents two concurrent requests from claiming the same invitation
  SELECT *
  INTO v_invitation
  FROM collaborator_invitations
  WHERE token = p_token
    AND used = false
    AND expires_at > NOW()
    AND invited_email = p_invited_email
  FOR UPDATE NOWAIT;

  -- ============================================================
  -- STEP 2: Handle not found (invalid/used/expired token)
  -- ============================================================
  IF NOT FOUND THEN
    RETURN QUERY SELECT
      false,
      'INVALID_TOKEN'::TEXT,
      'La invitacion no es valida, ya fue usada, o expiro'::TEXT,
      NULL::UUID,
      NULL::TEXT,
      NULL::UUID;
    RETURN;
  END IF;

  -- ============================================================
  -- STEP 3: Validate plan limit via OWNER'S USER-LEVEL SUBSCRIPTION
  -- Pattern from migration 054: owner lookup -> subscriptions -> plan_limits
  -- ============================================================

  -- Step 3a: Get store owner
  SELECT us.user_id INTO v_owner_id
  FROM user_stores us
  WHERE us.store_id = v_invitation.store_id
    AND us.role = 'owner'
    AND us.is_active = true
  LIMIT 1;

  -- Step 3b: Get owner's subscription plan
  IF v_owner_id IS NOT NULL THEN
    SELECT COALESCE(s.plan, 'free'::subscription_plan_type)
    INTO v_current_plan
    FROM subscriptions s
    WHERE s.user_id = v_owner_id
      AND s.is_primary = true
      AND s.status IN ('active', 'trialing')
    LIMIT 1;
  END IF;

  -- Default to free if no owner, no subscription, or canceled/past_due subscription
  IF v_current_plan IS NULL THEN
    v_current_plan := 'free';
  END IF;

  -- Step 3c: Get max_users from plan_limits
  SELECT pl.max_users INTO v_max_users
  FROM plan_limits pl
  WHERE pl.plan = v_current_plan;

  -- Fallback: if plan not in plan_limits table, default to 1 (most restrictive)
  IF v_max_users IS NULL THEN
    v_max_users := 1;
  END IF;

  -- Step 3d: Count current active users in store
  SELECT COUNT(*)::INT
  INTO v_store_users
  FROM user_stores
  WHERE store_id = v_invitation.store_id
    AND is_active = true;

  -- Step 3e: Check if can add (unlimited if max_users = -1)
  v_can_add := (v_max_users = -1) OR (v_store_users < v_max_users);

  IF NOT v_can_add THEN
    RETURN QUERY SELECT
      false,
      'USER_LIMIT_REACHED'::TEXT,
      format('La tienda alcanzo el limite de usuarios (%s/%s) del plan %s',
        v_store_users, v_max_users, v_current_plan)::TEXT,
      NULL::UUID,
      NULL::TEXT,
      NULL::UUID;
    RETURN;
  END IF;

  -- ============================================================
  -- STEP 4: Check if user is already linked to this store
  -- ============================================================
  SELECT EXISTS(
    SELECT 1
    FROM user_stores
    WHERE user_id = p_user_id
      AND store_id = v_invitation.store_id
      AND is_active = true
  ) INTO v_link_exists;

  IF v_link_exists THEN
    RETURN QUERY SELECT
      false,
      'ALREADY_MEMBER'::TEXT,
      'Ya eres miembro de esta tienda'::TEXT,
      NULL::UUID,
      NULL::TEXT,
      NULL::UUID;
    RETURN;
  END IF;

  -- ============================================================
  -- STEP 5: Mark invitation as used (within same transaction)
  -- ============================================================
  UPDATE collaborator_invitations
  SET
    used = true,
    used_at = NOW(),
    used_by_user_id = p_user_id
  WHERE id = v_invitation.id;

  -- ============================================================
  -- STEP 6: Create user-store link (within same transaction)
  -- ============================================================
  INSERT INTO user_stores (
    user_id,
    store_id,
    role,
    invited_by,
    invited_at,
    is_active
  )
  VALUES (
    p_user_id,
    v_invitation.store_id,
    v_invitation.assigned_role,
    v_invitation.inviting_user_id,
    NOW(),
    true
  );

  -- ============================================================
  -- STEP 7: Success - Return invitation details
  -- ============================================================
  RETURN QUERY SELECT
    true,
    NULL::TEXT,
    NULL::TEXT,
    v_invitation.store_id,
    v_invitation.assigned_role::TEXT,
    v_invitation.inviting_user_id;

EXCEPTION
  WHEN lock_not_available THEN
    -- Another transaction is processing this invitation right now
    RETURN QUERY SELECT
      false,
      'CONCURRENT_CLAIM'::TEXT,
      'Otro usuario esta procesando esta invitacion. Intenta nuevamente en unos segundos.'::TEXT,
      NULL::UUID,
      NULL::TEXT,
      NULL::UUID;
  WHEN OTHERS THEN
    -- Any other error: transaction rolls back automatically
    RETURN QUERY SELECT
      false,
      'INTERNAL_ERROR'::TEXT,
      format('Error interno: %s', SQLERRM)::TEXT,
      NULL::UUID,
      NULL::TEXT,
      NULL::UUID;
END;
$$;

-- ================================================================
-- PERMISSIONS
-- ================================================================
GRANT EXECUTE ON FUNCTION accept_invitation_atomic(TEXT, UUID, TEXT)
TO authenticated, service_role;

-- ================================================================
-- METADATA
-- ================================================================
COMMENT ON FUNCTION accept_invitation_atomic(TEXT, UUID, TEXT) IS
'Migration 123: Fixed to use owner user-level subscription instead of deprecated stores.subscription_plan/max_users columns.

CRITICAL FIX:
  BEFORE (migration 078): Read stores.subscription_plan (always free) and stores.max_users (always 1)
  AFTER (migration 123): Looks up store owner -> reads subscriptions.user_id -> gets plan_limits.max_users

CONCURRENCY:
  Uses FOR UPDATE NOWAIT to acquire exclusive row lock on invitation.
  If row locked by another transaction, fails immediately with CONCURRENT_CLAIM.

PLAN RESOLUTION (same pattern as migration 054):
  1. Find store owner from user_stores (role=owner, is_active=true)
  2. Get owner primary subscription (is_primary=true, status IN active/trialing)
  3. Look up max_users from plan_limits table
  4. Fallback: no owner or no subscription = free plan (max_users=1)

ERROR CODES:
  INVALID_TOKEN, USER_LIMIT_REACHED, ALREADY_MEMBER, CONCURRENT_CLAIM, INTERNAL_ERROR';

-- ================================================================
-- VERIFICATION
-- ================================================================
DO $$
DECLARE
  v_function_exists BOOLEAN;
  v_function_source TEXT;
BEGIN
  -- Verify function exists
  SELECT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'accept_invitation_atomic'
  ) INTO v_function_exists;

  IF NOT v_function_exists THEN
    RAISE EXCEPTION 'Migration 123 FAILED: accept_invitation_atomic function not created';
  END IF;

  -- Verify function source no longer references stores.subscription_plan
  SELECT prosrc INTO v_function_source
  FROM pg_proc WHERE proname = 'accept_invitation_atomic';

  IF v_function_source ILIKE '%s.subscription_plan%' OR v_function_source ILIKE '%s.max_users%' THEN
    RAISE EXCEPTION 'Migration 123 FAILED: function still references deprecated stores columns';
  END IF;

  IF v_function_source NOT ILIKE '%subscriptions%' THEN
    RAISE EXCEPTION 'Migration 123 FAILED: function does not reference subscriptions table';
  END IF;

  IF v_function_source NOT ILIKE '%plan_limits%' THEN
    RAISE EXCEPTION 'Migration 123 FAILED: function does not reference plan_limits table';
  END IF;

  RAISE NOTICE '================================================================';
  RAISE NOTICE 'Migration 123 VERIFIED: accept_invitation_atomic FIXED';
  RAISE NOTICE '================================================================';
  RAISE NOTICE 'Function source verified:';
  RAISE NOTICE '  - Does NOT reference stores.subscription_plan';
  RAISE NOTICE '  - Does NOT reference stores.max_users';
  RAISE NOTICE '  - DOES reference subscriptions table (owner lookup)';
  RAISE NOTICE '  - DOES reference plan_limits table (max_users lookup)';
  RAISE NOTICE '  - SECURITY DEFINER enabled (RLS bypass)';
  RAISE NOTICE '  - GRANT to authenticated, service_role';
  RAISE NOTICE '================================================================';
END $$;

COMMIT;

-- ================================================================
-- Migration 078: Fix Invitation Race Condition
-- ================================================================
-- Created: 2026-01-18
-- Author: Bright Idea
--
-- DEPENDENCIES:
-- - Migration 030: collaborator_invitations table
-- - Migration 036: stores.subscription_plan, stores.max_users columns
--
-- Purpose:
-- Fix critical race condition in collaborator invitation acceptance
-- where two concurrent requests can use the same invitation token.
--
-- PROBLEM SOLVED:
-- Two concurrent requests could both:
-- 1. Read invitation with used=false
-- 2. Update invitation to used=true
-- 3. Both create user_stores entries
-- Result: 2 users added with 1 invitation, plan limits bypassed
--
-- SOLUTION:
-- Atomic invitation claim with row-level locking (SELECT FOR UPDATE NOWAIT)
-- All validations + claim + user-store link in single transaction
-- If any step fails, entire transaction rolls back automatically
-- ================================================================

-- ================================================================
-- DEPENDENCY CHECK
-- ================================================================
DO $$
BEGIN
    -- Check collaborator_invitations table exists (from migration 030)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'collaborator_invitations'
    ) THEN
        RAISE EXCEPTION 'Missing dependency: collaborator_invitations table not found. Run migration 030 first.';
    END IF;

    -- Check user_stores table exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'user_stores'
    ) THEN
        RAISE EXCEPTION 'Missing dependency: user_stores table not found.';
    END IF;

    -- Check stores table has required columns
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'stores'
          AND column_name = 'max_users'
    ) THEN
        RAISE EXCEPTION 'Missing dependency: stores.max_users column not found. Run migration 036 first.';
    END IF;

    RAISE NOTICE '✓ All dependencies verified';
END $$;

-- ================================================================
-- FUNCTION: accept_invitation_atomic
-- ================================================================
-- Atomically accepts a collaborator invitation with row-level locking
-- to prevent race conditions where two users claim same invitation.
--
-- PARAMETERS:
--   p_token          TEXT - Invitation token (64 char hex)
--   p_user_id        UUID - User ID accepting the invitation
--   p_invited_email  TEXT - Email that was invited (security check)
--
-- RETURNS: Table with success/error info
--   - success: true if accepted, false if error
--   - error_code: INVALID_TOKEN | USER_LIMIT_REACHED | ALREADY_MEMBER | CONCURRENT_CLAIM | INTERNAL_ERROR
--   - error_message: User-friendly error in Spanish
--   - store_id: Store ID (on success)
--   - assigned_role: Role assigned (on success)
--   - inviting_user_id: User who sent invitation (on success)
--
-- CONCURRENCY:
--   Uses FOR UPDATE NOWAIT to acquire exclusive row lock
--   If row locked by another transaction, fails with CONCURRENT_CLAIM
--
-- TRANSACTION:
--   All operations (validation + update + insert) in single transaction
--   If any fails, entire transaction rolls back automatically
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
AS $$
DECLARE
  v_invitation collaborator_invitations%ROWTYPE;
  v_store_users INT;
  v_max_users INT;
  v_plan TEXT;
  v_can_add BOOLEAN;
  v_link_exists BOOLEAN;
BEGIN
  -- ============================================================
  -- STEP 1: Claim invitation atomically with row-level lock
  -- ============================================================
  -- FOR UPDATE NOWAIT blocks other transactions from reading/writing
  -- NOWAIT fails immediately if row already locked (prevents waiting)
  SELECT *
  INTO v_invitation
  FROM collaborator_invitations
  WHERE token = p_token
    AND used = false
    AND expires_at > NOW()
    AND invited_email = p_invited_email  -- Security: Ensure email matches
  FOR UPDATE NOWAIT;

  -- ============================================================
  -- STEP 2: Handle not found (invalid/used/expired token)
  -- ============================================================
  IF NOT FOUND THEN
    RETURN QUERY SELECT
      false,
      'INVALID_TOKEN'::TEXT,
      'La invitación no es válida, ya fue usada, o expiró'::TEXT,
      NULL::UUID,
      NULL::TEXT,
      NULL::UUID;
    RETURN;
  END IF;

  -- ============================================================
  -- STEP 3: Validate plan limit (inline to avoid function conflicts)
  -- ============================================================
  -- Get current active users count
  SELECT COUNT(*)
  INTO v_store_users
  FROM user_stores
  WHERE store_id = v_invitation.store_id
    AND is_active = true;

  -- Get plan limit
  SELECT s.subscription_plan, s.max_users
  INTO v_plan, v_max_users
  FROM stores s
  WHERE s.id = v_invitation.store_id;

  -- Check if can add
  v_can_add := (v_store_users < v_max_users);

  IF NOT v_can_add THEN
    RETURN QUERY SELECT
      false,
      'USER_LIMIT_REACHED'::TEXT,
      format('La tienda alcanzó el límite de usuarios (%s/%s) del plan %s',
        v_store_users, v_max_users, v_plan)::TEXT,
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
      'Otro usuario está procesando esta invitación. Intenta nuevamente en unos segundos.'::TEXT,
      NULL::UUID,
      NULL::TEXT,
      NULL::UUID;
  WHEN OTHERS THEN
    -- Any other error: rollback entire transaction automatically
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
-- PERFORMANCE INDEX
-- ================================================================
-- Partial index for fast lookup of available (unused) invitations
-- Only indexes rows where used=false to keep index small

CREATE INDEX IF NOT EXISTS idx_collaborator_invitations_token_lookup
ON collaborator_invitations(token, used, expires_at)
WHERE used = false;

-- ================================================================
-- METADATA & PERMISSIONS
-- ================================================================

COMMENT ON FUNCTION accept_invitation_atomic(TEXT, UUID, TEXT) IS
'Atomically accepts a collaborator invitation with row-level locking to prevent race conditions.

RACE CONDITION FIXED:
  Before: Two concurrent requests could both claim same invitation
  After: First request locks row, second fails with CONCURRENT_CLAIM

USAGE:
  SELECT * FROM accept_invitation_atomic(
    ''abc123...''::TEXT,
    ''550e8400-e29b-41d4-a716-446655440000''::UUID,
    ''user@example.com''::TEXT
  );

ERROR CODES:
  INVALID_TOKEN, USER_LIMIT_REACHED, ALREADY_MEMBER, CONCURRENT_CLAIM, INTERNAL_ERROR';

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION accept_invitation_atomic(TEXT, UUID, TEXT)
TO authenticated, service_role;

-- ================================================================
-- MIGRATION VERIFICATION
-- ================================================================

DO $$
DECLARE
    v_function_exists BOOLEAN;
    v_index_exists BOOLEAN;
BEGIN
    -- Verify accept_invitation_atomic created
    SELECT EXISTS (
        SELECT 1 FROM pg_proc WHERE proname = 'accept_invitation_atomic'
    ) INTO v_function_exists;

    IF NOT v_function_exists THEN
        RAISE EXCEPTION 'Migration failed: accept_invitation_atomic function not created';
    END IF;

    -- Verify index created
    SELECT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE indexname = 'idx_collaborator_invitations_token_lookup'
    ) INTO v_index_exists;

    IF NOT v_index_exists THEN
        RAISE EXCEPTION 'Migration failed: idx_collaborator_invitations_token_lookup not created';
    END IF;

    RAISE NOTICE '================================================================';
    RAISE NOTICE 'Migration 078 complete: Invitation Race Condition Fixed';
    RAISE NOTICE '================================================================';
    RAISE NOTICE '✓ Created: accept_invitation_atomic() function';
    RAISE NOTICE '✓ Created: idx_collaborator_invitations_token_lookup index';
    RAISE NOTICE '✓ Permissions: Granted to authenticated, service_role';
    RAISE NOTICE '';
    RAISE NOTICE 'Race Condition Fixed:';
    RAISE NOTICE '  BEFORE: Request A and B both claim same invitation ❌';
    RAISE NOTICE '  AFTER:  Request A locks row, B gets CONCURRENT_CLAIM ✅';
    RAISE NOTICE '';
    RAISE NOTICE 'Security:';
    RAISE NOTICE '  • Row-level locking (FOR UPDATE NOWAIT)';
    RAISE NOTICE '  • Email validation (invited_email must match)';
    RAISE NOTICE '  • Expiration check (expires_at > NOW())';
    RAISE NOTICE '  • Plan limit enforcement (atomic validation)';
    RAISE NOTICE '  • Duplicate prevention (ALREADY_MEMBER check)';
    RAISE NOTICE '================================================================';
END $$;

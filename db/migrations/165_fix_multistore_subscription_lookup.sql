-- Migration 165: Fix multi-store subscription resolution (CRITICAL P0)
--
-- ROOT CAUSE
--   Migration 052 moved subscriptions from store-level to user-level
--   (one subscription per owner, covering N stores per plan).
--   Migration 054 patched get_store_usage / has_feature_access /
--   can_add_user_to_store to look up the owner first, then read the
--   owner's user-level subscription.
--
--   However:
--   1) get_store_user_stats (consumed by GET /api/collaborators/stats,
--      which drives the "Invitar" button in TeamManagement.tsx) was never
--      updated. It still does:
--        FROM stores st LEFT JOIN subscriptions s ON s.store_id = st.id
--      Because the subscription only carries the FIRST store_id, every
--      additional store of the same owner falls through to plan='free',
--      max_users=1, slots_available=0 and the UI disables invitations.
--
--   2) The current production version of can_add_user_to_store reads
--      stores.subscription_plan and stores.max_users (denormalized columns
--      that default to 'free' / 1 on store creation). This is the legacy
--      pre-052 implementation, which silently regressed at some point
--      after migration 054. It only works for stores where someone
--      manually wrote 'professional' / 25 onto the store row, which is
--      unreliable and contradicts the user-level subscription model.
--
-- IMPACT
--   - 2 users on Professional plan with multiple stores blocked from
--     inviting collaborators on their non-primary stores.
--   - Frontend "Invitar" button disabled despite paid subscription.
--   - Revenue blocker: customers paying for multi-store cannot use it.
--
-- FIX
--   Replace both functions with the owner-lookup pattern from migration 054:
--     1. Resolve store owner from user_stores.
--     2. Resolve owner's plan from subscriptions.user_id + is_primary
--        (status active or trialing).
--     3. Fall back to subscription_trials, then 'free'.
--     4. Read max_users (and other limits) from plan_limits.
--   Stop reading the denormalized stores.subscription_plan / stores.max_users
--   columns entirely. Those columns remain in the schema for back-compat
--   but will be dropped in a follow-up migration once we confirm no other
--   reader exists.
--
-- VERIFICATION
--   Post-deploy, get_store_user_stats(<any owned store>) must return the
--   owner's plan, not 'free', for users on paid subscriptions.
--   Test specifically with Gaston (3 stores) and rojasfigueredo1995
--   (2 stores). Both should report plan=professional, max_users=25 on
--   every owned store.

BEGIN;

-- ============================================================================
-- 1) get_store_user_stats: owner -> user-level subscription -> plan_limits
-- ============================================================================

DROP FUNCTION IF EXISTS get_store_user_stats(UUID);

CREATE OR REPLACE FUNCTION get_store_user_stats(p_store_id UUID)
RETURNS TABLE (
  current_users INTEGER,
  pending_invitations INTEGER,
  max_users INTEGER,
  plan TEXT,
  slots_available INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_owner_id UUID;
  v_current_plan subscription_plan_type;
  v_max_users INTEGER;
  v_current_users INTEGER;
  v_pending_invites INTEGER;
BEGIN
  -- Step 1: Resolve store owner
  SELECT us.user_id INTO v_owner_id
  FROM user_stores us
  WHERE us.store_id = p_store_id
    AND us.role = 'owner'
    AND us.is_active = true
  LIMIT 1;

  -- Step 2: Resolve owner's primary subscription plan
  IF v_owner_id IS NOT NULL THEN
    SELECT s.plan INTO v_current_plan
    FROM subscriptions s
    WHERE s.user_id = v_owner_id
      AND s.is_primary = true
      AND s.status IN ('active', 'trialing')
    LIMIT 1;

    -- Step 2b: Fall back to active trial if no live subscription
    IF v_current_plan IS NULL THEN
      SELECT st.plan INTO v_current_plan
      FROM subscription_trials st
      WHERE st.user_id = v_owner_id
        AND st.is_active = true
        AND st.trial_ends_at > NOW()
      LIMIT 1;
    END IF;
  END IF;

  -- Step 2c: Default to free if no owner / no subscription / no trial
  IF v_current_plan IS NULL THEN
    v_current_plan := 'free';
  END IF;

  -- Step 3: Read plan limit
  SELECT pl.max_users INTO v_max_users
  FROM plan_limits pl
  WHERE pl.plan = v_current_plan;

  -- Defensive default: most restrictive if plan_limits row missing
  IF v_max_users IS NULL THEN
    v_max_users := 1;
  END IF;

  -- Step 4: Count current active users in store
  SELECT COUNT(*)::INTEGER INTO v_current_users
  FROM user_stores us2
  WHERE us2.store_id = p_store_id
    AND us2.is_active = true;

  -- Step 5: Count pending invitations (count against quota same as before)
  SELECT COUNT(*)::INTEGER INTO v_pending_invites
  FROM collaborator_invitations ci
  WHERE ci.store_id = p_store_id
    AND ci.used = false
    AND ci.expires_at > NOW();

  -- Step 6: Return stats
  RETURN QUERY
  SELECT
    v_current_users,
    v_pending_invites,
    v_max_users,
    v_current_plan::TEXT,
    CASE
      WHEN v_max_users = -1 THEN -1
      ELSE GREATEST(v_max_users - v_current_users - v_pending_invites, 0)
    END;
END;
$function$;

COMMENT ON FUNCTION get_store_user_stats(UUID) IS
'Migration 165: Fixed to look up store owner first, then resolve owner''s user-level subscription plan. Replaces broken JOIN on subscriptions.store_id that returned plan=free for all non-primary stores of multi-store owners.';

-- ============================================================================
-- 2) can_add_user_to_store: same owner-lookup pattern
--    (current production version reads stores.subscription_plan; replaced)
-- ============================================================================

DROP FUNCTION IF EXISTS can_add_user_to_store(UUID);

CREATE OR REPLACE FUNCTION can_add_user_to_store(p_store_id UUID)
RETURNS TABLE (
  can_add BOOLEAN,
  current_users INTEGER,
  max_users INTEGER,
  plan_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_owner_id UUID;
  v_current_plan subscription_plan_type;
  v_max_users INTEGER;
  v_current_users INTEGER;
  v_pending_invites INTEGER;
BEGIN
  -- Resolve store owner
  SELECT us.user_id INTO v_owner_id
  FROM user_stores us
  WHERE us.store_id = p_store_id
    AND us.role = 'owner'
    AND us.is_active = true
  LIMIT 1;

  -- Resolve owner's primary subscription
  IF v_owner_id IS NOT NULL THEN
    SELECT s.plan INTO v_current_plan
    FROM subscriptions s
    WHERE s.user_id = v_owner_id
      AND s.is_primary = true
      AND s.status IN ('active', 'trialing')
    LIMIT 1;

    IF v_current_plan IS NULL THEN
      SELECT st.plan INTO v_current_plan
      FROM subscription_trials st
      WHERE st.user_id = v_owner_id
        AND st.is_active = true
        AND st.trial_ends_at > NOW()
      LIMIT 1;
    END IF;
  END IF;

  IF v_current_plan IS NULL THEN
    v_current_plan := 'free';
  END IF;

  -- Read plan limit
  SELECT pl.max_users INTO v_max_users
  FROM plan_limits pl
  WHERE pl.plan = v_current_plan;

  IF v_max_users IS NULL THEN
    v_max_users := 1;
  END IF;

  -- Count current users + pending invites (consistent with get_store_user_stats)
  SELECT COUNT(*)::INTEGER INTO v_current_users
  FROM user_stores us2
  WHERE us2.store_id = p_store_id
    AND us2.is_active = true;

  SELECT COUNT(*)::INTEGER INTO v_pending_invites
  FROM collaborator_invitations ci
  WHERE ci.store_id = p_store_id
    AND ci.used = false
    AND ci.expires_at > NOW();

  RETURN QUERY
  SELECT
    (v_max_users = -1) OR ((v_current_users + v_pending_invites) < v_max_users) AS can_add,
    v_current_users,
    v_max_users,
    v_current_plan::TEXT;
END;
$function$;

COMMENT ON FUNCTION can_add_user_to_store(UUID) IS
'Migration 165: Replaced legacy denormalized lookup (stores.subscription_plan / stores.max_users) with owner-level subscription resolution. Now consistent with get_store_user_stats and accept_invitation_atomic.';

-- ============================================================================
-- 3) Data hygiene: trim trailing whitespace on stores.subscription_plan
--    (bright-idea row contains "professional\n" which would break enum cast)
-- ============================================================================

UPDATE stores
SET subscription_plan = trim(both from subscription_plan)
WHERE subscription_plan IS NOT NULL
  AND subscription_plan <> trim(both from subscription_plan);

-- ============================================================================
-- 4) Backfill stores.subscription_plan / stores.max_users from owner's
--    real subscription, so any remaining caller of those denormalized
--    columns reads consistent values until we drop them entirely.
-- ============================================================================

WITH owner_plans AS (
  SELECT
    us.store_id,
    sub.plan::TEXT      AS plan,
    pl.max_users        AS max_users
  FROM user_stores us
  JOIN subscriptions sub
    ON sub.user_id = us.user_id
   AND sub.is_primary = true
   AND sub.status IN ('active', 'trialing')
  JOIN plan_limits pl ON pl.plan = sub.plan
  WHERE us.role = 'owner'
    AND us.is_active = true
)
UPDATE stores st
SET
  subscription_plan = op.plan,
  max_users         = op.max_users
FROM owner_plans op
WHERE st.id = op.store_id
  AND (
       COALESCE(st.subscription_plan, '') <> op.plan
    OR COALESCE(st.max_users, -2)        <> op.max_users
  );

-- ============================================================================
-- 5) Verification
-- ============================================================================

DO $$
DECLARE
  v_gaston_id UUID := '5752e442-c540-4e16-8f08-8e615be09843';
  v_solenne   UUID := '0b3f13f8-d1dc-48a5-a707-27a095c9c545';
  v_minigenios UUID := '2b5a5638-a956-428a-8d1f-f6cb6a90d597';
  r RECORD;
BEGIN
  RAISE NOTICE '=== Migration 165 verification ===';

  FOR r IN
    SELECT 'Solenne (Gaston non-primary)' AS label, *
    FROM get_store_user_stats(v_solenne)
    UNION ALL
    SELECT 'MiniGenios (rojasfigueredo non-primary)', *
    FROM get_store_user_stats(v_minigenios)
  LOOP
    RAISE NOTICE 'store=% plan=% max_users=% slots=%',
      r.label, r.plan, r.max_users, r.slots_available;

    IF r.plan = 'free' THEN
      RAISE EXCEPTION 'Migration 165 FAILED: % still resolves to free plan', r.label;
    END IF;
  END LOOP;

  RAISE NOTICE 'Migration 165 OK: multi-store users resolve to owner subscription';
END $$;

COMMIT;

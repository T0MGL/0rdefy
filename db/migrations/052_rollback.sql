-- ============================================================================
-- ROLLBACK SCRIPT: Migration 052 (Subscriptions User-Level → Store-Level)
-- ============================================================================
--
-- WARNING: This script reverts subscriptions back to store-level architecture.
-- Only execute if migration 052 caused critical issues and you need to rollback.
--
-- CRITICAL CONSIDERATIONS:
-- 1. Users with multiple stores will lose subscriptions for secondary stores
-- 2. Only the PRIMARY store will retain its subscription
-- 3. Stripe customer metadata will still have user_id (requires manual cleanup)
-- 4. Backup your database BEFORE running this rollback
--
-- Usage:
--   psql -h <host> -U <user> -d <database> -f db/migrations/052_rollback.sql
--
-- ============================================================================

BEGIN;

RAISE NOTICE '========================================';
RAISE NOTICE 'ROLLBACK: Migration 052';
RAISE NOTICE '========================================';
RAISE NOTICE 'This will revert subscriptions to store-level architecture';
RAISE NOTICE 'Data loss is expected for multi-store users';
RAISE NOTICE '========================================';

-- ============================================================================
-- PHASE 1: PRE-ROLLBACK VERIFICATION
-- ============================================================================

DO $$
DECLARE
  affected_users INTEGER;
  total_subscriptions INTEGER;
BEGIN
  -- Count users with multiple stores (will lose data)
  SELECT COUNT(DISTINCT user_id) INTO affected_users
  FROM user_stores
  WHERE role = 'owner' AND is_active = true
  GROUP BY user_id
  HAVING COUNT(*) > 1;

  SELECT COUNT(*) INTO total_subscriptions
  FROM subscriptions;

  RAISE NOTICE 'Pre-rollback status:';
  RAISE NOTICE '  Total subscriptions: %', total_subscriptions;
  RAISE NOTICE '  Users with multiple stores (will lose secondary subscriptions): %', COALESCE(affected_users, 0);
  RAISE WARNING 'These users will keep only their PRIMARY store subscription';
END $$;

-- ============================================================================
-- PHASE 2: BACKUP TO HISTORY
-- ============================================================================

-- Archive current state before rollback
INSERT INTO subscription_history (
  subscription_id,
  store_id,
  event_type,
  from_plan,
  metadata
)
SELECT
  s.id as subscription_id,
  s.store_id,
  'rollback_052' as event_type,
  s.plan as from_plan,
  jsonb_build_object(
    'reason', 'Rollback: Reverting from user-level to store-level subscriptions',
    'user_id', s.user_id,
    'is_primary', s.is_primary,
    'status', s.status,
    'rollback_at', NOW()
  ) as metadata
FROM subscriptions s
WHERE s.user_id IS NOT NULL;

RAISE NOTICE 'Archived % subscriptions to history', (SELECT COUNT(*) FROM subscriptions WHERE user_id IS NOT NULL);

-- ============================================================================
-- PHASE 3: RESTORE store_id FOR SUBSCRIPTIONS
-- ============================================================================

-- For users with multiple stores, we'll assign subscription to their FIRST store
-- This matches the migration 052 logic (ORDER BY created_at ASC LIMIT 1)
UPDATE subscriptions s
SET store_id = (
  SELECT us.store_id
  FROM user_stores us
  WHERE us.user_id = s.user_id
    AND us.role = 'owner'
    AND us.is_active = true
  ORDER BY us.created_at ASC  -- Take oldest store (matches migration 052 logic)
  LIMIT 1
)
WHERE s.store_id IS NULL AND s.user_id IS NOT NULL;

RAISE NOTICE 'Restored store_id for subscriptions';

-- Verify all subscriptions have store_id
DO $$
DECLARE
  orphaned_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO orphaned_count
  FROM subscriptions
  WHERE store_id IS NULL;

  IF orphaned_count > 0 THEN
    RAISE WARNING 'Found % subscriptions without store_id after rollback', orphaned_count;
    RAISE WARNING 'These will be deleted in next step';
  END IF;
END $$;

-- Delete subscriptions that couldn't be assigned to a store
DELETE FROM subscriptions WHERE store_id IS NULL;

-- ============================================================================
-- PHASE 4: DROP USER-LEVEL CONSTRAINTS
-- ============================================================================

-- Drop unique constraint added in migration 052
ALTER TABLE subscriptions
DROP CONSTRAINT IF EXISTS unique_user_primary_subscription;

-- Drop unique index
DROP INDEX IF EXISTS subscriptions_user_id_primary_unique;

-- Drop other indexes
DROP INDEX IF EXISTS idx_subscriptions_user_id;
DROP INDEX IF EXISTS idx_subscriptions_user_id_status;

RAISE NOTICE 'Dropped user-level constraints and indexes';

-- ============================================================================
-- PHASE 5: RE-ADD STORE-LEVEL CONSTRAINTS
-- ============================================================================

-- Restore foreign key constraint on store_id
ALTER TABLE subscriptions
ADD CONSTRAINT subscriptions_store_id_fkey
FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE;

-- Make store_id NOT NULL again
ALTER TABLE subscriptions
ALTER COLUMN store_id SET NOT NULL;

RAISE NOTICE 'Restored store-level constraints';

-- ============================================================================
-- PHASE 6: REMOVE USER-LEVEL COLUMNS
-- ============================================================================

-- Drop user_id column
ALTER TABLE subscriptions
DROP COLUMN IF EXISTS user_id;

-- Drop is_primary column
ALTER TABLE subscriptions
DROP COLUMN IF EXISTS is_primary;

RAISE NOTICE 'Removed user-level columns (user_id, is_primary)';

-- ============================================================================
-- PHASE 7: DROP NEW RPC FUNCTIONS
-- ============================================================================

DROP FUNCTION IF EXISTS get_user_subscription(UUID);
DROP FUNCTION IF EXISTS get_store_plan_via_owner(UUID);
DROP FUNCTION IF EXISTS get_user_usage(UUID);
DROP FUNCTION IF EXISTS can_create_store(UUID);

RAISE NOTICE 'Dropped user-level RPC functions';

-- ============================================================================
-- PHASE 8: RESTORE OLD can_add_user_to_store (store-level version)
-- ============================================================================

-- Restore the original store-level version of can_add_user_to_store
-- This version queries subscriptions by store_id, not user_id

DROP FUNCTION IF EXISTS can_add_user_to_store(UUID);

CREATE OR REPLACE FUNCTION can_add_user_to_store(p_store_id UUID)
RETURNS TABLE (
  can_add BOOLEAN,
  current_users INTEGER,
  max_users INTEGER,
  reason TEXT
) AS $$
DECLARE
  v_current_plan subscription_plan_type;
  v_max_users INTEGER;
  v_current_users INTEGER;
BEGIN
  -- Get store's subscription plan (OLD store-level logic)
  SELECT COALESCE(s.plan, 'free'::subscription_plan_type)
  INTO v_current_plan
  FROM stores st
  LEFT JOIN subscriptions s ON s.store_id = st.id
  WHERE st.id = p_store_id;

  -- Get plan limits
  SELECT pl.max_users INTO v_max_users
  FROM plan_limits pl
  WHERE pl.plan = v_current_plan;

  -- Count current users in store
  SELECT COUNT(*)::INTEGER INTO v_current_users
  FROM user_stores
  WHERE store_id = p_store_id
    AND is_active = true;

  -- Check if can add
  IF v_current_users >= v_max_users THEN
    RETURN QUERY SELECT
      false,
      v_current_users,
      v_max_users,
      format('User limit reached. Current plan (%s) allows %s users.', v_current_plan, v_max_users)::TEXT;
  ELSE
    RETURN QUERY SELECT
      true,
      v_current_users,
      v_max_users,
      format('Can add user. %s of %s users used.', v_current_users, v_max_users)::TEXT;
  END IF;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION can_add_user_to_store(UUID) IS
'Rollback 052: Restored store-level version (queries subscriptions by store_id)';

RAISE NOTICE 'Restored store-level can_add_user_to_store function';

-- ============================================================================
-- PHASE 9: POST-ROLLBACK VERIFICATION
-- ============================================================================

DO $$
DECLARE
  total_subs INTEGER;
  subs_with_store INTEGER;
  subs_without_store INTEGER;
BEGIN
  SELECT COUNT(*) INTO total_subs FROM subscriptions;
  SELECT COUNT(*) INTO subs_with_store FROM subscriptions WHERE store_id IS NOT NULL;
  SELECT COUNT(*) INTO subs_without_store FROM subscriptions WHERE store_id IS NULL;

  RAISE NOTICE '========================================';
  RAISE NOTICE 'Rollback 052 Complete!';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Post-rollback status:';
  RAISE NOTICE '  Total subscriptions: %', total_subs;
  RAISE NOTICE '  Subscriptions with store_id: %', subs_with_store;
  RAISE NOTICE '  Subscriptions without store_id: %', subs_without_store;

  IF subs_without_store > 0 THEN
    RAISE EXCEPTION 'Rollback verification failed: % subscriptions have NULL store_id', subs_without_store;
  END IF;

  -- Verify columns
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'subscriptions' AND column_name = 'user_id'
  ) THEN
    RAISE EXCEPTION 'Rollback verification failed: user_id column still exists';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'subscriptions' AND column_name = 'is_primary'
  ) THEN
    RAISE EXCEPTION 'Rollback verification failed: is_primary column still exists';
  END IF;

  RAISE NOTICE '========================================';
  RAISE NOTICE '✅ Rollback successful';
  RAISE NOTICE '========================================';
  RAISE WARNING 'IMPORTANT: You MUST also:';
  RAISE WARNING '1. Revert backend code changes (stripe.service.ts, billing.ts, stores.ts)';
  RAISE WARNING '2. Clean up Stripe customer metadata (run reverse migration script)';
  RAISE WARNING '3. Re-deploy backend with old store-level code';
  RAISE WARNING '4. Monitor for webhook failures';
  RAISE NOTICE '========================================';
END $$;

COMMIT;

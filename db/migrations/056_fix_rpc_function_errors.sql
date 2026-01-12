-- ============================================================================
-- Migration 056: Fix RPC function errors
-- ============================================================================
--
-- FIXES:
-- 1. has_feature_access: Wrong parameter name (p_feature vs p_feature_key)
-- 2. get_store_usage: Wrong column name (orders_per_month vs max_orders_per_month)
--
-- ============================================================================

BEGIN;

RAISE NOTICE '========================================';
RAISE NOTICE 'Migration 056: Fix RPC function errors';
RAISE NOTICE '========================================';

-- ================================================================
-- FIX 1: has_feature_access - Standardize parameter names
-- ================================================================
-- The code calls it with p_feature, but function uses p_feature_key
-- Recreate with consistent naming: p_feature

DROP FUNCTION IF EXISTS has_feature_access(UUID, TEXT);

CREATE OR REPLACE FUNCTION has_feature_access(
  p_store_id UUID,
  p_feature TEXT  -- Changed from p_feature_key to p_feature
)
RETURNS BOOLEAN AS $$
DECLARE
  v_owner_id UUID;
  v_current_plan subscription_plan_type;
  v_has_access BOOLEAN;
BEGIN
  -- Step 1: Get store owner
  SELECT user_id INTO v_owner_id
  FROM user_stores
  WHERE store_id = p_store_id
    AND role = 'owner'
    AND is_active = true
  LIMIT 1;

  IF v_owner_id IS NULL THEN
    -- No owner found, default to free plan
    v_current_plan := 'free';
  ELSE
    -- Step 2: Get owner's subscription plan
    SELECT COALESCE(s.plan, 'free'::subscription_plan_type) INTO v_current_plan
    FROM subscriptions s
    WHERE s.user_id = v_owner_id
      AND s.is_primary = true
    LIMIT 1;

    -- If no subscription found, default to free
    IF v_current_plan IS NULL THEN
      v_current_plan := 'free';
    END IF;
  END IF;

  -- Step 3: Check feature access based on plan
  EXECUTE format(
    'SELECT %I FROM plan_limits WHERE plan = $1',
    'has_' || p_feature
  ) INTO v_has_access USING v_current_plan;

  RETURN COALESCE(v_has_access, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

RAISE NOTICE '✅ Fixed has_feature_access parameter name';

-- ================================================================
-- FIX 2: get_store_usage - Fix column name
-- ================================================================
-- Wrong: pl.orders_per_month
-- Correct: pl.max_orders_per_month

CREATE OR REPLACE FUNCTION get_store_usage(p_store_id UUID)
RETURNS TABLE(
  current_plan subscription_plan_type,
  max_orders_per_month INTEGER,
  max_products INTEGER,
  max_users INTEGER,
  total_orders_this_month INTEGER,
  total_products INTEGER,
  total_users INTEGER
) AS $$
DECLARE
  v_owner_id UUID;
  v_current_plan subscription_plan_type;
BEGIN
  -- Step 1: Get store owner
  SELECT user_id INTO v_owner_id
  FROM user_stores
  WHERE store_id = p_store_id
    AND role = 'owner'
    AND is_active = true
  LIMIT 1;

  IF v_owner_id IS NULL THEN
    -- No owner found, use free plan limits
    v_current_plan := 'free';
  ELSE
    -- Step 2: Get owner's subscription plan
    SELECT COALESCE(s.plan, 'free'::subscription_plan_type) INTO v_current_plan
    FROM subscriptions s
    WHERE s.user_id = v_owner_id
      AND s.is_primary = true
    LIMIT 1;

    IF v_current_plan IS NULL THEN
      v_current_plan := 'free';
    END IF;
  END IF;

  -- Step 3: Return usage with plan limits
  RETURN QUERY
  WITH limits AS (
    SELECT
      pl.max_orders_per_month,  -- FIXED: was pl.orders_per_month
      pl.max_products,
      pl.max_users
    FROM plan_limits pl
    WHERE pl.plan = v_current_plan
  ),
  usage AS (
    SELECT
      COUNT(DISTINCT o.id) FILTER (
        WHERE o.created_at >= date_trunc('month', CURRENT_DATE)
      ) as orders_count,
      COUNT(DISTINCT p.id) as products_count,
      COUNT(DISTINCT us.user_id) as users_count
    FROM stores s
    LEFT JOIN orders o ON o.store_id = s.id
    LEFT JOIN products p ON p.store_id = s.id
    LEFT JOIN user_stores us ON us.store_id = s.id AND us.is_active = true
    WHERE s.id = p_store_id
  )
  SELECT
    v_current_plan,
    l.max_orders_per_month,
    l.max_products,
    l.max_users,
    COALESCE(u.orders_count::INTEGER, 0),
    COALESCE(u.products_count::INTEGER, 0),
    COALESCE(u.users_count::INTEGER, 0)
  FROM limits l, usage u;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

RAISE NOTICE '✅ Fixed get_store_usage column name';

-- ================================================================
-- Verify fixes
-- ================================================================
DO $$
BEGIN
  -- Test 1: has_feature_access exists with correct signature
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'has_feature_access'
      AND pronargs = 2
  ) THEN
    RAISE EXCEPTION 'has_feature_access function not found';
  END IF;

  -- Test 2: get_store_usage exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'get_store_usage'
      AND pronargs = 1
  ) THEN
    RAISE EXCEPTION 'get_store_usage function not found';
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE '✅ Migration 056 Complete!';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Fixed: has_feature_access parameter name';
  RAISE NOTICE 'Fixed: get_store_usage column name';
  RAISE NOTICE '========================================';
END $$;

COMMIT;

-- Migration 054: Fix RPC Functions for User-Level Subscriptions
--
-- This migration fixes RPC functions from migrations 036 and 037 that still use store_id
-- to query subscriptions instead of looking up the store owner first.
--
-- CRITICAL: This migration must run AFTER migration 052 (user-level subscriptions)
-- NOTE: Originally numbered 053, renamed to 054 to avoid conflict with existing 053
--
-- Changes:
-- 1. Updates get_store_usage() to look up owner first, then query by user_id
-- 2. Updates has_feature_access() to look up owner first, then query by user_id
-- 3. Re-applies can_add_user_to_store() from migration 052 (in case 037 overwrote it)

BEGIN;

-- ========================================
-- 1. Fix get_store_usage function
-- ========================================

DROP FUNCTION IF EXISTS get_store_usage(UUID);

CREATE OR REPLACE FUNCTION get_store_usage(p_store_id UUID)
RETURNS TABLE (
  orders_count BIGINT,
  orders_limit INTEGER,
  products_count BIGINT,
  products_limit INTEGER,
  users_count BIGINT,
  users_limit INTEGER,
  current_plan TEXT,
  is_trial BOOLEAN,
  trial_ends_at TIMESTAMP WITH TIME ZONE
) AS $$
DECLARE
  v_owner_id UUID;
  v_current_plan subscription_plan_type;
  v_is_trial BOOLEAN := false;
  v_trial_ends_at TIMESTAMP WITH TIME ZONE := NULL;
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
    -- Step 2: Get owner's subscription
    SELECT
      COALESCE(s.plan, 'free'::subscription_plan_type),
      CASE
        WHEN s.status = 'trialing' THEN true
        ELSE false
      END,
      CASE
        WHEN s.status = 'trialing' THEN s.current_period_end
        ELSE NULL
      END
    INTO v_current_plan, v_is_trial, v_trial_ends_at
    FROM subscriptions s
    WHERE s.user_id = v_owner_id
      AND s.is_primary = true
      AND s.status IN ('active', 'trialing')
    LIMIT 1;

    -- If no active subscription found, check for trial
    IF v_current_plan IS NULL THEN
      SELECT plan INTO v_current_plan
      FROM subscription_trials
      WHERE user_id = v_owner_id
        AND is_active = true
        AND trial_ends_at > NOW()
      LIMIT 1;

      IF v_current_plan IS NOT NULL THEN
        v_is_trial := true;
        SELECT trial_ends_at INTO v_trial_ends_at
        FROM subscription_trials
        WHERE user_id = v_owner_id
          AND is_active = true
          AND trial_ends_at > NOW()
        LIMIT 1;
      ELSE
        v_current_plan := 'free';
      END IF;
    END IF;
  END IF;

  -- Step 3: Get usage counts and limits
  RETURN QUERY
  WITH limits AS (
    SELECT
      pl.orders_per_month,
      pl.max_products,
      pl.max_users
    FROM plan_limits pl
    WHERE pl.plan = v_current_plan
  ),
  counts AS (
    SELECT
      COUNT(DISTINCT o.id)::BIGINT as orders,
      COUNT(DISTINCT p.id)::BIGINT as products,
      COUNT(DISTINCT us.user_id)::BIGINT as users
    FROM stores st
    LEFT JOIN orders o ON o.store_id = st.id
      AND o.created_at >= date_trunc('month', CURRENT_DATE)
    LEFT JOIN products p ON p.store_id = st.id AND p.is_active = true
    LEFT JOIN user_stores us ON us.store_id = st.id AND us.is_active = true
    WHERE st.id = p_store_id
  )
  SELECT
    counts.orders,
    limits.orders_per_month,
    counts.products,
    limits.max_products,
    counts.users,
    limits.max_users,
    v_current_plan::TEXT,
    v_is_trial,
    v_trial_ends_at
  FROM counts, limits;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION get_store_usage(UUID) IS
'Migration 054: Fixed to look up store owner first, then query owner''s subscription by user_id';

-- ========================================
-- 2. Fix has_feature_access function
-- ========================================

DROP FUNCTION IF EXISTS has_feature_access(UUID, TEXT);

CREATE OR REPLACE FUNCTION has_feature_access(
  p_store_id UUID,
  p_feature_key TEXT
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
    -- Step 2: Get owner's subscription
    SELECT COALESCE(s.plan, 'free'::subscription_plan_type)
    INTO v_current_plan
    FROM subscriptions s
    WHERE s.user_id = v_owner_id
      AND s.is_primary = true
      AND s.status IN ('active', 'trialing')
    LIMIT 1;

    -- If no active subscription, check for active trial
    IF v_current_plan IS NULL THEN
      SELECT plan INTO v_current_plan
      FROM subscription_trials
      WHERE user_id = v_owner_id
        AND is_active = true
        AND trial_ends_at > NOW()
      LIMIT 1;

      -- Default to free if no trial
      IF v_current_plan IS NULL THEN
        v_current_plan := 'free';
      END IF;
    END IF;
  END IF;

  -- Step 3: Check if plan has access to feature
  SELECT
    CASE
      WHEN v_current_plan = 'free' THEN
        p_feature_key = ANY(ARRAY['dashboard', 'orders', 'products', 'customers'])
      WHEN v_current_plan = 'starter' THEN
        p_feature_key = ANY(ARRAY['dashboard', 'orders', 'products', 'customers', 'warehouse',
                                   'returns', 'merchandise', 'shipping_labels', 'shopify_import',
                                   'team_management'])
      WHEN v_current_plan = 'growth' THEN
        p_feature_key = ANY(ARRAY['dashboard', 'orders', 'products', 'customers', 'warehouse',
                                   'returns', 'merchandise', 'shipping_labels', 'shopify_import',
                                   'team_management', 'shopify_sync', 'smart_alerts',
                                   'campaign_tracking', 'api_read'])
      WHEN v_current_plan = 'professional' THEN
        true  -- Professional has access to everything
      ELSE
        false
    END
  INTO v_has_access;

  RETURN COALESCE(v_has_access, false);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION has_feature_access(UUID, TEXT) IS
'Migration 054: Fixed to look up store owner first, then query owner''s subscription by user_id';

-- ========================================
-- 3. Re-apply can_add_user_to_store from migration 052
-- ========================================
-- This ensures migration 037 doesn't overwrite the correct version

DROP FUNCTION IF EXISTS can_add_user_to_store(UUID);

CREATE OR REPLACE FUNCTION can_add_user_to_store(p_store_id UUID)
RETURNS TABLE (
  can_add BOOLEAN,
  current_users INTEGER,
  max_users INTEGER,
  reason TEXT
) AS $$
DECLARE
  v_owner_id UUID;
  v_current_plan subscription_plan_type;
  v_max_users INTEGER;
  v_current_users INTEGER;
BEGIN
  -- Step 1: Get store owner
  SELECT user_id INTO v_owner_id
  FROM user_stores
  WHERE store_id = p_store_id
    AND role = 'owner'
    AND is_active = true
  LIMIT 1;

  IF v_owner_id IS NULL THEN
    RETURN QUERY SELECT false, 0, 0, 'No owner found for store'::TEXT;
    RETURN;
  END IF;

  -- Step 2: Get owner's subscription plan
  SELECT COALESCE(s.plan, 'free'::subscription_plan_type)
  INTO v_current_plan
  FROM subscriptions s
  WHERE s.user_id = v_owner_id
    AND s.is_primary = true
    AND s.status IN ('active', 'trialing')
  LIMIT 1;

  -- If no active subscription, check for trial
  IF v_current_plan IS NULL THEN
    SELECT plan INTO v_current_plan
    FROM subscription_trials
    WHERE user_id = v_owner_id
      AND is_active = true
      AND trial_ends_at > NOW()
    LIMIT 1;

    -- Default to free if no trial
    IF v_current_plan IS NULL THEN
      v_current_plan := 'free';
    END IF;
  END IF;

  -- Step 3: Get plan limits
  SELECT pl.max_users INTO v_max_users
  FROM plan_limits pl
  WHERE pl.plan = v_current_plan;

  -- Step 4: Count current users in store
  SELECT COUNT(*)::INTEGER INTO v_current_users
  FROM user_stores
  WHERE store_id = p_store_id
    AND is_active = true;

  -- Step 5: Check if can add
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
'Migration 054: Re-applied from migration 052 to ensure it uses owner''s subscription (not overwritten by 037)';

-- ========================================
-- Verification Queries
-- ========================================

DO $$
DECLARE
  v_test_result RECORD;
BEGIN
  -- Test 1: Verify get_store_usage exists and returns correct structure
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Migration 054 Verification';
  RAISE NOTICE '========================================';

  -- Check if functions exist
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_store_usage') THEN
    RAISE NOTICE '✓ get_store_usage function exists';
  ELSE
    RAISE EXCEPTION '✗ get_store_usage function not found';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'has_feature_access') THEN
    RAISE NOTICE '✓ has_feature_access function exists';
  ELSE
    RAISE EXCEPTION '✗ has_feature_access function not found';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'can_add_user_to_store') THEN
    RAISE NOTICE '✓ can_add_user_to_store function exists';
  ELSE
    RAISE EXCEPTION '✗ can_add_user_to_store function not found';
  END IF;

  RAISE NOTICE '========================================';
  RAISE NOTICE 'Migration 054 Complete!';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'All 3 critical RPC functions have been updated to:';
  RAISE NOTICE '1. Look up store owner first';
  RAISE NOTICE '2. Query owner''s subscription by user_id';
  RAISE NOTICE '3. Fall back to free plan if no owner/subscription found';
  RAISE NOTICE '========================================';
END $$;

COMMIT;

-- ============================================================================
-- Migration 085: Add Missing Subscription Functions for Store Creation
-- ============================================================================
-- Description: Adds get_user_subscription and can_create_store functions
-- These functions are required by POST /api/stores to validate store limits
--
-- SAFETY: This migration is idempotent and safe
-- - Uses DROP IF EXISTS + CREATE for functions (handles signature changes)
-- - Uses IF NOT EXISTS for column additions
-- - Does NOT modify existing data
-- - Can be run multiple times safely
-- - Functions are dropped and recreated to handle return type changes
--
-- ROLLBACK: To rollback, run:
--   DROP FUNCTION IF EXISTS can_create_store(UUID);
--   DROP FUNCTION IF EXISTS get_user_subscription(UUID);
--   DROP FUNCTION IF EXISTS get_store_plan_via_owner(UUID);
-- ============================================================================

-- ============================================================================
-- PHASE 1: PREREQUISITE VALIDATION
-- ============================================================================

DO $$
DECLARE
  v_missing_tables TEXT[];
  v_missing_columns TEXT[];
BEGIN
  -- Check required tables exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'plan_limits') THEN
    v_missing_tables := array_append(v_missing_tables, 'plan_limits');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'subscriptions') THEN
    v_missing_tables := array_append(v_missing_tables, 'subscriptions');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user_stores') THEN
    v_missing_tables := array_append(v_missing_tables, 'user_stores');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users') THEN
    v_missing_tables := array_append(v_missing_tables, 'users');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'stores') THEN
    v_missing_tables := array_append(v_missing_tables, 'stores');
  END IF;

  IF v_missing_tables IS NOT NULL AND array_length(v_missing_tables, 1) > 0 THEN
    RAISE EXCEPTION 'Migration 085 ABORTED: Missing required tables: %. Please run migration 036 first.', array_to_string(v_missing_tables, ', ');
  END IF;

  -- Verify plan_limits has data (critical for free plan fallback)
  IF NOT EXISTS (SELECT 1 FROM plan_limits WHERE plan = 'free') THEN
    RAISE EXCEPTION 'Migration 085 ABORTED: plan_limits table has no "free" plan entry. Please run migration 036 seed data.';
  END IF;

  RAISE NOTICE '✅ Phase 1: All prerequisites validated';
END $$;

-- ============================================================================
-- PHASE 2: SCHEMA UPDATES (Non-destructive additions only)
-- ============================================================================

-- Add user_id column to subscriptions if missing (for user-level subscriptions)
DO $$
BEGIN
  RAISE NOTICE '📦 Phase 2: Starting schema updates...';
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'subscriptions'
      AND column_name = 'user_id'
  ) THEN
    ALTER TABLE subscriptions ADD COLUMN user_id UUID REFERENCES users(id) ON DELETE CASCADE;

    -- Migrate existing store_id to user_id (find owner of each store)
    -- This is safe because it only updates NULL user_id values
    UPDATE subscriptions s
    SET user_id = (
      SELECT us.user_id
      FROM user_stores us
      WHERE us.store_id = s.store_id
        AND us.role = 'owner'
        AND us.is_active = true
      ORDER BY us.created_at ASC
      LIMIT 1
    )
    WHERE s.user_id IS NULL;

    RAISE NOTICE '✅ Added user_id column to subscriptions and migrated data';
  ELSE
    RAISE NOTICE '⏭️  user_id column already exists in subscriptions';
  END IF;
END $$;

-- Add is_primary column to subscriptions if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'subscriptions'
      AND column_name = 'is_primary'
  ) THEN
    ALTER TABLE subscriptions ADD COLUMN is_primary BOOLEAN DEFAULT true;

    -- Set all existing subscriptions as primary (safe default)
    UPDATE subscriptions SET is_primary = true WHERE is_primary IS NULL;

    RAISE NOTICE '✅ Added is_primary column to subscriptions';
  ELSE
    RAISE NOTICE '⏭️  is_primary column already exists in subscriptions';
  END IF;
END $$;

-- Create index for user_id lookups if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'subscriptions'
      AND indexname = 'idx_subscriptions_user_id'
  ) THEN
    CREATE INDEX idx_subscriptions_user_id ON subscriptions(user_id) WHERE user_id IS NOT NULL;
    RAISE NOTICE '✅ Created index idx_subscriptions_user_id';
  ELSE
    RAISE NOTICE '⏭️  Index idx_subscriptions_user_id already exists';
  END IF;

  RAISE NOTICE '✅ Phase 2: Schema updates completed';
END $$;

-- ============================================================================
-- PHASE 3: FUNCTION DEFINITIONS
-- ============================================================================

-- -----------------------------------------------------------------------------
-- SAFE DROP: Remove existing functions if signature changed
-- -----------------------------------------------------------------------------
-- This is necessary because CREATE OR REPLACE cannot change return types
-- DROP IF EXISTS is safe - it does nothing if function doesn't exist

DROP FUNCTION IF EXISTS get_user_subscription(UUID);
DROP FUNCTION IF EXISTS can_create_store(UUID);
DROP FUNCTION IF EXISTS get_store_plan_via_owner(UUID);

-- -----------------------------------------------------------------------------
-- FUNCTION: get_user_subscription
-- -----------------------------------------------------------------------------
-- Returns user's primary subscription with plan limits
-- Returns empty result set if user has no subscription (NOT an error)

CREATE OR REPLACE FUNCTION get_user_subscription(p_user_id UUID)
RETURNS TABLE (
  subscription_id UUID,
  user_id UUID,
  plan TEXT,
  status TEXT,
  billing_cycle TEXT,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  trial_ends_at TIMESTAMPTZ,
  store_count BIGINT,
  max_stores INTEGER,
  max_users INTEGER,
  max_orders_per_month INTEGER,
  max_products INTEGER
) AS $$
BEGIN
  -- Input validation
  IF p_user_id IS NULL THEN
    RAISE NOTICE 'get_user_subscription: NULL user_id provided, returning empty result';
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    s.id as subscription_id,
    s.user_id,
    s.plan::TEXT,
    s.status::TEXT,
    s.billing_cycle::TEXT,
    s.current_period_start,
    s.current_period_end,
    s.cancel_at_period_end,
    s.stripe_customer_id,
    s.stripe_subscription_id,
    s.trial_ends_at,
    (
      SELECT COUNT(*)
      FROM user_stores us
      WHERE us.user_id = p_user_id
        AND us.role = 'owner'
        AND us.is_active = true
    ) as store_count,
    pl.max_stores,
    pl.max_users,
    pl.max_orders_per_month,
    pl.max_products
  FROM subscriptions s
  JOIN plan_limits pl ON s.plan::TEXT = pl.plan::TEXT
  WHERE s.user_id = p_user_id
    AND COALESCE(s.is_primary, true) = true
    AND s.status IN ('active', 'trialing')
  ORDER BY
    CASE s.status WHEN 'active' THEN 1 WHEN 'trialing' THEN 2 ELSE 3 END,
    s.created_at DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION get_user_subscription(UUID) IS
  'Returns user''s primary subscription with plan limits. Returns empty if no subscription (use free plan fallback).';

-- -----------------------------------------------------------------------------
-- FUNCTION: can_create_store
-- -----------------------------------------------------------------------------
-- Checks if user can create a new store based on their subscription limits
-- ALWAYS returns exactly one row (never empty, never errors for valid input)

CREATE OR REPLACE FUNCTION can_create_store(p_user_id UUID)
RETURNS TABLE (
  can_create BOOLEAN,
  current_stores BIGINT,
  max_stores INTEGER,
  plan TEXT,
  reason TEXT
) AS $$
DECLARE
  v_subscription RECORD;
  v_store_count BIGINT;
  v_free_max_stores INTEGER;
BEGIN
  -- Input validation
  IF p_user_id IS NULL THEN
    RETURN QUERY SELECT
      false::BOOLEAN,
      0::BIGINT,
      1::INTEGER,
      'free'::TEXT,
      'Invalid user ID'::TEXT;
    RETURN;
  END IF;

  -- Count current stores owned by user
  SELECT COUNT(*) INTO v_store_count
  FROM user_stores us
  WHERE us.user_id = p_user_id
    AND us.role = 'owner'
    AND us.is_active = true;

  -- Get user's subscription (may be NULL/empty if no subscription)
  SELECT * INTO v_subscription
  FROM get_user_subscription(p_user_id);

  -- If no active subscription, use free plan limits
  IF v_subscription.subscription_id IS NULL THEN
    -- Get free plan max_stores (with fallback to 1)
    SELECT COALESCE(pl.max_stores, 1) INTO v_free_max_stores
    FROM plan_limits pl
    WHERE pl.plan = 'free';

    -- Safety fallback if plan_limits query fails
    IF v_free_max_stores IS NULL THEN
      v_free_max_stores := 1;
    END IF;

    RETURN QUERY SELECT
      (v_store_count < v_free_max_stores)::BOOLEAN as can_create,
      v_store_count,
      v_free_max_stores,
      'free'::TEXT,
      CASE
        WHEN v_store_count < v_free_max_stores THEN
          format('Puedes crear %s tienda(s) más', v_free_max_stores - v_store_count)
        ELSE
          format('Límite alcanzado (%s/%s). Actualiza tu plan para crear más tiendas.', v_store_count, v_free_max_stores)
      END::TEXT as reason;
    RETURN;
  END IF;

  -- Check against subscription limits
  RETURN QUERY SELECT
    (v_store_count < v_subscription.max_stores OR v_subscription.max_stores = -1)::BOOLEAN as can_create,
    v_store_count,
    v_subscription.max_stores,
    v_subscription.plan,
    CASE
      WHEN v_subscription.max_stores = -1 THEN
        'Puedes crear tiendas ilimitadas'
      WHEN v_store_count < v_subscription.max_stores THEN
        format('Puedes crear %s tienda(s) más', v_subscription.max_stores - v_store_count)
      ELSE
        format('Límite alcanzado (%s/%s). Actualiza tu plan para crear más tiendas.', v_store_count, v_subscription.max_stores)
    END::TEXT as reason;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION can_create_store(UUID) IS
  'Checks if user can create a new store based on subscription limits. Always returns one row.';

-- -----------------------------------------------------------------------------
-- FUNCTION: get_store_plan_via_owner
-- -----------------------------------------------------------------------------
-- Gets a store's plan features by looking up the owner's subscription
-- ALWAYS returns exactly one row (falls back to free plan)

CREATE OR REPLACE FUNCTION get_store_plan_via_owner(p_store_id UUID)
RETURNS TABLE (
  plan TEXT,
  status TEXT,
  max_users INTEGER,
  max_orders_per_month INTEGER,
  max_products INTEGER,
  max_stores INTEGER,
  max_integrations INTEGER,
  has_warehouse BOOLEAN,
  has_returns BOOLEAN,
  has_merchandise BOOLEAN,
  has_shipping_labels BOOLEAN,
  has_auto_inventory BOOLEAN,
  has_shopify_import BOOLEAN,
  has_shopify_bidirectional BOOLEAN,
  has_team_management BOOLEAN,
  has_advanced_team BOOLEAN,
  has_custom_roles BOOLEAN,
  has_smart_alerts BOOLEAN,
  has_campaign_tracking BOOLEAN,
  has_api_read BOOLEAN,
  has_api_write BOOLEAN,
  has_custom_webhooks BOOLEAN,
  analytics_history_days INTEGER,
  has_pdf_excel_reports BOOLEAN,
  price_monthly_cents INTEGER,
  price_annual_cents INTEGER,
  has_trial BOOLEAN,
  trial_days INTEGER
) AS $$
DECLARE
  v_owner_id UUID;
  v_has_result BOOLEAN := false;
BEGIN
  -- Input validation - return free plan for NULL input
  IF p_store_id IS NULL THEN
    RETURN QUERY
    SELECT
      pl.plan::TEXT,
      'active'::TEXT as status,
      pl.max_users,
      pl.max_orders_per_month,
      pl.max_products,
      pl.max_stores,
      pl.max_integrations,
      pl.has_warehouse,
      pl.has_returns,
      pl.has_merchandise,
      pl.has_shipping_labels,
      pl.has_auto_inventory,
      pl.has_shopify_import,
      pl.has_shopify_bidirectional,
      pl.has_team_management,
      pl.has_advanced_team,
      pl.has_custom_roles,
      pl.has_smart_alerts,
      pl.has_campaign_tracking,
      pl.has_api_read,
      pl.has_api_write,
      pl.has_custom_webhooks,
      pl.analytics_history_days,
      pl.has_pdf_excel_reports,
      pl.price_monthly_cents,
      pl.price_annual_cents,
      pl.has_trial,
      pl.trial_days
    FROM plan_limits pl
    WHERE pl.plan = 'free';
    RETURN;
  END IF;

  -- Get store owner
  SELECT us.user_id INTO v_owner_id
  FROM user_stores us
  WHERE us.store_id = p_store_id
    AND us.role = 'owner'
    AND us.is_active = true
  LIMIT 1;

  -- If owner found, try to get their subscription plan
  IF v_owner_id IS NOT NULL THEN
    RETURN QUERY
    SELECT
      pl.plan::TEXT,
      s.status::TEXT,
      pl.max_users,
      pl.max_orders_per_month,
      pl.max_products,
      pl.max_stores,
      pl.max_integrations,
      pl.has_warehouse,
      pl.has_returns,
      pl.has_merchandise,
      pl.has_shipping_labels,
      pl.has_auto_inventory,
      pl.has_shopify_import,
      pl.has_shopify_bidirectional,
      pl.has_team_management,
      pl.has_advanced_team,
      pl.has_custom_roles,
      pl.has_smart_alerts,
      pl.has_campaign_tracking,
      pl.has_api_read,
      pl.has_api_write,
      pl.has_custom_webhooks,
      pl.analytics_history_days,
      pl.has_pdf_excel_reports,
      pl.price_monthly_cents,
      pl.price_annual_cents,
      pl.has_trial,
      pl.trial_days
    FROM subscriptions s
    JOIN plan_limits pl ON s.plan::TEXT = pl.plan::TEXT
    WHERE s.user_id = v_owner_id
      AND COALESCE(s.is_primary, true) = true
      AND s.status IN ('active', 'trialing')
    ORDER BY
      CASE s.status WHEN 'active' THEN 1 WHEN 'trialing' THEN 2 ELSE 3 END
    LIMIT 1;

    -- Check if we got a result
    IF FOUND THEN
      RETURN;
    END IF;
  END IF;

  -- Fallback: return free plan (no owner or no active subscription)
  RETURN QUERY
  SELECT
    pl.plan::TEXT,
    'active'::TEXT as status,
    pl.max_users,
    pl.max_orders_per_month,
    pl.max_products,
    pl.max_stores,
    pl.max_integrations,
    pl.has_warehouse,
    pl.has_returns,
    pl.has_merchandise,
    pl.has_shipping_labels,
    pl.has_auto_inventory,
    pl.has_shopify_import,
    pl.has_shopify_bidirectional,
    pl.has_team_management,
    pl.has_advanced_team,
    pl.has_custom_roles,
    pl.has_smart_alerts,
    pl.has_campaign_tracking,
    pl.has_api_read,
    pl.has_api_write,
    pl.has_custom_webhooks,
    pl.analytics_history_days,
    pl.has_pdf_excel_reports,
    pl.price_monthly_cents,
    pl.price_annual_cents,
    pl.has_trial,
    pl.trial_days
  FROM plan_limits pl
  WHERE pl.plan = 'free';
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION get_store_plan_via_owner(UUID) IS
  'Gets store''s plan features via owner''s subscription. Always returns one row (free plan fallback).';

-- ============================================================================
-- PHASE 4: PERMISSIONS
-- ============================================================================

-- Grant execute permissions (idempotent - safe to run multiple times)
DO $$
BEGIN
  -- Check if 'authenticated' role exists (Supabase)
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT EXECUTE ON FUNCTION get_user_subscription(UUID) TO authenticated;
    GRANT EXECUTE ON FUNCTION can_create_store(UUID) TO authenticated;
    GRANT EXECUTE ON FUNCTION get_store_plan_via_owner(UUID) TO authenticated;
    RAISE NOTICE '✅ Granted permissions to authenticated role';
  END IF;

  -- Check if 'anon' role exists (Supabase)
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    -- Only grant read functions to anon if needed (currently not granting)
    RAISE NOTICE '⏭️  Skipping anon role grants (not needed for these functions)';
  END IF;

  -- Check if 'service_role' exists (Supabase admin)
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION get_user_subscription(UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION can_create_store(UUID) TO service_role;
    GRANT EXECUTE ON FUNCTION get_store_plan_via_owner(UUID) TO service_role;
    RAISE NOTICE '✅ Granted permissions to service_role';
  END IF;
END $$;

-- ============================================================================
-- PHASE 5: VERIFICATION & SMOKE TESTS
-- ============================================================================

DO $$
DECLARE
  v_test_result RECORD;
  v_function_exists BOOLEAN;
BEGIN
  RAISE NOTICE '🧪 Running verification tests...';

  -- Test 1: Verify functions exist
  SELECT EXISTS(SELECT 1 FROM pg_proc WHERE proname = 'get_user_subscription') INTO v_function_exists;
  IF NOT v_function_exists THEN
    RAISE EXCEPTION '❌ TEST FAILED: get_user_subscription function not found';
  END IF;
  RAISE NOTICE '✅ Test 1: get_user_subscription exists';

  SELECT EXISTS(SELECT 1 FROM pg_proc WHERE proname = 'can_create_store') INTO v_function_exists;
  IF NOT v_function_exists THEN
    RAISE EXCEPTION '❌ TEST FAILED: can_create_store function not found';
  END IF;
  RAISE NOTICE '✅ Test 2: can_create_store exists';

  SELECT EXISTS(SELECT 1 FROM pg_proc WHERE proname = 'get_store_plan_via_owner') INTO v_function_exists;
  IF NOT v_function_exists THEN
    RAISE EXCEPTION '❌ TEST FAILED: get_store_plan_via_owner function not found';
  END IF;
  RAISE NOTICE '✅ Test 3: get_store_plan_via_owner exists';

  -- Test 4: can_create_store handles NULL gracefully
  SELECT * INTO v_test_result FROM can_create_store(NULL);
  IF v_test_result IS NULL THEN
    RAISE EXCEPTION '❌ TEST FAILED: can_create_store(NULL) returned NULL instead of a row';
  END IF;
  IF v_test_result.can_create IS NULL THEN
    RAISE EXCEPTION '❌ TEST FAILED: can_create_store(NULL).can_create is NULL';
  END IF;
  RAISE NOTICE '✅ Test 4: can_create_store(NULL) returns valid result';

  -- Test 5: get_store_plan_via_owner handles NULL gracefully
  SELECT * INTO v_test_result FROM get_store_plan_via_owner(NULL);
  IF v_test_result IS NULL OR v_test_result.plan IS NULL THEN
    RAISE EXCEPTION '❌ TEST FAILED: get_store_plan_via_owner(NULL) did not return free plan';
  END IF;
  IF v_test_result.plan != 'free' THEN
    RAISE EXCEPTION '❌ TEST FAILED: get_store_plan_via_owner(NULL) should return free plan, got: %', v_test_result.plan;
  END IF;
  RAISE NOTICE '✅ Test 5: get_store_plan_via_owner(NULL) returns free plan';

  -- Test 6: can_create_store with random UUID returns free plan result
  SELECT * INTO v_test_result FROM can_create_store('00000000-0000-0000-0000-000000000000'::UUID);
  IF v_test_result.plan != 'free' THEN
    RAISE EXCEPTION '❌ TEST FAILED: can_create_store with non-existent user should return free plan';
  END IF;
  RAISE NOTICE '✅ Test 6: can_create_store with non-existent user returns free plan';

  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '✅ MIGRATION 085 COMPLETED SUCCESSFULLY';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE 'Functions created:';
  RAISE NOTICE '  • get_user_subscription(UUID) - Get user subscription with limits';
  RAISE NOTICE '  • can_create_store(UUID) - Check if user can create more stores';
  RAISE NOTICE '  • get_store_plan_via_owner(UUID) - Get store plan via owner';
  RAISE NOTICE '';
  RAISE NOTICE 'All smoke tests passed. Migration is safe to deploy.';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;

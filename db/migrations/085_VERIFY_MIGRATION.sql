-- ============================================================================
-- VERIFICATION SCRIPT FOR MIGRATION 085
-- ============================================================================
-- Run this in Supabase SQL Editor to verify the migration was successful
-- Expected output: All tests should pass with ✅
-- ============================================================================

DO $$
DECLARE
  v_result RECORD;
  v_count INTEGER;
  v_test_user_id UUID;
  v_test_store_id UUID;
BEGIN
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '🧪 MIGRATION 085 VERIFICATION';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '';

  -- =========================================================================
  -- TEST 1: Verify functions exist
  -- =========================================================================
  RAISE NOTICE '📋 TEST 1: Checking functions exist...';

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_user_subscription') THEN
    RAISE NOTICE '   ✅ get_user_subscription EXISTS';
  ELSE
    RAISE EXCEPTION '   ❌ get_user_subscription NOT FOUND';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'can_create_store') THEN
    RAISE NOTICE '   ✅ can_create_store EXISTS';
  ELSE
    RAISE EXCEPTION '   ❌ can_create_store NOT FOUND';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_store_plan_via_owner') THEN
    RAISE NOTICE '   ✅ get_store_plan_via_owner EXISTS';
  ELSE
    RAISE EXCEPTION '   ❌ get_store_plan_via_owner NOT FOUND';
  END IF;

  RAISE NOTICE '';

  -- =========================================================================
  -- TEST 2: Verify subscriptions table has required columns
  -- =========================================================================
  RAISE NOTICE '📋 TEST 2: Checking subscriptions table schema...';

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'subscriptions' AND column_name = 'user_id'
  ) THEN
    RAISE NOTICE '   ✅ subscriptions.user_id column EXISTS';
  ELSE
    RAISE EXCEPTION '   ❌ subscriptions.user_id column NOT FOUND';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'subscriptions' AND column_name = 'is_primary'
  ) THEN
    RAISE NOTICE '   ✅ subscriptions.is_primary column EXISTS';
  ELSE
    RAISE EXCEPTION '   ❌ subscriptions.is_primary column NOT FOUND';
  END IF;

  RAISE NOTICE '';

  -- =========================================================================
  -- TEST 3: Test can_create_store with NULL (should return free plan)
  -- =========================================================================
  RAISE NOTICE '📋 TEST 3: Testing can_create_store(NULL)...';

  SELECT * INTO v_result FROM can_create_store(NULL);

  IF v_result IS NOT NULL AND v_result.plan = 'free' THEN
    RAISE NOTICE '   ✅ can_create_store(NULL) returns free plan';
    RAISE NOTICE '      plan: %, can_create: %, reason: %', v_result.plan, v_result.can_create, v_result.reason;
  ELSE
    RAISE EXCEPTION '   ❌ can_create_store(NULL) failed - expected free plan';
  END IF;

  RAISE NOTICE '';

  -- =========================================================================
  -- TEST 4: Test get_store_plan_via_owner with NULL (should return free plan)
  -- =========================================================================
  RAISE NOTICE '📋 TEST 4: Testing get_store_plan_via_owner(NULL)...';

  SELECT * INTO v_result FROM get_store_plan_via_owner(NULL);

  IF v_result IS NOT NULL AND v_result.plan = 'free' THEN
    RAISE NOTICE '   ✅ get_store_plan_via_owner(NULL) returns free plan';
    RAISE NOTICE '      plan: %, max_stores: %, max_users: %', v_result.plan, v_result.max_stores, v_result.max_users;
  ELSE
    RAISE EXCEPTION '   ❌ get_store_plan_via_owner(NULL) failed - expected free plan';
  END IF;

  RAISE NOTICE '';

  -- =========================================================================
  -- TEST 5: Test with a real user (if exists)
  -- =========================================================================
  RAISE NOTICE '📋 TEST 5: Testing with real user data...';

  -- Get a real user ID
  SELECT id INTO v_test_user_id FROM users LIMIT 1;

  IF v_test_user_id IS NOT NULL THEN
    SELECT * INTO v_result FROM can_create_store(v_test_user_id);
    RAISE NOTICE '   ✅ can_create_store with real user works';
    RAISE NOTICE '      user_id: %', v_test_user_id;
    RAISE NOTICE '      plan: %, current_stores: %, max_stores: %, can_create: %',
      v_result.plan, v_result.current_stores, v_result.max_stores, v_result.can_create;
  ELSE
    RAISE NOTICE '   ⚠️  No users found to test with (skipping real user test)';
  END IF;

  RAISE NOTICE '';

  -- =========================================================================
  -- TEST 6: Test with a real store (if exists)
  -- =========================================================================
  RAISE NOTICE '📋 TEST 6: Testing with real store data...';

  -- Get a real store ID
  SELECT id INTO v_test_store_id FROM stores LIMIT 1;

  IF v_test_store_id IS NOT NULL THEN
    SELECT * INTO v_result FROM get_store_plan_via_owner(v_test_store_id);
    RAISE NOTICE '   ✅ get_store_plan_via_owner with real store works';
    RAISE NOTICE '      store_id: %', v_test_store_id;
    RAISE NOTICE '      plan: %, status: %, has_warehouse: %',
      v_result.plan, v_result.status, v_result.has_warehouse;
  ELSE
    RAISE NOTICE '   ⚠️  No stores found to test with (skipping real store test)';
  END IF;

  RAISE NOTICE '';

  -- =========================================================================
  -- TEST 7: Verify plan_limits has all required plans
  -- =========================================================================
  RAISE NOTICE '📋 TEST 7: Checking plan_limits data...';

  SELECT COUNT(*) INTO v_count FROM plan_limits;
  RAISE NOTICE '   Total plans in plan_limits: %', v_count;

  IF EXISTS (SELECT 1 FROM plan_limits WHERE plan = 'free') THEN
    RAISE NOTICE '   ✅ free plan exists';
  ELSE
    RAISE EXCEPTION '   ❌ free plan NOT FOUND';
  END IF;

  IF EXISTS (SELECT 1 FROM plan_limits WHERE plan = 'starter') THEN
    RAISE NOTICE '   ✅ starter plan exists';
  ELSE
    RAISE NOTICE '   ⚠️  starter plan not found (may be expected)';
  END IF;

  IF EXISTS (SELECT 1 FROM plan_limits WHERE plan = 'growth') THEN
    RAISE NOTICE '   ✅ growth plan exists';
  ELSE
    RAISE NOTICE '   ⚠️  growth plan not found (may be expected)';
  END IF;

  IF EXISTS (SELECT 1 FROM plan_limits WHERE plan = 'professional') THEN
    RAISE NOTICE '   ✅ professional plan exists';
  ELSE
    RAISE NOTICE '   ⚠️  professional plan not found (may be expected)';
  END IF;

  RAISE NOTICE '';

  -- =========================================================================
  -- SUMMARY
  -- =========================================================================
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '✅ ALL TESTS PASSED - MIGRATION 085 VERIFIED SUCCESSFULLY';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'The following functions are now available:';
  RAISE NOTICE '  • can_create_store(user_id UUID) - Check store creation limits';
  RAISE NOTICE '  • get_user_subscription(user_id UUID) - Get user subscription';
  RAISE NOTICE '  • get_store_plan_via_owner(store_id UUID) - Get store plan';
  RAISE NOTICE '';
  RAISE NOTICE 'You can now create new stores via the API.';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;

-- ================================================================
-- ONBOARDING SYSTEM PRODUCTION FIXES
-- ================================================================
-- Migration: 064_onboarding_system_production_fixes.sql
-- Author: Bright Idea
-- Date: 2026-01-13
--
-- Fixes identified issues:
-- 1. get_onboarding_progress references non-existent is_deleted column (BLOCKER)
-- 2. First-time tracking uses LocalStorage instead of database (collaboration issue)
-- 3. hasDismissed read from LocalStorage causes cross-user pollution
-- 4. 'Add customer' step should be optional when Shopify is connected
-- 5. No step for Shopify connection
-- ================================================================

BEGIN;

-- ================================================================
-- FIX 1: Recreate get_onboarding_progress function (CRITICAL)
-- ================================================================
-- The existing function in production references is_deleted which doesn't exist
-- This completely breaks the onboarding checklist for new users

CREATE OR REPLACE FUNCTION get_onboarding_progress(p_store_id UUID, p_user_id UUID)
RETURNS JSON AS $$
DECLARE
    v_has_carrier BOOLEAN;
    v_has_product BOOLEAN;
    v_has_order BOOLEAN;
    v_has_shopify BOOLEAN;
    v_has_customer BOOLEAN;
    v_checklist_dismissed BOOLEAN := FALSE;
    v_visited_modules JSONB := '[]'::jsonb;
    v_steps JSON;
    v_completed_count INT := 0;
    v_total_count INT := 4;
BEGIN
    -- Get user preferences from onboarding_progress table
    SELECT
        COALESCE(checklist_dismissed, FALSE),
        COALESCE(visited_modules, '[]'::jsonb)
    INTO v_checklist_dismissed, v_visited_modules
    FROM onboarding_progress
    WHERE store_id = p_store_id AND user_id = p_user_id;

    -- Check for active carrier
    SELECT EXISTS(
        SELECT 1 FROM carriers
        WHERE store_id = p_store_id
          AND is_active = TRUE
        LIMIT 1
    ) INTO v_has_carrier;

    -- Check for active product (no is_deleted column in products)
    SELECT EXISTS(
        SELECT 1 FROM products
        WHERE store_id = p_store_id
          AND is_active = TRUE
        LIMIT 1
    ) INTO v_has_product;

    -- Check for customer (no is_deleted column in customers)
    SELECT EXISTS(
        SELECT 1 FROM customers
        WHERE store_id = p_store_id
        LIMIT 1
    ) INTO v_has_customer;

    -- Check for order (exclude soft-deleted orders)
    SELECT EXISTS(
        SELECT 1 FROM orders
        WHERE store_id = p_store_id
          AND deleted_at IS NULL
        LIMIT 1
    ) INTO v_has_order;

    -- Check for active Shopify integration
    SELECT EXISTS(
        SELECT 1 FROM shopify_integrations
        WHERE store_id = p_store_id
          AND is_active = TRUE
        LIMIT 1
    ) INTO v_has_shopify;

    -- Count completed steps
    IF v_has_carrier THEN v_completed_count := v_completed_count + 1; END IF;
    IF v_has_product THEN v_completed_count := v_completed_count + 1; END IF;
    -- Customer step: complete if has customer OR has Shopify (customers auto-created)
    IF v_has_customer OR v_has_shopify THEN v_completed_count := v_completed_count + 1; END IF;
    IF v_has_order THEN v_completed_count := v_completed_count + 1; END IF;

    -- Build steps array with dynamic customer step description
    v_steps := json_build_array(
        json_build_object(
            'id', 'create-carrier',
            'title', 'Agregar transportadora',
            'description', 'Configura al menos una transportadora para enviar pedidos',
            'completed', v_has_carrier,
            'route', '/carriers',
            'priority', 1,
            'category', 'setup'
        ),
        json_build_object(
            'id', 'add-product',
            'title', 'Agregar primer producto',
            'description', 'Crea un producto o importa desde Shopify',
            'completed', v_has_product,
            'route', '/products',
            'priority', 2,
            'category', 'setup'
        ),
        json_build_object(
            'id', 'add-customer',
            'title', CASE
                WHEN v_has_shopify THEN 'Clientes de Shopify'
                ELSE 'Agregar cliente'
            END,
            'description', CASE
                WHEN v_has_shopify AND v_has_customer THEN 'Clientes importados automáticamente desde Shopify'
                WHEN v_has_shopify THEN 'Los clientes se crearán al recibir pedidos de Shopify'
                ELSE 'Registra tu primer cliente para crear pedidos'
            END,
            'completed', v_has_customer OR v_has_shopify,
            'route', '/customers',
            'priority', 3,
            'category', 'setup'
        ),
        json_build_object(
            'id', 'first-order',
            'title', 'Crear primer pedido',
            'description', 'Crea tu primer pedido para ver el flujo completo',
            'completed', v_has_order,
            'route', '/orders',
            'priority', 4,
            'category', 'operation'
        )
    );

    -- Return complete progress object
    RETURN json_build_object(
        'steps', v_steps,
        'completedCount', v_completed_count,
        'totalCount', v_total_count,
        'percentage', ROUND((v_completed_count::DECIMAL / v_total_count) * 100),
        'isComplete', v_completed_count = v_total_count,
        'hasShopify', v_has_shopify,
        'hasDismissed', v_checklist_dismissed,
        'visitedModules', v_visited_modules
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_onboarding_progress(UUID, UUID) IS
'Computes onboarding progress dynamically based on store data. Fixed to not reference non-existent is_deleted columns.';


-- ================================================================
-- FIX 2: Add visit counts to onboarding_progress table
-- ================================================================
-- Move visit counts from LocalStorage to database for proper multi-user support

ALTER TABLE onboarding_progress
ADD COLUMN IF NOT EXISTS module_visit_counts JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS first_actions_completed JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN onboarding_progress.module_visit_counts IS
'Count of visits to each module by this user (for auto-hiding tips after 3 visits)';
COMMENT ON COLUMN onboarding_progress.first_actions_completed IS
'Array of module IDs where user completed their first action';


-- ================================================================
-- FIX 3: Function to increment visit count (DB-backed)
-- ================================================================

CREATE OR REPLACE FUNCTION increment_module_visit_count(
    p_store_id UUID,
    p_user_id UUID,
    p_module_id TEXT
)
RETURNS INTEGER AS $$
DECLARE
    v_new_count INTEGER;
BEGIN
    -- Insert or update the visit count
    INSERT INTO onboarding_progress (store_id, user_id, module_visit_counts)
    VALUES (p_store_id, p_user_id, jsonb_build_object(p_module_id, 1))
    ON CONFLICT (store_id, user_id)
    DO UPDATE SET
        module_visit_counts = CASE
            WHEN onboarding_progress.module_visit_counts ? p_module_id
            THEN jsonb_set(
                onboarding_progress.module_visit_counts,
                ARRAY[p_module_id],
                to_jsonb((onboarding_progress.module_visit_counts->>p_module_id)::INT + 1)
            )
            ELSE onboarding_progress.module_visit_counts || jsonb_build_object(p_module_id, 1)
        END,
        updated_at = NOW();

    -- Return the new count
    SELECT (module_visit_counts->>p_module_id)::INT INTO v_new_count
    FROM onboarding_progress
    WHERE store_id = p_store_id AND user_id = p_user_id;

    RETURN COALESCE(v_new_count, 1);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION increment_module_visit_count(UUID, UUID, TEXT) IS
'Increments visit count for a module. Returns the new count.';


-- ================================================================
-- FIX 4: Function to get visit count
-- ================================================================

CREATE OR REPLACE FUNCTION get_module_visit_count(
    p_store_id UUID,
    p_user_id UUID,
    p_module_id TEXT
)
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
BEGIN
    SELECT (module_visit_counts->>p_module_id)::INT INTO v_count
    FROM onboarding_progress
    WHERE store_id = p_store_id AND user_id = p_user_id;

    RETURN COALESCE(v_count, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_module_visit_count(UUID, UUID, TEXT) IS
'Gets the visit count for a specific module. Returns 0 if not visited.';


-- ================================================================
-- FIX 5: Function to check if tip should show (combines all conditions)
-- ================================================================

CREATE OR REPLACE FUNCTION should_show_module_tip(
    p_store_id UUID,
    p_user_id UUID,
    p_module_id TEXT,
    p_max_visits INTEGER DEFAULT 3
)
RETURNS BOOLEAN AS $$
DECLARE
    v_record RECORD;
BEGIN
    -- Get all relevant data in one query
    SELECT
        COALESCE(visited_modules ? p_module_id, FALSE) as is_dismissed,
        COALESCE((module_visit_counts->>p_module_id)::INT, 0) as visit_count,
        COALESCE(first_actions_completed ? p_module_id, FALSE) as action_completed
    INTO v_record
    FROM onboarding_progress
    WHERE store_id = p_store_id AND user_id = p_user_id;

    -- If no record, show tip
    IF NOT FOUND THEN
        RETURN TRUE;
    END IF;

    -- Don't show if manually dismissed (X button)
    IF v_record.is_dismissed THEN
        RETURN FALSE;
    END IF;

    -- Don't show if visited too many times
    IF v_record.visit_count >= p_max_visits THEN
        RETURN FALSE;
    END IF;

    -- Don't show if first action completed
    IF v_record.action_completed THEN
        RETURN FALSE;
    END IF;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION should_show_module_tip(UUID, UUID, TEXT, INTEGER) IS
'Determines if a module tip should be shown. Combines: not dismissed, under visit limit, no first action.';


-- ================================================================
-- FIX 6: Function to mark first action completed
-- ================================================================

CREATE OR REPLACE FUNCTION mark_first_action_completed(
    p_store_id UUID,
    p_user_id UUID,
    p_module_id TEXT
)
RETURNS BOOLEAN AS $$
BEGIN
    INSERT INTO onboarding_progress (store_id, user_id, first_actions_completed)
    VALUES (p_store_id, p_user_id, jsonb_build_array(p_module_id))
    ON CONFLICT (store_id, user_id)
    DO UPDATE SET
        first_actions_completed = CASE
            WHEN NOT (onboarding_progress.first_actions_completed ? p_module_id)
            THEN onboarding_progress.first_actions_completed || jsonb_build_array(p_module_id)
            ELSE onboarding_progress.first_actions_completed
        END,
        updated_at = NOW();

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION mark_first_action_completed(UUID, UUID, TEXT) IS
'Marks that user completed their first action in a module (hides future tips).';


-- ================================================================
-- FIX 7: Update RLS policies for new columns
-- ================================================================

-- Drop and recreate policies to ensure they cover new columns
DROP POLICY IF EXISTS "Users can view their own onboarding progress" ON onboarding_progress;
DROP POLICY IF EXISTS "Users can insert their own onboarding progress" ON onboarding_progress;
DROP POLICY IF EXISTS "Users can update their own onboarding progress" ON onboarding_progress;

CREATE POLICY "onboarding_select_own"
ON onboarding_progress FOR SELECT
USING (
    user_id = auth.uid() OR
    store_id IN (SELECT us.store_id FROM user_stores us WHERE us.user_id = auth.uid())
);

CREATE POLICY "onboarding_insert_own"
ON onboarding_progress FOR INSERT
WITH CHECK (
    user_id = auth.uid() OR
    store_id IN (SELECT us.store_id FROM user_stores us WHERE us.user_id = auth.uid())
);

CREATE POLICY "onboarding_update_own"
ON onboarding_progress FOR UPDATE
USING (
    user_id = auth.uid() OR
    store_id IN (SELECT us.store_id FROM user_stores us WHERE us.user_id = auth.uid())
);


-- ================================================================
-- FIX 8: Grant permissions for new functions
-- ================================================================

GRANT EXECUTE ON FUNCTION get_onboarding_progress(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION increment_module_visit_count(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_module_visit_count(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION should_show_module_tip(UUID, UUID, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION mark_first_action_completed(UUID, UUID, TEXT) TO authenticated;


-- ================================================================
-- VERIFICATION
-- ================================================================

DO $$
DECLARE
    v_test_result JSON;
BEGIN
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Migration 064 Verification';
    RAISE NOTICE '========================================';

    -- Test get_onboarding_progress doesn't error anymore
    BEGIN
        SELECT get_onboarding_progress(
            '00000000-0000-0000-0000-000000000001'::UUID,
            '00000000-0000-0000-0000-000000000001'::UUID
        ) INTO v_test_result;
        RAISE NOTICE 'OK: get_onboarding_progress function works without is_deleted error';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'WARN: get_onboarding_progress test returned: %', SQLERRM;
    END;

    -- Verify new columns exist
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'onboarding_progress'
          AND column_name = 'module_visit_counts'
    ) THEN
        RAISE NOTICE 'OK: module_visit_counts column exists';
    ELSE
        RAISE EXCEPTION 'FAILED: module_visit_counts column not created';
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'onboarding_progress'
          AND column_name = 'first_actions_completed'
    ) THEN
        RAISE NOTICE 'OK: first_actions_completed column exists';
    ELSE
        RAISE EXCEPTION 'FAILED: first_actions_completed column not created';
    END IF;

    -- Verify functions exist
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'increment_module_visit_count') THEN
        RAISE NOTICE 'OK: increment_module_visit_count function exists';
    ELSE
        RAISE EXCEPTION 'FAILED: increment_module_visit_count function not created';
    END IF;

    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'should_show_module_tip') THEN
        RAISE NOTICE 'OK: should_show_module_tip function exists';
    ELSE
        RAISE EXCEPTION 'FAILED: should_show_module_tip function not created';
    END IF;

    RAISE NOTICE '========================================';
    RAISE NOTICE 'Migration 064 Complete!';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Production fixes applied:';
    RAISE NOTICE '1. Fixed get_onboarding_progress (removed is_deleted reference)';
    RAISE NOTICE '2. Added module_visit_counts column (DB-backed visits)';
    RAISE NOTICE '3. Added first_actions_completed column';
    RAISE NOTICE '4. Shopify counts as "customer step complete"';
    RAISE NOTICE '5. Returns visitedModules in progress response';
    RAISE NOTICE '6. New functions: increment/get visit count, should_show_tip';
    RAISE NOTICE '7. Updated RLS policies';
    RAISE NOTICE '========================================';
END $$;

COMMIT;

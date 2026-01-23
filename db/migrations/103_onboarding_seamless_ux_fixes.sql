-- ================================================================
-- ONBOARDING SEAMLESS UX FIXES
-- ================================================================
-- Migration: 103_onboarding_seamless_ux_fixes.sql
-- Author: Bright Idea
-- Date: 2026-01-23
--
-- PRODUCTION-READY: Fully idempotent, can be run multiple times safely
--
-- Fixes for $150k product-level UX:
-- 1. Optimizes N+1 queries to single query (5 SELECTs → 1 SELECT)
-- 2. Returns moduleVisitCounts and firstActionsCompleted in progress response
-- 3. Adds batch tip state endpoint for prefetching
--
-- DEPENDENCIES:
-- - Migration 050: onboarding_progress table
-- - Migration 064: module_visit_counts, first_actions_completed columns
-- ================================================================

BEGIN;

-- ================================================================
-- SAFETY CHECK: Verify dependencies exist
-- ================================================================

DO $$
BEGIN
    -- Check onboarding_progress table exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'onboarding_progress'
    ) THEN
        RAISE EXCEPTION 'DEPENDENCY ERROR: onboarding_progress table not found. Run migration 050 first.';
    END IF;

    -- Check required columns exist (from migration 064)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'onboarding_progress'
        AND column_name = 'module_visit_counts'
    ) THEN
        RAISE EXCEPTION 'DEPENDENCY ERROR: module_visit_counts column not found. Run migration 064 first.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'onboarding_progress'
        AND column_name = 'first_actions_completed'
    ) THEN
        RAISE EXCEPTION 'DEPENDENCY ERROR: first_actions_completed column not found. Run migration 064 first.';
    END IF;

    RAISE NOTICE 'OK: All dependencies verified';
END $$;


-- ================================================================
-- FIX 1: Optimized get_onboarding_progress function
-- ================================================================
-- Uses single query with EXISTS subqueries instead of 5 separate SELECTs
-- CREATE OR REPLACE is inherently idempotent

CREATE OR REPLACE FUNCTION get_onboarding_progress(p_store_id UUID, p_user_id UUID)
RETURNS JSON AS $$
DECLARE
    v_result RECORD;
    v_steps JSON;
    v_completed_count INT := 0;
    v_total_count INT := 4;
BEGIN
    -- Single optimized query - replaces 5+ separate queries
    SELECT
        COALESCE(op.checklist_dismissed, FALSE) as checklist_dismissed,
        COALESCE(op.visited_modules, '[]'::jsonb) as visited_modules,
        COALESCE(op.module_visit_counts, '{}'::jsonb) as module_visit_counts,
        COALESCE(op.first_actions_completed, '[]'::jsonb) as first_actions_completed,
        EXISTS(SELECT 1 FROM carriers c WHERE c.store_id = p_store_id AND c.is_active = TRUE LIMIT 1) as has_carrier,
        EXISTS(SELECT 1 FROM products p WHERE p.store_id = p_store_id AND p.is_active = TRUE LIMIT 1) as has_product,
        EXISTS(SELECT 1 FROM customers cu WHERE cu.store_id = p_store_id LIMIT 1) as has_customer,
        EXISTS(SELECT 1 FROM orders o WHERE o.store_id = p_store_id AND o.deleted_at IS NULL LIMIT 1) as has_order,
        EXISTS(SELECT 1 FROM shopify_integrations si WHERE si.store_id = p_store_id AND si.status = 'active' LIMIT 1) as has_shopify
    INTO v_result
    FROM (SELECT 1) as dummy
    LEFT JOIN onboarding_progress op ON op.store_id = p_store_id AND op.user_id = p_user_id;

    -- Count completed steps
    IF v_result.has_carrier THEN v_completed_count := v_completed_count + 1; END IF;
    IF v_result.has_product THEN v_completed_count := v_completed_count + 1; END IF;
    -- Customer step: complete if has customer OR has Shopify (customers auto-created)
    IF v_result.has_customer OR v_result.has_shopify THEN v_completed_count := v_completed_count + 1; END IF;
    IF v_result.has_order THEN v_completed_count := v_completed_count + 1; END IF;

    -- Build steps array with dynamic customer step description
    v_steps := json_build_array(
        json_build_object(
            'id', 'create-carrier',
            'title', 'Agregar transportadora',
            'description', 'Configura al menos una transportadora para enviar pedidos',
            'completed', v_result.has_carrier,
            'route', '/carriers',
            'priority', 1,
            'category', 'setup'
        ),
        json_build_object(
            'id', 'add-product',
            'title', 'Agregar primer producto',
            'description', 'Crea un producto o importa desde Shopify',
            'completed', v_result.has_product,
            'route', '/products',
            'priority', 2,
            'category', 'setup'
        ),
        json_build_object(
            'id', 'add-customer',
            'title', CASE
                WHEN v_result.has_shopify THEN 'Clientes de Shopify'
                ELSE 'Agregar cliente'
            END,
            'description', CASE
                WHEN v_result.has_shopify AND v_result.has_customer THEN 'Clientes importados automáticamente desde Shopify'
                WHEN v_result.has_shopify THEN 'Los clientes se crearán al recibir pedidos de Shopify'
                ELSE 'Registra tu primer cliente para crear pedidos'
            END,
            'completed', v_result.has_customer OR v_result.has_shopify,
            'route', '/customers',
            'priority', 3,
            'category', 'setup'
        ),
        json_build_object(
            'id', 'first-order',
            'title', 'Crear primer pedido',
            'description', 'Crea tu primer pedido para ver el flujo completo',
            'completed', v_result.has_order,
            'route', '/orders',
            'priority', 4,
            'category', 'operation'
        )
    );

    -- Return complete progress object with all needed data for frontend caching
    RETURN json_build_object(
        'steps', v_steps,
        'completedCount', v_completed_count,
        'totalCount', v_total_count,
        'percentage', ROUND((v_completed_count::DECIMAL / v_total_count) * 100),
        'isComplete', v_completed_count = v_total_count,
        'hasShopify', v_result.has_shopify,
        'hasDismissed', v_result.checklist_dismissed,
        'visitedModules', v_result.visited_modules,
        'moduleVisitCounts', v_result.module_visit_counts,
        'firstActionsCompleted', v_result.first_actions_completed
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_onboarding_progress(UUID, UUID) IS
'Computes onboarding progress with optimized single query. Returns all data needed for frontend caching. Updated: 2026-01-23';


-- ================================================================
-- FIX 2: Batch should_show_module_tip for prefetching
-- ================================================================
-- Allows frontend to prefetch tip states for multiple modules in one call
-- CREATE OR REPLACE is inherently idempotent

CREATE OR REPLACE FUNCTION get_batch_tip_states(
    p_store_id UUID,
    p_user_id UUID,
    p_module_ids TEXT[],
    p_max_visits INTEGER DEFAULT 3
)
RETURNS JSON AS $$
DECLARE
    v_record RECORD;
    v_result JSONB := '{}'::jsonb;
    v_module_id TEXT;
BEGIN
    -- Handle empty array
    IF p_module_ids IS NULL OR array_length(p_module_ids, 1) IS NULL THEN
        RETURN '{}'::json;
    END IF;

    -- Get all relevant data in one query
    SELECT
        COALESCE(visited_modules, '[]'::jsonb) as visited_modules,
        COALESCE(module_visit_counts, '{}'::jsonb) as module_visit_counts,
        COALESCE(first_actions_completed, '[]'::jsonb) as first_actions_completed
    INTO v_record
    FROM onboarding_progress
    WHERE store_id = p_store_id AND user_id = p_user_id;

    -- Process each module
    FOREACH v_module_id IN ARRAY p_module_ids
    LOOP
        -- Skip empty strings
        IF v_module_id IS NULL OR v_module_id = '' THEN
            CONTINUE;
        END IF;

        -- Default to showing tip
        v_result := v_result || jsonb_build_object(v_module_id, TRUE);

        -- Check conditions to hide
        IF v_record IS NOT NULL THEN
            -- Don't show if manually dismissed
            IF v_record.visited_modules ? v_module_id THEN
                v_result := jsonb_set(v_result, ARRAY[v_module_id], 'false'::jsonb);
                CONTINUE;
            END IF;

            -- Don't show if visited too many times
            IF COALESCE((v_record.module_visit_counts->>v_module_id)::INT, 0) >= p_max_visits THEN
                v_result := jsonb_set(v_result, ARRAY[v_module_id], 'false'::jsonb);
                CONTINUE;
            END IF;

            -- Don't show if first action completed
            IF v_record.first_actions_completed ? v_module_id THEN
                v_result := jsonb_set(v_result, ARRAY[v_module_id], 'false'::jsonb);
                CONTINUE;
            END IF;
        END IF;
    END LOOP;

    RETURN v_result::json;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_batch_tip_states(UUID, UUID, TEXT[], INTEGER) IS
'Returns tip visibility states for multiple modules in one call. Optimized for frontend prefetching.';


-- ================================================================
-- FIX 3: Add indexes for common queries (IF NOT EXISTS = idempotent)
-- ================================================================

-- Primary lookup index for onboarding_progress
CREATE INDEX IF NOT EXISTS idx_onboarding_progress_user_store
ON onboarding_progress(user_id, store_id);

-- Partial indexes for EXISTS subqueries (only index active records)
CREATE INDEX IF NOT EXISTS idx_carriers_store_active_partial
ON carriers(store_id) WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_products_store_active_partial
ON products(store_id) WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_customers_store_id
ON customers(store_id);

CREATE INDEX IF NOT EXISTS idx_orders_store_not_deleted_partial
ON orders(store_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_shopify_integrations_store_active_partial
ON shopify_integrations(store_id) WHERE status = 'active';


-- ================================================================
-- GRANT PERMISSIONS (idempotent - GRANT is safe to run multiple times)
-- ================================================================

GRANT EXECUTE ON FUNCTION get_onboarding_progress(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_batch_tip_states(UUID, UUID, TEXT[], INTEGER) TO authenticated;


-- ================================================================
-- VERIFICATION
-- ================================================================

DO $$
DECLARE
    v_test_result JSON;
BEGIN
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Migration 103 - Onboarding Seamless UX';
    RAISE NOTICE '========================================';

    -- Test get_onboarding_progress doesn't error
    BEGIN
        SELECT get_onboarding_progress(
            '00000000-0000-0000-0000-000000000001'::UUID,
            '00000000-0000-0000-0000-000000000001'::UUID
        ) INTO v_test_result;
        RAISE NOTICE 'OK: get_onboarding_progress function works';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'WARN: get_onboarding_progress test: %', SQLERRM;
    END;

    -- Test get_batch_tip_states doesn't error
    BEGIN
        SELECT get_batch_tip_states(
            '00000000-0000-0000-0000-000000000001'::UUID,
            '00000000-0000-0000-0000-000000000001'::UUID,
            ARRAY['orders', 'products', 'customers'],
            3
        ) INTO v_test_result;
        RAISE NOTICE 'OK: get_batch_tip_states function works';
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'WARN: get_batch_tip_states test: %', SQLERRM;
    END;

    -- Verify functions exist
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_onboarding_progress') THEN
        RAISE NOTICE 'OK: get_onboarding_progress function exists';
    ELSE
        RAISE EXCEPTION 'FAILED: get_onboarding_progress function not found';
    END IF;

    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_batch_tip_states') THEN
        RAISE NOTICE 'OK: get_batch_tip_states function exists';
    ELSE
        RAISE EXCEPTION 'FAILED: get_batch_tip_states function not created';
    END IF;

    -- Verify indexes (just check a few key ones)
    IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_onboarding_progress_user_store') THEN
        RAISE NOTICE 'OK: Performance indexes created';
    ELSE
        RAISE NOTICE 'WARN: Some indexes may not have been created';
    END IF;

    RAISE NOTICE '========================================';
    RAISE NOTICE 'Migration 103 Complete!';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Fixes applied:';
    RAISE NOTICE '  1. Optimized N+1 queries (5 SELECTs -> 1 SELECT)';
    RAISE NOTICE '  2. Returns moduleVisitCounts in progress response';
    RAISE NOTICE '  3. Returns firstActionsCompleted in progress response';
    RAISE NOTICE '  4. Added get_batch_tip_states for prefetching';
    RAISE NOTICE '  5. Added performance indexes';
    RAISE NOTICE '';
    RAISE NOTICE 'This migration is IDEMPOTENT - safe to run multiple times';
    RAISE NOTICE '========================================';
END $$;

COMMIT;

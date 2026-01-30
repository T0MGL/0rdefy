-- ============================================================
-- Migration 120: Fix backfill_fix_prepaid_movements function
--
-- HOTFIX - Safe to run directly in Supabase SQL Editor
-- Date: 2026-01-30
--
-- PROBLEM: backfill_fix_prepaid_movements() had a SQL error:
-- "for SELECT DISTINCT, ORDER BY expressions must appear in select list"
--
-- FIX: Remove DISTINCT (not needed) and add created_at to SELECT
-- ============================================================

-- Just replace the function - no dependencies needed
CREATE OR REPLACE FUNCTION backfill_fix_prepaid_movements(
    p_store_id UUID DEFAULT NULL,
    p_dry_run BOOLEAN DEFAULT TRUE
)
RETURNS TABLE(
    orders_checked INT,
    incorrect_cod_deleted INT,
    missing_fee_created INT,
    orders_affected TEXT[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order RECORD;
    v_orders_checked INT := 0;
    v_incorrect_deleted INT := 0;
    v_missing_created INT := 0;
    v_orders_affected TEXT[] := ARRAY[]::TEXT[];
    v_is_cod BOOLEAN;
    v_batch_count INT := 0;
    v_max_batch INT := 500;  -- Process in batches for safety
BEGIN
    RAISE NOTICE '=== Backfill Fix Prepaid Movements ===';
    RAISE NOTICE 'Store ID: %', COALESCE(p_store_id::text, 'ALL');
    RAISE NOTICE 'Dry Run: %', p_dry_run;
    RAISE NOTICE '';

    -- PHASE 1: Find and fix incorrect COD movements (prepaid orders with cod_collected)
    RAISE NOTICE '--- Phase 1: Finding incorrect COD movements ---';

    FOR v_order IN
        SELECT
            o.id,
            o.order_number,
            o.payment_method,
            o.prepaid_method,
            o.total_price,
            o.courier_id,
            o.store_id,
            o.created_at,
            m.id as movement_id,
            m.amount as movement_amount
        FROM orders o
        JOIN carrier_account_movements m ON m.order_id = o.id
        WHERE m.movement_type = 'cod_collected'
          AND o.prepaid_method IS NOT NULL  -- Has prepaid_method set = NOT COD
          AND (p_store_id IS NULL OR o.store_id = p_store_id)
        ORDER BY o.created_at DESC
        LIMIT v_max_batch
    LOOP
        v_orders_checked := v_orders_checked + 1;
        v_batch_count := v_batch_count + 1;

        -- Double-check using is_order_cod
        v_is_cod := is_order_cod(v_order.payment_method, v_order.prepaid_method);

        IF NOT v_is_cod THEN
            -- This order should NOT have a cod_collected movement
            v_orders_affected := array_append(v_orders_affected,
                COALESCE(v_order.order_number, v_order.id::text) || ' (prepaid:' || v_order.prepaid_method || ')');

            IF NOT p_dry_run THEN
                DELETE FROM carrier_account_movements WHERE id = v_order.movement_id;
                v_incorrect_deleted := v_incorrect_deleted + 1;
                RAISE NOTICE 'DELETED: cod_collected for order % (prepaid via %)',
                    COALESCE(v_order.order_number, v_order.id::text), v_order.prepaid_method;
            ELSE
                v_incorrect_deleted := v_incorrect_deleted + 1;
                RAISE NOTICE '[DRY RUN] Would delete cod_collected for order % (prepaid via %)',
                    COALESCE(v_order.order_number, v_order.id::text), v_order.prepaid_method;
            END IF;
        END IF;

        -- Safety check
        IF v_batch_count >= v_max_batch THEN
            RAISE NOTICE 'Reached batch limit (%). Run again to process more.', v_max_batch;
            EXIT;
        END IF;
    END LOOP;

    -- PHASE 2: Find delivered orders without delivery_fee movement
    RAISE NOTICE '';
    RAISE NOTICE '--- Phase 2: Finding missing delivery_fee movements ---';
    v_batch_count := 0;

    FOR v_order IN
        SELECT
            o.id,
            o.order_number,
            o.courier_id,
            o.store_id,
            o.delivery_zone,
            o.shipping_city,
            o.shipping_city_normalized,
            o.payment_method,
            o.prepaid_method,
            o.total_price,
            o.amount_collected
        FROM orders o
        WHERE o.sleeves_status = 'delivered'
          AND o.courier_id IS NOT NULL
          AND o.delivered_at IS NOT NULL
          AND (p_store_id IS NULL OR o.store_id = p_store_id)
          AND NOT EXISTS (
              SELECT 1 FROM carrier_account_movements m
              WHERE m.order_id = o.id AND m.movement_type = 'delivery_fee'
          )
        ORDER BY o.delivered_at DESC
        LIMIT v_max_batch
    LOOP
        v_orders_checked := v_orders_checked + 1;
        v_batch_count := v_batch_count + 1;

        IF NOT p_dry_run THEN
            -- Create the missing movements using the fixed function
            PERFORM create_delivery_movements(v_order.id, v_order.amount_collected, NULL, NULL);
            v_missing_created := v_missing_created + 1;
            RAISE NOTICE 'CREATED: movements for order %', COALESCE(v_order.order_number, v_order.id::text);
        ELSE
            v_missing_created := v_missing_created + 1;
            RAISE NOTICE '[DRY RUN] Would create movements for order %', COALESCE(v_order.order_number, v_order.id::text);
        END IF;

        -- Safety check
        IF v_batch_count >= v_max_batch THEN
            RAISE NOTICE 'Reached batch limit (%). Run again to process more.', v_max_batch;
            EXIT;
        END IF;
    END LOOP;

    -- Summary
    RAISE NOTICE '';
    RAISE NOTICE '=== SUMMARY ===';
    RAISE NOTICE 'Orders checked: %', v_orders_checked;
    RAISE NOTICE 'Incorrect COD movements %: %', CASE WHEN p_dry_run THEN 'to delete' ELSE 'deleted' END, v_incorrect_deleted;
    RAISE NOTICE 'Missing fee movements %: %', CASE WHEN p_dry_run THEN 'to create' ELSE 'created' END, v_missing_created;

    IF v_batch_count >= v_max_batch THEN
        RAISE NOTICE '';
        RAISE NOTICE 'NOTE: Batch limit reached. Run this function again to process more records.';
    END IF;

    RETURN QUERY SELECT v_orders_checked, v_incorrect_deleted, v_missing_created, v_orders_affected;
END;
$$;

COMMENT ON FUNCTION backfill_fix_prepaid_movements(UUID, BOOLEAN) IS
'Fixes incorrect carrier movements caused by prepaid detection bug.
1. Deletes cod_collected movements for orders that have prepaid_method set
2. Creates missing delivery_fee movements for delivered orders
ALWAYS use p_dry_run=TRUE first to preview changes.
Processes in batches of 500 - run multiple times if needed.
Migration 120 (hotfix for 119).';

-- Notify PostgREST to reload
NOTIFY pgrst, 'reload schema';

-- Verification
DO $$
BEGIN
    RAISE NOTICE 'Migration 120 applied: backfill_fix_prepaid_movements fixed.';
    RAISE NOTICE 'Run: SELECT * FROM backfill_fix_prepaid_movements(NULL, TRUE);';
END $$;

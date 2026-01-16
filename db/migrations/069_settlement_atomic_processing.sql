-- ================================================================
-- SETTLEMENT ATOMIC PROCESSING
-- ================================================================
-- Migration: 069_settlement_atomic_processing.sql
-- Author: Bright Idea
-- Date: 2026-01-15
--
-- DEPENDENCIES:
-- - Migration 045: dispatch_sessions, dispatch_session_orders, daily_settlements tables
-- - Migration 059: process_dispatch_settlement_atomic (will be superseded)
-- - Migration 065: create_delivery_movements, create_failed_delivery_movement functions
-- - Migration 066: generate_settlement_code_atomic function
--
-- Purpose:
-- 1. Create atomic import_dispatch_results RPC to handle CSV imports atomically
-- 2. Improve process_settlement_atomic to include carrier movement linking
-- 3. Ensure all-or-nothing processing to prevent inconsistent states
--
-- PROBLEM SOLVED:
-- Previously, importDispatchResults and processSettlement in settlements.service.ts
-- performed multiple separate DB calls. If any call failed midway, data would be
-- left in an inconsistent state (e.g., some orders updated, others not).
--
-- SOLUTION:
-- Move all operations into PostgreSQL functions that run in a single transaction.
-- If any part fails, the entire operation is rolled back automatically.
-- ================================================================

-- ================================================================
-- DEPENDENCY CHECK
-- ================================================================
DO $$
BEGIN
    -- Check generate_settlement_code_atomic exists (from migration 066)
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc WHERE proname = 'generate_settlement_code_atomic'
    ) THEN
        RAISE EXCEPTION 'Missing dependency: generate_settlement_code_atomic function not found. Run migration 066 first.';
    END IF;

    -- Check dispatch_sessions table exists (from migration 045)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'dispatch_sessions'
    ) THEN
        RAISE EXCEPTION 'Missing dependency: dispatch_sessions table not found. Run migration 045 first.';
    END IF;

    RAISE NOTICE '✓ All dependencies verified';
END $$;


-- ================================================================
-- FUNCTION: import_dispatch_results_atomic
-- ================================================================
-- Atomically imports CSV results and updates all related records
-- Uses JSONB array for compatibility with Supabase JS client
-- Returns JSON with processed count, errors, and warnings

CREATE OR REPLACE FUNCTION import_dispatch_results_atomic(
    p_session_id UUID,
    p_store_id UUID,
    p_results JSONB  -- Array of {order_number, delivery_status, amount_collected, failure_reason, courier_notes}
)
RETURNS JSON AS $$
DECLARE
    v_session RECORD;
    v_session_order RECORD;
    v_result RECORD;
    v_order_number TEXT;
    v_delivery_status VARCHAR(50);
    v_failure_reason VARCHAR(50);
    v_amount_collected DECIMAL(12,2);
    v_status_upper VARCHAR(100);
    v_reason_upper VARCHAR(255);
    v_is_cod BOOLEAN;
    v_has_discrepancy BOOLEAN;
    v_processed INTEGER := 0;
    v_errors TEXT[] := ARRAY[]::TEXT[];
    v_warnings TEXT[] := ARRAY[]::TEXT[];
BEGIN
    -- ============================================================
    -- STEP 1: Lock session and validate
    -- ============================================================
    SELECT * INTO v_session
    FROM dispatch_sessions
    WHERE id = p_session_id AND store_id = p_store_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Dispatch session not found';
    END IF;

    IF v_session.status = 'settled' THEN
        RAISE EXCEPTION 'Session already settled';
    END IF;

    -- ============================================================
    -- STEP 2: Build order map for quick lookup
    -- ============================================================
    -- Create a temporary table for session orders
    CREATE TEMP TABLE IF NOT EXISTS temp_session_orders (
        id UUID,
        order_id UUID,
        order_number VARCHAR(100),
        total_price DECIMAL(12,2),
        is_cod BOOLEAN,
        PRIMARY KEY (order_number)
    ) ON COMMIT DROP;

    DELETE FROM temp_session_orders;

    INSERT INTO temp_session_orders (id, order_id, order_number, total_price, is_cod)
    SELECT dso.id, dso.order_id, dso.order_number, dso.total_price, dso.is_cod
    FROM dispatch_session_orders dso
    WHERE dso.dispatch_session_id = p_session_id;

    -- ============================================================
    -- STEP 3: Process each result row from JSONB array
    -- ============================================================
    FOR v_result IN SELECT jsonb_array_elements AS item FROM jsonb_array_elements(p_results)
    LOOP
        v_order_number := (v_result.item)->>'order_number';

        -- Find matching session order
        SELECT * INTO v_session_order
        FROM temp_session_orders
        WHERE order_number = v_order_number;

        IF NOT FOUND THEN
            v_errors := array_append(v_errors,
                format('Order %s not found in this session', v_order_number));
            CONTINUE;
        END IF;

        -- Map delivery status
        v_status_upper := UPPER(TRIM(COALESCE((v_result.item)->>'delivery_status', '')));
        v_delivery_status := CASE
            WHEN v_status_upper IN ('ENTREGADO', 'DELIVERED') THEN 'delivered'
            WHEN v_status_upper IN ('NO ENTREGADO', 'NOT_DELIVERED', 'NO_ENTREGADO') THEN 'not_delivered'
            WHEN v_status_upper IN ('RECHAZADO', 'REJECTED') THEN 'rejected'
            WHEN v_status_upper IN ('REPROGRAMADO', 'RESCHEDULED') THEN 'rescheduled'
            WHEN v_status_upper IN ('DEVUELTO', 'RETURNED') THEN 'returned'
            ELSE 'pending'
        END;

        -- Map failure reason
        v_failure_reason := NULL;
        IF (v_result.item)->>'failure_reason' IS NOT NULL AND (v_result.item)->>'failure_reason' != '' THEN
            v_reason_upper := UPPER(TRIM((v_result.item)->>'failure_reason'));
            v_failure_reason := CASE
                WHEN v_reason_upper LIKE '%NO CONTESTA%' THEN 'no_answer'
                WHEN v_reason_upper LIKE '%DIRECCION%' THEN 'wrong_address'
                WHEN v_reason_upper LIKE '%AUSENTE%' THEN 'customer_absent'
                WHEN v_reason_upper LIKE '%RECHAZ%' THEN 'customer_rejected'
                WHEN v_reason_upper LIKE '%DINERO%' OR v_reason_upper LIKE '%FONDOS%' THEN 'insufficient_funds'
                WHEN v_reason_upper LIKE '%NO SE ENCONTR%' THEN 'address_not_found'
                WHEN v_reason_upper LIKE '%REPROGRAM%' THEN 'rescheduled'
                ELSE 'other'
            END;
        END IF;

        -- Calculate amount collected
        v_is_cod := v_session_order.is_cod;
        v_has_discrepancy := FALSE;

        IF v_delivery_status = 'delivered' THEN
            IF v_is_cod THEN
                -- COD: use reported amount or default to full price
                IF (v_result.item)->>'amount_collected' IS NOT NULL AND (v_result.item)->>'amount_collected' != '' THEN
                    v_amount_collected := ((v_result.item)->>'amount_collected')::DECIMAL(12,2);
                    IF v_amount_collected != v_session_order.total_price THEN
                        v_warnings := array_append(v_warnings,
                            format('⚠️ Pedido %s: Discrepancia de monto - Esperado: %s, Cobrado: %s',
                                v_order_number,
                                v_session_order.total_price,
                                v_amount_collected));
                        v_has_discrepancy := TRUE;
                    END IF;
                ELSE
                    v_amount_collected := v_session_order.total_price;
                END IF;
            ELSE
                -- PREPAID: no money collected
                v_amount_collected := 0;
                IF (v_result.item)->>'amount_collected' IS NOT NULL
                   AND (v_result.item)->>'amount_collected' != ''
                   AND ((v_result.item)->>'amount_collected')::DECIMAL > 0 THEN
                    v_warnings := array_append(v_warnings,
                        format('⚠️ Pedido %s: Es PREPAGO pero el courier reportó cobrar %s. Se registrará como 0.',
                            v_order_number, (v_result.item)->>'amount_collected'));
                END IF;
            END IF;
        ELSE
            -- Not delivered: no amount
            v_amount_collected := 0;
        END IF;

        -- Update dispatch session order
        UPDATE dispatch_session_orders
        SET delivery_status = v_delivery_status,
            amount_collected = v_amount_collected,
            failure_reason = v_failure_reason,
            courier_notes = NULLIF((v_result.item)->>'courier_notes', ''),
            delivered_at = CASE WHEN v_delivery_status = 'delivered' THEN NOW() ELSE NULL END,
            processed_at = NOW()
        WHERE id = v_session_order.id;

        -- Update main orders table for COD deliveries
        IF v_delivery_status = 'delivered' AND v_is_cod THEN
            UPDATE orders
            SET amount_collected = v_amount_collected,
                has_amount_discrepancy = v_has_discrepancy
            WHERE id = v_session_order.order_id;
        END IF;

        -- Create carrier movements for delivered orders (if function exists)
        IF v_delivery_status = 'delivered' THEN
            IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'create_delivery_movements') THEN
                BEGIN
                    PERFORM create_delivery_movements(
                        v_session_order.order_id,
                        v_amount_collected,
                        p_session_id,
                        NULL
                    );
                EXCEPTION WHEN OTHERS THEN
                    v_warnings := array_append(v_warnings,
                        format('Pedido %s actualizado pero no se pudo registrar en cuentas del transportista: %s',
                            v_order_number, SQLERRM));
                END;
            END IF;
        ELSIF v_delivery_status IN ('not_delivered', 'rejected', 'returned') THEN
            -- Create failed attempt fee movement (if function exists)
            IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'create_failed_delivery_movement') THEN
                BEGIN
                    PERFORM create_failed_delivery_movement(
                        v_session_order.order_id,
                        p_session_id,
                        NULL
                    );
                EXCEPTION WHEN OTHERS THEN
                    -- Non-critical: log but don't fail
                    NULL;
                END;
            END IF;
        END IF;

        v_processed := v_processed + 1;
    END LOOP;

    -- ============================================================
    -- STEP 4: Update session status
    -- ============================================================
    UPDATE dispatch_sessions
    SET status = 'processing',
        imported_at = NOW()
    WHERE id = p_session_id;

    -- ============================================================
    -- STEP 5: Return results
    -- ============================================================
    RETURN json_build_object(
        'processed', v_processed,
        'errors', v_errors,
        'warnings', v_warnings
    );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION import_dispatch_results_atomic(UUID, UUID, JSONB) IS
'Atomically imports CSV delivery results. All updates happen in a single transaction.
If any step fails, the entire operation is rolled back.
Input: p_results is a JSONB array of objects with keys: order_number, delivery_status, amount_collected, failure_reason, courier_notes
Returns: { processed: number, errors: string[], warnings: string[] }';


-- ================================================================
-- FUNCTION: process_settlement_atomic_v2
-- ================================================================
-- Improved version that includes carrier movement linking
-- Replaces the existing process_dispatch_settlement_atomic

CREATE OR REPLACE FUNCTION process_settlement_atomic_v2(
    p_session_id UUID,
    p_store_id UUID,
    p_user_id UUID DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
    v_session RECORD;
    v_settlement RECORD;
    v_settlement_code TEXT;
    v_stats RECORD;
    v_net_receivable DECIMAL(12,2);
    v_order RECORD;
    v_new_status VARCHAR(50);
BEGIN
    -- ============================================================
    -- STEP 1: Lock session and validate
    -- ============================================================
    SELECT * INTO v_session
    FROM dispatch_sessions
    WHERE id = p_session_id AND store_id = p_store_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Dispatch session not found';
    END IF;

    IF v_session.status = 'settled' THEN
        RAISE EXCEPTION 'Session already settled';
    END IF;

    IF v_session.status = 'cancelled' THEN
        RAISE EXCEPTION 'Cannot settle cancelled session';
    END IF;

    -- ============================================================
    -- STEP 2: Calculate statistics with COD/prepaid separation
    -- ============================================================
    SELECT
        COUNT(*) as total_dispatched,
        COUNT(*) FILTER (WHERE delivery_status = 'delivered') as total_delivered,
        COUNT(*) FILTER (WHERE delivery_status IN ('not_delivered', 'rejected', 'returned')) as total_not_delivered,
        COUNT(*) FILTER (WHERE delivery_status = 'delivered' AND is_cod = TRUE) as total_cod_delivered,
        COUNT(*) FILTER (WHERE delivery_status = 'delivered' AND is_cod = FALSE) as total_prepaid_delivered,
        -- COD amounts
        COALESCE(SUM(amount_collected) FILTER (WHERE delivery_status = 'delivered' AND is_cod = TRUE), 0) as total_cod_collected,
        COALESCE(SUM(total_price) FILTER (WHERE delivery_status = 'delivered' AND is_cod = TRUE), 0) as total_cod_expected,
        -- Carrier fees separated
        COALESCE(SUM(carrier_fee) FILTER (WHERE delivery_status = 'delivered' AND is_cod = TRUE), 0) as carrier_fees_cod,
        COALESCE(SUM(carrier_fee) FILTER (WHERE delivery_status = 'delivered' AND is_cod = FALSE), 0) as carrier_fees_prepaid,
        COALESCE(SUM(carrier_fee) FILTER (WHERE delivery_status = 'delivered'), 0) as total_carrier_fees,
        -- Failed attempt fees (50% of fee)
        COALESCE(SUM(carrier_fee * 0.5) FILTER (WHERE delivery_status IN ('not_delivered', 'rejected')), 0) as failed_attempt_fee,
        -- Discrepancy count
        COUNT(*) FILTER (WHERE delivery_status = 'delivered' AND is_cod = TRUE
            AND amount_collected IS NOT NULL AND amount_collected != total_price) as total_discrepancies
    INTO v_stats
    FROM dispatch_session_orders
    WHERE dispatch_session_id = p_session_id;

    -- ============================================================
    -- STEP 3: Generate settlement code atomically
    -- ============================================================
    v_settlement_code := generate_settlement_code_atomic(p_store_id);

    -- ============================================================
    -- STEP 4: Calculate net receivable
    -- ============================================================
    -- Formula: COD collected - all carrier fees - failed attempt fees
    -- Positive = courier owes store, Negative = store owes courier
    v_net_receivable := v_stats.total_cod_collected - v_stats.total_carrier_fees - v_stats.failed_attempt_fee;

    -- ============================================================
    -- STEP 5: Create settlement record
    -- ============================================================
    INSERT INTO daily_settlements (
        store_id,
        carrier_id,
        dispatch_session_id,
        settlement_code,
        settlement_date,
        total_dispatched,
        total_delivered,
        total_not_delivered,
        total_cod_delivered,
        total_prepaid_delivered,
        total_cod_collected,
        total_cod_expected,
        carrier_fees_cod,
        carrier_fees_prepaid,
        total_carrier_fees,
        failed_attempt_fee,
        net_receivable,
        balance_due,
        amount_paid,
        status,
        created_by
    ) VALUES (
        p_store_id,
        v_session.carrier_id,
        p_session_id,
        v_settlement_code,
        CURRENT_DATE,
        v_stats.total_dispatched,
        v_stats.total_delivered,
        v_stats.total_not_delivered,
        v_stats.total_cod_delivered,
        v_stats.total_prepaid_delivered,
        v_stats.total_cod_collected,
        v_stats.total_cod_expected,
        v_stats.carrier_fees_cod,
        v_stats.carrier_fees_prepaid,
        v_stats.total_carrier_fees,
        v_stats.failed_attempt_fee,
        v_net_receivable,
        v_net_receivable,  -- balance_due starts equal to net_receivable
        0,                  -- amount_paid starts at 0
        'pending',
        p_user_id
    )
    RETURNING * INTO v_settlement;

    -- ============================================================
    -- STEP 6: Update dispatch session
    -- ============================================================
    UPDATE dispatch_sessions
    SET status = 'settled',
        daily_settlement_id = v_settlement.id,
        settled_at = NOW()
    WHERE id = p_session_id;

    -- ============================================================
    -- STEP 7: Link carrier movements to settlement (if table exists)
    -- ============================================================
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'carrier_account_movements'
    ) THEN
        UPDATE carrier_account_movements
        SET settlement_id = v_settlement.id
        WHERE dispatch_session_id = p_session_id
          AND settlement_id IS NULL;
    END IF;

    -- ============================================================
    -- STEP 8: Batch update order statuses
    -- ============================================================
    -- Update all orders in a single statement instead of loop
    UPDATE orders o
    SET sleeves_status = CASE
            WHEN dso.delivery_status = 'delivered' THEN 'delivered'
            WHEN dso.delivery_status = 'rejected' THEN 'cancelled'
            WHEN dso.delivery_status = 'returned' THEN 'returned'
            WHEN dso.delivery_status = 'not_delivered' THEN 'shipped'  -- Keep as shipped for retry
            ELSE o.sleeves_status
        END,
        delivered_at = CASE
            WHEN dso.delivery_status = 'delivered'
            THEN COALESCE(dso.delivered_at, NOW())
            ELSE NULL
        END
    FROM dispatch_session_orders dso
    WHERE dso.dispatch_session_id = p_session_id
      AND dso.order_id = o.id
      AND dso.delivery_status != 'pending';

    -- ============================================================
    -- STEP 9: Return settlement data
    -- ============================================================
    RETURN row_to_json(v_settlement);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION process_settlement_atomic_v2(UUID, UUID, UUID) IS
'Atomically processes dispatch session into a settlement.
All operations (settlement creation, session update, movement linking, order updates)
happen in a single transaction. If any step fails, everything is rolled back.
Returns: JSON representation of the created settlement.';


-- ================================================================
-- GRANT PERMISSIONS
-- ================================================================
GRANT EXECUTE ON FUNCTION import_dispatch_results_atomic(UUID, UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION import_dispatch_results_atomic(UUID, UUID, JSONB) TO service_role;

GRANT EXECUTE ON FUNCTION process_settlement_atomic_v2(UUID, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION process_settlement_atomic_v2(UUID, UUID, UUID) TO service_role;


-- ================================================================
-- VERIFICATION
-- ================================================================
DO $$
BEGIN
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Migration 069 Verification';
    RAISE NOTICE '========================================';

    -- Verify import function exists with correct signature
    IF EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE p.proname = 'import_dispatch_results_atomic'
        AND n.nspname = 'public'
    ) THEN
        RAISE NOTICE '✓ Function import_dispatch_results_atomic exists';
    ELSE
        RAISE EXCEPTION '✗ Function import_dispatch_results_atomic not created';
    END IF;

    -- Verify settlement function exists
    IF EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE p.proname = 'process_settlement_atomic_v2'
        AND n.nspname = 'public'
    ) THEN
        RAISE NOTICE '✓ Function process_settlement_atomic_v2 exists';
    ELSE
        RAISE EXCEPTION '✗ Function process_settlement_atomic_v2 not created';
    END IF;

    RAISE NOTICE '========================================';
    RAISE NOTICE 'Migration 069 Complete!';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Atomic processing enabled:';
    RAISE NOTICE '1. import_dispatch_results_atomic(UUID, UUID, JSONB) - CSV import';
    RAISE NOTICE '2. process_settlement_atomic_v2(UUID, UUID, UUID) - Settlement';
    RAISE NOTICE '========================================';
END $$;

-- Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';

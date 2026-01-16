-- =============================================
-- Migration 077: Configurable Failed Attempt Fee Percentage
-- =============================================
-- Purpose: Make failed attempt fee percentage configurable per carrier
--          instead of hardcoded at 50%
--
-- Problem:
-- The system hardcoded 0.5 (50%) for failed attempt fees in:
-- 1. settlements.service.ts (processSettlementLegacy, processManualReconciliation)
-- 2. 065_unified_carrier_accounts.sql (create_failed_delivery_movement)
-- 3. 069_settlement_atomic_processing.sql (process_settlement_atomic_v2)
--
-- Different carriers may charge different rates (0%, 30%, 50%, 75%, 100%)
--
-- Solution:
-- Add failed_attempt_fee_percent column to carriers table
-- Update all functions to use this configurable value
--
-- Author: Claude
-- Date: 2026-01-16
-- =============================================

BEGIN;

-- =============================================
-- 1. ADD failed_attempt_fee_percent COLUMN TO CARRIERS
-- =============================================
-- This is safe because we use IF NOT EXISTS and default value

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'carriers'
          AND column_name = 'failed_attempt_fee_percent'
    ) THEN
        ALTER TABLE carriers
        ADD COLUMN failed_attempt_fee_percent DECIMAL(5,2) DEFAULT 50.00;

        -- Add check constraint separately for safety
        ALTER TABLE carriers
        ADD CONSTRAINT chk_failed_attempt_fee_percent_range
        CHECK (failed_attempt_fee_percent >= 0 AND failed_attempt_fee_percent <= 100);

        RAISE NOTICE 'Added failed_attempt_fee_percent column to carriers';
    ELSE
        RAISE NOTICE 'Column failed_attempt_fee_percent already exists';
    END IF;
END $$;

COMMENT ON COLUMN carriers.failed_attempt_fee_percent IS
'Percentage of delivery fee charged for failed attempts (0-100). Default 50%. Only applies when charges_failed_attempts = true.';


-- =============================================
-- 2. UPDATE create_failed_delivery_movement FUNCTION
-- =============================================
-- This function is from migration 065. We use CREATE OR REPLACE which is safe.
-- If the function doesn't exist, this will create it.
-- If carrier_account_movements table doesn't exist, the function will fail at runtime (acceptable).

CREATE OR REPLACE FUNCTION create_failed_delivery_movement(
    p_order_id UUID,
    p_dispatch_session_id UUID DEFAULT NULL,
    p_created_by UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_order RECORD;
    v_carrier RECORD;
    v_carrier_fee DECIMAL(12,2);
    v_failed_fee DECIMAL(12,2);
    v_fee_percent DECIMAL(5,2);
    v_movement_id UUID;
BEGIN
    -- Get order details
    SELECT id, order_number, store_id, courier_id, delivery_zone, shipping_city
    INTO v_order
    FROM orders
    WHERE id = p_order_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order not found: %', p_order_id;
    END IF;

    IF v_order.courier_id IS NULL THEN
        RETURN NULL;  -- No carrier assigned
    END IF;

    -- Get carrier settings including the fee percentage
    SELECT id, charges_failed_attempts, COALESCE(failed_attempt_fee_percent, 50.00) as fee_percent
    INTO v_carrier
    FROM carriers
    WHERE id = v_order.courier_id;

    IF NOT FOUND THEN
        RETURN NULL;  -- Carrier not found
    END IF;

    IF NOT COALESCE(v_carrier.charges_failed_attempts, FALSE) THEN
        RETURN NULL;  -- Carrier doesn't charge for failed attempts
    END IF;

    v_fee_percent := v_carrier.fee_percent;

    -- Get carrier fee using existing function
    v_carrier_fee := get_carrier_fee_for_order(
        v_order.courier_id,
        v_order.delivery_zone,
        v_order.shipping_city
    );

    IF v_carrier_fee <= 0 THEN
        RETURN NULL;
    END IF;

    -- Calculate failed attempt fee using carrier's configured percentage
    v_failed_fee := v_carrier_fee * (v_fee_percent / 100.0);

    -- Create movement
    INSERT INTO carrier_account_movements (
        store_id,
        carrier_id,
        movement_type,
        amount,
        order_id,
        order_number,
        dispatch_session_id,
        description,
        metadata,
        created_by
    ) VALUES (
        v_order.store_id,
        v_order.courier_id,
        'failed_attempt_fee',
        -v_failed_fee,  -- Negative because store owes carrier
        v_order.id,
        v_order.order_number,
        p_dispatch_session_id,
        'Tarifa por intento fallido (' || v_fee_percent::text || ' pct de ' || v_carrier_fee::text || ')',
        jsonb_build_object(
            'full_fee', v_carrier_fee,
            'fee_percent', v_fee_percent,
            'calculated_fee', v_failed_fee,
            'zone', v_order.delivery_zone
        ),
        p_created_by
    )
    RETURNING id INTO v_movement_id;

    RETURN v_movement_id;
END;
$$ LANGUAGE plpgsql;


-- =============================================
-- 3. UPDATE process_settlement_atomic_v2 FUNCTION
-- =============================================
-- Preserve ALL original functionality, only change the 0.5 to use carrier's percent

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
    v_fee_percent DECIMAL(5,2);
BEGIN
    -- ============================================================
    -- STEP 1: Lock session and validate, get carrier fee percent
    -- ============================================================
    SELECT ds.*, COALESCE(c.failed_attempt_fee_percent, 50.00) as carrier_fee_percent
    INTO v_session
    FROM dispatch_sessions ds
    JOIN carriers c ON c.id = ds.carrier_id
    WHERE ds.id = p_session_id AND ds.store_id = p_store_id
    FOR UPDATE OF ds;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Dispatch session not found';
    END IF;

    IF v_session.status = 'settled' THEN
        RAISE EXCEPTION 'Session already settled';
    END IF;

    IF v_session.status = 'cancelled' THEN
        RAISE EXCEPTION 'Cannot settle cancelled session';
    END IF;

    v_fee_percent := v_session.carrier_fee_percent;

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
        -- Failed attempt fees using carrier's configured percentage (was hardcoded 0.5)
        COALESCE(SUM(carrier_fee * (v_fee_percent / 100.0)) FILTER (WHERE delivery_status IN ('not_delivered', 'rejected')), 0) as failed_attempt_fee,
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
Uses carrier''s configured failed_attempt_fee_percent (default 50%).
All operations happen in a single transaction. If any step fails, everything is rolled back.
Returns: JSON representation of the created settlement.';


-- =============================================
-- 4. CREATE HELPER VIEW FOR CARRIER FEE INFO
-- =============================================

DROP VIEW IF EXISTS v_carrier_fee_settings;
CREATE VIEW v_carrier_fee_settings AS
SELECT
    c.id,
    c.store_id,
    c.name,
    COALESCE(c.charges_failed_attempts, FALSE) as charges_failed_attempts,
    COALESCE(c.failed_attempt_fee_percent, 50.00) as failed_attempt_fee_percent,
    c.settlement_type,
    c.is_active,
    (SELECT COUNT(*) FROM carrier_zones cz WHERE cz.carrier_id = c.id AND cz.is_active = TRUE) as zone_count
FROM carriers c;

COMMENT ON VIEW v_carrier_fee_settings IS
'Carrier fee configuration summary including failed attempt fee percentage';


-- =============================================
-- VERIFICATION
-- =============================================

DO $$
DECLARE
    v_column_exists BOOLEAN;
    v_function_exists BOOLEAN;
BEGIN
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Migration 077: Configurable Failed Attempt Fee';
    RAISE NOTICE '========================================';

    -- Verify column exists
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'carriers'
          AND column_name = 'failed_attempt_fee_percent'
    ) INTO v_column_exists;

    IF v_column_exists THEN
        RAISE NOTICE '  [OK] Column carriers.failed_attempt_fee_percent exists';
    ELSE
        RAISE EXCEPTION '  [ERROR] Column carriers.failed_attempt_fee_percent NOT created';
    END IF;

    -- Verify process_settlement_atomic_v2 function exists
    SELECT EXISTS (
        SELECT 1 FROM pg_proc WHERE proname = 'process_settlement_atomic_v2'
    ) INTO v_function_exists;

    IF v_function_exists THEN
        RAISE NOTICE '  [OK] Function process_settlement_atomic_v2 updated';
    ELSE
        RAISE WARNING '  [WARN] Function process_settlement_atomic_v2 not found';
    END IF;

    -- Verify view exists
    IF EXISTS (
        SELECT 1 FROM information_schema.views
        WHERE table_name = 'v_carrier_fee_settings'
    ) THEN
        RAISE NOTICE '  [OK] View v_carrier_fee_settings created';
    END IF;

    RAISE NOTICE '========================================';
    RAISE NOTICE 'Migration 077 Complete!';
    RAISE NOTICE '';
    RAISE NOTICE 'Changes applied:';
    RAISE NOTICE '1. Added failed_attempt_fee_percent column to carriers (default 50)';
    RAISE NOTICE '2. Updated process_settlement_atomic_v2 to use carrier percentage';
    RAISE NOTICE '3. Updated create_failed_delivery_movement';
    RAISE NOTICE '4. Created v_carrier_fee_settings view';
    RAISE NOTICE '========================================';
END $$;

-- Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';

COMMIT;

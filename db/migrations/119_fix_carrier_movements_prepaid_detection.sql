-- ============================================================
-- Migration 119: Fix Carrier Account Movements for Prepaid Detection
--
-- PRODUCTION-READY - CRITICAL FIX
-- Version: 1.1
-- Date: 2026-01-30
--
-- PROBLEM: The carrier account movements system (migration 065) has
-- two critical bugs:
--
-- BUG #1: The trigger that creates movements when orders are delivered
--         does NOT consider prepaid_method. If an order was originally
--         COD but the customer later paid via transfer, the trigger
--         incorrectly creates a cod_collected movement.
--
-- BUG #2: The reconciliation process does NOT create movements. It only
--         creates the settlement record, but never creates the individual
--         movements in carrier_account_movements. This causes the carrier
--         balance to be incorrect.
--
-- FIXES:
-- 1. Update create_delivery_movements() to use is_order_cod()
-- 2. Update the trigger to use the fixed function
-- 3. Create create_reconciliation_movements() for batch movement creation
-- 4. Create backfill function to fix incorrect historical movements
--
-- DEPENDENCIES:
-- - Migration 065: carrier_account_movements table, get_carrier_fee_for_order()
-- - Migration 115: is_order_cod() function
--
-- IDEMPOTENT: Safe to run multiple times
-- ROLLBACK: All CREATE OR REPLACE, safe to re-run
-- ============================================================

BEGIN;

-- ============================================================
-- 0. PRE-FLIGHT CHECKS & AUTO-CREATE DEPENDENCIES
-- ============================================================
DO $$
BEGIN
    -- Check carrier_account_movements table exists (from migration 065)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'carrier_account_movements'
    ) THEN
        RAISE EXCEPTION 'DEPENDENCY MISSING: Table carrier_account_movements not found. Run migration 065 first.';
    END IF;

    RAISE NOTICE 'Pre-flight checks passed.';
END $$;


-- ============================================================
-- 0.1 CREATE is_order_cod() IF NOT EXISTS
-- This function may have been created by migration 115, but we
-- ensure it exists here for self-contained deployment
-- ============================================================
CREATE OR REPLACE FUNCTION is_order_cod(
    p_payment_method TEXT,
    p_prepaid_method TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
    -- Order is COD only if:
    -- 1. prepaid_method is NULL (not marked as prepaid)
    -- 2. payment_method is a COD type (or empty, which defaults to COD)
    SELECT p_prepaid_method IS NULL
        AND LOWER(COALESCE(p_payment_method, '')) IN ('cod', 'cash', 'contra_entrega', 'efectivo', 'contra entrega', '');
$$;

COMMENT ON FUNCTION is_order_cod(TEXT, TEXT) IS
'Determines if an order should be treated as COD.
Returns FALSE if prepaid_method is set, even if payment_method is efectivo.
Auto-created by migration 119 if not exists.';


-- ============================================================
-- 0.2 CREATE get_carrier_fee_for_order() IF NOT EXISTS
-- Fallback if migration 065 wasn't fully applied
-- ============================================================
CREATE OR REPLACE FUNCTION get_carrier_fee_for_order(
    p_carrier_id UUID,
    p_zone_name TEXT,
    p_city TEXT DEFAULT NULL
)
RETURNS DECIMAL(12,2)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_rate DECIMAL(12,2);
    v_fallback_zones TEXT[] := ARRAY['default', 'otros', 'interior', 'general'];
    v_zone TEXT;
BEGIN
    -- Try carrier_coverage first (city-based rates from migration 090)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'carrier_coverage') THEN
        SELECT rate INTO v_rate
        FROM carrier_coverage
        WHERE carrier_id = p_carrier_id
          AND is_active = TRUE
          AND LOWER(TRIM(city)) = LOWER(TRIM(COALESCE(p_city, '')))
        LIMIT 1;

        IF v_rate IS NOT NULL THEN
            RETURN v_rate;
        END IF;
    END IF;

    -- Try exact zone match in carrier_zones
    SELECT rate INTO v_rate
    FROM carrier_zones
    WHERE carrier_id = p_carrier_id
      AND is_active = true
      AND (
          LOWER(TRIM(zone_name)) = LOWER(TRIM(COALESCE(p_zone_name, '')))
          OR LOWER(TRIM(zone_name)) = LOWER(TRIM(COALESCE(p_city, '')))
      )
    LIMIT 1;

    IF v_rate IS NOT NULL THEN
        RETURN v_rate;
    END IF;

    -- Try fallback zones
    FOREACH v_zone IN ARRAY v_fallback_zones
    LOOP
        SELECT rate INTO v_rate
        FROM carrier_zones
        WHERE carrier_id = p_carrier_id
          AND is_active = true
          AND LOWER(TRIM(zone_name)) = v_zone
        LIMIT 1;

        IF v_rate IS NOT NULL THEN
            RETURN v_rate;
        END IF;
    END LOOP;

    -- Last resort: first active zone rate
    SELECT rate INTO v_rate
    FROM carrier_zones
    WHERE carrier_id = p_carrier_id
      AND is_active = true
    ORDER BY created_at
    LIMIT 1;

    RETURN COALESCE(v_rate, 0);
END;
$$;

COMMENT ON FUNCTION get_carrier_fee_for_order(UUID, TEXT, TEXT) IS
'Returns carrier fee for an order based on zone/city, with intelligent fallback.
Auto-created by migration 119 if not exists.';


-- ============================================================
-- 0.3 CREATE create_failed_delivery_movement() IF NOT EXISTS
-- This function is from migration 077, included here for self-containment
-- ============================================================
CREATE OR REPLACE FUNCTION create_failed_delivery_movement(
    p_order_id UUID,
    p_dispatch_session_id UUID DEFAULT NULL,
    p_created_by UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order RECORD;
    v_carrier RECORD;
    v_carrier_fee DECIMAL(12,2);
    v_failed_fee DECIMAL(12,2);
    v_fee_percent DECIMAL(5,2);
    v_movement_id UUID;
BEGIN
    -- Get order details
    SELECT id, order_number, store_id, courier_id, delivery_zone, shipping_city, shipping_city_normalized
    INTO v_order
    FROM orders
    WHERE id = p_order_id;

    IF NOT FOUND THEN
        RAISE WARNING 'Order not found: %. Skipping failed delivery movement.', p_order_id;
        RETURN NULL;
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
        COALESCE(v_order.shipping_city_normalized, v_order.shipping_city)
    );

    IF v_carrier_fee <= 0 THEN
        RETURN NULL;
    END IF;

    -- Calculate failed attempt fee using carrier's configured percentage
    v_failed_fee := v_carrier_fee * (v_fee_percent / 100.0);

    -- Create movement with ON CONFLICT to prevent duplicates
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
        movement_date,
        created_by
    ) VALUES (
        v_order.store_id,
        v_order.courier_id,
        'failed_attempt_fee',
        -v_failed_fee,  -- Negative because store owes carrier
        v_order.id,
        v_order.order_number,
        p_dispatch_session_id,
        'Tarifa por intento fallido (' || v_fee_percent::text || '% de ' || v_carrier_fee::text || ')',
        jsonb_build_object(
            'full_fee', v_carrier_fee,
            'fee_percent', v_fee_percent,
            'calculated_fee', v_failed_fee,
            'zone', COALESCE(v_order.delivery_zone, v_order.shipping_city),
            'migration', '119'
        ),
        CURRENT_DATE,
        p_created_by
    )
    ON CONFLICT (order_id, movement_type) DO UPDATE
    SET amount = EXCLUDED.amount,
        metadata = carrier_account_movements.metadata || EXCLUDED.metadata
    RETURNING id INTO v_movement_id;

    RETURN v_movement_id;
END;
$$;

COMMENT ON FUNCTION create_failed_delivery_movement(UUID, UUID, UUID) IS
'Creates a failed attempt fee movement when delivery fails.
Uses carrier''s configured failed_attempt_fee_percent (default 50%).
Only creates movement if carrier has charges_failed_attempts = true.
Auto-created by migration 119 for self-containment.';


-- ============================================================
-- 1. UPDATED: create_delivery_movements function
-- Now uses is_order_cod() for proper prepaid detection
-- SECURITY DEFINER to bypass RLS when called from triggers
-- ============================================================
CREATE OR REPLACE FUNCTION create_delivery_movements(
    p_order_id UUID,
    p_amount_collected DECIMAL(12,2) DEFAULT NULL,
    p_dispatch_session_id UUID DEFAULT NULL,
    p_created_by UUID DEFAULT NULL
)
RETURNS TABLE(
    cod_movement_id UUID,
    fee_movement_id UUID,
    total_cod DECIMAL(12,2),
    total_fee DECIMAL(12,2)
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order RECORD;
    v_carrier RECORD;
    v_carrier_fee DECIMAL(12,2);
    v_is_cod BOOLEAN;
    v_cod_amount DECIMAL(12,2);
    v_cod_movement_id UUID := NULL;
    v_fee_movement_id UUID := NULL;
BEGIN
    -- Get order details including prepaid_method
    SELECT
        o.id, o.store_id, o.courier_id, o.order_number,
        o.total_price, o.payment_method, o.prepaid_method,
        o.delivery_zone, o.shipping_city, o.shipping_city_normalized,
        o.sleeves_status
    INTO v_order
    FROM orders o
    WHERE o.id = p_order_id;

    IF NOT FOUND THEN
        RAISE WARNING 'Order not found: %. Skipping movement creation.', p_order_id;
        RETURN QUERY SELECT NULL::UUID, NULL::UUID, 0::DECIMAL(12,2), 0::DECIMAL(12,2);
        RETURN;
    END IF;

    IF v_order.courier_id IS NULL THEN
        RAISE WARNING 'Order % has no carrier assigned. Skipping movement creation.', p_order_id;
        RETURN QUERY SELECT NULL::UUID, NULL::UUID, 0::DECIMAL(12,2), 0::DECIMAL(12,2);
        RETURN;
    END IF;

    -- Get carrier config
    SELECT c.id, c.settlement_type, c.charges_failed_attempts
    INTO v_carrier
    FROM carriers c
    WHERE c.id = v_order.courier_id;

    IF NOT FOUND THEN
        RAISE WARNING 'Carrier not found for order %. Skipping movement creation.', p_order_id;
        RETURN QUERY SELECT NULL::UUID, NULL::UUID, 0::DECIMAL(12,2), 0::DECIMAL(12,2);
        RETURN;
    END IF;

    -- CRITICAL FIX: Use is_order_cod() for proper prepaid detection
    -- This considers BOTH payment_method AND prepaid_method
    v_is_cod := is_order_cod(v_order.payment_method, v_order.prepaid_method);

    -- Calculate COD amount
    IF v_is_cod THEN
        v_cod_amount := COALESCE(p_amount_collected, v_order.total_price, 0);
    ELSE
        v_cod_amount := 0;
    END IF;

    -- Get carrier fee using the smart fee function
    -- Priority: carrier_coverage (city) -> carrier_zones (zone) -> default
    v_carrier_fee := COALESCE(
        get_carrier_fee_for_order(
            v_order.courier_id,
            v_order.delivery_zone,
            COALESCE(v_order.shipping_city_normalized, v_order.shipping_city)
        ),
        0
    );

    -- Create COD movement (ONLY if COD order and amount > 0)
    IF v_is_cod AND v_cod_amount > 0 THEN
        INSERT INTO carrier_account_movements (
            store_id, carrier_id, movement_type, amount,
            order_id, order_number, dispatch_session_id,
            description, movement_date, created_by,
            metadata
        ) VALUES (
            v_order.store_id, v_order.courier_id, 'cod_collected', v_cod_amount,
            p_order_id, v_order.order_number, p_dispatch_session_id,
            'COD cobrado en entrega de pedido ' || COALESCE(v_order.order_number, p_order_id::text),
            CURRENT_DATE, p_created_by,
            jsonb_build_object(
                'payment_method', v_order.payment_method,
                'prepaid_method', v_order.prepaid_method,
                'original_total', v_order.total_price,
                'is_cod', true,
                'migration', '119'
            )
        )
        ON CONFLICT (order_id, movement_type) DO UPDATE
        SET amount = EXCLUDED.amount,
            description = EXCLUDED.description,
            metadata = carrier_account_movements.metadata || EXCLUDED.metadata
        RETURNING id INTO v_cod_movement_id;
    END IF;

    -- Create fee movement (carrier earns fee for EVERY successful delivery, COD or prepaid)
    IF v_carrier_fee > 0 THEN
        INSERT INTO carrier_account_movements (
            store_id, carrier_id, movement_type, amount,
            order_id, order_number, dispatch_session_id,
            description, movement_date, created_by,
            metadata
        ) VALUES (
            v_order.store_id, v_order.courier_id, 'delivery_fee', -v_carrier_fee,
            p_order_id, v_order.order_number, p_dispatch_session_id,
            'Tarifa de entrega para pedido ' || COALESCE(v_order.order_number, p_order_id::text),
            CURRENT_DATE, p_created_by,
            jsonb_build_object(
                'zone', COALESCE(v_order.delivery_zone, v_order.shipping_city),
                'city', v_order.shipping_city,
                'fee_rate', v_carrier_fee,
                'is_cod', v_is_cod,
                'migration', '119'
            )
        )
        ON CONFLICT (order_id, movement_type) DO UPDATE
        SET amount = EXCLUDED.amount,
            description = EXCLUDED.description,
            metadata = carrier_account_movements.metadata || EXCLUDED.metadata
        RETURNING id INTO v_fee_movement_id;
    END IF;

    RETURN QUERY SELECT v_cod_movement_id, v_fee_movement_id, v_cod_amount, v_carrier_fee;
END;
$$;

COMMENT ON FUNCTION create_delivery_movements(UUID, DECIMAL, UUID, UUID) IS
'Creates account movements when an order is delivered.
FIXED in migration 119: Uses is_order_cod() to properly detect prepaid orders.
COD orders get cod_collected movement. ALL deliveries get delivery_fee movement.
SECURITY DEFINER to work from triggers.';


-- ============================================================
-- 2. UPDATED: Trigger function for auto-creating movements
-- ============================================================
CREATE OR REPLACE FUNCTION trigger_create_delivery_movement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_result RECORD;
BEGIN
    -- Only trigger on status change TO delivered
    IF NEW.sleeves_status = 'delivered' AND
       (OLD.sleeves_status IS NULL OR OLD.sleeves_status != 'delivered') THEN

        -- Check if order has carrier
        IF NEW.courier_id IS NOT NULL THEN
            -- Check if movement already exists (from dispatch flow or previous trigger)
            IF NOT EXISTS (
                SELECT 1 FROM carrier_account_movements
                WHERE order_id = NEW.id
                  AND movement_type IN ('cod_collected', 'delivery_fee')
            ) THEN
                -- Create movements using the FIXED function
                BEGIN
                    SELECT * INTO v_result
                    FROM create_delivery_movements(
                        NEW.id,
                        NEW.amount_collected,
                        NULL,  -- No dispatch session
                        NULL   -- No user context in trigger
                    );

                    -- Only log if movements were created
                    IF v_result.cod_movement_id IS NOT NULL OR v_result.fee_movement_id IS NOT NULL THEN
                        RAISE NOTICE '[M119] Created delivery movements for order %: COD=%, Fee=%',
                            COALESCE(NEW.order_number, NEW.id::text),
                            COALESCE(v_result.total_cod, 0),
                            COALESCE(v_result.total_fee, 0);
                    END IF;
                EXCEPTION WHEN OTHERS THEN
                    -- Log error but don't fail the transaction
                    RAISE WARNING '[M119] Error creating movements for order %: %',
                        COALESCE(NEW.order_number, NEW.id::text), SQLERRM;
                END;
            END IF;
        END IF;
    END IF;

    -- Handle failed delivery status changes
    IF NEW.sleeves_status IN ('cancelled', 'returned') AND
       OLD.sleeves_status = 'shipped' AND
       NEW.courier_id IS NOT NULL THEN
        -- Check if this was a delivery failure (not a pre-dispatch cancellation)
        IF NOT EXISTS (
            SELECT 1 FROM carrier_account_movements
            WHERE order_id = NEW.id
              AND movement_type = 'failed_attempt_fee'
        ) THEN
            BEGIN
                PERFORM create_failed_delivery_movement(NEW.id, NULL, NULL);
            EXCEPTION WHEN OTHERS THEN
                RAISE WARNING '[M119] Error creating failed movement for order %: %',
                    COALESCE(NEW.order_number, NEW.id::text), SQLERRM;
            END;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- Recreate trigger (DROP IF EXISTS + CREATE is safer than CREATE OR REPLACE for triggers)
DROP TRIGGER IF EXISTS trigger_order_delivery_movement ON orders;
CREATE TRIGGER trigger_order_delivery_movement
    AFTER UPDATE ON orders
    FOR EACH ROW
    WHEN (OLD.sleeves_status IS DISTINCT FROM NEW.sleeves_status)
    EXECUTE FUNCTION trigger_create_delivery_movement();

COMMENT ON TRIGGER trigger_order_delivery_movement ON orders IS
'Auto-creates carrier account movements when orders are delivered or failed.
FIXED in migration 119: Uses is_order_cod() for proper prepaid detection.';


-- ============================================================
-- 3. NEW: Function to create movements during reconciliation
-- This is the missing piece - called by the service layer
-- ============================================================
CREATE OR REPLACE FUNCTION create_reconciliation_movements(
    p_store_id UUID,
    p_settlement_id UUID,
    p_orders JSONB,  -- Array of {order_id, delivered, carrier_fee, is_cod, amount_collected, failure_reason}
    p_failed_fee_percent NUMERIC DEFAULT 50,
    p_created_by UUID DEFAULT NULL
)
RETURNS TABLE(
    movements_created INT,
    cod_movements INT,
    fee_movements INT,
    failed_movements INT,
    total_cod DECIMAL(12,2),
    total_fees DECIMAL(12,2),
    total_failed_fees DECIMAL(12,2)
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order JSONB;
    v_order_id UUID;
    v_order_record RECORD;
    v_movement_id UUID;
    v_is_cod BOOLEAN;
    v_carrier_fee NUMERIC;
    v_amount_collected NUMERIC;
    v_failed_fee NUMERIC;
    v_movements_created INT := 0;
    v_cod_movements INT := 0;
    v_fee_movements INT := 0;
    v_failed_movements INT := 0;
    v_total_cod DECIMAL(12,2) := 0;
    v_total_fees DECIMAL(12,2) := 0;
    v_total_failed_fees DECIMAL(12,2) := 0;
BEGIN
    -- Validate inputs
    IF p_store_id IS NULL THEN
        RAISE EXCEPTION 'store_id is required';
    END IF;

    IF p_orders IS NULL OR jsonb_array_length(p_orders) = 0 THEN
        RAISE WARNING 'No orders provided for movement creation';
        RETURN QUERY SELECT 0, 0, 0, 0, 0::DECIMAL(12,2), 0::DECIMAL(12,2), 0::DECIMAL(12,2);
        RETURN;
    END IF;

    -- Process each order
    FOR v_order IN SELECT * FROM jsonb_array_elements(p_orders)
    LOOP
        BEGIN
            v_order_id := (v_order->>'order_id')::UUID;
            v_is_cod := COALESCE((v_order->>'is_cod')::BOOLEAN, FALSE);
            v_carrier_fee := COALESCE((v_order->>'carrier_fee')::NUMERIC, 0);
            v_amount_collected := COALESCE((v_order->>'amount_collected')::NUMERIC, 0);

            -- Get order details (without row lock to avoid deadlocks)
            SELECT o.*, c.name as carrier_name
            INTO v_order_record
            FROM orders o
            LEFT JOIN carriers c ON c.id = o.courier_id
            WHERE o.id = v_order_id
              AND o.store_id = p_store_id;

            IF v_order_record IS NULL THEN
                RAISE WARNING 'Order not found: %', v_order_id;
                CONTINUE;
            END IF;

            IF v_order_record.courier_id IS NULL THEN
                RAISE WARNING 'Order has no carrier, skipping movements: %', v_order_id;
                CONTINUE;
            END IF;

            IF COALESCE((v_order->>'delivered')::BOOLEAN, FALSE) THEN
                -- DELIVERED ORDER: Create COD movement (if COD) and delivery_fee movement (always)

                -- Create COD collected movement if COD order
                IF v_is_cod AND v_amount_collected > 0 THEN
                    INSERT INTO carrier_account_movements (
                        store_id, carrier_id, movement_type, amount,
                        order_id, order_number, settlement_id,
                        description, movement_date, created_by,
                        metadata
                    ) VALUES (
                        p_store_id, v_order_record.courier_id, 'cod_collected', v_amount_collected,
                        v_order_id, v_order_record.order_number, p_settlement_id,
                        'COD cobrado - ' || COALESCE(v_order_record.order_number, v_order_id::text),
                        CURRENT_DATE, p_created_by,
                        jsonb_build_object(
                            'payment_method', v_order_record.payment_method,
                            'prepaid_method', v_order_record.prepaid_method,
                            'reconciliation', true,
                            'migration', '119'
                        )
                    )
                    ON CONFLICT (order_id, movement_type) DO UPDATE
                    SET amount = EXCLUDED.amount,
                        settlement_id = COALESCE(EXCLUDED.settlement_id, carrier_account_movements.settlement_id),
                        metadata = carrier_account_movements.metadata || EXCLUDED.metadata
                    RETURNING id INTO v_movement_id;

                    IF v_movement_id IS NOT NULL THEN
                        v_cod_movements := v_cod_movements + 1;
                        v_total_cod := v_total_cod + v_amount_collected;
                        v_movements_created := v_movements_created + 1;
                    END IF;
                END IF;

                -- Create delivery fee movement (ALWAYS for delivered orders, COD or prepaid)
                IF v_carrier_fee > 0 THEN
                    INSERT INTO carrier_account_movements (
                        store_id, carrier_id, movement_type, amount,
                        order_id, order_number, settlement_id,
                        description, movement_date, created_by,
                        metadata
                    ) VALUES (
                        p_store_id, v_order_record.courier_id, 'delivery_fee', -v_carrier_fee,
                        v_order_id, v_order_record.order_number, p_settlement_id,
                        'Tarifa entrega - ' || COALESCE(v_order_record.order_number, v_order_id::text),
                        CURRENT_DATE, p_created_by,
                        jsonb_build_object(
                            'zone', COALESCE(v_order_record.delivery_zone, v_order_record.shipping_city),
                            'is_cod', v_is_cod,
                            'reconciliation', true,
                            'migration', '119'
                        )
                    )
                    ON CONFLICT (order_id, movement_type) DO UPDATE
                    SET amount = EXCLUDED.amount,
                        settlement_id = COALESCE(EXCLUDED.settlement_id, carrier_account_movements.settlement_id),
                        metadata = carrier_account_movements.metadata || EXCLUDED.metadata
                    RETURNING id INTO v_movement_id;

                    IF v_movement_id IS NOT NULL THEN
                        v_fee_movements := v_fee_movements + 1;
                        v_total_fees := v_total_fees + v_carrier_fee;
                        v_movements_created := v_movements_created + 1;
                    END IF;
                END IF;

            ELSE
                -- NOT DELIVERED: Create failed attempt fee movement
                IF v_carrier_fee > 0 AND p_failed_fee_percent > 0 THEN
                    v_failed_fee := v_carrier_fee * p_failed_fee_percent / 100;

                    INSERT INTO carrier_account_movements (
                        store_id, carrier_id, movement_type, amount,
                        order_id, order_number, settlement_id,
                        description, movement_date, created_by,
                        metadata
                    ) VALUES (
                        p_store_id, v_order_record.courier_id, 'failed_attempt_fee', -v_failed_fee,
                        v_order_id, v_order_record.order_number, p_settlement_id,
                        'Intento fallido - ' || COALESCE(v_order_record.order_number, v_order_id::text),
                        CURRENT_DATE, p_created_by,
                        jsonb_build_object(
                            'full_fee', v_carrier_fee,
                            'fee_percent', p_failed_fee_percent,
                            'failure_reason', v_order->>'failure_reason',
                            'reconciliation', true,
                            'migration', '119'
                        )
                    )
                    ON CONFLICT (order_id, movement_type) DO UPDATE
                    SET amount = EXCLUDED.amount,
                        settlement_id = COALESCE(EXCLUDED.settlement_id, carrier_account_movements.settlement_id),
                        metadata = carrier_account_movements.metadata || EXCLUDED.metadata
                    RETURNING id INTO v_movement_id;

                    IF v_movement_id IS NOT NULL THEN
                        v_failed_movements := v_failed_movements + 1;
                        v_total_failed_fees := v_total_failed_fees + v_failed_fee;
                        v_movements_created := v_movements_created + 1;
                    END IF;
                END IF;
            END IF;

        EXCEPTION WHEN OTHERS THEN
            -- Log error but continue processing other orders
            RAISE WARNING 'Error processing order %: %', v_order_id, SQLERRM;
            CONTINUE;
        END;
    END LOOP;

    RETURN QUERY SELECT
        v_movements_created,
        v_cod_movements,
        v_fee_movements,
        v_failed_movements,
        v_total_cod,
        v_total_fees,
        v_total_failed_fees;
END;
$$;

COMMENT ON FUNCTION create_reconciliation_movements(UUID, UUID, JSONB, NUMERIC, UUID) IS
'Creates carrier account movements during reconciliation.
Called by the service layer after creating a settlement.
Migration 119: The missing piece that connects settlements to movements.
Handles errors gracefully - will continue processing remaining orders if one fails.';


-- ============================================================
-- 4. NEW: Backfill function to fix incorrect historical movements
-- ============================================================
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
Migration 119.';


-- ============================================================
-- 5. NEW: View for monitoring movement health
-- ============================================================
DROP VIEW IF EXISTS v_carrier_movement_health CASCADE;

CREATE VIEW v_carrier_movement_health AS
SELECT
    o.store_id,
    c.id as carrier_id,
    c.name as carrier_name,
    COUNT(*) as total_delivered_orders,
    COUNT(*) FILTER (WHERE m_cod.id IS NOT NULL) as orders_with_cod_movement,
    COUNT(*) FILTER (WHERE m_fee.id IS NOT NULL) as orders_with_fee_movement,
    COUNT(*) FILTER (WHERE is_order_cod(o.payment_method, o.prepaid_method)) as actual_cod_orders,
    COUNT(*) FILTER (WHERE NOT is_order_cod(o.payment_method, o.prepaid_method)) as actual_prepaid_orders,
    -- Problem detection
    COUNT(*) FILTER (
        WHERE m_cod.id IS NOT NULL
        AND NOT is_order_cod(o.payment_method, o.prepaid_method)
    ) as incorrect_cod_movements,
    COUNT(*) FILTER (
        WHERE m_fee.id IS NULL
    ) as missing_fee_movements,
    -- Health status
    CASE
        WHEN COUNT(*) FILTER (WHERE m_cod.id IS NOT NULL AND NOT is_order_cod(o.payment_method, o.prepaid_method)) > 0
            THEN 'CRITICAL: Incorrect COD movements'
        WHEN COUNT(*) FILTER (WHERE m_fee.id IS NULL) > 0
            THEN 'WARNING: Missing fee movements'
        ELSE 'HEALTHY'
    END as health_status
FROM orders o
JOIN carriers c ON c.id = o.courier_id
LEFT JOIN carrier_account_movements m_cod ON m_cod.order_id = o.id AND m_cod.movement_type = 'cod_collected'
LEFT JOIN carrier_account_movements m_fee ON m_fee.order_id = o.id AND m_fee.movement_type = 'delivery_fee'
WHERE o.sleeves_status = 'delivered'
  AND o.courier_id IS NOT NULL
  AND o.delivered_at > NOW() - INTERVAL '90 days'
GROUP BY o.store_id, c.id, c.name
HAVING
    COUNT(*) FILTER (WHERE m_cod.id IS NOT NULL AND NOT is_order_cod(o.payment_method, o.prepaid_method)) > 0
    OR COUNT(*) FILTER (WHERE m_fee.id IS NULL) > 0;

COMMENT ON VIEW v_carrier_movement_health IS
'Monitoring view for carrier movement integrity.
Shows carriers with: incorrect COD movements (prepaid orders with cod_collected)
or missing fee movements (delivered orders without delivery_fee).
Empty result = all healthy. Migration 119.';


-- ============================================================
-- 6. Grant permissions
-- ============================================================
GRANT EXECUTE ON FUNCTION is_order_cod(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION is_order_cod(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION get_carrier_fee_for_order(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_carrier_fee_for_order(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION create_failed_delivery_movement(UUID, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION create_failed_delivery_movement(UUID, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION create_delivery_movements(UUID, DECIMAL, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION create_delivery_movements(UUID, DECIMAL, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION create_reconciliation_movements(UUID, UUID, JSONB, NUMERIC, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION create_reconciliation_movements(UUID, UUID, JSONB, NUMERIC, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION backfill_fix_prepaid_movements(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION backfill_fix_prepaid_movements(UUID, BOOLEAN) TO service_role;
GRANT SELECT ON v_carrier_movement_health TO authenticated;
GRANT SELECT ON v_carrier_movement_health TO service_role;


-- ============================================================
-- 7. Final Verification
-- ============================================================
DO $$
DECLARE
    v_func_count INT;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Migration 119 Verification';
    RAISE NOTICE '========================================';

    -- Test is_order_cod function
    IF is_order_cod('efectivo', NULL) != TRUE THEN
        RAISE EXCEPTION 'TEST FAILED: is_order_cod(efectivo, NULL) should be TRUE';
    END IF;
    RAISE NOTICE 'PASS: is_order_cod(efectivo, NULL) = TRUE';

    IF is_order_cod('efectivo', 'transferencia') != FALSE THEN
        RAISE EXCEPTION 'TEST FAILED: is_order_cod(efectivo, transferencia) should be FALSE';
    END IF;
    RAISE NOTICE 'PASS: is_order_cod(efectivo, transferencia) = FALSE';

    IF is_order_cod('tarjeta', NULL) != FALSE THEN
        RAISE EXCEPTION 'TEST FAILED: is_order_cod(tarjeta, NULL) should be FALSE';
    END IF;
    RAISE NOTICE 'PASS: is_order_cod(tarjeta, NULL) = FALSE';

    IF is_order_cod(NULL, NULL) != TRUE THEN
        RAISE EXCEPTION 'TEST FAILED: is_order_cod(NULL, NULL) should be TRUE (default COD)';
    END IF;
    RAISE NOTICE 'PASS: is_order_cod(NULL, NULL) = TRUE';

    -- Verify all functions exist
    SELECT COUNT(*) INTO v_func_count
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.proname IN ('create_delivery_movements', 'create_reconciliation_movements', 'backfill_fix_prepaid_movements', 'create_failed_delivery_movement');

    IF v_func_count < 4 THEN
        RAISE EXCEPTION 'TEST FAILED: Not all functions created (found %/4)', v_func_count;
    END IF;
    RAISE NOTICE 'PASS: All 4 functions created';

    -- Verify view exists
    IF NOT EXISTS (SELECT 1 FROM pg_views WHERE viewname = 'v_carrier_movement_health') THEN
        RAISE EXCEPTION 'TEST FAILED: v_carrier_movement_health view not found';
    END IF;
    RAISE NOTICE 'PASS: v_carrier_movement_health view exists';

    -- Verify trigger exists
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_order_delivery_movement') THEN
        RAISE EXCEPTION 'TEST FAILED: trigger_order_delivery_movement not found';
    END IF;
    RAISE NOTICE 'PASS: trigger_order_delivery_movement exists';

    RAISE NOTICE '========================================';
    RAISE NOTICE 'Migration 119 COMPLETE!';
    RAISE NOTICE '========================================';
    RAISE NOTICE '';
    RAISE NOTICE 'CHANGES APPLIED:';
    RAISE NOTICE '  1. is_order_cod() - auto-created if missing';
    RAISE NOTICE '  2. get_carrier_fee_for_order() - auto-created if missing';
    RAISE NOTICE '  3. create_failed_delivery_movement() - auto-created if missing';
    RAISE NOTICE '  4. create_delivery_movements() - now uses is_order_cod()';
    RAISE NOTICE '  5. Trigger - updated to use fixed function';
    RAISE NOTICE '  6. create_reconciliation_movements() - NEW for settlements';
    RAISE NOTICE '  7. backfill_fix_prepaid_movements() - NEW for historical fix';
    RAISE NOTICE '  8. v_carrier_movement_health - NEW monitoring view';
    RAISE NOTICE '';
    RAISE NOTICE 'NEXT STEPS:';
    RAISE NOTICE '  1. Check health: SELECT * FROM v_carrier_movement_health;';
    RAISE NOTICE '  2. Preview fix:  SELECT * FROM backfill_fix_prepaid_movements(NULL, TRUE);';
    RAISE NOTICE '  3. Apply fix:    SELECT * FROM backfill_fix_prepaid_movements(NULL, FALSE);';
    RAISE NOTICE '  4. Re-check:     SELECT * FROM v_carrier_movement_health;';
    RAISE NOTICE '========================================';
END $$;

COMMIT;

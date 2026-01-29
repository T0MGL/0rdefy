-- ================================================================
-- Migration 114: Separate Confirmation Flow
-- ================================================================
-- Author: Bright Idea
-- Date: 2026-01-28
--
-- PRODUCTION-READY: Fully idempotent, can be run multiple times safely
--
-- PURPOSE:
-- Allows stores to separate the order confirmation process into two steps:
--   1. Confirmador confirms the sale (customer accepted)
--   2. Admin/Owner assigns the carrier and zone
--
-- This is useful for stores where confirmadores only handle customer contact,
-- and logistics/admin handles carrier assignment decisions.
--
-- FLOW WHEN ENABLED:
--   pending -> contacted -> awaiting_carrier -> confirmed -> in_preparation -> ...
--                              (step 1)           (step 2)
--
-- FLOW WHEN DISABLED (normal):
--   pending -> contacted -> confirmed -> in_preparation -> ...
--                           (single step with carrier)
--
-- AVAILABILITY:
-- Only for plans with max_users > 1 (Starter, Growth, Professional)
-- ================================================================

BEGIN;

-- ================================================================
-- SAFETY CHECK: Verify dependencies exist
-- ================================================================

DO $$
BEGIN
    -- Check orders table exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'orders'
    ) THEN
        RAISE EXCEPTION 'DEPENDENCY ERROR: orders table not found.';
    END IF;

    -- Check stores table exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'stores'
    ) THEN
        RAISE EXCEPTION 'DEPENDENCY ERROR: stores table not found.';
    END IF;

    -- Check carriers table exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'carriers'
    ) THEN
        RAISE EXCEPTION 'DEPENDENCY ERROR: carriers table not found.';
    END IF;

    RAISE NOTICE 'OK: All dependencies verified';
END $$;


-- ================================================================
-- STEP 1: Add preference column to stores table
-- ================================================================

ALTER TABLE stores ADD COLUMN IF NOT EXISTS separate_confirmation_flow BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN stores.separate_confirmation_flow IS
'When TRUE, confirmadores only confirm the sale without assigning carrier.
Admin/Owner must then assign the carrier in a separate step.
Only available for plans with max_users > 1.';


-- ================================================================
-- STEP 2: Add carrier assignment tracking columns to orders
-- ================================================================

ALTER TABLE orders ADD COLUMN IF NOT EXISTS carrier_assigned_at TIMESTAMP;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS carrier_assigned_by VARCHAR(100);

COMMENT ON COLUMN orders.carrier_assigned_at IS 'When the carrier was assigned (in separate confirmation flow)';
COMMENT ON COLUMN orders.carrier_assigned_by IS 'Who assigned the carrier (user ID or email)';


-- ================================================================
-- STEP 3: Update CHECK constraint to include awaiting_carrier status
-- ================================================================

-- Drop existing constraint (safely)
DO $$
BEGIN
    ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
    ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_sleeves_status_check;
EXCEPTION WHEN OTHERS THEN
    NULL; -- Ignore if constraint doesn't exist
END $$;

-- Add new constraint with 'awaiting_carrier' status
ALTER TABLE orders ADD CONSTRAINT orders_sleeves_status_check
    CHECK (sleeves_status IS NULL OR sleeves_status IN (
        'pending',
        'contacted',
        'awaiting_carrier',  -- NEW: Confirmed but waiting for carrier assignment
        'confirmed',
        'in_preparation',
        'ready_to_ship',
        'shipped',
        'in_transit',
        'delivered',
        'returned',
        'cancelled',
        'rejected',
        'incident'
    ));


-- ================================================================
-- STEP 4: Create index for awaiting_carrier orders
-- ================================================================

CREATE INDEX IF NOT EXISTS idx_orders_awaiting_carrier
    ON orders(store_id, created_at DESC)
    WHERE sleeves_status = 'awaiting_carrier';

CREATE INDEX IF NOT EXISTS idx_orders_carrier_assigned
    ON orders(store_id, carrier_assigned_at)
    WHERE carrier_assigned_at IS NOT NULL;


-- ================================================================
-- STEP 5: Create view for orders awaiting carrier assignment
-- ================================================================

CREATE OR REPLACE VIEW v_orders_awaiting_carrier AS
SELECT
    o.id,
    o.store_id,
    o.order_number,
    o.shopify_order_name,
    o.customer_first_name || ' ' || COALESCE(o.customer_last_name, '') AS customer_name,
    o.customer_phone,
    o.customer_address,
    o.shipping_city,
    o.shipping_city_normalized,
    o.delivery_zone,
    o.total_price,
    o.cod_amount,
    o.financial_status,
    o.confirmed_at,
    o.confirmed_by,
    EXTRACT(EPOCH FROM (NOW() - o.confirmed_at))/3600 AS hours_since_confirmation,
    CASE
        WHEN o.confirmed_at < NOW() - INTERVAL '8 hours' THEN 'CRITICAL'
        WHEN o.confirmed_at < NOW() - INTERVAL '4 hours' THEN 'WARNING'
        ELSE 'OK'
    END AS urgency_level,
    o.created_at
FROM orders o
WHERE o.sleeves_status = 'awaiting_carrier'
  AND o.deleted_at IS NULL
ORDER BY o.confirmed_at ASC;

COMMENT ON VIEW v_orders_awaiting_carrier IS
'Orders confirmed by confirmadores awaiting carrier assignment.
Urgency levels: OK (0-4h), WARNING (4-8h), CRITICAL (>8h)';


-- ================================================================
-- STEP 6: Function to confirm order WITHOUT carrier (Step 1)
-- ================================================================

-- Drop existing function if exists
DROP FUNCTION IF EXISTS confirm_order_without_carrier(UUID, UUID, TEXT, TEXT, TEXT, DECIMAL, BOOLEAN, TEXT);

CREATE OR REPLACE FUNCTION confirm_order_without_carrier(
    p_order_id UUID,
    p_store_id UUID,
    p_confirmed_by TEXT,
    p_address TEXT DEFAULT NULL,
    p_google_maps_link TEXT DEFAULT NULL,
    p_discount_amount DECIMAL DEFAULT NULL,
    p_mark_as_prepaid BOOLEAN DEFAULT FALSE,
    p_prepaid_method TEXT DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
    v_order RECORD;
    v_store RECORD;
    v_new_total_price DECIMAL;
    v_new_cod_amount DECIMAL;
    v_effective_discount DECIMAL := 0;
    v_was_marked_prepaid BOOLEAN := FALSE;
    v_is_cod_order BOOLEAN := FALSE;
    v_original_is_paid_online BOOLEAN := FALSE;
    v_result JSON;
BEGIN
    -- ================================================================
    -- STEP 1: Validate store has separate_confirmation_flow enabled
    -- ================================================================
    SELECT * INTO v_store FROM stores WHERE id = p_store_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'STORE_NOT_FOUND: Store % not found', p_store_id
            USING ERRCODE = 'P0010';
    END IF;

    IF NOT COALESCE(v_store.separate_confirmation_flow, FALSE) THEN
        RAISE EXCEPTION 'FEATURE_DISABLED: separate_confirmation_flow is not enabled for this store'
            USING ERRCODE = 'P0011';
    END IF;

    -- ================================================================
    -- STEP 2: Lock and validate order
    -- ================================================================
    SELECT * INTO v_order
    FROM orders
    WHERE id = p_order_id AND store_id = p_store_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ORDER_NOT_FOUND: Order % not found in store %', p_order_id, p_store_id
            USING ERRCODE = 'P0001';
    END IF;

    -- Only pending or contacted orders can be confirmed
    IF v_order.sleeves_status NOT IN ('pending', 'contacted') THEN
        RAISE EXCEPTION 'INVALID_STATUS: Order is already % (expected pending or contacted)', v_order.sleeves_status
            USING ERRCODE = 'P0002';
    END IF;

    -- ================================================================
    -- STEP 3: Determine payment type
    -- ================================================================
    v_original_is_paid_online := LOWER(COALESCE(v_order.financial_status, '')) IN ('paid', 'authorized');
    v_is_cod_order := LOWER(COALESCE(v_order.payment_gateway, '')) IN ('cash_on_delivery', 'cod', 'manual')
                      OR (v_order.cod_amount IS NOT NULL AND v_order.cod_amount > 0);

    v_new_total_price := COALESCE(v_order.total_price, 0);
    v_new_cod_amount := COALESCE(v_order.cod_amount, 0);

    -- ================================================================
    -- STEP 4: Handle mark as prepaid
    -- ================================================================
    IF p_mark_as_prepaid = TRUE AND NOT v_original_is_paid_online AND v_is_cod_order THEN
        v_new_cod_amount := 0;
        v_was_marked_prepaid := TRUE;
    END IF;

    -- ================================================================
    -- STEP 5: Handle discount
    -- ================================================================
    IF p_discount_amount IS NOT NULL AND p_discount_amount > 0 THEN
        v_effective_discount := LEAST(p_discount_amount, v_new_total_price);
        v_new_total_price := GREATEST(0, v_new_total_price - v_effective_discount);

        IF NOT v_was_marked_prepaid AND NOT v_original_is_paid_online AND v_is_cod_order THEN
            v_new_cod_amount := GREATEST(0, v_new_total_price);
        END IF;
    END IF;

    -- ================================================================
    -- STEP 6: Update order to awaiting_carrier (NOT confirmed)
    -- ================================================================
    UPDATE orders SET
        sleeves_status = 'awaiting_carrier',
        confirmed_at = NOW(),
        confirmed_by = p_confirmed_by,
        confirmation_method = 'dashboard',
        customer_address = COALESCE(p_address, customer_address),
        google_maps_link = COALESCE(p_google_maps_link, google_maps_link),
        total_price = v_new_total_price,
        financial_status = CASE WHEN v_was_marked_prepaid THEN 'paid' ELSE financial_status END,
        cod_amount = v_new_cod_amount,
        prepaid_method = CASE WHEN v_was_marked_prepaid THEN COALESCE(p_prepaid_method, 'transfer') ELSE prepaid_method END,
        prepaid_at = CASE WHEN v_was_marked_prepaid THEN NOW() ELSE prepaid_at END,
        prepaid_by = CASE WHEN v_was_marked_prepaid THEN p_confirmed_by ELSE prepaid_by END,
        total_discounts = CASE
            WHEN v_effective_discount > 0 THEN COALESCE(total_discounts, 0) + v_effective_discount
            ELSE total_discounts
        END,
        updated_at = NOW()
    WHERE id = p_order_id;

    -- ================================================================
    -- STEP 7: Return result
    -- ================================================================
    SELECT json_build_object(
        'success', TRUE,
        'order_id', p_order_id,
        'new_status', 'awaiting_carrier',
        'confirmed_by', p_confirmed_by,
        'confirmed_at', NOW(),
        'was_marked_prepaid', v_was_marked_prepaid,
        'new_total_price', v_new_total_price,
        'new_cod_amount', v_new_cod_amount,
        'discount_applied', v_effective_discount > 0,
        'discount_amount', v_effective_discount
    ) INTO v_result;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION confirm_order_without_carrier IS
'Confirms an order WITHOUT assigning a carrier (Step 1 of separate confirmation flow).
Sets status to "awaiting_carrier" instead of "confirmed".
Requires store to have separate_confirmation_flow = TRUE.

ERROR CODES:
- P0001: ORDER_NOT_FOUND
- P0002: INVALID_STATUS (order not pending/contacted)
- P0010: STORE_NOT_FOUND
- P0011: FEATURE_DISABLED (separate_confirmation_flow not enabled)';


-- ================================================================
-- STEP 7: Function to assign carrier (Step 2)
-- ================================================================

-- Drop existing function if exists
DROP FUNCTION IF EXISTS assign_carrier_to_order(UUID, UUID, TEXT, UUID, TEXT, TEXT, DECIMAL);

CREATE OR REPLACE FUNCTION assign_carrier_to_order(
    p_order_id UUID,
    p_store_id UUID,
    p_assigned_by TEXT,
    p_courier_id UUID,
    p_delivery_zone TEXT DEFAULT NULL,
    p_shipping_city TEXT DEFAULT NULL,
    p_shipping_cost DECIMAL DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
    v_order RECORD;
    v_carrier RECORD;
    v_result JSON;
BEGIN
    -- ================================================================
    -- STEP 1: Lock and validate order
    -- ================================================================
    SELECT * INTO v_order
    FROM orders
    WHERE id = p_order_id AND store_id = p_store_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ORDER_NOT_FOUND: Order % not found in store %', p_order_id, p_store_id
            USING ERRCODE = 'P0001';
    END IF;

    -- Only awaiting_carrier orders can have carrier assigned
    IF v_order.sleeves_status != 'awaiting_carrier' THEN
        RAISE EXCEPTION 'INVALID_STATUS: Order is % (expected awaiting_carrier)', v_order.sleeves_status
            USING ERRCODE = 'P0002';
    END IF;

    -- ================================================================
    -- STEP 2: Validate carrier
    -- ================================================================
    SELECT id, name INTO v_carrier
    FROM carriers
    WHERE id = p_courier_id
      AND store_id = p_store_id
      AND is_active = TRUE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'CARRIER_NOT_FOUND: Carrier % not found or inactive in store %', p_courier_id, p_store_id
            USING ERRCODE = 'P0003';
    END IF;

    -- ================================================================
    -- STEP 3: Update order with carrier info
    -- ================================================================
    UPDATE orders SET
        sleeves_status = 'confirmed',
        courier_id = p_courier_id,
        delivery_zone = COALESCE(p_delivery_zone, delivery_zone),
        shipping_city = COALESCE(p_shipping_city, shipping_city),
        shipping_city_normalized = LOWER(COALESCE(p_shipping_city, shipping_city)),
        shipping_cost = COALESCE(p_shipping_cost, 0),
        carrier_assigned_at = NOW(),
        carrier_assigned_by = p_assigned_by,
        updated_at = NOW()
    WHERE id = p_order_id;

    -- ================================================================
    -- STEP 4: Return result
    -- ================================================================
    SELECT json_build_object(
        'success', TRUE,
        'order_id', p_order_id,
        'new_status', 'confirmed',
        'carrier_id', p_courier_id,
        'carrier_name', v_carrier.name,
        'carrier_assigned_by', p_assigned_by,
        'carrier_assigned_at', NOW(),
        'shipping_cost', COALESCE(p_shipping_cost, 0),
        'delivery_zone', COALESCE(p_delivery_zone, v_order.delivery_zone),
        'shipping_city', COALESCE(p_shipping_city, v_order.shipping_city)
    ) INTO v_result;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION assign_carrier_to_order IS
'Assigns a carrier to an order that is awaiting_carrier (Step 2 of separate confirmation flow).
Moves status from "awaiting_carrier" to "confirmed".

ERROR CODES:
- P0001: ORDER_NOT_FOUND
- P0002: INVALID_STATUS (order not awaiting_carrier)
- P0003: CARRIER_NOT_FOUND';


-- ================================================================
-- STEP 8: Update order status history trigger for awaiting_carrier
-- ================================================================

CREATE OR REPLACE FUNCTION fn_log_order_status_change()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.sleeves_status IS DISTINCT FROM NEW.sleeves_status THEN
        INSERT INTO order_status_history (
            order_id, store_id, previous_status, new_status,
            changed_by, changed_by_n8n, change_source, notes
        ) VALUES (
            NEW.id, NEW.store_id, OLD.sleeves_status, NEW.sleeves_status,
            COALESCE(NEW.carrier_assigned_by, NEW.confirmed_by, NEW.contacted_by, 'system'),
            COALESCE(NEW.n8n_sent, FALSE),
            CASE
                WHEN NEW.n8n_sent = TRUE THEN 'n8n'
                WHEN NEW.sleeves_status = 'awaiting_carrier' THEN 'separate_confirmation'
                WHEN NEW.sleeves_status = 'confirmed' AND OLD.sleeves_status = 'awaiting_carrier' THEN 'carrier_assignment'
                WHEN NEW.contacted_method = 'whatsapp' AND NEW.sleeves_status = 'contacted' THEN 'whatsapp_contact'
                WHEN NEW.confirmation_method = 'whatsapp' THEN 'whatsapp_webhook'
                WHEN NEW.shopify_order_id IS NOT NULL THEN 'shopify_sync'
                ELSE 'dashboard'
            END,
            CASE
                WHEN NEW.sleeves_status = 'awaiting_carrier' THEN 'Confirmado sin transportadora (flujo separado)'
                WHEN NEW.sleeves_status = 'confirmed' AND OLD.sleeves_status = 'awaiting_carrier' THEN 'Transportadora asignada'
                ELSE NULL
            END
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ================================================================
-- STEP 9: Helper function to get awaiting carrier count
-- ================================================================

CREATE OR REPLACE FUNCTION get_awaiting_carrier_count(p_store_id UUID)
RETURNS TABLE (
    total_count BIGINT,
    critical_count BIGINT,
    warning_count BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        COUNT(*)::BIGINT AS total_count,
        COUNT(*) FILTER (WHERE confirmed_at < NOW() - INTERVAL '8 hours')::BIGINT AS critical_count,
        COUNT(*) FILTER (WHERE confirmed_at >= NOW() - INTERVAL '8 hours' AND confirmed_at < NOW() - INTERVAL '4 hours')::BIGINT AS warning_count
    FROM orders
    WHERE store_id = p_store_id
      AND sleeves_status = 'awaiting_carrier'
      AND deleted_at IS NULL;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_awaiting_carrier_count IS
'Returns count of orders awaiting carrier assignment with urgency breakdown.
Used for sidebar badges and notifications.';


-- ================================================================
-- STEP 10: Grant permissions
-- ================================================================

GRANT EXECUTE ON FUNCTION confirm_order_without_carrier(UUID, UUID, TEXT, TEXT, TEXT, DECIMAL, BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION confirm_order_without_carrier(UUID, UUID, TEXT, TEXT, TEXT, DECIMAL, BOOLEAN, TEXT) TO service_role;

GRANT EXECUTE ON FUNCTION assign_carrier_to_order(UUID, UUID, TEXT, UUID, TEXT, TEXT, DECIMAL) TO authenticated;
GRANT EXECUTE ON FUNCTION assign_carrier_to_order(UUID, UUID, TEXT, UUID, TEXT, TEXT, DECIMAL) TO service_role;

GRANT EXECUTE ON FUNCTION get_awaiting_carrier_count(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_awaiting_carrier_count(UUID) TO service_role;

GRANT SELECT ON v_orders_awaiting_carrier TO authenticated;
GRANT SELECT ON v_orders_awaiting_carrier TO service_role;


-- ================================================================
-- STEP 11: Notify PostgREST to reload schema
-- ================================================================

NOTIFY pgrst, 'reload schema';


-- ================================================================
-- VERIFICATION
-- ================================================================

DO $$
DECLARE
    v_column_exists BOOLEAN;
    v_function_exists BOOLEAN;
    v_view_exists BOOLEAN;
BEGIN
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Migration 114 - Separate Confirmation Flow';
    RAISE NOTICE '========================================';

    -- Verify stores column
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'stores'
        AND column_name = 'separate_confirmation_flow'
    ) INTO v_column_exists;

    IF NOT v_column_exists THEN
        RAISE EXCEPTION 'FAILED: stores.separate_confirmation_flow column not created';
    END IF;
    RAISE NOTICE 'OK: stores.separate_confirmation_flow column created';

    -- Verify orders columns
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders'
        AND column_name = 'carrier_assigned_at'
    ) INTO v_column_exists;

    IF NOT v_column_exists THEN
        RAISE EXCEPTION 'FAILED: orders.carrier_assigned_at column not created';
    END IF;
    RAISE NOTICE 'OK: orders.carrier_assigned_at column created';

    -- Verify confirm_order_without_carrier function
    SELECT EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE p.proname = 'confirm_order_without_carrier'
        AND n.nspname = 'public'
    ) INTO v_function_exists;

    IF NOT v_function_exists THEN
        RAISE EXCEPTION 'FAILED: confirm_order_without_carrier function not created';
    END IF;
    RAISE NOTICE 'OK: confirm_order_without_carrier function created';

    -- Verify assign_carrier_to_order function
    SELECT EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE p.proname = 'assign_carrier_to_order'
        AND n.nspname = 'public'
    ) INTO v_function_exists;

    IF NOT v_function_exists THEN
        RAISE EXCEPTION 'FAILED: assign_carrier_to_order function not created';
    END IF;
    RAISE NOTICE 'OK: assign_carrier_to_order function created';

    -- Verify view
    SELECT EXISTS (
        SELECT 1 FROM information_schema.views
        WHERE table_name = 'v_orders_awaiting_carrier'
    ) INTO v_view_exists;

    IF NOT v_view_exists THEN
        RAISE EXCEPTION 'FAILED: v_orders_awaiting_carrier view not created';
    END IF;
    RAISE NOTICE 'OK: v_orders_awaiting_carrier view created';

    RAISE NOTICE '========================================';
    RAISE NOTICE 'Migration 114 Complete!';
    RAISE NOTICE '========================================';
    RAISE NOTICE '';
    RAISE NOTICE 'NEW FEATURE: Separate Confirmation Flow';
    RAISE NOTICE '';
    RAISE NOTICE 'When stores.separate_confirmation_flow = TRUE:';
    RAISE NOTICE '  1. Confirmador confirms -> awaiting_carrier';
    RAISE NOTICE '  2. Admin assigns carrier -> confirmed';
    RAISE NOTICE '';
    RAISE NOTICE 'NEW STATUS: awaiting_carrier';
    RAISE NOTICE 'NEW FUNCTIONS:';
    RAISE NOTICE '  - confirm_order_without_carrier()';
    RAISE NOTICE '  - assign_carrier_to_order()';
    RAISE NOTICE '  - get_awaiting_carrier_count()';
    RAISE NOTICE '';
    RAISE NOTICE 'NEW VIEW: v_orders_awaiting_carrier';
    RAISE NOTICE '';
    RAISE NOTICE 'This migration is IDEMPOTENT - safe to run multiple times';
    RAISE NOTICE '========================================';
END $$;

COMMIT;

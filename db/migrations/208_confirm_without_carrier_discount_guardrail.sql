-- ================================================================
-- CONFIRM ORDER WITHOUT CARRIER: DISCOUNT GUARDRAIL VIA SHARED FUNCTION
-- ================================================================
-- Migration: 208_confirm_without_carrier_discount_guardrail.sql
-- Date: 2026-06-23
--
-- WHY THIS EXISTS:
-- confirm_order_without_carrier (separate confirmation flow, migration 114)
-- carried a FOURTH copy of the same discount math that caused the
-- total_price-zeroing bug: STEP 5 did LEAST(discount, total_price) with no
-- guardrail. The dashboard confirm route reaches this function whenever a
-- confirmador confirms without a carrier on a store with
-- separate_confirmation_flow enabled, so it is a live path with the exact same
-- hole. Converging it onto the shared compute_discounted_total (migration 206)
-- closes it; leaving one unguarded copy would defeat the fix.
--
-- Discount base is now subtotal_price + COALESCE(total_shipping,0), consistent
-- with the other discount sites. New parameter p_allow_full_discount (8th,
-- defaults FALSE) threads the override through. Everything else is unchanged
-- from migration 114.
-- ================================================================

BEGIN;

-- Drop the 8-arg signature (migration 114). Appending p_allow_full_discount
-- changes the argument list, so drop the old overload to keep exactly one
-- confirm_order_without_carrier.
DROP FUNCTION IF EXISTS confirm_order_without_carrier(UUID, UUID, TEXT, TEXT, TEXT, DECIMAL, BOOLEAN, TEXT);

CREATE OR REPLACE FUNCTION confirm_order_without_carrier(
    p_order_id UUID,
    p_store_id UUID,
    p_confirmed_by TEXT,
    p_address TEXT DEFAULT NULL,
    p_google_maps_link TEXT DEFAULT NULL,
    p_discount_amount DECIMAL DEFAULT NULL,
    p_mark_as_prepaid BOOLEAN DEFAULT FALSE,
    p_prepaid_method TEXT DEFAULT NULL,
    p_allow_full_discount BOOLEAN DEFAULT FALSE
) RETURNS JSON AS $$
DECLARE
    v_order RECORD;
    v_store RECORD;
    v_new_total_price DECIMAL;
    v_new_cod_amount DECIMAL;
    v_effective_discount DECIMAL := 0;
    v_discount_base DECIMAL := 0;
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
    -- STEP 5: Handle discount (shared math + guardrail)
    -- ================================================================
    -- Discount base = product subtotal + shipping, consistent with the other
    -- discount sites. The >95%-of-gross guardrail and the clamp live in
    -- compute_discounted_total (migration 206). p_allow_full_discount overrides
    -- the guardrail for the rare legitimate full comp.
    IF p_discount_amount IS NOT NULL AND p_discount_amount > 0 THEN
        v_discount_base := COALESCE(v_order.subtotal_price, 0)
                         + COALESCE(v_order.total_shipping, 0);

        IF v_discount_base <= 0 THEN
            v_discount_base := v_new_total_price;
        END IF;

        SELECT effective_discount,
               GREATEST(0, v_new_total_price - effective_discount)
        INTO v_effective_discount, v_new_total_price
        FROM compute_discounted_total(v_discount_base, p_discount_amount, p_allow_full_discount);

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

COMMENT ON FUNCTION confirm_order_without_carrier(UUID, UUID, TEXT, TEXT, TEXT, DECIMAL, BOOLEAN, TEXT, BOOLEAN) IS
'Confirms an order WITHOUT assigning a carrier (Step 1 of separate confirmation
flow). Sets status to "awaiting_carrier". Discount math + the >95%-of-gross
guardrail live in compute_discounted_total (migration 206); the discount base
is subtotal_price + total_shipping. Pass p_allow_full_discount to override the
guardrail. Requires store separate_confirmation_flow = TRUE. Error codes: P0001
ORDER_NOT_FOUND, P0002 INVALID_STATUS, P0010 STORE_NOT_FOUND, P0011
FEATURE_DISABLED, P0012 FULL_DISCOUNT_BLOCKED.';

GRANT EXECUTE ON FUNCTION confirm_order_without_carrier(UUID, UUID, TEXT, TEXT, TEXT, DECIMAL, BOOLEAN, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION confirm_order_without_carrier(UUID, UUID, TEXT, TEXT, TEXT, DECIMAL, BOOLEAN, TEXT, BOOLEAN) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

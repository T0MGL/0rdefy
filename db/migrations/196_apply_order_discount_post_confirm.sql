-- ================================================================
-- APPLY ORDER DISCOUNT (DECOUPLED FROM CONFIRMATION)
-- ================================================================
-- Migration: 196_apply_order_discount_post_confirm.sql
-- Date: 2026-05-29
--
-- PROBLEM:
-- Discounts could only be applied through confirm_order_atomic, which
-- rejects any order whose sleeves_status is not 'pending' or 'contacted'
-- (migration 104, error P0002 INVALID_STATUS). A confirmed order could
-- therefore never receive a discount through the dashboard.
--
-- FIX:
-- Standalone atomic function that SETS the order discount to an absolute
-- value on any pre-dispatch order. It recomputes total_price and cod_amount
-- from a clean base (current line_items minus the new discount), so calling
-- it repeatedly is idempotent and never compounds.
--
-- ALLOWED SOURCE STATUSES (everything strictly before in_transit):
--   pending, contacted, confirmed, in_preparation, ready_to_ship,
--   awaiting_carrier, shipped
-- BLOCKED (carrier already moving the package / terminal). The cut is
-- in_transit: once the order is on the road the amount the carrier collects
-- is locked, so no discount can change it:
--   in_transit, delivered, returned, cancelled, rejected
--
-- IDEMPOTENCY MODEL:
--   p_discount_amount is the ABSOLUTE total discount for the order, not a
--   delta. The gross subtotal is derived from SUM(order_line_items.total_price),
--   the real product source of truth, NOT from total_price + total_discounts.
--   Deriving from line_items makes the discount immune to whatever total_price
--   and total_discounts were previously stamped: it cannot double-count a prior
--   discount, and it cannot lose a discount when products change. The function
--   applies the discount once against the real product subtotal and stamps
--   total_discounts = effective discount. Repeated calls converge to the same
--   result regardless of intervening line-item edits or upsell mutations.
-- ================================================================

BEGIN;

CREATE OR REPLACE FUNCTION apply_order_discount(
  p_order_id UUID,
  p_store_id UUID,
  p_discount_amount DECIMAL,
  p_applied_by TEXT DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
  v_order RECORD;
  v_gross_subtotal DECIMAL;
  v_effective_discount DECIMAL;
  v_new_total_price DECIMAL;
  v_new_cod_amount DECIMAL;
  v_is_paid_online BOOLEAN;
  v_is_prepaid BOOLEAN;
  v_is_cod_order BOOLEAN;
  v_result JSON;
BEGIN
  IF p_discount_amount IS NULL OR p_discount_amount < 0 THEN
    RAISE EXCEPTION 'INVALID_DISCOUNT: discount must be a non-negative number'
      USING ERRCODE = 'P0010';
  END IF;

  SELECT * INTO v_order
  FROM orders
  WHERE id = p_order_id AND store_id = p_store_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND: Order % not found in store %', p_order_id, p_store_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_order.sleeves_status NOT IN (
    'pending', 'contacted', 'confirmed', 'in_preparation', 'ready_to_ship', 'awaiting_carrier', 'shipped'
  ) THEN
    RAISE EXCEPTION 'INVALID_STATUS: Order is % and can no longer be discounted (already in transit or in a terminal state)', v_order.sleeves_status
      USING ERRCODE = 'P0002';
  END IF;

  -- Gross subtotal = SUM of the current line items (the real product total,
  -- upsell lines included). This is the source of truth for what the customer
  -- is buying, independent of any total_price / total_discounts already stamped.
  -- Deriving from here is what makes the discount idempotent and immune to
  -- prior edits: it can neither compound a previous discount nor lose one when
  -- products change between calls.
  SELECT COALESCE(SUM(li.total_price), 0)
  INTO v_gross_subtotal
  FROM order_line_items li
  WHERE li.order_id = p_order_id;

  -- Fallback for legacy orders with no line_items rows: reconstruct the
  -- pre-discount amount from the stamped fields so the order is still usable.
  IF v_gross_subtotal <= 0 THEN
    v_gross_subtotal := COALESCE(v_order.total_price, 0) + COALESCE(v_order.total_discounts, 0);
  END IF;

  v_effective_discount := LEAST(p_discount_amount, v_gross_subtotal);
  v_new_total_price := GREATEST(0, v_gross_subtotal - v_effective_discount);

  v_is_paid_online := LOWER(COALESCE(v_order.financial_status, '')) IN ('paid', 'authorized');
  v_is_prepaid := v_order.prepaid_method IS NOT NULL;
  v_is_cod_order := LOWER(COALESCE(v_order.payment_gateway, '')) IN ('cash_on_delivery', 'cod', 'manual')
                    OR (v_order.cod_amount IS NOT NULL AND v_order.cod_amount > 0);

  -- Recompute the amount the carrier collects at the door.
  -- Paid online or manually prepaid: nothing to collect.
  -- COD: collect the new total.
  IF v_is_paid_online OR v_is_prepaid THEN
    v_new_cod_amount := 0;
  ELSIF v_is_cod_order THEN
    v_new_cod_amount := v_new_total_price;
  ELSE
    v_new_cod_amount := COALESCE(v_order.cod_amount, 0);
  END IF;

  UPDATE orders SET
    total_price = v_new_total_price,
    total_discounts = v_effective_discount,
    cod_amount = v_new_cod_amount,
    updated_at = NOW()
  WHERE id = p_order_id;

  SELECT json_build_object(
    'success', TRUE,
    'order', row_to_json(o),
    'discount_amount', v_effective_discount,
    'gross_subtotal', v_gross_subtotal,
    'new_total_price', v_new_total_price,
    'new_cod_amount', v_new_cod_amount,
    'applied_by', p_applied_by
  ) INTO v_result
  FROM orders o WHERE o.id = p_order_id;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION apply_order_discount(UUID, UUID, DECIMAL, TEXT) IS
'Atomically SETS the absolute discount on an order that has not yet entered
transit, decoupled from confirm_order_atomic. Allowed up to and including
shipped. Derives the gross subtotal from SUM(order_line_items.total_price)
(the real product total) and re-derives total_price and cod_amount from it, so
repeated calls are idempotent regardless of prior edits. Blocks
in_transit/delivered/returned/cancelled/rejected. Error codes: P0001
ORDER_NOT_FOUND, P0002 INVALID_STATUS, P0010 INVALID_DISCOUNT.';

GRANT EXECUTE ON FUNCTION apply_order_discount(UUID, UUID, DECIMAL, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION apply_order_discount(UUID, UUID, DECIMAL, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ================================================================
-- DISCOUNT GUARDRAIL: ONE SHARED FUNCTION + apply_order_discount REWIRE
-- ================================================================
-- Migration: 206_discount_guardrail_shared_function.sql
-- Date: 2026-06-23
--
-- WHY THIS EXISTS:
-- A discount bug zeroed total_price on real orders. An operator typed the
-- order subtotal into the "discount" field while confirming orders that were
-- already paid, instead of using the mark_as_prepaid toggle. With a discount
-- close to 100% of gross, total_price collapsed to ~0 and total_discounts
-- inflated, so revenue was under-reported.
--
-- The same discount math was copy-pasted in three places (confirm_order_atomic
-- STEP 7, apply_order_discount, and the external webhook service). This
-- migration creates ONE shared Postgres function that both SQL call sites use,
-- with a guardrail that rejects a discount larger than 95% of gross unless an
-- explicit allow_full_discount flag is passed. The TS site reuses a single
-- TS helper that mirrors the same rule.
--
-- The discount base (gross) is now subtotal_price + COALESCE(total_shipping,0),
-- consistent across all three sites. Previously apply_order_discount excluded
-- shipping and derived gross from SUM(line_items); this aligns it.
-- ================================================================

BEGIN;

-- ----------------------------------------------------------------
-- Shared guardrail + math. Single source of truth for the discount
-- calculation used by both confirm_order_atomic and apply_order_discount.
--
-- p_gross               the discount base (subtotal_price + total_shipping)
-- p_discount            requested absolute discount
-- p_allow_full_discount escape hatch for the rare legitimate ~100% discount
--                       (e.g. full comp / write-off). Without it, a discount
--                       above 95% of gross is rejected as an operator error.
--
-- Returns the clamped effective discount and the resulting total. Raises
-- P0012 (FULL_DISCOUNT_BLOCKED) when the guardrail trips without the flag, so
-- the typo that caused the original bug can no longer silently zero an order.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION compute_discounted_total(
  p_gross DECIMAL,
  p_discount DECIMAL,
  p_allow_full_discount BOOLEAN DEFAULT FALSE,
  OUT effective_discount DECIMAL,
  OUT new_total DECIMAL
) AS $$
DECLARE
  v_gross DECIMAL := GREATEST(0, COALESCE(p_gross, 0));
  v_discount DECIMAL := GREATEST(0, COALESCE(p_discount, 0));
BEGIN
  IF NOT COALESCE(p_allow_full_discount, FALSE)
     AND v_gross > 0
     AND v_discount > v_gross * 0.95 THEN
    RAISE EXCEPTION 'FULL_DISCOUNT_BLOCKED: discount % exceeds 95%% of gross % (pass allow_full_discount to override)', v_discount, v_gross
      USING ERRCODE = 'P0012';
  END IF;

  effective_discount := LEAST(v_discount, v_gross);
  new_total := GREATEST(0, v_gross - effective_discount);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION compute_discounted_total(DECIMAL, DECIMAL, BOOLEAN) IS
'Shared discount math + guardrail. Rejects a discount above 95% of gross unless
allow_full_discount is true (P0012 FULL_DISCOUNT_BLOCKED). Returns the clamped
effective discount and the resulting total. Single source of truth used by both
confirm_order_atomic and apply_order_discount; the TS webhook path mirrors it.';

GRANT EXECUTE ON FUNCTION compute_discounted_total(DECIMAL, DECIMAL, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION compute_discounted_total(DECIMAL, DECIMAL, BOOLEAN) TO service_role;


-- ----------------------------------------------------------------
-- apply_order_discount: rewired onto the shared function.
--
-- Changes vs migration 196:
--  - Discount base is now subtotal_price + COALESCE(total_shipping,0) (was
--    SUM(order_line_items.total_price), which excluded shipping).
--  - Adds p_allow_full_discount, threaded to the shared guardrail.
--  - Math and guardrail live in compute_discounted_total, not inline.
--
-- The fallback for legacy orders with no usable subtotal still reconstructs
-- the pre-discount amount from the stamped fields so the order stays usable.
-- ----------------------------------------------------------------

-- Drop the prior 4-arg signature (migration 196). Adding p_allow_full_discount
-- changes the argument list, so CREATE OR REPLACE alone would leave a divergent
-- old overload behind. Drop it so exactly one apply_order_discount exists.
DROP FUNCTION IF EXISTS apply_order_discount(UUID, UUID, DECIMAL, TEXT);

CREATE OR REPLACE FUNCTION apply_order_discount(
  p_order_id UUID,
  p_store_id UUID,
  p_discount_amount DECIMAL,
  p_applied_by TEXT DEFAULT NULL,
  p_allow_full_discount BOOLEAN DEFAULT FALSE
) RETURNS JSON AS $$
DECLARE
  v_order RECORD;
  v_gross DECIMAL;
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

  -- Discount base: product subtotal plus shipping. Shipping is part of what the
  -- customer owes, so a percentage/absolute discount applies against it too.
  v_gross := COALESCE(v_order.subtotal_price, 0) + COALESCE(v_order.total_shipping, 0);

  -- Fallback for legacy orders with no subtotal stamped: reconstruct the
  -- pre-discount amount from the stamped fields so the order is still usable.
  IF v_gross <= 0 THEN
    v_gross := COALESCE(v_order.total_price, 0) + COALESCE(v_order.total_discounts, 0);
  END IF;

  SELECT effective_discount, new_total
  INTO v_effective_discount, v_new_total_price
  FROM compute_discounted_total(v_gross, p_discount_amount, p_allow_full_discount);

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
    'gross_subtotal', v_gross,
    'new_total_price', v_new_total_price,
    'new_cod_amount', v_new_cod_amount,
    'applied_by', p_applied_by
  ) INTO v_result
  FROM orders o WHERE o.id = p_order_id;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION apply_order_discount(UUID, UUID, DECIMAL, TEXT, BOOLEAN) IS
'Atomically SETS the absolute discount on an order that has not yet entered
transit, decoupled from confirm_order_atomic. Allowed up to and including
shipped. Discount base is subtotal_price + COALESCE(total_shipping,0).
Math and the >95%-of-gross guardrail live in compute_discounted_total; pass
p_allow_full_discount to override the guardrail. Error codes: P0001
ORDER_NOT_FOUND, P0002 INVALID_STATUS, P0010 INVALID_DISCOUNT, P0012
FULL_DISCOUNT_BLOCKED.';

GRANT EXECUTE ON FUNCTION apply_order_discount(UUID, UUID, DECIMAL, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION apply_order_discount(UUID, UUID, DECIMAL, TEXT, BOOLEAN) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

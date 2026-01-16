-- Migration 075: Increase Discount Code Redemption Timeout
-- Increases statement timeout from 5s to 30s for Supabase production environments
--
-- PROBLEM:
-- - Original 5s timeout in migration 073 is too short for Supabase under load
-- - Queries can take longer during peak traffic, causing unnecessary failures
--
-- SOLUTION:
-- - Increase timeout to 30s to provide adequate margin for high-load scenarios
--
-- PRODUCTION SAFETY:
-- - Idempotent: Can be run multiple times safely
-- - Uses NOWAIT to prevent long waits on locked rows
-- - 30s timeout provides margin while still protecting against deadlocks

-- =============================================
-- ATOMIC DISCOUNT CODE REDEMPTION RPC (UPDATED)
-- Increased timeout from 5s to 30s
-- =============================================

CREATE OR REPLACE FUNCTION redeem_discount_code_atomic(
  p_code VARCHAR(50),
  p_user_id UUID,
  p_store_id UUID DEFAULT NULL,
  p_stripe_subscription_id TEXT DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
  v_discount RECORD;
BEGIN
  -- Set a statement timeout to prevent long waits (30 seconds max)
  -- Increased from 5s to 30s to handle Supabase production load
  -- This protects against deadlocks and long-running transactions
  SET LOCAL statement_timeout = '30s';

  -- Lock the discount code row for update with NOWAIT
  -- NOWAIT immediately fails if row is locked, preventing queue buildup
  BEGIN
    SELECT * INTO v_discount
    FROM discount_codes
    WHERE code = UPPER(p_code)
    FOR UPDATE NOWAIT;
  EXCEPTION
    WHEN lock_not_available THEN
      RETURN json_build_object(
        'success', false,
        'error', 'Discount code is being processed, please try again',
        'retry', true
      );
  END;

  -- Check if discount code exists
  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Discount code not found'
    );
  END IF;

  -- Check if discount is active
  IF NOT v_discount.is_active THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Discount code is not active'
    );
  END IF;

  -- Check valid_from date
  IF v_discount.valid_from IS NOT NULL AND v_discount.valid_from > NOW() THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Discount code is not yet valid'
    );
  END IF;

  -- Check expiration
  IF v_discount.valid_until IS NOT NULL AND v_discount.valid_until < NOW() THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Discount code has expired'
    );
  END IF;

  -- Check max uses (with lock held, this is now atomic)
  IF v_discount.max_uses IS NOT NULL AND v_discount.current_uses >= v_discount.max_uses THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Discount code has reached maximum uses'
    );
  END IF;

  -- Check if user already redeemed this discount
  IF EXISTS (
    SELECT 1 FROM discount_redemptions
    WHERE discount_code_id = v_discount.id
    AND user_id = p_user_id
  ) THEN
    RETURN json_build_object(
      'success', false,
      'error', 'You have already used this discount code'
    );
  END IF;

  -- Increment usage atomically
  UPDATE discount_codes
  SET current_uses = current_uses + 1
  WHERE id = v_discount.id;

  -- Record redemption
  INSERT INTO discount_redemptions (
    discount_code_id,
    user_id,
    store_id,
    applied_at,
    stripe_subscription_id
  )
  VALUES (
    v_discount.id,
    p_user_id,
    p_store_id,
    NOW(),
    p_stripe_subscription_id
  );

  -- Return success with discount details
  RETURN json_build_object(
    'success', true,
    'discount', json_build_object(
      'id', v_discount.id,
      'code', v_discount.code,
      'type', v_discount.type,
      'value', v_discount.value,
      'stripe_coupon_id', v_discount.stripe_coupon_id,
      'first_payment_only', v_discount.first_payment_only
    )
  );
END;
$$ LANGUAGE plpgsql;

-- Update comment to reflect new timeout
COMMENT ON FUNCTION redeem_discount_code_atomic IS
  'Atomically redeems a discount code with row-level locking to prevent race conditions.
   Uses NOWAIT to fail fast if row is locked, preventing queue buildup.
   30s statement timeout provides margin for Supabase production load.
   Returns JSON with success status and discount details or error message.
   If retry=true in response, caller should retry after a short delay.';

-- =============================================
-- MIGRATION COMPLETE
-- =============================================

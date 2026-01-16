-- Migration 073: Discount Code Atomic Redemption
-- Fixes race condition in discount code redemption
-- Two concurrent requests could both redeem the same code exceeding max_uses
--
-- PRODUCTION SAFETY:
-- - Idempotent: Can be run multiple times safely
-- - Uses NOWAIT to prevent long waits on locked rows
-- - Timeout protection against deadlocks

-- =============================================
-- FIX: Add NOT NULL constraint to current_uses
-- =============================================

-- First ensure all NULL values are set to 0
UPDATE discount_codes
SET current_uses = 0
WHERE current_uses IS NULL;

-- Add DEFAULT (idempotent - PostgreSQL ignores if already set)
ALTER TABLE discount_codes
ALTER COLUMN current_uses SET DEFAULT 0;

-- Add NOT NULL constraint
-- Note: PostgreSQL will raise an error if trying to set NOT NULL when column already has it
-- We check the catalog first to make it idempotent
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'discount_codes'
    AND column_name = 'current_uses'
    AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE discount_codes ALTER COLUMN current_uses SET NOT NULL;
    RAISE NOTICE 'Added NOT NULL constraint to current_uses';
  ELSE
    RAISE NOTICE 'current_uses already has NOT NULL constraint, skipping';
  END IF;
END $$;

-- =============================================
-- ATOMIC DISCOUNT CODE REDEMPTION RPC
-- Uses row-level locking to prevent race conditions
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
  -- Set a statement timeout to prevent long waits (5 seconds max)
  -- This protects against deadlocks and long-running transactions
  SET LOCAL statement_timeout = '5s';

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

-- Add comment
COMMENT ON FUNCTION redeem_discount_code_atomic IS
  'Atomically redeems a discount code with row-level locking to prevent race conditions.
   Uses NOWAIT to fail fast if row is locked, preventing queue buildup.
   Returns JSON with success status and discount details or error message.
   If retry=true in response, caller should retry after a short delay.';

-- =============================================
-- MIGRATION COMPLETE
-- =============================================

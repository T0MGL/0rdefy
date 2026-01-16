-- ================================================================
-- SETTLEMENT PAYMENT ATOMIC PROCESSING
-- ================================================================
-- Migration: 076_settlement_payment_atomic.sql
-- Author: Bright Idea
-- Date: 2026-01-16
--
-- DEPENDENCIES:
-- - Migration 045: daily_settlements table
-- - Migration 059: settlement status workflow
--
-- Purpose: Atomic settlement payment recording to prevent double-count race conditions
--
-- PROBLEM SOLVED:
-- In markSettlementPaid, two concurrent requests could read the same amount_paid value
-- and both add their payment amount, resulting in one payment being lost (overwritten).
--
-- Example of race condition:
--   T1: reads amount_paid = 0
--   T2: reads amount_paid = 0
--   T1: writes amount_paid = 0 + 100 = 100
--   T2: writes amount_paid = 0 + 50 = 50  <-- OVERWRITES T1's payment!
--   Result: amount_paid = 50 (should be 150)
--
-- SOLUTION:
-- Use row-level locking (FOR UPDATE) and atomic increment in a single transaction.
-- ================================================================


-- ================================================================
-- DEPENDENCY CHECK
-- ================================================================
DO $$
BEGIN
    -- Check daily_settlements table exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'daily_settlements'
    ) THEN
        RAISE EXCEPTION 'Missing dependency: daily_settlements table not found. Run migration 045 first.';
    END IF;

    RAISE NOTICE '✓ All dependencies verified for migration 076';
END $$;


-- ================================================================
-- FUNCTION: record_settlement_payment
-- ================================================================
-- Atomically records a payment against a settlement
-- Uses row-level locking (FOR UPDATE) to prevent race conditions
--
-- Parameters:
--   p_settlement_id: UUID of the settlement to record payment for
--   p_amount: Payment amount (must be positive)
--   p_store_id: Store ID for security validation
--   p_method: Payment method (e.g., 'cash', 'transfer', 'check')
--   p_reference: Optional payment reference number
--   p_notes: Optional notes about the payment
--
-- Returns: JSON with success status and updated settlement data
--
-- Error cases:
--   - Settlement not found
--   - Payment amount <= 0
--   - Settlement already fully paid
--   - Settlement is disputed or cancelled

DROP FUNCTION IF EXISTS record_settlement_payment(UUID, DECIMAL, UUID, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION record_settlement_payment(
    p_settlement_id UUID,
    p_amount DECIMAL,
    p_store_id UUID,
    p_method TEXT DEFAULT NULL,
    p_reference TEXT DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_settlement RECORD;
    v_new_amount_paid DECIMAL(12,2);
    v_new_balance_due DECIMAL(12,2);
    v_new_status TEXT;
    v_result RECORD;
BEGIN
    -- ============================================================
    -- STEP 1: Validate input parameters
    -- ============================================================
    IF p_settlement_id IS NULL THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Settlement ID is required',
            'error_code', 'INVALID_INPUT'
        );
    END IF;

    IF p_store_id IS NULL THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Store ID is required',
            'error_code', 'INVALID_INPUT'
        );
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Payment amount must be a positive number',
            'error_code', 'INVALID_AMOUNT'
        );
    END IF;

    -- ============================================================
    -- STEP 2: Lock the row and get current values
    -- ============================================================
    -- FOR UPDATE ensures no concurrent transaction can modify this row
    -- until we commit or rollback
    SELECT *
    INTO v_settlement
    FROM daily_settlements
    WHERE id = p_settlement_id
      AND store_id = p_store_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Settlement not found or access denied',
            'error_code', 'NOT_FOUND'
        );
    END IF;

    -- ============================================================
    -- STEP 3: Validate settlement status
    -- ============================================================
    IF v_settlement.status = 'paid' THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Settlement is already fully paid',
            'error_code', 'ALREADY_PAID',
            'current_amount_paid', v_settlement.amount_paid,
            'net_receivable', v_settlement.net_receivable
        );
    END IF;

    IF v_settlement.status = 'disputed' THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Cannot record payment on disputed settlement. Resolve dispute first.',
            'error_code', 'SETTLEMENT_DISPUTED'
        );
    END IF;

    IF v_settlement.status = 'cancelled' THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Cannot record payment on cancelled settlement',
            'error_code', 'SETTLEMENT_CANCELLED'
        );
    END IF;

    -- ============================================================
    -- STEP 4: Calculate new values
    -- ============================================================
    v_new_amount_paid := COALESCE(v_settlement.amount_paid, 0) + p_amount;
    v_new_balance_due := COALESCE(v_settlement.net_receivable, 0) - v_new_amount_paid;

    -- Determine new status based on payment coverage
    IF v_new_amount_paid >= COALESCE(v_settlement.net_receivable, 0) THEN
        v_new_status := 'paid';
        -- Cap balance_due at 0 to avoid negative values on overpayment
        v_new_balance_due := GREATEST(v_new_balance_due, 0);
    ELSE
        v_new_status := 'partial';
    END IF;

    -- ============================================================
    -- STEP 5: Atomic update
    -- ============================================================
    UPDATE daily_settlements
    SET
        amount_paid = v_new_amount_paid,
        balance_due = v_new_balance_due,
        status = v_new_status,
        payment_date = CURRENT_DATE,
        payment_method = COALESCE(p_method, payment_method),
        payment_reference = COALESCE(p_reference, payment_reference),
        notes = COALESCE(p_notes, notes),
        updated_at = NOW()
    WHERE id = p_settlement_id
      AND store_id = p_store_id
    RETURNING * INTO v_result;

    -- ============================================================
    -- STEP 6: Return success with complete settlement data
    -- ============================================================
    RETURN json_build_object(
        'success', true,
        'data', json_build_object(
            'id', v_result.id,
            'store_id', v_result.store_id,
            'carrier_id', v_result.carrier_id,
            'dispatch_session_id', v_result.dispatch_session_id,
            'settlement_code', v_result.settlement_code,
            'settlement_date', v_result.settlement_date,
            'status', v_result.status,
            -- Order counts
            'total_dispatched', v_result.total_dispatched,
            'total_delivered', v_result.total_delivered,
            'total_not_delivered', v_result.total_not_delivered,
            'total_cod_delivered', v_result.total_cod_delivered,
            'total_prepaid_delivered', v_result.total_prepaid_delivered,
            -- Financial fields
            'total_cod_expected', v_result.total_cod_expected,
            'total_cod_collected', v_result.total_cod_collected,
            'carrier_fees_cod', v_result.carrier_fees_cod,
            'carrier_fees_prepaid', v_result.carrier_fees_prepaid,
            'total_carrier_fees', v_result.total_carrier_fees,
            'failed_attempt_fee', v_result.failed_attempt_fee,
            'net_receivable', v_result.net_receivable,
            -- Payment tracking
            'amount_paid', v_result.amount_paid,
            'balance_due', v_result.balance_due,
            'payment_date', v_result.payment_date,
            'payment_method', v_result.payment_method,
            'payment_reference', v_result.payment_reference,
            -- Metadata
            'notes', v_result.notes,
            'dispute_reason', v_result.dispute_reason,
            'created_by', v_result.created_by,
            'created_at', v_result.created_at,
            'updated_at', v_result.updated_at
        ),
        'payment_recorded', p_amount,
        'previous_amount_paid', COALESCE(v_settlement.amount_paid, 0),
        'is_fully_paid', v_new_status = 'paid'
    );

EXCEPTION
    WHEN OTHERS THEN
        -- Log error details for debugging
        RAISE WARNING 'record_settlement_payment error: % - %', SQLSTATE, SQLERRM;
        RETURN json_build_object(
            'success', false,
            'error', 'Internal error recording payment: ' || SQLERRM,
            'error_code', 'INTERNAL_ERROR',
            'sql_state', SQLSTATE
        );
END;
$$;


-- ================================================================
-- DOCUMENTATION
-- ================================================================
COMMENT ON FUNCTION record_settlement_payment IS
'Atomically records a payment against a settlement.

Uses row-level locking (FOR UPDATE) to prevent race conditions where concurrent
payments could overwrite each other (double-count bug).

Returns JSON with:
- success: boolean indicating if operation succeeded
- data: complete settlement object if successful
- error: error message if failed
- error_code: machine-readable error code (NOT_FOUND, INVALID_AMOUNT, etc.)

Example usage:
  SELECT record_settlement_payment(
    ''uuid-here''::UUID,
    50000.00,
    ''store-uuid''::UUID,
    ''transfer'',
    ''REF-12345'',
    ''Pago parcial enero''
  );';


-- ================================================================
-- PERMISSIONS
-- ================================================================
GRANT EXECUTE ON FUNCTION record_settlement_payment TO authenticated;
GRANT EXECUTE ON FUNCTION record_settlement_payment TO service_role;


-- ================================================================
-- VERIFICATION
-- ================================================================
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_proc WHERE proname = 'record_settlement_payment'
    ) THEN
        RAISE NOTICE '✓ Migration 076 completed: record_settlement_payment function created';
    ELSE
        RAISE EXCEPTION 'Migration 076 failed: function not created';
    END IF;
END $$;

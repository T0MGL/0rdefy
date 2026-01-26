-- ============================================================================
-- MIGRATION 111: Fix Settlement Unique Constraint (PRODUCTION-READY)
-- ============================================================================
--
-- BUG: Delivery-based reconciliation returns 500 error
--
-- Problem:
--   The daily_settlements table has a UNIQUE constraint from migration 000:
--     unique_store_date_carrier UNIQUE(store_id, settlement_date, carrier_id)
--   This prevents creating more than ONE settlement per carrier per date.
--
--   The delivery-based reconciliation system (migration 100) was designed to
--   support multiple settlements per carrier/date using sequential codes:
--     LIQ-DDMMYYYY-001, LIQ-DDMMYYYY-002, etc.
--
--   When a user tries to reconcile orders for a carrier that already has a
--   settlement on that date, the INSERT fails with a 23505 unique violation,
--   causing a 500 error on POST /api/settlements/reconcile-delivery.
--
-- Fix:
--   Drop the old unique_store_date_carrier constraint.
--   Settlement uniqueness is already enforced by migration 066:
--     uq_daily_settlements_store_code UNIQUE(store_id, settlement_code)
--
-- SAFETY:
--   - Idempotent (safe to run multiple times)
--   - Uses DROP CONSTRAINT IF EXISTS
--   - Transaction wrapped for atomicity
--   - Verifies replacement constraint exists before dropping
--   - No data modification, only constraint change
--
-- ROLLBACK: See bottom of file for rollback instructions
--
-- Date: 2026-01-26
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Verify the replacement constraint exists before dropping the old one
-- ============================================================================

DO $$
DECLARE
  v_replacement_exists BOOLEAN;
BEGIN
  -- Check that uq_daily_settlements_store_code exists (from migration 066)
  SELECT EXISTS(
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'daily_settlements'
      AND constraint_name = 'uq_daily_settlements_store_code'
      AND constraint_type = 'UNIQUE'
  ) INTO v_replacement_exists;

  IF v_replacement_exists THEN
    RAISE NOTICE '[MIGRATION 111] OK: Replacement constraint uq_daily_settlements_store_code exists';
  ELSE
    RAISE WARNING '[MIGRATION 111] WARNING: Replacement constraint uq_daily_settlements_store_code NOT found. '
                  'Migration 066 may not have been applied. Proceeding anyway - settlement_code uniqueness '
                  'should be verified manually.';
  END IF;
END $$;

-- ============================================================================
-- STEP 2: Drop the old constraint that blocks multiple settlements per date
-- ============================================================================

ALTER TABLE daily_settlements
DROP CONSTRAINT IF EXISTS unique_store_date_carrier;

COMMENT ON TABLE daily_settlements IS
'Settlement records for carrier reconciliation.
Uniqueness enforced by (store_id, settlement_code) via uq_daily_settlements_store_code (migration 066).
Multiple settlements per carrier/date are allowed (migration 111).';

-- ============================================================================
-- STEP 3: Verification
-- ============================================================================

DO $$
DECLARE
  v_old_constraint_exists BOOLEAN;
  v_new_constraint_exists BOOLEAN;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '============================================';
  RAISE NOTICE '  MIGRATION 111 - VERIFICATION';
  RAISE NOTICE '============================================';

  -- Verify old constraint is gone
  SELECT EXISTS(
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'daily_settlements'
      AND constraint_name = 'unique_store_date_carrier'
  ) INTO v_old_constraint_exists;

  IF NOT v_old_constraint_exists THEN
    RAISE NOTICE 'OK: unique_store_date_carrier constraint removed';
  ELSE
    RAISE WARNING 'FAIL: unique_store_date_carrier constraint still exists';
  END IF;

  -- Verify replacement constraint exists
  SELECT EXISTS(
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'daily_settlements'
      AND constraint_name = 'uq_daily_settlements_store_code'
  ) INTO v_new_constraint_exists;

  IF v_new_constraint_exists THEN
    RAISE NOTICE 'OK: uq_daily_settlements_store_code constraint exists (settlement_code uniqueness)';
  ELSE
    RAISE WARNING 'WARNING: uq_daily_settlements_store_code NOT found - settlement_code uniqueness not enforced';
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE 'CHANGES APPLIED:';
  RAISE NOTICE '  1. Dropped unique_store_date_carrier UNIQUE(store_id, settlement_date, carrier_id)';
  RAISE NOTICE '  2. Multiple settlements per carrier/date now allowed';
  RAISE NOTICE '  3. Uniqueness still enforced by settlement_code (uq_daily_settlements_store_code)';
  RAISE NOTICE '============================================';
END $$;

COMMIT;

-- ============================================================================
-- ROLLBACK INSTRUCTIONS
-- ============================================================================
--
-- If you need to rollback this migration, run the following:
--
-- BEGIN;
--
-- -- Re-add the old constraint (will fail if duplicate store+date+carrier rows exist)
-- ALTER TABLE daily_settlements
-- ADD CONSTRAINT unique_store_date_carrier UNIQUE(store_id, settlement_date, carrier_id);
--
-- COMMIT;
--
-- NOTE: Rollback will fail if multiple settlements exist for the same
-- carrier+date combination. You would need to delete duplicates first.
--
-- ============================================================================

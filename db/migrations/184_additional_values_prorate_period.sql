-- ================================================================
-- Migration 184: additional_values period_start / period_end
-- ================================================================
-- Adds optional period_start and period_end columns to additional_values
-- so a single expense row can represent a cost that spans multiple days
-- (typical case: ad spend that "covers a month" but is loaded as one
-- charge). When the columns are NULL, the row keeps the legacy single-
-- date behavior driven by the existing `date` column.
--
-- The analytics layer reads these columns and prorates the amount over
-- the overlap between [period_start, period_end] and the dashboard
-- query window. See api/utils/metrics-canonical.ts::proratedAmountInWindow.
--
-- Constraints:
--   - Both columns nullable. Default behavior unchanged for every
--     existing row (~all production data pre-2026-05-11).
--   - CHECK: when both are set, period_end >= period_start.
--   - CHECK: cannot set only one side. Both NULL or both NOT NULL.
--   - Helper index on (store_id, period_start, period_end) for the
--     dashboard query path. Partial index so the cost is paid only on
--     rows that actually use periods.
--
-- Notes:
--   - Idempotent: ADD COLUMN IF NOT EXISTS, ADD CONSTRAINT IF NOT EXISTS,
--     CREATE INDEX IF NOT EXISTS. Re-running is a no-op.
--   - Runs in a single transaction; full rollback on any failure.
--   - No data backfill needed: legacy rows stay single-date and the
--     prorate helper short-circuits when both columns are NULL.
-- ================================================================

BEGIN;

-- ================================================================
-- 1. Add columns (nullable, no default beyond NULL)
-- ================================================================
ALTER TABLE additional_values
    ADD COLUMN IF NOT EXISTS period_start DATE,
    ADD COLUMN IF NOT EXISTS period_end DATE;

COMMENT ON COLUMN additional_values.period_start IS 'Optional: start date of the period this expense covers. When set, the analytics layer prorates the amount over [period_start, period_end] instead of attributing 100% to `date`.';
COMMENT ON COLUMN additional_values.period_end IS 'Optional: end date (inclusive) of the period this expense covers. Must be >= period_start. Both columns must be set together or both NULL.';

-- ================================================================
-- 2. Constraints: both-or-neither, and end >= start
-- ================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'additional_values_period_both_or_neither'
    ) THEN
        ALTER TABLE additional_values
            ADD CONSTRAINT additional_values_period_both_or_neither
            CHECK (
                (period_start IS NULL AND period_end IS NULL)
                OR (period_start IS NOT NULL AND period_end IS NOT NULL)
            );
    END IF;
END$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'additional_values_period_end_after_start'
    ) THEN
        ALTER TABLE additional_values
            ADD CONSTRAINT additional_values_period_end_after_start
            CHECK (
                period_start IS NULL
                OR period_end IS NULL
                OR period_end >= period_start
            );
    END IF;
END$$;

-- ================================================================
-- 3. Partial index for the dashboard prorate path
-- ================================================================
-- The analytics endpoints filter by (store_id, category='marketing',
-- type='expense') and then need to check overlap against a query window.
-- A B-tree on (store_id, period_start, period_end) lets the planner
-- range-scan when the new columns are populated. WHERE clause keeps the
-- index small: only rows that actually use periods.
CREATE INDEX IF NOT EXISTS idx_additional_values_period
    ON additional_values (store_id, period_start, period_end)
    WHERE period_start IS NOT NULL;

COMMIT;

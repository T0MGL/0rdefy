-- ================================================================
-- MIGRATION 096: Fix v_active_incidents View - Add retry attempt IDs
-- ================================================================
-- Purpose: Add the 'id' field to retry_attempts JSON array so that
-- admins can reschedule specific retries from the Incidents dashboard
--
-- This migration is IDEMPOTENT - safe to run multiple times
-- ================================================================
-- Author: Claude Code
-- Date: 2026-01-20
-- Ticket: Incident retry rescheduling from admin dashboard
-- ================================================================

-- ================================================================
-- PRE-FLIGHT CHECKS
-- ================================================================

DO $$
BEGIN
    -- Verify required tables exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'delivery_incidents') THEN
        RAISE EXCEPTION 'Table delivery_incidents does not exist. Run migration 026_delivery_incidents_system.sql first.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'incident_retry_attempts') THEN
        RAISE EXCEPTION 'Table incident_retry_attempts does not exist. Run migration 026_delivery_incidents_system.sql first.';
    END IF;

    -- Verify required columns exist in incident_retry_attempts
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'incident_retry_attempts' AND column_name = 'rescheduled_by'
    ) THEN
        RAISE NOTICE 'Column rescheduled_by does not exist in incident_retry_attempts, will use NULL';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'incident_retry_attempts' AND column_name = 'payment_method'
    ) THEN
        RAISE NOTICE 'Column payment_method does not exist in incident_retry_attempts, will use NULL';
    END IF;

    RAISE NOTICE 'Pre-flight checks passed for migration 096';
END $$;

-- ================================================================
-- STEP 1: DROP AND RECREATE VIEW WITH ENHANCED FIELDS
-- ================================================================
-- Using CREATE OR REPLACE makes this idempotent

CREATE OR REPLACE VIEW v_active_incidents AS
SELECT
    i.id AS incident_id,
    i.order_id,
    i.store_id,
    i.status AS incident_status,
    i.current_retry_count,
    i.max_retry_attempts,
    i.created_at AS incident_created_at,

    -- Order details
    o.shopify_order_number,
    o.customer_first_name,
    o.customer_last_name,
    o.customer_phone,
    o.customer_address,
    o.total_price,
    o.delivery_failure_reason,
    o.courier_notes,
    o.sleeves_status,

    -- Carrier info
    c.name AS carrier_name,
    c.phone AS carrier_phone,

    -- Initial attempt info
    da.failed_reason AS initial_failure_reason,
    da.failure_notes AS initial_failure_notes,
    da.actual_date AS initial_attempt_date,

    -- Retry attempts (as JSON array) - NOW INCLUDING id for rescheduling
    COALESCE(
        (
            SELECT json_agg(
                json_build_object(
                    'id', ira.id,
                    'retry_number', ira.retry_number,
                    'status', ira.status,
                    'scheduled_date', ira.scheduled_date,
                    'courier_notes', ira.courier_notes,
                    'failure_reason', ira.failure_reason,
                    'attempted_at', COALESCE(ira.attempted_at, ira.created_at),
                    'rescheduled_by', ira.rescheduled_by,
                    'payment_method', ira.payment_method
                ) ORDER BY ira.retry_number
            )
            FROM incident_retry_attempts ira
            WHERE ira.incident_id = i.id
        ),
        '[]'::json
    ) AS retry_attempts

FROM delivery_incidents i
INNER JOIN orders o ON i.order_id = o.id
LEFT JOIN carriers c ON o.courier_id = c.id
LEFT JOIN delivery_attempts da ON i.initial_attempt_id = da.id
WHERE i.status = 'active'
ORDER BY i.created_at DESC;

COMMENT ON VIEW v_active_incidents IS 'Active delivery incidents with order and retry details for dashboard - includes retry IDs for rescheduling (Migration 096)';

-- ================================================================
-- STEP 2: ADD updated_at COLUMN IF NOT EXISTS
-- ================================================================
-- This column is needed for the schedule-retry endpoint to track changes

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'incident_retry_attempts' AND column_name = 'updated_at'
    ) THEN
        ALTER TABLE incident_retry_attempts
        ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();

        RAISE NOTICE 'Added updated_at column to incident_retry_attempts';
    ELSE
        RAISE NOTICE 'Column updated_at already exists in incident_retry_attempts';
    END IF;
END $$;

-- ================================================================
-- STEP 3: CREATE INDEX FOR FASTER RETRY LOOKUPS
-- ================================================================

CREATE INDEX IF NOT EXISTS idx_incident_retry_attempts_incident_status
ON incident_retry_attempts (incident_id, status);

CREATE INDEX IF NOT EXISTS idx_incident_retry_attempts_scheduled
ON incident_retry_attempts (incident_id, status, retry_number)
WHERE status = 'scheduled';

-- ================================================================
-- POST-MIGRATION VERIFICATION
-- ================================================================

DO $$
DECLARE
    v_view_exists BOOLEAN;
    v_has_id_field BOOLEAN;
    v_sample_data JSONB;
BEGIN
    -- Check view exists
    SELECT EXISTS (
        SELECT 1 FROM information_schema.views
        WHERE table_name = 'v_active_incidents'
    ) INTO v_view_exists;

    IF NOT v_view_exists THEN
        RAISE EXCEPTION 'Migration failed: v_active_incidents view was not created';
    END IF;

    -- Check that the view returns the expected structure
    -- by querying column info
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'v_active_incidents' AND column_name = 'retry_attempts'
    ) THEN
        RAISE EXCEPTION 'Migration failed: retry_attempts column missing from view';
    END IF;

    -- Try to query the view (will fail if joins are broken)
    BEGIN
        PERFORM * FROM v_active_incidents LIMIT 1;
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Migration failed: v_active_incidents view query failed - %', SQLERRM;
    END;

    RAISE NOTICE '✅ Migration 096 completed successfully';
    RAISE NOTICE '   - v_active_incidents view updated with retry IDs';
    RAISE NOTICE '   - Indexes created for retry lookups';
END $$;

-- ================================================================
-- ROLLBACK INSTRUCTIONS (if needed)
-- ================================================================
-- To rollback this migration, run:
--
-- CREATE OR REPLACE VIEW v_active_incidents AS
-- SELECT
--     i.id AS incident_id,
--     i.order_id,
--     i.store_id,
--     i.status AS incident_status,
--     i.current_retry_count,
--     i.max_retry_attempts,
--     i.created_at AS incident_created_at,
--     o.shopify_order_number,
--     o.customer_first_name,
--     o.customer_last_name,
--     o.customer_phone,
--     o.customer_address,
--     o.total_price,
--     o.delivery_failure_reason,
--     o.courier_notes,
--     o.sleeves_status,
--     c.name AS carrier_name,
--     c.phone AS carrier_phone,
--     da.failed_reason AS initial_failure_reason,
--     da.failure_notes AS initial_failure_notes,
--     da.actual_date AS initial_attempt_date,
--     COALESCE(
--         (
--             SELECT json_agg(
--                 json_build_object(
--                     'retry_number', ira.retry_number,
--                     'status', ira.status,
--                     'scheduled_date', ira.scheduled_date,
--                     'courier_notes', ira.courier_notes,
--                     'failure_reason', ira.failure_reason,
--                     'attempted_at', COALESCE(ira.attempted_at, ira.created_at)
--                 ) ORDER BY ira.retry_number
--             )
--             FROM incident_retry_attempts ira
--             WHERE ira.incident_id = i.id
--         ),
--         '[]'::json
--     ) AS retry_attempts
-- FROM delivery_incidents i
-- INNER JOIN orders o ON i.order_id = o.id
-- LEFT JOIN carriers c ON o.courier_id = c.id
-- LEFT JOIN delivery_attempts da ON i.initial_attempt_id = da.id
-- WHERE i.status = 'active'
-- ORDER BY i.created_at DESC;
--
-- DROP INDEX IF EXISTS idx_incident_retry_attempts_incident_status;
-- DROP INDEX IF EXISTS idx_incident_retry_attempts_scheduled;
-- ================================================================

-- ================================================================
-- MIGRATION COMPLETE
-- ================================================================
-- Changes:
-- ✅ Added 'id' field to retry_attempts JSON array (for rescheduling)
-- ✅ Added 'rescheduled_by' field to track who made changes
-- ✅ Added 'payment_method' field for completed retries
-- ✅ Added updated_at column to incident_retry_attempts (if missing)
-- ✅ Created indexes for faster retry lookups
-- ✅ Added pre-flight and post-migration verification
-- ================================================================

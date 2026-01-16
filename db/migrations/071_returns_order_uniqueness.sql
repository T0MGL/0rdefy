-- Migration: Returns Order Uniqueness Constraint
-- Description: Prevents the same order from being in multiple active return sessions
-- Author: Bright Idea
-- Date: 2026-01-15

-- ============================================================================
-- PROBLEM: An order can currently be added to multiple return sessions
-- The existing UNIQUE(session_id, order_id) only prevents duplicates within
-- the SAME session, not across different sessions.
-- ============================================================================

-- ============================================================================
-- SOLUTION: Database-level trigger to enforce uniqueness across active sessions
-- ============================================================================

-- Function to prevent duplicate return orders across active sessions
CREATE OR REPLACE FUNCTION prevent_duplicate_return_orders()
RETURNS TRIGGER AS $$
DECLARE
  v_existing_count INTEGER;
  v_existing_session_code TEXT;
BEGIN
  -- Check if order is already in an active session (in_progress or completed)
  SELECT COUNT(*), MAX(rs.session_code)
  INTO v_existing_count, v_existing_session_code
  FROM return_session_orders rso
  JOIN return_sessions rs ON rs.id = rso.session_id
  WHERE rso.order_id = NEW.order_id
  AND rs.status IN ('in_progress', 'completed')
  AND rso.id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::UUID);

  IF v_existing_count > 0 THEN
    RAISE EXCEPTION 'Order % is already in an active return session (%)',
      NEW.order_id, v_existing_session_code
      USING ERRCODE = 'unique_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if exists (idempotent)
DROP TRIGGER IF EXISTS trigger_prevent_duplicate_return_orders ON return_session_orders;

-- Create trigger to validate before insert or update
CREATE TRIGGER trigger_prevent_duplicate_return_orders
BEFORE INSERT OR UPDATE ON return_session_orders
FOR EACH ROW
EXECUTE FUNCTION prevent_duplicate_return_orders();

COMMENT ON FUNCTION prevent_duplicate_return_orders() IS
  'Prevents the same order from being in multiple active (in_progress/completed) return sessions';

-- ============================================================================
-- CLEANUP: When a session is cancelled, delete its order links
-- This allows the orders to be added to a new session
--
-- NOTE: return_session_orders and return_session_items have ON DELETE CASCADE
-- from session_id, but we need to explicitly delete them when session is
-- CANCELLED (not deleted). The session record stays for audit purposes.
-- ============================================================================

CREATE OR REPLACE FUNCTION cleanup_cancelled_return_session_orders()
RETURNS TRIGGER AS $$
BEGIN
  -- Only trigger when status changes TO 'cancelled'
  IF NEW.status = 'cancelled' AND OLD.status != 'cancelled' THEN
    -- Delete the order links first (items have FK to session, will cascade from items table)
    -- We delete from return_session_orders which releases the orders for re-processing
    DELETE FROM return_session_orders WHERE session_id = NEW.id;

    -- Note: return_session_items references session_id with ON DELETE CASCADE,
    -- but since we're not deleting the session, we need to delete items explicitly
    DELETE FROM return_session_items WHERE session_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if exists (idempotent)
DROP TRIGGER IF EXISTS trigger_cleanup_cancelled_returns ON return_sessions;

-- Create trigger to cleanup on cancellation
CREATE TRIGGER trigger_cleanup_cancelled_returns
AFTER UPDATE ON return_sessions
FOR EACH ROW
EXECUTE FUNCTION cleanup_cancelled_return_session_orders();

COMMENT ON FUNCTION cleanup_cancelled_return_session_orders() IS
  'Automatically removes order links when a return session is cancelled, allowing orders to be re-processed';

-- ============================================================================
-- INDEXES: Optimize the duplicate check query
-- ============================================================================

-- Index to speed up the duplicate check query (order_id lookups)
CREATE INDEX IF NOT EXISTS idx_return_session_orders_order_id
ON return_session_orders(order_id);

-- Index for filtering sessions by status (used in the trigger join)
CREATE INDEX IF NOT EXISTS idx_return_sessions_status
ON return_sessions(status)
WHERE status IN ('in_progress', 'completed');

-- ============================================================================
-- VERIFICATION: Check for any existing duplicates (informational only)
-- ============================================================================

DO $$
DECLARE
  v_duplicate_count INTEGER;
  v_duplicate_orders TEXT;
BEGIN
  -- Check for duplicates
  SELECT COUNT(*), string_agg(order_id::TEXT, ', ')
  INTO v_duplicate_count, v_duplicate_orders
  FROM (
    SELECT rso.order_id
    FROM return_session_orders rso
    JOIN return_sessions rs ON rs.id = rso.session_id
    WHERE rs.status IN ('in_progress', 'completed')
    GROUP BY rso.order_id
    HAVING COUNT(*) > 1
  ) AS duplicates;

  IF v_duplicate_count > 0 THEN
    RAISE WARNING 'Found % orders in multiple active return sessions: %. Manual cleanup required before this constraint will be fully effective.',
      v_duplicate_count, v_duplicate_orders;
  ELSE
    RAISE NOTICE 'No duplicate orders found in active return sessions. Constraint is fully effective.';
  END IF;
END $$;

-- ============================================================================
-- ROLLBACK INSTRUCTIONS (run manually if needed)
-- ============================================================================
/*
-- To rollback this migration, run:

DROP TRIGGER IF EXISTS trigger_prevent_duplicate_return_orders ON return_session_orders;
DROP TRIGGER IF EXISTS trigger_cleanup_cancelled_returns ON return_sessions;
DROP FUNCTION IF EXISTS prevent_duplicate_return_orders();
DROP FUNCTION IF EXISTS cleanup_cancelled_return_session_orders();
DROP INDEX IF EXISTS idx_return_session_orders_order_id;
DROP INDEX IF EXISTS idx_return_sessions_status;

*/

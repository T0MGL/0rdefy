-- =============================================
-- Migration 059: Dispatch & Settlements Production Fixes
-- Description: Critical fixes for courier reconciliation system
--              - Prevent duplicate order dispatch
--              - Fix session code format (999/day capacity)
--              - Add status transition validation
--              - Add carrier zone validation
--              - Improve settlement calculations
-- Author: Claude
-- Date: 2026-01-13
-- =============================================

BEGIN;

-- =============================================
-- 1. PREVENT DUPLICATE ORDER DISPATCH
-- Orders cannot be in multiple active dispatch sessions
-- =============================================

-- Function to check if orders are already dispatched
CREATE OR REPLACE FUNCTION check_orders_not_in_active_session(p_order_ids UUID[])
RETURNS TABLE(order_id UUID, session_code VARCHAR, carrier_name VARCHAR) AS $$
BEGIN
  RETURN QUERY
  SELECT
    dso.order_id,
    ds.session_code,
    c.name as carrier_name
  FROM dispatch_session_orders dso
  JOIN dispatch_sessions ds ON ds.id = dso.dispatch_session_id
  JOIN carriers c ON c.id = ds.carrier_id
  WHERE dso.order_id = ANY(p_order_ids)
    AND ds.status NOT IN ('cancelled', 'settled');
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION check_orders_not_in_active_session(UUID[]) IS
'Returns orders that are already in active dispatch sessions. Empty result = safe to dispatch.';

-- Trigger to prevent inserting duplicate orders
CREATE OR REPLACE FUNCTION prevent_duplicate_dispatch()
RETURNS TRIGGER AS $$
DECLARE
  v_existing RECORD;
BEGIN
  -- Check if order already in an active session
  SELECT ds.session_code, ds.status
  INTO v_existing
  FROM dispatch_session_orders dso
  JOIN dispatch_sessions ds ON ds.id = dso.dispatch_session_id
  WHERE dso.order_id = NEW.order_id
    AND ds.status NOT IN ('cancelled', 'settled')
    AND ds.id != NEW.dispatch_session_id
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Order % is already in active dispatch session %',
      NEW.order_id, v_existing.session_code;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_prevent_duplicate_dispatch ON dispatch_session_orders;
CREATE TRIGGER trigger_prevent_duplicate_dispatch
  BEFORE INSERT ON dispatch_session_orders
  FOR EACH ROW
  EXECUTE FUNCTION prevent_duplicate_dispatch();

COMMENT ON TRIGGER trigger_prevent_duplicate_dispatch ON dispatch_session_orders IS
'Prevents same order from being dispatched in multiple active sessions';

-- =============================================
-- 2. FIX SESSION CODE FORMAT (999/day capacity)
-- Change from 2-digit to 3-digit session number
-- =============================================

CREATE OR REPLACE FUNCTION generate_dispatch_session_code(p_store_id UUID, p_date DATE DEFAULT CURRENT_DATE)
RETURNS VARCHAR(30) AS $$
DECLARE
  v_count INT;
  v_date_str VARCHAR(8);
BEGIN
  v_date_str := TO_CHAR(p_date, 'DDMMYYYY');

  SELECT COUNT(*) + 1 INTO v_count
  FROM dispatch_sessions
  WHERE store_id = p_store_id
    AND dispatch_date = p_date;

  -- Changed from 2 digits to 3 digits (supports 999 sessions/day)
  RETURN 'DISP-' || v_date_str || '-' || LPAD(v_count::TEXT, 3, '0');
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION generate_dispatch_session_code(UUID, DATE) IS
'Generates dispatch session code in format DISP-DDMMYYYY-NNN (supports 999 sessions/day)';

-- Also fix settlement code
CREATE OR REPLACE FUNCTION generate_settlement_code(p_store_id UUID, p_date DATE DEFAULT CURRENT_DATE)
RETURNS VARCHAR(30) AS $$
DECLARE
  v_count INT;
  v_date_str VARCHAR(8);
BEGIN
  v_date_str := TO_CHAR(p_date, 'DDMMYYYY');

  SELECT COUNT(*) + 1 INTO v_count
  FROM daily_settlements
  WHERE store_id = p_store_id
    AND settlement_date = p_date;

  -- Changed from 2 digits to 3 digits
  RETURN 'LIQ-' || v_date_str || '-' || LPAD(v_count::TEXT, 3, '0');
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION generate_settlement_code(UUID, DATE) IS
'Generates settlement code in format LIQ-DDMMYYYY-NNN (supports 999 settlements/day)';

-- =============================================
-- 3. STATUS TRANSITION VALIDATION
-- Enforce valid status flow: dispatched → processing → settled
-- =============================================

CREATE OR REPLACE FUNCTION validate_dispatch_session_status_transition()
RETURNS TRIGGER AS $$
BEGIN
  -- Cannot change status of settled sessions (except to cancelled with reason)
  IF OLD.status = 'settled' AND NEW.status != 'settled' THEN
    RAISE EXCEPTION 'Cannot change status of settled dispatch session. Create a new session instead.';
  END IF;

  -- Cannot reopen cancelled sessions
  IF OLD.status = 'cancelled' AND NEW.status != 'cancelled' THEN
    RAISE EXCEPTION 'Cannot reopen cancelled dispatch session. Create a new session instead.';
  END IF;

  -- Valid transitions:
  -- dispatched → processing, settled, cancelled
  -- processing → settled, cancelled
  -- settled → (nothing)
  -- cancelled → (nothing)

  IF OLD.status = 'dispatched' AND NEW.status NOT IN ('dispatched', 'processing', 'settled', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid status transition from dispatched to %', NEW.status;
  END IF;

  IF OLD.status = 'processing' AND NEW.status NOT IN ('processing', 'settled', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid status transition from processing to %', NEW.status;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_validate_dispatch_status ON dispatch_sessions;
CREATE TRIGGER trigger_validate_dispatch_status
  BEFORE UPDATE ON dispatch_sessions
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION validate_dispatch_session_status_transition();

COMMENT ON TRIGGER trigger_validate_dispatch_status ON dispatch_sessions IS
'Enforces valid status transitions for dispatch sessions';

-- =============================================
-- 4. CARRIER ZONE VALIDATION
-- Ensure carriers have at least a default zone before dispatch
-- =============================================

CREATE OR REPLACE FUNCTION validate_carrier_has_zones(p_carrier_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_zone_count INT;
BEGIN
  SELECT COUNT(*) INTO v_zone_count
  FROM carrier_zones
  WHERE carrier_id = p_carrier_id
    AND is_active = true;

  RETURN v_zone_count > 0;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION validate_carrier_has_zones(UUID) IS
'Returns true if carrier has at least one active zone configured';

-- Function to get carrier fee for a zone (with fallback)
CREATE OR REPLACE FUNCTION get_carrier_fee_for_zone(
  p_carrier_id UUID,
  p_zone_name TEXT
)
RETURNS DECIMAL(12,2) AS $$
DECLARE
  v_rate DECIMAL(12,2);
BEGIN
  -- Try exact zone match first
  SELECT rate INTO v_rate
  FROM carrier_zones
  WHERE carrier_id = p_carrier_id
    AND is_active = true
    AND LOWER(zone_name) = LOWER(TRIM(p_zone_name))
  LIMIT 1;

  IF FOUND THEN
    RETURN v_rate;
  END IF;

  -- Try default zone
  SELECT rate INTO v_rate
  FROM carrier_zones
  WHERE carrier_id = p_carrier_id
    AND is_active = true
    AND LOWER(zone_name) = 'default'
  LIMIT 1;

  IF FOUND THEN
    RETURN v_rate;
  END IF;

  -- No zone found - return NULL (caller should handle)
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_carrier_fee_for_zone(UUID, TEXT) IS
'Returns carrier fee for zone, with fallback to default zone. Returns NULL if no zone configured.';

-- =============================================
-- 5. ADD COLUMNS FOR IMPROVED SETTLEMENT TRACKING
-- =============================================

-- Add expected COD to daily_settlements for discrepancy tracking
ALTER TABLE daily_settlements
ADD COLUMN IF NOT EXISTS total_cod_expected DECIMAL(12,2) DEFAULT 0;

COMMENT ON COLUMN daily_settlements.total_cod_expected IS
'Total COD amount expected based on delivered COD orders';

-- Add discrepancy amount for quick queries
ALTER TABLE daily_settlements
ADD COLUMN IF NOT EXISTS discrepancy_amount DECIMAL(12,2) GENERATED ALWAYS AS
  (total_cod_collected - COALESCE(total_cod_expected, total_cod_collected)) STORED;

COMMENT ON COLUMN daily_settlements.discrepancy_amount IS
'Difference between collected and expected COD (auto-calculated)';

-- Add carrier fees breakdown
ALTER TABLE daily_settlements
ADD COLUMN IF NOT EXISTS carrier_fees_cod DECIMAL(12,2) DEFAULT 0;

ALTER TABLE daily_settlements
ADD COLUMN IF NOT EXISTS carrier_fees_prepaid DECIMAL(12,2) DEFAULT 0;

COMMENT ON COLUMN daily_settlements.carrier_fees_cod IS
'Carrier fees for COD orders (deducted from collected amount)';

COMMENT ON COLUMN daily_settlements.carrier_fees_prepaid IS
'Carrier fees for prepaid orders (store owes to carrier)';

-- =============================================
-- 6. PROTECT CARRIER_FEE FROM MODIFICATION
-- Once order is in session, fee should not change
-- =============================================

CREATE OR REPLACE FUNCTION protect_dispatch_order_fee()
RETURNS TRIGGER AS $$
BEGIN
  -- Only protect if session is not in 'dispatched' status
  IF EXISTS (
    SELECT 1 FROM dispatch_sessions
    WHERE id = NEW.dispatch_session_id
      AND status NOT IN ('dispatched')
  ) THEN
    IF OLD.carrier_fee != NEW.carrier_fee THEN
      RAISE EXCEPTION 'Cannot modify carrier_fee after session has progressed past dispatched status';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_protect_dispatch_order_fee ON dispatch_session_orders;
CREATE TRIGGER trigger_protect_dispatch_order_fee
  BEFORE UPDATE ON dispatch_session_orders
  FOR EACH ROW
  WHEN (OLD.carrier_fee IS DISTINCT FROM NEW.carrier_fee)
  EXECUTE FUNCTION protect_dispatch_order_fee();

-- =============================================
-- 7. ADD INDEXES FOR PERFORMANCE
-- =============================================

-- Index for finding orders ready to dispatch
CREATE INDEX IF NOT EXISTS idx_orders_ready_to_dispatch
ON orders(store_id, sleeves_status, courier_id)
WHERE sleeves_status = 'ready_to_ship';

-- Index for shipped orders (reconciliation queries)
CREATE INDEX IF NOT EXISTS idx_orders_shipped_for_reconciliation
ON orders(store_id, sleeves_status, courier_id, shipped_at)
WHERE sleeves_status = 'shipped';

-- Index for dispatch session orders by status
CREATE INDEX IF NOT EXISTS idx_dispatch_session_orders_status
ON dispatch_session_orders(dispatch_session_id, delivery_status);

-- Index for pending settlements
CREATE INDEX IF NOT EXISTS idx_daily_settlements_pending_balance
ON daily_settlements(store_id, carrier_id, status, balance_due)
WHERE status IN ('pending', 'partial') AND balance_due > 0;

-- =============================================
-- 8. ATOMIC SETTLEMENT CREATION
-- Ensure all-or-nothing settlement processing
-- =============================================

CREATE OR REPLACE FUNCTION process_dispatch_settlement_atomic(
  p_dispatch_session_id UUID,
  p_created_by UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_session RECORD;
  v_settlement_id UUID;
  v_settlement_code VARCHAR(30);
  v_stats RECORD;
  v_net_receivable DECIMAL(12,2);
BEGIN
  -- Lock the session row to prevent concurrent processing
  SELECT * INTO v_session
  FROM dispatch_sessions
  WHERE id = p_dispatch_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dispatch session not found: %', p_dispatch_session_id;
  END IF;

  IF v_session.status = 'settled' THEN
    RAISE EXCEPTION 'Session already settled: %', v_session.session_code;
  END IF;

  IF v_session.status = 'cancelled' THEN
    RAISE EXCEPTION 'Cannot settle cancelled session: %', v_session.session_code;
  END IF;

  -- Calculate statistics with proper COD/prepaid separation
  SELECT
    COUNT(*) as total_dispatched,
    COUNT(*) FILTER (WHERE delivery_status = 'delivered') as total_delivered,
    COUNT(*) FILTER (WHERE delivery_status IN ('not_delivered', 'rejected', 'returned')) as total_not_delivered,
    COUNT(*) FILTER (WHERE delivery_status = 'delivered' AND is_cod = TRUE) as total_cod_delivered,
    COUNT(*) FILTER (WHERE delivery_status = 'delivered' AND is_cod = FALSE) as total_prepaid_delivered,
    -- COD collected
    COALESCE(SUM(amount_collected) FILTER (WHERE delivery_status = 'delivered' AND is_cod = TRUE), 0) as total_cod_collected,
    -- COD expected (for discrepancy)
    COALESCE(SUM(total_price) FILTER (WHERE delivery_status = 'delivered' AND is_cod = TRUE), 0) as total_cod_expected,
    -- Carrier fees separated
    COALESCE(SUM(carrier_fee) FILTER (WHERE delivery_status = 'delivered' AND is_cod = TRUE), 0) as carrier_fees_cod,
    COALESCE(SUM(carrier_fee) FILTER (WHERE delivery_status = 'delivered' AND is_cod = FALSE), 0) as carrier_fees_prepaid,
    -- Total carrier fees
    COALESCE(SUM(carrier_fee) FILTER (WHERE delivery_status = 'delivered'), 0) as total_carrier_fees,
    -- Failed attempt fees (50% of fee)
    COALESCE(SUM(carrier_fee * 0.5) FILTER (WHERE delivery_status IN ('not_delivered', 'rejected')), 0) as failed_attempt_fee
  INTO v_stats
  FROM dispatch_session_orders
  WHERE dispatch_session_id = p_dispatch_session_id;

  -- Generate settlement code
  v_settlement_code := generate_settlement_code(v_session.store_id);

  -- Calculate net receivable
  -- Formula: COD collected - all carrier fees - failed attempt fees
  -- If negative, store owes courier
  v_net_receivable := v_stats.total_cod_collected - v_stats.total_carrier_fees - v_stats.failed_attempt_fee;

  -- Create settlement
  INSERT INTO daily_settlements (
    store_id, carrier_id, dispatch_session_id,
    settlement_code, settlement_date,
    total_dispatched, total_delivered, total_not_delivered,
    total_cod_delivered, total_prepaid_delivered,
    total_cod_collected, total_cod_expected,
    carrier_fees_cod, carrier_fees_prepaid,
    total_carrier_fees, failed_attempt_fee,
    net_receivable, balance_due,
    amount_paid, status, created_by
  ) VALUES (
    v_session.store_id, v_session.carrier_id, p_dispatch_session_id,
    v_settlement_code, CURRENT_DATE,
    v_stats.total_dispatched, v_stats.total_delivered, v_stats.total_not_delivered,
    v_stats.total_cod_delivered, v_stats.total_prepaid_delivered,
    v_stats.total_cod_collected, v_stats.total_cod_expected,
    v_stats.carrier_fees_cod, v_stats.carrier_fees_prepaid,
    v_stats.total_carrier_fees, v_stats.failed_attempt_fee,
    v_net_receivable, v_net_receivable,
    0, 'pending', p_created_by
  )
  RETURNING id INTO v_settlement_id;

  -- Update dispatch session
  UPDATE dispatch_sessions
  SET status = 'settled',
      daily_settlement_id = v_settlement_id,
      settled_at = NOW()
  WHERE id = p_dispatch_session_id;

  -- Update order statuses
  UPDATE orders o
  SET sleeves_status = CASE
        WHEN dso.delivery_status = 'delivered' THEN 'delivered'
        WHEN dso.delivery_status = 'rejected' THEN 'cancelled'
        WHEN dso.delivery_status = 'returned' THEN 'returned'
        ELSE o.sleeves_status
      END,
      delivered_at = CASE WHEN dso.delivery_status = 'delivered' THEN COALESCE(dso.delivered_at, NOW()) ELSE NULL END,
      amount_collected = CASE WHEN dso.delivery_status = 'delivered' AND dso.is_cod THEN dso.amount_collected ELSE NULL END
  FROM dispatch_session_orders dso
  WHERE dso.dispatch_session_id = p_dispatch_session_id
    AND dso.order_id = o.id
    AND dso.delivery_status != 'pending';

  RETURN v_settlement_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION process_dispatch_settlement_atomic(UUID, UUID) IS
'Atomically processes dispatch session and creates settlement. Uses row locking to prevent races.';

-- =============================================
-- 9. VIEW FOR MONITORING DISPATCH HEALTH
-- =============================================

CREATE OR REPLACE VIEW v_dispatch_session_health AS
SELECT
  ds.id,
  ds.store_id,
  ds.session_code,
  ds.carrier_id,
  c.name as carrier_name,
  ds.dispatch_date,
  ds.status,
  ds.total_orders,
  ds.total_cod_expected,
  -- Calculate time since dispatch
  EXTRACT(EPOCH FROM (NOW() - ds.created_at)) / 3600 as hours_since_dispatch,
  -- Health status
  CASE
    WHEN ds.status = 'settled' THEN 'COMPLETED'
    WHEN ds.status = 'cancelled' THEN 'CANCELLED'
    WHEN EXTRACT(EPOCH FROM (NOW() - ds.created_at)) / 3600 > 72 THEN 'CRITICAL'
    WHEN EXTRACT(EPOCH FROM (NOW() - ds.created_at)) / 3600 > 48 THEN 'WARNING'
    ELSE 'OK'
  END as health_status,
  -- Count of pending orders
  (SELECT COUNT(*) FROM dispatch_session_orders dso
   WHERE dso.dispatch_session_id = ds.id AND dso.delivery_status = 'pending') as pending_orders,
  ds.created_at,
  ds.settled_at
FROM dispatch_sessions ds
JOIN carriers c ON c.id = ds.carrier_id
ORDER BY ds.dispatch_date DESC, ds.created_at DESC;

COMMENT ON VIEW v_dispatch_session_health IS
'Monitor health of dispatch sessions. Shows CRITICAL for sessions > 72h old, WARNING for > 48h.';

-- =============================================
-- 10. VIEW FOR SETTLEMENT DISCREPANCIES
-- =============================================

CREATE OR REPLACE VIEW v_settlement_discrepancies AS
SELECT
  s.id,
  s.store_id,
  s.settlement_code,
  c.name as carrier_name,
  s.settlement_date,
  s.total_cod_expected,
  s.total_cod_collected,
  s.total_cod_collected - COALESCE(s.total_cod_expected, s.total_cod_collected) as discrepancy,
  CASE
    WHEN s.total_cod_collected < COALESCE(s.total_cod_expected, s.total_cod_collected) THEN 'UNDER_COLLECTED'
    WHEN s.total_cod_collected > COALESCE(s.total_cod_expected, s.total_cod_collected) THEN 'OVER_COLLECTED'
    ELSE 'MATCH'
  END as discrepancy_type,
  s.notes,
  s.status
FROM daily_settlements s
JOIN carriers c ON c.id = s.carrier_id
WHERE s.total_cod_collected != COALESCE(s.total_cod_expected, s.total_cod_collected)
ORDER BY ABS(s.total_cod_collected - COALESCE(s.total_cod_expected, s.total_cod_collected)) DESC;

COMMENT ON VIEW v_settlement_discrepancies IS
'Shows settlements with COD discrepancies for investigation';

-- =============================================
-- VERIFICATION
-- =============================================

DO $$
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Migration 059 Verification';
  RAISE NOTICE '========================================';

  -- Verify trigger exists
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_prevent_duplicate_dispatch') THEN
    RAISE NOTICE 'OK: Duplicate dispatch prevention trigger exists';
  ELSE
    RAISE EXCEPTION 'FAILED: Duplicate dispatch prevention trigger not created';
  END IF;

  -- Verify status validation trigger
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_validate_dispatch_status') THEN
    RAISE NOTICE 'OK: Status validation trigger exists';
  ELSE
    RAISE EXCEPTION 'FAILED: Status validation trigger not created';
  END IF;

  -- Verify atomic settlement function
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'process_dispatch_settlement_atomic') THEN
    RAISE NOTICE 'OK: Atomic settlement function exists';
  ELSE
    RAISE EXCEPTION 'FAILED: Atomic settlement function not created';
  END IF;

  -- Verify new columns
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'daily_settlements' AND column_name = 'total_cod_expected') THEN
    RAISE NOTICE 'OK: total_cod_expected column exists';
  ELSE
    RAISE EXCEPTION 'FAILED: total_cod_expected column not created';
  END IF;

  RAISE NOTICE '========================================';
  RAISE NOTICE 'Migration 059 Complete!';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Production fixes applied:';
  RAISE NOTICE '1. Duplicate order dispatch prevention';
  RAISE NOTICE '2. Session code format (999/day)';
  RAISE NOTICE '3. Status transition validation';
  RAISE NOTICE '4. Carrier zone validation helpers';
  RAISE NOTICE '5. Improved settlement tracking columns';
  RAISE NOTICE '6. Carrier fee protection';
  RAISE NOTICE '7. Performance indexes';
  RAISE NOTICE '8. Atomic settlement processing';
  RAISE NOTICE '9. Health monitoring view';
  RAISE NOTICE '10. Discrepancy tracking view';
  RAISE NOTICE '========================================';
END $$;

COMMIT;

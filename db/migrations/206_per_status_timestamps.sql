-- ============================================================================
-- Migration 206: Dedicated per-status timestamps (additive, surgical)
-- ============================================================================
--
-- CONTEXT (status timeline precision, 2026-06-24)
--   Several order statuses never recorded their own timestamp. The status
--   flow has 14 states but only contacted/confirmed/in_transit/delivered/
--   cancelled wrote a dedicated *_at column. in_preparation, ready_to_ship,
--   out_for_delivery, rejected and returned had NO precise timestamp, so the
--   UI timeline could not show when those steps actually happened. incident
--   already has `incident_reported_at` (migration 175, timestamptz) and is
--   left untouched.
--
-- WHAT THIS DOES
--   1. Adds 5 new dedicated timestamp columns to `orders`, all TIMESTAMPTZ
--      (timezone-aware from birth, so reads are never ambiguous):
--        in_preparation_at, ready_to_ship_at, out_for_delivery_at,
--        rejected_at, returned_at
--   2. Installs ONE BEFORE INSERT/UPDATE trigger that stamps the matching
--      column with NOW() on the transition into each state. Centralizing this
--      in a trigger means EVERY write path is covered automatically (manual
--      PATCH, bulk actions, warehouse RPCs, returns RPC, webhooks) with no app
--      code change and no path that can silently forget the timestamp.
--   3. Backfills the new columns for existing orders from order_status_history
--      (the audit log already records every transition), so historical orders
--      show a correct timeline.
--
-- SURGICAL / NON-DESTRUCTIVE
--   - Purely additive. No existing column is altered, dropped or retyped.
--   - No view is touched. No data is deleted or moved.
--   - Existing app writes (contacted_at, confirmed_at, in_transit_at,
--     delivered_at, cancelled_at) keep working exactly as before. The trigger
--     only ever fills a NEW column when it is NULL, so it never overwrites a
--     value an app path may have set.
--   - out_for_delivery still also sets in_transit_at and rejected still also
--     sets cancelled_at in app code (unchanged); this migration just adds the
--     precise dedicated timestamps alongside.
--
-- IDEMPOTENT
--   - ADD COLUMN IF NOT EXISTS
--   - CREATE OR REPLACE FUNCTION + DROP/CREATE TRIGGER guard
--   - Backfill only writes where the target column IS NULL
--   - Re-running is a no-op
-- ============================================================================

BEGIN;

-- 1. New dedicated per-status timestamp columns (timezone-aware) --------------
ALTER TABLE orders ADD COLUMN IF NOT EXISTS in_preparation_at   TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ready_to_ship_at    TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS out_for_delivery_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS rejected_at         TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS returned_at         TIMESTAMPTZ;

COMMENT ON COLUMN orders.in_preparation_at   IS 'When the order entered in_preparation (warehouse picking started). Set by trigger fn_stamp_status_timestamp.';
COMMENT ON COLUMN orders.ready_to_ship_at    IS 'When the order became ready_to_ship (packing complete). Set by trigger fn_stamp_status_timestamp.';
COMMENT ON COLUMN orders.out_for_delivery_at IS 'When the order went out for delivery. Rarely written today (couriers do not report it) but ready for future carrier integrations.';
COMMENT ON COLUMN orders.rejected_at         IS 'When the order was rejected. Dedicated precise timestamp (cancelled_at is also set for back-compat).';
COMMENT ON COLUMN orders.returned_at         IS 'When the order was returned. Set by trigger on transition to returned (incl. complete_return_session RPC).';

-- 2. Centralized stamping trigger --------------------------------------------
--    Stamps the dedicated column on transition into each state, only when the
--    column is still NULL (never overwrites an explicit value). Covers all
--    write paths because it lives at the row level.
CREATE OR REPLACE FUNCTION fn_stamp_status_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'INSERT') OR (NEW.sleeves_status IS DISTINCT FROM OLD.sleeves_status) THEN
        IF NEW.sleeves_status = 'in_preparation'   AND NEW.in_preparation_at   IS NULL THEN NEW.in_preparation_at   := NOW(); END IF;
        IF NEW.sleeves_status = 'ready_to_ship'    AND NEW.ready_to_ship_at    IS NULL THEN NEW.ready_to_ship_at    := NOW(); END IF;
        IF NEW.sleeves_status = 'out_for_delivery' AND NEW.out_for_delivery_at IS NULL THEN NEW.out_for_delivery_at := NOW(); END IF;
        IF NEW.sleeves_status = 'rejected'         AND NEW.rejected_at         IS NULL THEN NEW.rejected_at         := NOW(); END IF;
        IF NEW.sleeves_status = 'returned'         AND NEW.returned_at         IS NULL THEN NEW.returned_at         := NOW(); END IF;
        -- incident already has incident_reported_at (mig 175); fill it if a
        -- path set the status but not the timestamp.
        IF NEW.sleeves_status = 'incident'         AND NEW.incident_reported_at IS NULL THEN NEW.incident_reported_at := NOW(); END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stamp_status_timestamp ON orders;
CREATE TRIGGER trg_stamp_status_timestamp
    BEFORE INSERT OR UPDATE OF sleeves_status ON orders
    FOR EACH ROW
    EXECUTE FUNCTION fn_stamp_status_timestamp();

-- 3. Backfill from the status audit log (order_status_history) ----------------
--    history.created_at is naive UTC wall-clock; reinterpret as UTC to get the
--    correct instant in the new TIMESTAMPTZ columns. Earliest transition into
--    each state wins. Only fills NULLs.
UPDATE orders o SET in_preparation_at = sub.ts
FROM (SELECT order_id, MIN(created_at) AT TIME ZONE 'UTC' AS ts
      FROM order_status_history WHERE new_status = 'in_preparation' GROUP BY order_id) sub
WHERE sub.order_id = o.id AND o.in_preparation_at IS NULL;

UPDATE orders o SET ready_to_ship_at = sub.ts
FROM (SELECT order_id, MIN(created_at) AT TIME ZONE 'UTC' AS ts
      FROM order_status_history WHERE new_status = 'ready_to_ship' GROUP BY order_id) sub
WHERE sub.order_id = o.id AND o.ready_to_ship_at IS NULL;

UPDATE orders o SET out_for_delivery_at = sub.ts
FROM (SELECT order_id, MIN(created_at) AT TIME ZONE 'UTC' AS ts
      FROM order_status_history WHERE new_status = 'out_for_delivery' GROUP BY order_id) sub
WHERE sub.order_id = o.id AND o.out_for_delivery_at IS NULL;

UPDATE orders o SET rejected_at = sub.ts
FROM (SELECT order_id, MIN(created_at) AT TIME ZONE 'UTC' AS ts
      FROM order_status_history WHERE new_status = 'rejected' GROUP BY order_id) sub
WHERE sub.order_id = o.id AND o.rejected_at IS NULL;

UPDATE orders o SET returned_at = sub.ts
FROM (SELECT order_id, MIN(created_at) AT TIME ZONE 'UTC' AS ts
      FROM order_status_history WHERE new_status = 'returned' GROUP BY order_id) sub
WHERE sub.order_id = o.id AND o.returned_at IS NULL;

-- Partial indexes to keep timeline/filtering queries cheap on the new columns
CREATE INDEX IF NOT EXISTS idx_orders_ready_to_ship_at ON orders(store_id, ready_to_ship_at) WHERE ready_to_ship_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_returned_at      ON orders(store_id, returned_at)      WHERE returned_at IS NOT NULL;

COMMIT;

-- ============================================================================
-- VERIFICATION (run manually after applying)
-- ----------------------------------------------------------------------------
-- 1. Columns exist and are timezone-aware:
--    SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_name='orders'
--      AND column_name IN ('in_preparation_at','ready_to_ship_at',
--                          'out_for_delivery_at','rejected_at','returned_at');
--    -- all rows must read 'timestamp with time zone'
--
-- 2. Trigger installed:
--    SELECT tgname FROM pg_trigger WHERE tgname='trg_stamp_status_timestamp';
--
-- 3. Backfill populated historical rows:
--    SELECT count(*) FILTER (WHERE ready_to_ship_at IS NOT NULL) AS rts,
--           count(*) FILTER (WHERE returned_at     IS NOT NULL) AS ret
--    FROM orders;
--
-- 4. Live stamp test (in a transaction you can roll back):
--    BEGIN;
--      UPDATE orders SET sleeves_status='ready_to_ship'
--      WHERE id = '<some-order>' RETURNING ready_to_ship_at;  -- must be ~now()
--    ROLLBACK;
-- ============================================================================

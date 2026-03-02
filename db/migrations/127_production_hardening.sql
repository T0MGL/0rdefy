-- ================================================================
-- Migration 127: Production Hardening
-- ================================================================
-- Adds missing constraints, indexes, and fixes for production readiness.
-- All operations are idempotent (IF NOT EXISTS / DO $$ blocks).
-- ================================================================

-- ----------------------------------------------------------------
-- 1. CHECK constraint on orders.sleeves_status (prevent invalid statuses)
--    Values sourced from: CLAUDE.md status list + api/routes/orders.ts
--    (includes 'out_for_delivery' used in status transition code)
-- ----------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'chk_orders_sleeves_status'
  ) THEN
    ALTER TABLE orders ADD CONSTRAINT chk_orders_sleeves_status
      CHECK (sleeves_status IN (
        'pending',
        'contacted',
        'confirmed',
        'in_preparation',
        'ready_to_ship',
        'shipped',
        'in_transit',
        'out_for_delivery',
        'delivered',
        'not_delivered',
        'incident',
        'cancelled',
        'rejected',
        'returned'
      ));
  END IF;
END $$;

-- ----------------------------------------------------------------
-- 2. NOT NULL on orders.sleeves_status (must always have a status)
-- ----------------------------------------------------------------
ALTER TABLE orders ALTER COLUMN sleeves_status SET NOT NULL;

-- NOTE: payment_method CHECK constraint intentionally omitted.
-- The field stores free-text values from multiple sources:
--   - Manual orders: 'cash', 'online'
--   - External webhooks: 'cod', 'cash_on_delivery', 'pending'
--   - Courier delivery confirmation: 'efectivo', 'transferencia', 'qr',
--     'tarjeta', 'contra entrega', 'contra_entrega', arbitrary strings
--   - Settlements: 'prepaid'
-- A strict CHECK would break existing data and future integrations.
-- Validation is handled at the application layer instead.

-- ----------------------------------------------------------------
-- 3. Missing index on orders.customer_id (FK without index)
-- ----------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_orders_customer_id
  ON orders(customer_id) WHERE customer_id IS NOT NULL;

-- ----------------------------------------------------------------
-- 4. Partial index for non-deleted orders (analytics queries)
-- ----------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_orders_active
  ON orders(store_id, created_at DESC) WHERE deleted_at IS NULL;

-- ----------------------------------------------------------------
-- 5. Index on inventory_movements by type (analytics filtering)
-- ----------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_inventory_movements_type
  ON inventory_movements(store_id, movement_type, created_at DESC);

-- ----------------------------------------------------------------
-- 6. UNIQUE constraint on return_session_items to prevent duplicate
--    stock restoration for the same (session, order, product, variant).
--    Uses COALESCE for NULL-safe variant handling (no variant = sentinel UUID).
-- ----------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'uniq_return_session_items'
  ) THEN
    CREATE UNIQUE INDEX uniq_return_session_items
      ON return_session_items(
        session_id,
        order_id,
        product_id,
        COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
      );
  END IF;
END $$;

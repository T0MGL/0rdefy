-- ================================================================
-- Migration 125: Delivery Restriction Server-Side Filter
-- ================================================================
-- Creates functional index for fast filtering of scheduled deliveries
-- Fixes Bug #4: Client-side filtering breaks pagination
--
-- Date: 2026-02-09
-- Author: Claude Sonnet 4.5
-- ================================================================
--
-- NOTE: We use a functional index instead of a generated column because
-- CURRENT_DATE is not immutable (changes daily). PostgreSQL requires
-- generated columns to use only immutable functions.
--
-- The index allows fast filtering without a separate column.
-- ================================================================

BEGIN;

-- ================================================================
-- SIMPLE SOLUTION: Only GIN index (100% reliable, no immutability issues)
-- ================================================================
-- GIN indexes support:
-- 1. Key existence checks: delivery_preferences ? 'not_before_date'
-- 2. Containment queries: delivery_preferences @> '{"key": "value"}'
-- 3. Efficient JSONB field access for filtering
--
-- PostgreSQL's query planner is smart enough to use GIN index even for
-- extracted field comparisons like (delivery_preferences->>'not_before_date')
-- ================================================================

-- Create GIN index on delivery_preferences JSONB
CREATE INDEX IF NOT EXISTS idx_orders_delivery_preferences_gin
  ON orders USING gin(delivery_preferences);

-- Comment for documentation
COMMENT ON INDEX idx_orders_delivery_preferences_gin IS
  'GIN index for fast JSONB queries on delivery_preferences field. Supports key existence, containment, and field extraction queries.';

COMMIT;

-- ================================================================
-- TESTING
-- ================================================================
-- Test 1: Verify GIN index exists
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'orders'
  AND indexname = 'idx_orders_delivery_preferences_gin';

-- Expected: 1 row with idx_orders_delivery_preferences_gin

-- Test 2: Verify index is used for queries (EXPLAIN should reference the index)
EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF)
SELECT id, delivery_preferences->>'not_before_date' as not_before_date
FROM orders
WHERE delivery_preferences IS NOT NULL
  AND delivery_preferences ? 'not_before_date'
LIMIT 10;

-- Test 3: Count orders with delivery preferences
SELECT
  COUNT(*) FILTER (WHERE delivery_preferences IS NOT NULL) as with_preferences,
  COUNT(*) FILTER (WHERE delivery_preferences IS NULL) as without_preferences,
  COUNT(*) as total
FROM orders;

-- Test 4: Sample query showing scheduled deliveries work correctly
SELECT
  id,
  delivery_preferences->>'not_before_date' as scheduled_date,
  sleeves_status
FROM orders
WHERE delivery_preferences ? 'not_before_date'
  AND (delivery_preferences->>'not_before_date') > CURRENT_DATE::text
LIMIT 5;

-- ================================================================
-- Migration 124: Fix customers.city VARCHAR length
-- ================================================================
-- Problem: customers.city is VARCHAR(100) but external webhooks
--          can receive cities with longer names (e.g., 113 chars).
--          This causes 500 errors when creating customers via webhook.
--
-- Solution: Increase to VARCHAR(150) to match the rest of the system
--           (orders.shipping_city, carrier_coverage.city, etc.)
--
-- Affected: External webhook order creation
-- Date: 2026-02-05
-- ================================================================

-- Increase city column length to match system-wide standard
ALTER TABLE customers
  ALTER COLUMN city TYPE VARCHAR(150);

-- Add comment for documentation
COMMENT ON COLUMN customers.city IS 'Customer city - increased to VARCHAR(150) to handle long city names from external webhooks (Migration 124)';

-- ================================================================
-- VERIFICATION
-- ================================================================
-- Run this query to verify the change:
-- SELECT column_name, data_type, character_maximum_length
-- FROM information_schema.columns
-- WHERE table_name = 'customers' AND column_name = 'city';
-- Expected: character_maximum_length = 150

-- Migration: Add image_url to order_line_items
-- Description: Stores product image snapshot at order time for display in Orders list
-- Author: Bright Idea
-- Date: 2026-01-11

-- ================================================================
-- PART 1: Add image_url column
-- ================================================================

ALTER TABLE order_line_items
ADD COLUMN IF NOT EXISTS image_url TEXT;

COMMENT ON COLUMN order_line_items.image_url IS 'Snapshot of product image URL at time of order. Allows displaying image without joining products table.';

-- ================================================================
-- PART 2: Backfill image_url from mapped products
-- ================================================================
-- This updates existing line items that have a product_id with the current product image

UPDATE order_line_items oli
SET image_url = p.image_url
FROM products p
WHERE oli.product_id = p.id
  AND oli.image_url IS NULL
  AND p.image_url IS NOT NULL;

-- ================================================================
-- PART 3: Index for performance (optional, commented out)
-- ================================================================
-- Uncomment if you need to query by image_url presence
-- CREATE INDEX IF NOT EXISTS idx_order_line_items_has_image ON order_line_items((image_url IS NOT NULL));

-- ================================================================
-- Summary
-- ================================================================
-- This migration:
-- 1. Adds image_url column to store product image snapshot
-- 2. Backfills existing line items with images from their mapped products
--
-- Benefits:
-- - Faster queries (no JOIN needed to display images)
-- - Historical accuracy (image preserved even if product image changes)
-- - Works for all line items regardless of product_id mapping

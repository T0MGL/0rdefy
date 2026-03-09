-- ============================================================
-- Migration 128: Snapshot unit_cost on order_line_items
-- ============================================================
-- PROBLEM: Changing a product's cost retroactively changes all
-- historical analytics (margin, profit, ROI) because analytics
-- JOINs to the products table for current costs.
--
-- SOLUTION: Store unit_cost as a snapshot at order creation time,
-- just like unit_price is already stored.
-- ============================================================

-- 1. Add unit_cost column (defaults to 0 for safety)
ALTER TABLE order_line_items
ADD COLUMN IF NOT EXISTS unit_cost DECIMAL(10,2) DEFAULT 0;

-- 2. Backfill existing line items with current product/variant costs
-- This is the best approximation for historical data
UPDATE order_line_items oli
SET unit_cost = COALESCE(
    -- Priority 1: variant cost (if variant_id exists and has cost)
    (SELECT pv.cost
     FROM product_variants pv
     WHERE pv.id = oli.variant_id
       AND pv.cost IS NOT NULL
       AND pv.cost > 0),
    -- Priority 2: product cost (base + packaging + additional)
    (SELECT COALESCE(p.cost, 0) + COALESCE(p.packaging_cost, 0) + COALESCE(p.additional_costs, 0)
     FROM products p
     WHERE p.id = oli.product_id),
    -- Priority 3: default 0
    0
)
WHERE oli.unit_cost = 0 OR oli.unit_cost IS NULL;

-- 3. Add to master migration table definition (comment for reference)
COMMENT ON COLUMN order_line_items.unit_cost IS 'Snapshot of product/variant cost at order creation time. Prevents retroactive analytics changes when product costs are updated.';

-- ================================================================
-- Migration: 155_fix_customer_stats_double_trigger.sql
-- Description: Fix customer total_orders double counting and blank names
-- Author: Bright Idea
-- Date: 2026-04-12
--
-- PROBLEM 1: customers.total_orders inflated
--   Three triggers were active on the orders table. TWO of them
--   incremented total_orders on every INSERT:
--     - trigger_update_customer_stats           (legacy, from master migration)
--     - trg_customer_stats_comprehensive        (migration 084)
--   Root cause: master migration was re-executed after 084, which
--   recreated the legacy trigger that 084 had dropped. Both coexisted.
--   Effect: every new order counted twice; Shopify-imported customers
--   got pre-seeded orders_count + 2 per imported order.
--
-- PROBLEM 2: customers.first_name and last_name are NULL
--   shopify-import.service.ts#upsertCustomer only wrote the "name"
--   column. The UI reads first_name/last_name, so names render blank.
--
-- FIX:
--   1) Drop the legacy triggers and their backing functions
--   2) Backfill first_name/last_name from the name column when missing
--   3) Recalculate total_orders and total_spent from the orders table
-- ================================================================

-- ================================================================
-- PART 1: Drop legacy duplicate triggers
-- ================================================================

DROP TRIGGER IF EXISTS trigger_update_customer_stats ON orders;
DROP TRIGGER IF EXISTS trigger_update_customer_stats_on_update ON orders;
DROP TRIGGER IF EXISTS trg_update_customer_stats ON orders;
DROP TRIGGER IF EXISTS trg_update_customer_stats_on_update ON orders;

DROP FUNCTION IF EXISTS fn_update_customer_stats();
DROP FUNCTION IF EXISTS fn_update_customer_stats_on_update();

-- Ensure the comprehensive trigger exists (idempotent safety net)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_customer_stats_comprehensive'
          AND tgrelid = 'orders'::regclass
    ) THEN
        RAISE EXCEPTION 'trg_customer_stats_comprehensive is missing. Run migration 084 first.';
    END IF;
END $$;

-- ================================================================
-- PART 2: Backfill first_name / last_name from name column
-- ================================================================
-- Splits "First Middle Last" into first_name="First", last_name="Middle Last".
-- Handles single-word names (everything goes to first_name, last_name empty).
-- Only touches rows where first_name is NULL/empty and name has a value.

UPDATE customers
SET
    first_name = CASE
        WHEN position(' ' IN TRIM(name)) > 0
        THEN split_part(TRIM(name), ' ', 1)
        ELSE TRIM(name)
    END,
    last_name = CASE
        WHEN position(' ' IN TRIM(name)) > 0
        THEN TRIM(substring(TRIM(name) FROM position(' ' IN TRIM(name)) + 1))
        ELSE ''
    END,
    updated_at = NOW()
WHERE (first_name IS NULL OR first_name = '')
  AND name IS NOT NULL
  AND TRIM(name) <> '';

-- ================================================================
-- PART 3: Recalculate total_orders and total_spent from actual orders
-- ================================================================
-- Only counts orders that are not cancelled/rejected and not soft-deleted.
-- Mirrors the logic in fn_update_customer_stats_comprehensive so future
-- trigger updates stay consistent with the backfilled snapshot.

WITH calculated_stats AS (
    SELECT
        c.id AS customer_id,
        COUNT(o.id) FILTER (
            WHERE o.sleeves_status NOT IN ('cancelled', 'rejected')
              AND o.deleted_at IS NULL
        ) AS actual_orders,
        COALESCE(SUM(o.total_price) FILTER (
            WHERE o.sleeves_status NOT IN ('cancelled', 'rejected')
              AND o.deleted_at IS NULL
        ), 0) AS actual_spent,
        MAX(o.created_at) FILTER (
            WHERE o.sleeves_status NOT IN ('cancelled', 'rejected')
              AND o.deleted_at IS NULL
        ) AS actual_last_order_at
    FROM customers c
    LEFT JOIN orders o ON o.customer_id = c.id
    GROUP BY c.id
)
UPDATE customers c
SET
    total_orders = cs.actual_orders::INT,
    total_spent = cs.actual_spent,
    last_order_at = cs.actual_last_order_at,
    updated_at = NOW()
FROM calculated_stats cs
WHERE c.id = cs.customer_id
  AND (
      c.total_orders IS DISTINCT FROM cs.actual_orders::INT
      OR c.total_spent IS DISTINCT FROM cs.actual_spent
      OR c.last_order_at IS DISTINCT FROM cs.actual_last_order_at
  );

-- ================================================================
-- PART 4: Audit log
-- ================================================================

DO $$
DECLARE
    v_total_customers INTEGER;
    v_with_names INTEGER;
    v_with_stats_match INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_total_customers FROM customers;

    SELECT COUNT(*) INTO v_with_names
    FROM customers
    WHERE first_name IS NOT NULL AND first_name <> '';

    SELECT COUNT(*) INTO v_with_stats_match
    FROM customers c
    WHERE c.total_orders = (
        SELECT COUNT(*) FROM orders o
        WHERE o.customer_id = c.id
          AND o.deleted_at IS NULL
          AND o.sleeves_status NOT IN ('cancelled', 'rejected')
    );

    RAISE NOTICE 'Migration 155 complete: %/% customers have first_name, %/% have accurate total_orders',
        v_with_names, v_total_customers, v_with_stats_match, v_total_customers;
END $$;

COMMENT ON FUNCTION fn_update_customer_stats_comprehensive IS
'Customer stats management. Handles INSERT, UPDATE (cancellation/uncancellation/customer change/total change), and DELETE. Must be the ONLY trigger incrementing customers.total_orders. If you re-add a legacy trigger you will double count. (Migration 155)';

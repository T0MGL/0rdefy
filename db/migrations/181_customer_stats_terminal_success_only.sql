-- ============================================================================
-- Migration 181 — customer.total_orders / total_spent counts only terminal-success
-- ============================================================================
-- Problem (audit findings D11, D12, D13)
--   The trigger fn_update_customer_stats_comprehensive (migration 084) filters
--   only `NOT IN ('cancelled','rejected')`, which means a customer's
--   total_spent and total_orders include pending orders, in_transit pipeline
--   orders, returned orders, delivery_failed orders, and not_delivered orders.
--   The audit's D11/D12/D13 documented up to 30% inflation on stores with
--   meaningful return or pending volume. customers.avg_lifetime_value (the
--   "LTV" card on Customers page) is built from total_spent, so the inflated
--   number is what the merchant sees as their LTV.
--
-- Fix
--   The canonical revenue / LTV definition (see api/utils/metrics-canonical.ts
--   section 3.13) only counts orders in terminal-success states: 'delivered'
--   and 'settled'. This migration:
--     1. Replaces fn_update_customer_stats_comprehensive with a version that
--        counts ONLY orders whose sleeves_status is in
--        ('delivered','settled'), so stats only move when a sale terminally
--        succeeds.
--     2. Recalculates total_orders, total_spent, last_order_at for every
--        customer using the same filter.
--     3. Records the rebuild in an audit notice for ops follow-up.
--
-- Side effects
--   total_orders and total_spent values are guaranteed to drop or stay equal
--   on stores that have any history of pending/returned/in-transit orders.
--   This is the intended fix: the inflated figure was wrong. Dashboards that
--   read from customers (Customers page totals, RevenueIntelligence
--   avgRevenuePerCustomer, get_customer_stats RPC) align with the canonical
--   revenue formula after this runs.
--
-- Idempotent
--   Re-running this migration is a no-op for the function (CREATE OR REPLACE)
--   and rebuilds the customers stats with the same filter (deterministic).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Replace the trigger function. Same control flow as 084 but with the
--    canonical "should count" predicate.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_update_customer_stats_comprehensive()
RETURNS TRIGGER AS $$
DECLARE
    v_old_customer_id UUID;
    v_new_customer_id UUID;
    v_old_total DECIMAL(10,2);
    v_new_total DECIMAL(10,2);
    v_old_status TEXT;
    v_new_status TEXT;
    v_should_count_old BOOLEAN;
    v_should_count_new BOOLEAN;
BEGIN
    -- Canonical: terminal-success states ONLY. delivered = pre-148c terminal,
    -- settled = post-148c paid-by-carrier. Anything else is inflight or
    -- failure and does NOT count toward LTV / total_spent / total_orders.

    IF TG_OP = 'INSERT' THEN
        v_new_customer_id := NEW.customer_id;
        v_new_total := COALESCE(NEW.total_price, 0);
        v_new_status := COALESCE(NEW.sleeves_status, 'pending');

        v_should_count_new := v_new_status IN ('delivered', 'settled');

        IF v_new_customer_id IS NOT NULL AND v_should_count_new THEN
            UPDATE customers
            SET
                total_orders = total_orders + 1,
                total_spent = total_spent + v_new_total,
                last_order_at = NOW(),
                updated_at = NOW()
            WHERE id = v_new_customer_id;
        END IF;

        RETURN NEW;

    ELSIF TG_OP = 'UPDATE' THEN
        v_old_customer_id := OLD.customer_id;
        v_new_customer_id := NEW.customer_id;
        v_old_total := COALESCE(OLD.total_price, 0);
        v_new_total := COALESCE(NEW.total_price, 0);
        v_old_status := COALESCE(OLD.sleeves_status, 'pending');
        v_new_status := COALESCE(NEW.sleeves_status, 'pending');

        v_should_count_old := v_old_status IN ('delivered', 'settled');
        v_should_count_new := v_new_status IN ('delivered', 'settled');

        -- Transition out of terminal success (e.g. delivered -> returned, or
        -- merchant flagged delivered -> cancelled): subtract the snapshot.
        IF v_should_count_old AND NOT v_should_count_new THEN
            IF v_old_customer_id IS NOT NULL THEN
                UPDATE customers
                SET
                    total_orders = GREATEST(0, total_orders - 1),
                    total_spent = GREATEST(0, total_spent - v_old_total),
                    updated_at = NOW()
                WHERE id = v_old_customer_id;
            END IF;

        -- Transition into terminal success (e.g. in_transit -> delivered):
        -- credit the customer.
        ELSIF NOT v_should_count_old AND v_should_count_new THEN
            IF v_new_customer_id IS NOT NULL THEN
                UPDATE customers
                SET
                    total_orders = total_orders + 1,
                    total_spent = total_spent + v_new_total,
                    last_order_at = NOW(),
                    updated_at = NOW()
                WHERE id = v_new_customer_id;
            END IF;

        -- Customer reassigned while order is in terminal success.
        ELSIF v_old_customer_id IS DISTINCT FROM v_new_customer_id AND v_should_count_new THEN
            IF v_old_customer_id IS NOT NULL AND v_should_count_old THEN
                UPDATE customers
                SET
                    total_orders = GREATEST(0, total_orders - 1),
                    total_spent = GREATEST(0, total_spent - v_old_total),
                    updated_at = NOW()
                WHERE id = v_old_customer_id;
            END IF;

            IF v_new_customer_id IS NOT NULL THEN
                UPDATE customers
                SET
                    total_orders = total_orders + 1,
                    total_spent = total_spent + v_new_total,
                    last_order_at = NOW(),
                    updated_at = NOW()
                WHERE id = v_new_customer_id;
            END IF;

        -- total_price edited on an order that is and stays in terminal success.
        ELSIF v_old_total IS DISTINCT FROM v_new_total AND v_should_count_new THEN
            IF v_new_customer_id IS NOT NULL THEN
                UPDATE customers
                SET
                    total_spent = GREATEST(0, total_spent - v_old_total + v_new_total),
                    updated_at = NOW()
                WHERE id = v_new_customer_id;
            END IF;
        END IF;

        RETURN NEW;

    ELSIF TG_OP = 'DELETE' THEN
        v_old_customer_id := OLD.customer_id;
        v_old_total := COALESCE(OLD.total_price, 0);
        v_old_status := COALESCE(OLD.sleeves_status, 'pending');

        v_should_count_old := v_old_status IN ('delivered', 'settled');

        IF v_old_customer_id IS NOT NULL AND v_should_count_old THEN
            UPDATE customers
            SET
                total_orders = GREATEST(0, total_orders - 1),
                total_spent = GREATEST(0, total_spent - v_old_total),
                updated_at = NOW()
            WHERE id = v_old_customer_id;
        END IF;

        RETURN OLD;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 2. Backfill every customer using the new filter.
-- ----------------------------------------------------------------------------

WITH calculated_stats AS (
    SELECT
        c.id AS customer_id,
        COUNT(o.id) FILTER (
            WHERE o.sleeves_status IN ('delivered', 'settled')
              AND o.deleted_at IS NULL
        )::INT AS actual_orders,
        COALESCE(SUM(o.total_price) FILTER (
            WHERE o.sleeves_status IN ('delivered', 'settled')
              AND o.deleted_at IS NULL
        ), 0) AS actual_spent,
        MAX(o.created_at) FILTER (
            WHERE o.sleeves_status IN ('delivered', 'settled')
              AND o.deleted_at IS NULL
        ) AS actual_last_order_at
    FROM customers c
    LEFT JOIN orders o ON o.customer_id = c.id
    GROUP BY c.id
)
UPDATE customers c
SET
    total_orders = cs.actual_orders,
    total_spent = cs.actual_spent,
    last_order_at = cs.actual_last_order_at,
    updated_at = NOW()
FROM calculated_stats cs
WHERE c.id = cs.customer_id
  AND (
      c.total_orders IS DISTINCT FROM cs.actual_orders
      OR c.total_spent IS DISTINCT FROM cs.actual_spent
      OR c.last_order_at IS DISTINCT FROM cs.actual_last_order_at
  );

-- ----------------------------------------------------------------------------
-- 3. Audit notice for ops.
-- ----------------------------------------------------------------------------

DO $$
DECLARE
    v_total_customers INTEGER;
    v_with_orders INTEGER;
    v_total_spent_sum NUMERIC;
BEGIN
    SELECT COUNT(*), COUNT(*) FILTER (WHERE total_orders > 0), COALESCE(SUM(total_spent), 0)
      INTO v_total_customers, v_with_orders, v_total_spent_sum
      FROM customers;

    RAISE NOTICE 'Migration 181 complete: % customers total, % with delivered+settled orders, total_spent_sum=%',
        v_total_customers, v_with_orders, v_total_spent_sum;
END $$;

COMMENT ON FUNCTION fn_update_customer_stats_comprehensive IS
    'Customer stats trigger (Migration 181 canonical filter). Counts only orders in terminal-success states: delivered + settled. Pending, in_transit, returned, delivery_failed, cancelled, and rejected orders never inflate total_orders / total_spent. This is the source of truth for customers.total_spent which feeds the Customers page and avg_lifetime_value. Replaces the wider NOT IN (cancelled, rejected) filter from migration 084.';

COMMIT;

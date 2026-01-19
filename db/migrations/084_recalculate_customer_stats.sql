-- ================================================================
-- Migration: 084_recalculate_customer_stats.sql
-- Description: Recalculate customer total_orders and total_spent
--              from actual orders data to fix discrepancies
-- Author: Bright Idea
-- Date: 2026-01-19
--
-- PROBLEM: Customer stats (total_orders, total_spent) are out of sync
--          with actual order data. Many customers show 2 orders when
--          they only have 1 order, or incorrect amounts.
--
-- CAUSE: Various scenarios caused desync:
--        - Shopify imports that didn't trigger stats update
--        - Old triggers that didn't handle all edge cases
--        - Order deletions/cancellations not properly updating stats
--
-- SOLUTION: Recalculate all customer stats from orders table
-- ================================================================

-- ================================================================
-- PART 1: Recalculate all customer stats
-- ================================================================

-- This CTE-based update recalculates stats from the orders table
-- Only counts orders that are NOT cancelled/rejected and NOT soft-deleted
WITH calculated_stats AS (
    SELECT
        c.id AS customer_id,
        c.store_id,
        COUNT(o.id) FILTER (
            WHERE o.sleeves_status NOT IN ('cancelled', 'rejected')
              AND o.deleted_at IS NULL
        ) AS actual_orders,
        COALESCE(SUM(o.total_price) FILTER (
            WHERE o.sleeves_status NOT IN ('cancelled', 'rejected')
              AND o.deleted_at IS NULL
        ), 0) AS actual_spent,
        -- Keep track of old values for logging
        c.total_orders AS old_orders,
        c.total_spent AS old_spent
    FROM customers c
    LEFT JOIN orders o ON o.customer_id = c.id
    GROUP BY c.id, c.store_id, c.total_orders, c.total_spent
)
UPDATE customers c
SET
    total_orders = cs.actual_orders::INT,
    total_spent = cs.actual_spent,
    updated_at = NOW()
FROM calculated_stats cs
WHERE c.id = cs.customer_id
  AND (c.total_orders != cs.actual_orders OR c.total_spent != cs.actual_spent);

-- ================================================================
-- PART 2: Log the results for audit
-- ================================================================

-- Create a temporary view to show what was fixed (optional - for verification)
DO $$
DECLARE
    v_fixed_count INTEGER;
BEGIN
    -- Count how many customers had incorrect stats before the fix
    -- (This runs AFTER the update, so we're just logging it happened)
    SELECT COUNT(*) INTO v_fixed_count
    FROM customers
    WHERE updated_at >= NOW() - INTERVAL '1 minute';

    RAISE NOTICE 'Customer stats recalculation complete. % customers updated.', v_fixed_count;
END $$;

-- ================================================================
-- PART 3: Ensure the comprehensive trigger is in place
-- ================================================================

-- Make sure the comprehensive trigger exists and replaces old triggers
DROP TRIGGER IF EXISTS trg_update_customer_stats ON orders;
DROP TRIGGER IF EXISTS trg_update_customer_stats_on_update ON orders;
DROP TRIGGER IF EXISTS trigger_update_customer_stats ON orders;
DROP TRIGGER IF EXISTS trigger_update_customer_stats_on_update ON orders;

-- Recreate the comprehensive function (idempotent)
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
    -- Statuses that should NOT count towards customer stats
    -- cancelled, rejected orders should not count

    IF TG_OP = 'INSERT' THEN
        v_new_customer_id := NEW.customer_id;
        v_new_total := COALESCE(NEW.total_price, 0);
        v_new_status := COALESCE(NEW.sleeves_status, 'pending');

        -- Only count if not cancelled/rejected
        v_should_count_new := v_new_status NOT IN ('cancelled', 'rejected');

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

        v_should_count_old := v_old_status NOT IN ('cancelled', 'rejected');
        v_should_count_new := v_new_status NOT IN ('cancelled', 'rejected');

        -- Case 1: Order was cancelled/rejected (restore stats)
        IF v_should_count_old AND NOT v_should_count_new THEN
            IF v_old_customer_id IS NOT NULL THEN
                UPDATE customers
                SET
                    total_orders = GREATEST(0, total_orders - 1),
                    total_spent = GREATEST(0, total_spent - v_old_total),
                    updated_at = NOW()
                WHERE id = v_old_customer_id;
            END IF;

        -- Case 2: Order was un-cancelled (recount stats)
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

        -- Case 3: Customer changed on active order
        ELSIF v_old_customer_id IS DISTINCT FROM v_new_customer_id AND v_should_count_new THEN
            -- Remove from old customer
            IF v_old_customer_id IS NOT NULL AND v_should_count_old THEN
                UPDATE customers
                SET
                    total_orders = GREATEST(0, total_orders - 1),
                    total_spent = GREATEST(0, total_spent - v_old_total),
                    updated_at = NOW()
                WHERE id = v_old_customer_id;
            END IF;

            -- Add to new customer
            IF v_new_customer_id IS NOT NULL THEN
                UPDATE customers
                SET
                    total_orders = total_orders + 1,
                    total_spent = total_spent + v_new_total,
                    last_order_at = NOW(),
                    updated_at = NOW()
                WHERE id = v_new_customer_id;
            END IF;

        -- Case 4: Total price changed on active order (same customer)
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

        -- Only subtract if order was not already cancelled
        v_should_count_old := v_old_status NOT IN ('cancelled', 'rejected');

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

-- Create the comprehensive trigger (if not exists)
DROP TRIGGER IF EXISTS trg_customer_stats_comprehensive ON orders;
CREATE TRIGGER trg_customer_stats_comprehensive
    AFTER INSERT OR UPDATE OR DELETE
    ON orders
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_customer_stats_comprehensive();

-- ================================================================
-- COMMENTS
-- ================================================================

COMMENT ON FUNCTION fn_update_customer_stats_comprehensive IS
'Comprehensive customer stats management:
- Increments stats on new orders (except cancelled/rejected)
- Decrements stats when order is cancelled/rejected
- Handles customer_id changes
- Handles total_price changes
- Decrements stats on order deletion
- Uses GREATEST(0, ...) to prevent negative values';

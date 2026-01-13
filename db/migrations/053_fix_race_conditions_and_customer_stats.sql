-- ================================================================
-- Migration: 053_fix_race_conditions_and_customer_stats.sql
-- Description: Fix race conditions in stock/customer operations and
--              restore customer stats on order cancellation/deletion
-- Author: Bright Idea
-- Date: 2026-01-12
--
-- FIXES:
-- 1. Race condition in customer creation (two orders same phone)
-- 2. Customer stats NOT restored on order cancellation
-- 3. Customer stats NOT restored on order hard delete
-- 4. Atomic customer lookup/creation with advisory locks
-- 5. Improved stock concurrency with better error handling
-- ================================================================

-- ================================================================
-- PART 1: Function to find or create customer atomically
-- Uses advisory locks to prevent race conditions
-- ================================================================

CREATE OR REPLACE FUNCTION find_or_create_customer_atomic(
    p_store_id UUID,
    p_phone TEXT,
    p_email TEXT,
    p_first_name TEXT DEFAULT NULL,
    p_last_name TEXT DEFAULT NULL,
    p_address TEXT DEFAULT NULL,
    p_city TEXT DEFAULT NULL,
    p_country TEXT DEFAULT 'Paraguay'
)
RETURNS UUID AS $$
DECLARE
    v_customer_id UUID;
    v_lock_key BIGINT;
    v_name TEXT;
BEGIN
    -- Generate a lock key based on store_id and phone/email
    -- This ensures only one process can create a customer with same identifiers
    v_lock_key := hashtext(p_store_id::TEXT || COALESCE(p_phone, '') || COALESCE(p_email, ''));

    -- Acquire advisory lock (waits if another process has it)
    PERFORM pg_advisory_xact_lock(v_lock_key);

    -- Build name from parts
    v_name := NULLIF(TRIM(COALESCE(p_first_name, '') || ' ' || COALESCE(p_last_name, '')), '');

    -- Try to find by phone first (most reliable identifier)
    IF p_phone IS NOT NULL AND p_phone <> '' THEN
        SELECT id INTO v_customer_id
        FROM customers
        WHERE store_id = p_store_id
          AND phone = p_phone
        LIMIT 1;

        IF v_customer_id IS NOT NULL THEN
            RETURN v_customer_id;
        END IF;
    END IF;

    -- Try to find by email (case-insensitive)
    IF p_email IS NOT NULL AND p_email <> '' THEN
        SELECT id INTO v_customer_id
        FROM customers
        WHERE store_id = p_store_id
          AND LOWER(email) = LOWER(p_email)
        LIMIT 1;

        IF v_customer_id IS NOT NULL THEN
            RETURN v_customer_id;
        END IF;
    END IF;

    -- Customer not found, create new one
    INSERT INTO customers (
        store_id, phone, email, name,
        first_name, last_name, address, city, country,
        total_orders, total_spent
    ) VALUES (
        p_store_id,
        NULLIF(p_phone, ''),
        NULLIF(p_email, ''),
        v_name,
        p_first_name,
        p_last_name,
        p_address,
        p_city,
        p_country,
        0,
        0
    )
    RETURNING id INTO v_customer_id;

    RETURN v_customer_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION find_or_create_customer_atomic IS
'Atomically finds or creates a customer using advisory locks to prevent race conditions.
Two concurrent orders with the same phone/email will both get the same customer_id.';

-- ================================================================
-- PART 2: Improved customer stats function with cancellation support
-- ================================================================

-- Drop existing triggers first
DROP TRIGGER IF EXISTS trg_update_customer_stats ON orders;
DROP TRIGGER IF EXISTS trg_update_customer_stats_on_update ON orders;

-- New comprehensive function that handles INSERT, UPDATE, and DELETE
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

COMMENT ON FUNCTION fn_update_customer_stats_comprehensive IS
'Comprehensive customer stats management:
- Increments stats on new orders (except cancelled/rejected)
- Decrements stats when order is cancelled/rejected
- Handles customer_id changes
- Handles total_price changes
- Decrements stats on order deletion
- Uses GREATEST(0, ...) to prevent negative values';

-- ================================================================
-- PART 3: Create new trigger for comprehensive stats
-- ================================================================

CREATE TRIGGER trg_customer_stats_comprehensive
    AFTER INSERT OR UPDATE OR DELETE
    ON orders
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_customer_stats_comprehensive();

-- ================================================================
-- PART 4: Update cascade_delete_order_data to restore customer stats
-- ================================================================

-- The existing cascade_delete_order_data function in migration 039
-- already handles stock restoration but not customer stats.
-- The new trigger above handles DELETE, so customer stats are now covered.

-- ================================================================
-- PART 5: Function for atomic stock adjustment with validation
-- ================================================================

CREATE OR REPLACE FUNCTION adjust_product_stock_atomic(
    p_product_id UUID,
    p_store_id UUID,
    p_quantity_change INT,
    p_movement_type TEXT,
    p_order_id UUID DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS TABLE (
    success BOOLEAN,
    new_stock INT,
    error_message TEXT
) AS $$
DECLARE
    v_current_stock INT;
    v_new_stock INT;
BEGIN
    -- Lock the product row to prevent concurrent modifications
    SELECT stock INTO v_current_stock
    FROM products
    WHERE id = p_product_id AND store_id = p_store_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, 0, 'Product not found'::TEXT;
        RETURN;
    END IF;

    -- Calculate new stock
    v_new_stock := v_current_stock + p_quantity_change;

    -- Prevent negative stock (optional - can be made configurable)
    IF v_new_stock < 0 THEN
        RETURN QUERY SELECT FALSE, v_current_stock,
            format('Insufficient stock. Current: %s, Requested change: %s', v_current_stock, p_quantity_change)::TEXT;
        RETURN;
    END IF;

    -- Update stock
    UPDATE products
    SET stock = v_new_stock, updated_at = NOW()
    WHERE id = p_product_id AND store_id = p_store_id;

    -- Log the movement
    INSERT INTO inventory_movements (
        store_id, product_id, order_id,
        quantity_change, stock_before, stock_after,
        movement_type, notes
    ) VALUES (
        p_store_id, p_product_id, p_order_id,
        p_quantity_change, v_current_stock, v_new_stock,
        p_movement_type, p_notes
    );

    RETURN QUERY SELECT TRUE, v_new_stock, NULL::TEXT;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION adjust_product_stock_atomic IS
'Atomically adjusts product stock with row-level locking.
Returns success/failure status, new stock value, and error message.
Prevents negative stock and logs all movements.';

-- ================================================================
-- PART 6: Function to recalculate customer stats (for data repair)
-- ================================================================

CREATE OR REPLACE FUNCTION recalculate_customer_stats(p_customer_id UUID DEFAULT NULL)
RETURNS TABLE (
    customer_id UUID,
    old_total_orders INT,
    new_total_orders BIGINT,
    old_total_spent DECIMAL(10,2),
    new_total_spent DECIMAL(10,2)
) AS $$
BEGIN
    RETURN QUERY
    WITH customer_orders AS (
        SELECT
            c.id AS cust_id,
            c.total_orders AS old_orders,
            c.total_spent AS old_spent,
            COUNT(o.id) FILTER (WHERE o.sleeves_status NOT IN ('cancelled', 'rejected')) AS calc_orders,
            COALESCE(SUM(o.total_price) FILTER (WHERE o.sleeves_status NOT IN ('cancelled', 'rejected')), 0) AS calc_spent
        FROM customers c
        LEFT JOIN orders o ON o.customer_id = c.id AND o.deleted_at IS NULL
        WHERE p_customer_id IS NULL OR c.id = p_customer_id
        GROUP BY c.id, c.total_orders, c.total_spent
    )
    UPDATE customers c
    SET
        total_orders = co.calc_orders::INT,
        total_spent = co.calc_spent,
        updated_at = NOW()
    FROM customer_orders co
    WHERE c.id = co.cust_id
      AND (c.total_orders != co.calc_orders OR c.total_spent != co.calc_spent)
    RETURNING c.id, co.old_orders, co.calc_orders, co.old_spent, co.calc_spent;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION recalculate_customer_stats IS
'Recalculates customer stats from actual orders.
Use without parameter to fix all customers, or pass customer_id to fix one.
Only updates if there is a discrepancy.';

-- ================================================================
-- PART 7: Indexes to improve performance
-- ================================================================

-- Index for faster customer lookup by phone
CREATE INDEX IF NOT EXISTS idx_customers_store_phone_lookup
ON customers(store_id, phone)
WHERE phone IS NOT NULL AND phone <> '';

-- Index for faster customer lookup by email (case-insensitive)
CREATE INDEX IF NOT EXISTS idx_customers_store_email_lower
ON customers(store_id, LOWER(email))
WHERE email IS NOT NULL AND email <> '';

-- Index for faster order stats calculation
CREATE INDEX IF NOT EXISTS idx_orders_customer_stats
ON orders(customer_id, sleeves_status, total_price)
WHERE deleted_at IS NULL;

-- ================================================================
-- PART 8: Grant permissions
-- ================================================================

GRANT EXECUTE ON FUNCTION find_or_create_customer_atomic TO authenticated;
GRANT EXECUTE ON FUNCTION find_or_create_customer_atomic TO service_role;

GRANT EXECUTE ON FUNCTION adjust_product_stock_atomic TO authenticated;
GRANT EXECUTE ON FUNCTION adjust_product_stock_atomic TO service_role;

GRANT EXECUTE ON FUNCTION recalculate_customer_stats TO authenticated;
GRANT EXECUTE ON FUNCTION recalculate_customer_stats TO service_role;

-- ================================================================
-- PART 9: Run initial recalculation to fix any existing discrepancies
-- ================================================================

-- This will fix any customers with incorrect stats
-- SELECT * FROM recalculate_customer_stats();

-- ================================================================
-- COMMENTS
-- ================================================================

COMMENT ON TRIGGER trg_customer_stats_comprehensive ON orders IS
'Maintains accurate customer statistics:
- Handles INSERT: adds to stats (except cancelled orders)
- Handles UPDATE: adjusts for cancellations, customer changes, price changes
- Handles DELETE: removes from stats
- Always uses GREATEST(0, ...) to prevent negative values';

-- ================================================================
-- FIX: Customer Stats COALESCE Type Mismatch (CRITICAL)
-- ================================================================
-- Problem: COALESCE(NEW.total_price, 0) in fn_update_customer_stats causes:
--   "COALESCE types integer and text cannot be matched"
-- Solution: Use 0.0 (DECIMAL) instead of 0 (INTEGER)
-- Date: 2025-12-04
-- ================================================================

CREATE OR REPLACE FUNCTION fn_update_customer_stats()
RETURNS TRIGGER AS $$
DECLARE
    v_customer_id UUID;
BEGIN
    -- Find or create customer based on email or phone
    SELECT id INTO v_customer_id
    FROM customers
    WHERE store_id = NEW.store_id
    AND (
        (NEW.customer_email IS NOT NULL AND email = NEW.customer_email)
        OR (NEW.customer_phone IS NOT NULL AND phone = NEW.customer_phone)
    )
    LIMIT 1;

    -- If customer doesn't exist, create them
    IF v_customer_id IS NULL THEN
        INSERT INTO customers (
            store_id,
            shopify_customer_id,
            email,
            phone,
            first_name,
            last_name,
            total_orders,
            total_spent,
            last_order_at,
            created_at,
            updated_at
        ) VALUES (
            NEW.store_id,
            NULL, -- Will be updated by Shopify sync if available
            NEW.customer_email,
            NEW.customer_phone,
            NEW.customer_first_name,
            NEW.customer_last_name,
            1,
            COALESCE(NEW.total_price, 0.0), -- FIXED: 0.0 instead of 0
            NEW.created_at,
            NOW(),
            NOW()
        )
        RETURNING id INTO v_customer_id;

        -- Link order to newly created customer
        UPDATE orders SET customer_id = v_customer_id WHERE id = NEW.id;
    ELSE
        -- Update existing customer stats
        UPDATE customers
        SET
            total_orders = total_orders + 1,
            total_spent = total_spent + COALESCE(NEW.total_price, 0.0), -- FIXED: 0.0 instead of 0
            last_order_at = NEW.created_at,
            -- Update name if not set
            first_name = COALESCE(first_name, NEW.customer_first_name),
            last_name = COALESCE(last_name, NEW.customer_last_name),
            updated_at = NOW()
        WHERE id = v_customer_id;

        -- Link order to customer if not already linked
        IF NEW.customer_id IS NULL THEN
            UPDATE orders SET customer_id = v_customer_id WHERE id = NEW.id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- MIGRATION COMPLETE
-- ================================================================

COMMENT ON FUNCTION fn_update_customer_stats IS 'Ordefy: Auto-update customer stats on new orders (FIXED: COALESCE type mismatch)';

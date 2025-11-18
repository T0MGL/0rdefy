-- ================================================================
-- NEONFLOW - DATABASE TRIGGERS
-- ================================================================
-- Automated event handling for order status changes and customer stats
-- ================================================================

-- ================================================================
-- TRIGGER 1: log_order_status_change
-- ================================================================
-- Automatically log all order status changes to order_status_history
-- Detects if change was made by n8n (no changed_by value)
-- ================================================================

CREATE OR REPLACE FUNCTION fn_log_order_status_change()
RETURNS TRIGGER AS $$
BEGIN
    -- Only log if sleeves_status actually changed
    IF OLD.sleeves_status IS DISTINCT FROM NEW.sleeves_status THEN
        INSERT INTO order_status_history (
            order_id,
            store_id,
            previous_status,
            new_status,
            changed_by,
            changed_by_n8n,
            change_source,
            notes,
            created_at
        ) VALUES (
            NEW.id,
            NEW.store_id,
            OLD.sleeves_status,
            NEW.sleeves_status,
            COALESCE(NEW.confirmed_by, 'unknown'),
            (NEW.confirmed_by IS NULL), -- TRUE if no confirmed_by means n8n changed it
            CASE
                WHEN NEW.n8n_processed_at IS NOT NULL AND NEW.n8n_processed_at > OLD.updated_at THEN 'n8n'
                WHEN NEW.confirmed_by = 'whatsapp_ai' THEN 'whatsapp_webhook'
                WHEN NEW.confirmed_by LIKE '%@%' THEN 'dashboard'
                ELSE 'system'
            END,
            CASE
                WHEN NEW.sleeves_status = 'confirmed' THEN 'Order confirmed via ' || COALESCE(NEW.confirmation_method, 'unknown')
                WHEN NEW.sleeves_status = 'rejected' THEN 'Order rejected: ' || COALESCE(NEW.rejection_reason, 'No reason provided')
                WHEN NEW.sleeves_status = 'shipped' THEN 'Order shipped'
                WHEN NEW.sleeves_status = 'delivered' THEN 'Order delivered'
                WHEN NEW.sleeves_status = 'cancelled' THEN 'Order cancelled'
                ELSE 'Status changed'
            END,
            NOW()
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if exists and recreate
DROP TRIGGER IF EXISTS trigger_log_order_status_change ON orders;

CREATE TRIGGER trigger_log_order_status_change
    AFTER UPDATE ON orders
    FOR EACH ROW
    EXECUTE FUNCTION fn_log_order_status_change();

COMMENT ON FUNCTION fn_log_order_status_change IS 'NeonFlow: Auto-log order status changes with source detection';

-- ================================================================
-- TRIGGER 2: update_customer_stats
-- ================================================================
-- Automatically update customer aggregate stats when new order inserted
-- Updates: total_orders, total_spent, last_order_at
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
            COALESCE(NEW.total_price, 0),
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
            total_spent = total_spent + COALESCE(NEW.total_price, 0),
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

-- Drop trigger if exists and recreate
DROP TRIGGER IF EXISTS trigger_update_customer_stats ON orders;

CREATE TRIGGER trigger_update_customer_stats
    AFTER INSERT ON orders
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_customer_stats();

COMMENT ON FUNCTION fn_update_customer_stats IS 'NeonFlow: Auto-update customer stats on new orders';

-- ================================================================
-- TRIGGER 3: update_timestamps
-- ================================================================
-- Automatically update updated_at timestamp on record modifications
-- Applied to all main tables
-- ================================================================

CREATE OR REPLACE FUNCTION fn_update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to all relevant tables
DROP TRIGGER IF EXISTS trigger_update_stores_timestamp ON stores;
CREATE TRIGGER trigger_update_stores_timestamp
    BEFORE UPDATE ON stores
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();

DROP TRIGGER IF EXISTS trigger_update_store_config_timestamp ON store_config;
CREATE TRIGGER trigger_update_store_config_timestamp
    BEFORE UPDATE ON store_config
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();

DROP TRIGGER IF EXISTS trigger_update_products_timestamp ON products;
CREATE TRIGGER trigger_update_products_timestamp
    BEFORE UPDATE ON products
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();

DROP TRIGGER IF EXISTS trigger_update_customers_timestamp ON customers;
CREATE TRIGGER trigger_update_customers_timestamp
    BEFORE UPDATE ON customers
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();

DROP TRIGGER IF EXISTS trigger_update_orders_timestamp ON orders;
CREATE TRIGGER trigger_update_orders_timestamp
    BEFORE UPDATE ON orders
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();

DROP TRIGGER IF EXISTS trigger_update_suppliers_timestamp ON suppliers;
CREATE TRIGGER trigger_update_suppliers_timestamp
    BEFORE UPDATE ON suppliers
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();

DROP TRIGGER IF EXISTS trigger_update_campaigns_timestamp ON campaigns;
CREATE TRIGGER trigger_update_campaigns_timestamp
    BEFORE UPDATE ON campaigns
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();

DROP TRIGGER IF EXISTS trigger_update_shipping_timestamp ON shipping_integrations;
CREATE TRIGGER trigger_update_shipping_timestamp
    BEFORE UPDATE ON shipping_integrations
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_timestamp();

COMMENT ON FUNCTION fn_update_timestamp IS 'NeonFlow: Auto-update updated_at on row modifications';

-- ================================================================
-- TRIGGERS CREATION COMPLETE
-- ================================================================
-- NeonFlow Trigger System v1.0
-- 3 Functions | 10 Triggers | Automated Logging Enabled
-- ================================================================

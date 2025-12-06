-- ================================================================
-- MIGRATION 024: Order Line Items - Normalized Product Mapping
-- ================================================================
-- Purpose: Create normalized table for order line items with proper
--          mapping to local products for Shopify orders
-- Date: 2025-01-06
-- ================================================================

-- ================================================================
-- PART 1: Create order_line_items table
-- ================================================================

CREATE TABLE IF NOT EXISTS order_line_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id UUID REFERENCES products(id) ON DELETE SET NULL,

    -- Shopify IDs for tracking
    shopify_product_id VARCHAR(255),
    shopify_variant_id VARCHAR(255),
    shopify_line_item_id VARCHAR(255),

    -- Product data at time of order (snapshot)
    product_name VARCHAR(500) NOT NULL,
    variant_title VARCHAR(255),
    sku VARCHAR(255),

    -- Pricing and quantity
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price DECIMAL(10,2) NOT NULL,
    total_price DECIMAL(10,2) NOT NULL,

    -- Discount information
    discount_amount DECIMAL(10,2) DEFAULT 0,
    tax_amount DECIMAL(10,2) DEFAULT 0,

    -- Product properties (for customizations, variants, etc.)
    properties JSONB,

    -- Fulfillment tracking
    fulfillment_status VARCHAR(50) DEFAULT 'unfulfilled',
    quantity_fulfilled INTEGER DEFAULT 0,

    -- Stock tracking
    stock_deducted BOOLEAN DEFAULT FALSE,
    stock_deducted_at TIMESTAMP,

    -- Original Shopify data (for reference)
    shopify_data JSONB,

    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ================================================================
-- PART 2: Create indexes
-- ================================================================

CREATE INDEX IF NOT EXISTS idx_order_line_items_order ON order_line_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_line_items_product ON order_line_items(product_id);
CREATE INDEX IF NOT EXISTS idx_order_line_items_shopify_product ON order_line_items(shopify_product_id);
CREATE INDEX IF NOT EXISTS idx_order_line_items_shopify_variant ON order_line_items(shopify_variant_id);
CREATE INDEX IF NOT EXISTS idx_order_line_items_sku ON order_line_items(sku);
CREATE INDEX IF NOT EXISTS idx_order_line_items_stock_deducted ON order_line_items(stock_deducted);

-- ================================================================
-- PART 3: Create trigger to update updated_at timestamp
-- ================================================================

CREATE OR REPLACE FUNCTION update_order_line_items_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_order_line_items_updated_at ON order_line_items;

CREATE TRIGGER trigger_update_order_line_items_updated_at
    BEFORE UPDATE ON order_line_items
    FOR EACH ROW
    EXECUTE FUNCTION update_order_line_items_updated_at();

-- ================================================================
-- PART 4: Create helper function to find product by Shopify IDs
-- ================================================================

CREATE OR REPLACE FUNCTION find_product_by_shopify_ids(
    p_store_id UUID,
    p_shopify_product_id VARCHAR,
    p_shopify_variant_id VARCHAR,
    p_sku VARCHAR DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_product_id UUID;
BEGIN
    -- Try to find by variant ID first (most specific)
    IF p_shopify_variant_id IS NOT NULL THEN
        SELECT id INTO v_product_id
        FROM products
        WHERE store_id = p_store_id
          AND shopify_variant_id = p_shopify_variant_id
        LIMIT 1;

        IF v_product_id IS NOT NULL THEN
            RETURN v_product_id;
        END IF;
    END IF;

    -- Try to find by product ID
    IF p_shopify_product_id IS NOT NULL THEN
        SELECT id INTO v_product_id
        FROM products
        WHERE store_id = p_store_id
          AND shopify_product_id = p_shopify_product_id
        LIMIT 1;

        IF v_product_id IS NOT NULL THEN
            RETURN v_product_id;
        END IF;
    END IF;

    -- Try to find by SKU as last resort
    IF p_sku IS NOT NULL AND p_sku != '' THEN
        SELECT id INTO v_product_id
        FROM products
        WHERE store_id = p_store_id
          AND sku = p_sku
        LIMIT 1;

        IF v_product_id IS NOT NULL THEN
            RETURN v_product_id;
        END IF;
    END IF;

    -- Product not found
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- PART 5: Create function to parse line items from Shopify order
-- ================================================================

CREATE OR REPLACE FUNCTION create_line_items_from_shopify(
    p_order_id UUID,
    p_store_id UUID,
    p_line_items JSONB
)
RETURNS INTEGER AS $$
DECLARE
    v_line_item JSONB;
    v_product_id UUID;
    v_shopify_product_id VARCHAR;
    v_shopify_variant_id VARCHAR;
    v_shopify_line_item_id VARCHAR;
    v_product_name VARCHAR;
    v_variant_title VARCHAR;
    v_sku VARCHAR;
    v_quantity INTEGER;
    v_unit_price DECIMAL(10,2);
    v_total_price DECIMAL(10,2);
    v_properties JSONB;
    v_count INTEGER := 0;
BEGIN
    -- Delete existing line items for this order (in case of update)
    DELETE FROM order_line_items WHERE order_id = p_order_id;

    -- Iterate through line items
    FOR v_line_item IN SELECT * FROM jsonb_array_elements(p_line_items)
    LOOP
        -- Extract data from Shopify line item
        v_shopify_product_id := v_line_item->>'product_id';
        v_shopify_variant_id := v_line_item->>'variant_id';
        v_shopify_line_item_id := v_line_item->>'id';
        v_product_name := COALESCE(v_line_item->>'name', v_line_item->>'title', 'Unknown Product');
        v_variant_title := v_line_item->>'variant_title';
        v_sku := v_line_item->>'sku';
        v_quantity := COALESCE((v_line_item->>'quantity')::INTEGER, 1);
        v_unit_price := COALESCE((v_line_item->>'price')::DECIMAL, 0);
        v_total_price := v_quantity * v_unit_price;
        v_properties := v_line_item->'properties';

        -- Try to find matching local product
        v_product_id := find_product_by_shopify_ids(
            p_store_id,
            v_shopify_product_id,
            v_shopify_variant_id,
            v_sku
        );

        -- Insert line item
        INSERT INTO order_line_items (
            order_id,
            product_id,
            shopify_product_id,
            shopify_variant_id,
            shopify_line_item_id,
            product_name,
            variant_title,
            sku,
            quantity,
            unit_price,
            total_price,
            discount_amount,
            tax_amount,
            properties,
            shopify_data
        ) VALUES (
            p_order_id,
            v_product_id,
            v_shopify_product_id,
            v_shopify_variant_id,
            v_shopify_line_item_id,
            v_product_name,
            v_variant_title,
            v_sku,
            v_quantity,
            v_unit_price,
            v_total_price,
            COALESCE((v_line_item->>'total_discount')::DECIMAL, 0),
            COALESCE((v_line_item->'tax_lines'->0->>'price')::DECIMAL, 0),
            v_properties,
            v_line_item
        );

        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- PART 6: Update inventory tracking to work with line items
-- ================================================================

-- Modify existing inventory trigger to use line items if available
CREATE OR REPLACE FUNCTION update_product_stock_on_order_status()
RETURNS TRIGGER AS $$
DECLARE
    v_line_item RECORD;
    v_product_id UUID;
    v_quantity INTEGER;
BEGIN
    -- Only process specific status changes
    IF NEW.sleeves_status = OLD.sleeves_status THEN
        RETURN NEW;
    END IF;

    -- DECREMENT STOCK: When order reaches ready_to_ship
    IF NEW.sleeves_status = 'ready_to_ship' AND OLD.sleeves_status != 'ready_to_ship' THEN

        -- Check if we have normalized line items
        IF EXISTS (SELECT 1 FROM order_line_items WHERE order_id = NEW.id LIMIT 1) THEN
            -- Use normalized line items
            FOR v_line_item IN
                SELECT product_id, quantity
                FROM order_line_items
                WHERE order_id = NEW.id
                  AND product_id IS NOT NULL
                  AND stock_deducted = FALSE
            LOOP
                -- Decrement stock
                UPDATE products
                SET stock = GREATEST(stock - v_line_item.quantity, 0),
                    updated_at = NOW()
                WHERE id = v_line_item.product_id;

                -- Mark as deducted in line item
                UPDATE order_line_items
                SET stock_deducted = TRUE,
                    stock_deducted_at = NOW()
                WHERE order_id = NEW.id
                  AND product_id = v_line_item.product_id;

                -- Log inventory movement
                INSERT INTO inventory_movements (
                    product_id,
                    order_id,
                    movement_type,
                    quantity,
                    previous_stock,
                    new_stock,
                    notes
                )
                SELECT
                    v_line_item.product_id,
                    NEW.id,
                    'order_deduction',
                    -v_line_item.quantity,
                    p.stock + v_line_item.quantity,
                    p.stock,
                    'Stock deducted - Order ready to ship (from line items)'
                FROM products p
                WHERE p.id = v_line_item.product_id;
            END LOOP;
        ELSE
            -- Fallback to old JSONB method if no line items exist
            -- (for backwards compatibility)
            NULL; -- Keep existing behavior
        END IF;

    -- RESTORE STOCK: When order is cancelled/rejected after being ready_to_ship
    ELSIF (NEW.sleeves_status IN ('cancelled', 'rejected'))
          AND (OLD.sleeves_status IN ('ready_to_ship', 'shipped', 'delivered')) THEN

        -- Check if we have normalized line items
        IF EXISTS (SELECT 1 FROM order_line_items WHERE order_id = NEW.id LIMIT 1) THEN
            -- Use normalized line items
            FOR v_line_item IN
                SELECT product_id, quantity
                FROM order_line_items
                WHERE order_id = NEW.id
                  AND product_id IS NOT NULL
                  AND stock_deducted = TRUE
            LOOP
                -- Restore stock
                UPDATE products
                SET stock = stock + v_line_item.quantity,
                    updated_at = NOW()
                WHERE id = v_line_item.product_id;

                -- Mark as not deducted
                UPDATE order_line_items
                SET stock_deducted = FALSE,
                    stock_deducted_at = NULL
                WHERE order_id = NEW.id
                  AND product_id = v_line_item.product_id;

                -- Log inventory movement
                INSERT INTO inventory_movements (
                    product_id,
                    order_id,
                    movement_type,
                    quantity,
                    previous_stock,
                    new_stock,
                    notes
                )
                SELECT
                    v_line_item.product_id,
                    NEW.id,
                    'order_restoration',
                    v_line_item.quantity,
                    p.stock - v_line_item.quantity,
                    p.stock,
                    'Stock restored - Order cancelled/rejected (from line items)'
                FROM products p
                WHERE p.id = v_line_item.product_id;
            END LOOP;
        ELSE
            -- Fallback to old method
            NULL;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recreate trigger
DROP TRIGGER IF EXISTS trigger_update_stock_on_order_status ON orders;

CREATE TRIGGER trigger_update_stock_on_order_status
    AFTER UPDATE OF sleeves_status ON orders
    FOR EACH ROW
    EXECUTE FUNCTION update_product_stock_on_order_status();

-- ================================================================
-- PART 7: Add comments for documentation
-- ================================================================

COMMENT ON TABLE order_line_items IS 'Normalized line items for orders with mapping to local products. Replaces JSONB line_items field for better querying and stock tracking.';
COMMENT ON COLUMN order_line_items.product_id IS 'FK to local products table. NULL if product not found/imported yet.';
COMMENT ON COLUMN order_line_items.shopify_product_id IS 'Shopify product ID for tracking and matching.';
COMMENT ON COLUMN order_line_items.shopify_variant_id IS 'Shopify variant ID for tracking and matching (most specific).';
COMMENT ON COLUMN order_line_items.stock_deducted IS 'TRUE if stock has been deducted for this line item.';
COMMENT ON FUNCTION find_product_by_shopify_ids IS 'Helper function to find local product by Shopify IDs (variant > product > SKU).';
COMMENT ON FUNCTION create_line_items_from_shopify IS 'Parses Shopify line_items JSONB and creates normalized records with product mapping.';

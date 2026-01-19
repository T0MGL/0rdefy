-- ============================================================================
-- Migration 086: Product Variants System
-- ============================================================================
--
-- DESCRIPTION:
-- Adds support for product variants (SKU, price, stock per variant).
-- Backward compatible - products without variants continue working as before.
--
-- USE CASES:
-- - Bundles: "NOCTE Glasses 1 unit", "NOCTE Glasses 2 units", "NOCTE Glasses 3 units"
-- - Sizes: S, M, L, XL
-- - Colors: Red, Blue, Green
-- - Combinations: Size + Color
--
-- ARCHITECTURE:
-- - products table: parent product (no changes to existing)
-- - product_variants table: NEW - holds variants with individual SKU/price/stock
-- - Simple products: has_variants = false, use product's own price/stock
-- - Variable products: has_variants = true, use variants' price/stock
--
-- BACKWARD COMPATIBILITY:
-- - All existing products continue working without changes
-- - has_variants defaults to FALSE
-- - Stock triggers work with both products and variants
-- - order_line_items can link to product OR variant
--
-- ============================================================================

-- ============================================================================
-- STEP 1: Add has_variants flag to products table
-- ============================================================================

DO $$
BEGIN
    -- Add has_variants column if not exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'products' AND column_name = 'has_variants'
    ) THEN
        ALTER TABLE products ADD COLUMN has_variants BOOLEAN DEFAULT FALSE;
        RAISE NOTICE '✅ Added has_variants column to products';
    ELSE
        RAISE NOTICE '⏭️ has_variants column already exists';
    END IF;
END $$;

-- ============================================================================
-- STEP 2: Create product_variants table
-- ============================================================================

CREATE TABLE IF NOT EXISTS product_variants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,

    -- Variant identification
    sku VARCHAR(255),
    variant_title VARCHAR(255) NOT NULL,  -- e.g., "1 unidad", "2 unidades", "Size M / Blue"

    -- Variant options (for multi-attribute variants)
    option1_name VARCHAR(100),   -- e.g., "Cantidad", "Size", "Color"
    option1_value VARCHAR(255),  -- e.g., "1", "M", "Blue"
    option2_name VARCHAR(100),   -- Optional second attribute
    option2_value VARCHAR(255),
    option3_name VARCHAR(100),   -- Optional third attribute
    option3_value VARCHAR(255),

    -- Pricing (overrides parent product)
    price DECIMAL(10,2) NOT NULL CHECK (price >= 0),
    cost DECIMAL(10,2) CHECK (cost IS NULL OR cost >= 0),

    -- Stock (independent per variant)
    stock INTEGER DEFAULT 0 CHECK (stock >= 0),

    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    position INTEGER DEFAULT 0,  -- Display order

    -- Shopify sync (if using Shopify)
    shopify_variant_id VARCHAR(255),
    shopify_inventory_item_id VARCHAR(255),
    sync_status VARCHAR(50) DEFAULT 'synced',
    last_synced_at TIMESTAMP,

    -- Metadata
    image_url TEXT,
    barcode VARCHAR(255),
    weight DECIMAL(10,3),
    weight_unit VARCHAR(20) DEFAULT 'kg',

    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Unique constraint: SKU unique per store (allows NULL)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE indexname = 'idx_product_variants_store_sku_unique'
    ) THEN
        CREATE UNIQUE INDEX idx_product_variants_store_sku_unique
        ON product_variants(store_id, LOWER(TRIM(sku)))
        WHERE sku IS NOT NULL AND sku != '' AND is_active = TRUE;
        RAISE NOTICE '✅ Created unique SKU index for variants';
    END IF;
END $$;

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_product_variants_product ON product_variants(product_id);
CREATE INDEX IF NOT EXISTS idx_product_variants_store ON product_variants(store_id);
CREATE INDEX IF NOT EXISTS idx_product_variants_sku ON product_variants(store_id, sku) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_product_variants_shopify ON product_variants(shopify_variant_id) WHERE shopify_variant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_product_variants_active ON product_variants(product_id, is_active) WHERE is_active = TRUE;

DO $$ BEGIN RAISE NOTICE '✅ Created product_variants table with indexes'; END $$;

-- ============================================================================
-- STEP 3: Add variant_id to order_line_items
-- ============================================================================

DO $$
BEGIN
    -- Add variant_id column if not exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'order_line_items' AND column_name = 'variant_id'
    ) THEN
        ALTER TABLE order_line_items ADD COLUMN variant_id UUID REFERENCES product_variants(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS idx_order_line_items_variant ON order_line_items(variant_id) WHERE variant_id IS NOT NULL;
        RAISE NOTICE '✅ Added variant_id to order_line_items';
    ELSE
        RAISE NOTICE '⏭️ variant_id already exists in order_line_items';
    END IF;
END $$;

-- ============================================================================
-- STEP 4: Create inventory_movements support for variants
-- ============================================================================

DO $$
BEGIN
    -- Add variant_id column if not exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'inventory_movements' AND column_name = 'variant_id'
    ) THEN
        ALTER TABLE inventory_movements ADD COLUMN variant_id UUID REFERENCES product_variants(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS idx_inventory_movements_variant ON inventory_movements(variant_id) WHERE variant_id IS NOT NULL;
        RAISE NOTICE '✅ Added variant_id to inventory_movements';
    ELSE
        RAISE NOTICE '⏭️ variant_id already exists in inventory_movements';
    END IF;
END $$;

-- ============================================================================
-- STEP 5: Function to find product/variant by SKU
-- ============================================================================

CREATE OR REPLACE FUNCTION find_product_or_variant_by_sku(
    p_store_id UUID,
    p_sku VARCHAR(255)
)
RETURNS TABLE (
    entity_type VARCHAR(20),
    product_id UUID,
    variant_id UUID,
    product_name VARCHAR(255),
    variant_title VARCHAR(255),
    sku VARCHAR(255),
    price DECIMAL(10,2),
    stock INTEGER
) AS $$
DECLARE
    v_normalized_sku VARCHAR(255);
BEGIN
    -- Normalize SKU for comparison
    v_normalized_sku := UPPER(TRIM(p_sku));

    IF v_normalized_sku IS NULL OR v_normalized_sku = '' THEN
        RETURN;
    END IF;

    -- First try to find variant by SKU
    RETURN QUERY
    SELECT
        'variant'::VARCHAR(20) AS entity_type,
        pv.product_id,
        pv.id AS variant_id,
        p.name AS product_name,
        pv.variant_title,
        pv.sku,
        pv.price,
        pv.stock
    FROM product_variants pv
    JOIN products p ON p.id = pv.product_id
    WHERE pv.store_id = p_store_id
      AND UPPER(TRIM(pv.sku)) = v_normalized_sku
      AND pv.is_active = TRUE
      AND p.is_active = TRUE
    LIMIT 1;

    -- If found, return (RETURN QUERY doesn't exit, so check if we got rows)
    IF FOUND THEN
        RETURN;
    END IF;

    -- Fallback: Try to find product by SKU (simple product without variants)
    RETURN QUERY
    SELECT
        'product'::VARCHAR(20) AS entity_type,
        p.id AS product_id,
        NULL::UUID AS variant_id,
        p.name AS product_name,
        NULL::VARCHAR(255) AS variant_title,
        p.sku,
        p.price,
        p.stock
    FROM products p
    WHERE p.store_id = p_store_id
      AND UPPER(TRIM(p.sku)) = v_normalized_sku
      AND p.is_active = TRUE
      AND (p.has_variants = FALSE OR p.has_variants IS NULL)
    LIMIT 1;

    RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DO $$ BEGIN RAISE NOTICE '✅ Created find_product_or_variant_by_sku function'; END $$;

-- ============================================================================
-- STEP 6: Function to adjust variant stock atomically
-- ============================================================================

CREATE OR REPLACE FUNCTION adjust_variant_stock(
    p_variant_id UUID,
    p_quantity_change INTEGER,
    p_movement_type VARCHAR(50),
    p_order_id UUID DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS TABLE (
    success BOOLEAN,
    new_stock INTEGER,
    error_message TEXT
) AS $$
DECLARE
    v_variant RECORD;
    v_stock_before INTEGER;
    v_stock_after INTEGER;
BEGIN
    -- Lock the variant row for update
    SELECT * INTO v_variant
    FROM product_variants
    WHERE id = p_variant_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, 0, 'Variant not found'::TEXT;
        RETURN;
    END IF;

    v_stock_before := v_variant.stock;
    v_stock_after := GREATEST(0, v_stock_before + p_quantity_change);

    -- Update stock
    UPDATE product_variants
    SET stock = v_stock_after,
        updated_at = NOW()
    WHERE id = p_variant_id;

    -- Log the movement
    INSERT INTO inventory_movements (
        product_id,
        variant_id,
        order_id,
        quantity_change,
        stock_before,
        stock_after,
        movement_type,
        notes,
        created_at
    ) VALUES (
        v_variant.product_id,
        p_variant_id,
        p_order_id,
        p_quantity_change,
        v_stock_before,
        v_stock_after,
        p_movement_type,
        p_notes,
        NOW()
    );

    RETURN QUERY SELECT TRUE, v_stock_after, NULL::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DO $$ BEGIN RAISE NOTICE '✅ Created adjust_variant_stock function'; END $$;

-- ============================================================================
-- STEP 7: Update stock trigger to handle variants
-- ============================================================================

CREATE OR REPLACE FUNCTION update_stock_on_order_status()
RETURNS TRIGGER AS $$
DECLARE
    v_line_item RECORD;
    v_movement_type TEXT;
    v_quantity_change INTEGER;
    v_stock_before INTEGER;
    v_stock_after INTEGER;
BEGIN
    -- Only process status changes that affect stock
    IF OLD.status = NEW.status THEN
        RETURN NEW;
    END IF;

    -- DECREMENT: When order moves to ready_to_ship (stock leaves warehouse)
    IF NEW.status = 'ready_to_ship' AND OLD.status IN ('pending', 'confirmed', 'in_preparation') THEN
        v_movement_type := 'order_ready_to_ship';

        FOR v_line_item IN
            SELECT oli.*,
                   COALESCE(oli.variant_id, oli.product_id) AS target_id,
                   CASE WHEN oli.variant_id IS NOT NULL THEN 'variant' ELSE 'product' END AS target_type
            FROM order_line_items oli
            WHERE oli.order_id = NEW.id
              AND oli.stock_deducted = FALSE
              AND (oli.product_id IS NOT NULL OR oli.variant_id IS NOT NULL)
        LOOP
            IF v_line_item.target_type = 'variant' THEN
                -- Deduct from variant
                SELECT stock INTO v_stock_before FROM product_variants WHERE id = v_line_item.variant_id FOR UPDATE;
                v_stock_after := GREATEST(0, v_stock_before - v_line_item.quantity);
                UPDATE product_variants SET stock = v_stock_after, updated_at = NOW() WHERE id = v_line_item.variant_id;

                INSERT INTO inventory_movements (product_id, variant_id, order_id, quantity_change, stock_before, stock_after, movement_type, order_status_from, order_status_to)
                VALUES (v_line_item.product_id, v_line_item.variant_id, NEW.id, -v_line_item.quantity, v_stock_before, v_stock_after, v_movement_type, OLD.status, NEW.status);
            ELSE
                -- Deduct from product (original behavior)
                SELECT stock INTO v_stock_before FROM products WHERE id = v_line_item.product_id FOR UPDATE;
                v_stock_after := GREATEST(0, v_stock_before - v_line_item.quantity);
                UPDATE products SET stock = v_stock_after, updated_at = NOW() WHERE id = v_line_item.product_id;

                INSERT INTO inventory_movements (product_id, order_id, quantity_change, stock_before, stock_after, movement_type, order_status_from, order_status_to)
                VALUES (v_line_item.product_id, NEW.id, -v_line_item.quantity, v_stock_before, v_stock_after, v_movement_type, OLD.status, NEW.status);
            END IF;

            -- Mark as deducted
            UPDATE order_line_items SET stock_deducted = TRUE, stock_deducted_at = NOW() WHERE id = v_line_item.id;
        END LOOP;
    END IF;

    -- RESTORE: When order is cancelled/rejected after stock was deducted
    IF NEW.status IN ('cancelled', 'rejected', 'returned') AND OLD.status IN ('ready_to_ship', 'shipped', 'delivered', 'in_transit') THEN
        v_movement_type := 'order_' || NEW.status;

        FOR v_line_item IN
            SELECT oli.*,
                   CASE WHEN oli.variant_id IS NOT NULL THEN 'variant' ELSE 'product' END AS target_type
            FROM order_line_items oli
            WHERE oli.order_id = NEW.id
              AND oli.stock_deducted = TRUE
              AND (oli.product_id IS NOT NULL OR oli.variant_id IS NOT NULL)
        LOOP
            IF v_line_item.target_type = 'variant' THEN
                -- Restore to variant
                SELECT stock INTO v_stock_before FROM product_variants WHERE id = v_line_item.variant_id FOR UPDATE;
                v_stock_after := v_stock_before + v_line_item.quantity;
                UPDATE product_variants SET stock = v_stock_after, updated_at = NOW() WHERE id = v_line_item.variant_id;

                INSERT INTO inventory_movements (product_id, variant_id, order_id, quantity_change, stock_before, stock_after, movement_type, order_status_from, order_status_to)
                VALUES (v_line_item.product_id, v_line_item.variant_id, NEW.id, v_line_item.quantity, v_stock_before, v_stock_after, v_movement_type, OLD.status, NEW.status);
            ELSE
                -- Restore to product (original behavior)
                SELECT stock INTO v_stock_before FROM products WHERE id = v_line_item.product_id FOR UPDATE;
                v_stock_after := v_stock_before + v_line_item.quantity;
                UPDATE products SET stock = v_stock_after, updated_at = NOW() WHERE id = v_line_item.product_id;

                INSERT INTO inventory_movements (product_id, order_id, quantity_change, stock_before, stock_after, movement_type, order_status_from, order_status_to)
                VALUES (v_line_item.product_id, NEW.id, v_line_item.quantity, v_stock_before, v_stock_after, v_movement_type, OLD.status, NEW.status);
            END IF;

            -- Mark as not deducted
            UPDATE order_line_items SET stock_deducted = FALSE, stock_deducted_at = NULL WHERE id = v_line_item.id;
        END LOOP;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate trigger
DROP TRIGGER IF EXISTS trigger_update_stock_on_order_status ON orders;
CREATE TRIGGER trigger_update_stock_on_order_status
    AFTER UPDATE ON orders
    FOR EACH ROW
    EXECUTE FUNCTION update_stock_on_order_status();

DO $$ BEGIN RAISE NOTICE '✅ Updated stock trigger to support variants'; END $$;

-- ============================================================================
-- STEP 8: Auto-update timestamp trigger for variants
-- ============================================================================

CREATE OR REPLACE FUNCTION update_variant_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_variant_timestamp ON product_variants;
CREATE TRIGGER trigger_update_variant_timestamp
    BEFORE UPDATE ON product_variants
    FOR EACH ROW
    EXECUTE FUNCTION update_variant_timestamp();

DO $$ BEGIN RAISE NOTICE '✅ Created variant timestamp trigger'; END $$;

-- ============================================================================
-- STEP 9: View for products with variant summary
-- ============================================================================

CREATE OR REPLACE VIEW v_products_with_variants AS
SELECT
    p.id,
    p.store_id,
    p.name,
    p.sku AS product_sku,
    p.description,
    p.category,
    p.image_url,
    p.has_variants,
    p.is_active,
    p.is_service,
    p.shopify_product_id,
    p.sync_status,
    p.created_at,
    p.updated_at,

    -- If has variants, aggregate from variants; else use product fields
    CASE
        WHEN p.has_variants = TRUE THEN
            (SELECT MIN(pv.price) FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = TRUE)
        ELSE p.price
    END AS min_price,

    CASE
        WHEN p.has_variants = TRUE THEN
            (SELECT MAX(pv.price) FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = TRUE)
        ELSE p.price
    END AS max_price,

    CASE
        WHEN p.has_variants = TRUE THEN
            (SELECT COALESCE(SUM(pv.stock), 0) FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = TRUE)
        ELSE p.stock
    END AS total_stock,

    CASE
        WHEN p.has_variants = TRUE THEN
            (SELECT COUNT(*) FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = TRUE)
        ELSE 0
    END AS variant_count,

    -- Cost for margin calculation
    CASE
        WHEN p.has_variants = TRUE THEN
            (SELECT AVG(pv.cost) FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = TRUE AND pv.cost IS NOT NULL)
        ELSE p.cost
    END AS avg_cost
FROM products p
WHERE p.is_active = TRUE;

DO $$ BEGIN RAISE NOTICE '✅ Created v_products_with_variants view'; END $$;

-- ============================================================================
-- STEP 10: RLS Policies for product_variants
-- ============================================================================

ALTER TABLE product_variants ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view variants of their store's products
DROP POLICY IF EXISTS "Users can view own store variants" ON product_variants;
CREATE POLICY "Users can view own store variants" ON product_variants
    FOR SELECT
    USING (
        store_id IN (
            SELECT us.store_id FROM user_stores us WHERE us.user_id = auth.uid()
        )
    );

-- Policy: Users can insert variants for their store's products
DROP POLICY IF EXISTS "Users can insert own store variants" ON product_variants;
CREATE POLICY "Users can insert own store variants" ON product_variants
    FOR INSERT
    WITH CHECK (
        store_id IN (
            SELECT us.store_id FROM user_stores us WHERE us.user_id = auth.uid()
        )
    );

-- Policy: Users can update their store's variants
DROP POLICY IF EXISTS "Users can update own store variants" ON product_variants;
CREATE POLICY "Users can update own store variants" ON product_variants
    FOR UPDATE
    USING (
        store_id IN (
            SELECT us.store_id FROM user_stores us WHERE us.user_id = auth.uid()
        )
    );

-- Policy: Users can delete their store's variants
DROP POLICY IF EXISTS "Users can delete own store variants" ON product_variants;
CREATE POLICY "Users can delete own store variants" ON product_variants
    FOR DELETE
    USING (
        store_id IN (
            SELECT us.store_id FROM user_stores us WHERE us.user_id = auth.uid()
        )
    );

DO $$ BEGIN RAISE NOTICE '✅ Created RLS policies for product_variants'; END $$;

-- ============================================================================
-- STEP 11: Function to validate variant data
-- ============================================================================

CREATE OR REPLACE FUNCTION validate_variant_data(
    p_product_id UUID,
    p_sku VARCHAR(255),
    p_variant_title VARCHAR(255),
    p_price DECIMAL(10,2),
    p_stock INTEGER DEFAULT 0,
    p_variant_id UUID DEFAULT NULL  -- NULL for new variants
)
RETURNS TABLE (
    is_valid BOOLEAN,
    errors JSONB,
    warnings JSONB
) AS $$
DECLARE
    v_errors JSONB := '[]'::JSONB;
    v_warnings JSONB := '[]'::JSONB;
    v_product RECORD;
    v_existing_sku UUID;
BEGIN
    -- Get parent product
    SELECT * INTO v_product FROM products WHERE id = p_product_id;

    IF NOT FOUND THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object('field', 'product_id', 'message', 'Product not found'));
        RETURN QUERY SELECT FALSE, v_errors, v_warnings;
        RETURN;
    END IF;

    -- Validate required fields
    IF p_variant_title IS NULL OR TRIM(p_variant_title) = '' THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object('field', 'variant_title', 'message', 'Variant title is required'));
    END IF;

    IF p_price IS NULL OR p_price < 0 THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object('field', 'price', 'message', 'Price must be a positive number'));
    END IF;

    IF p_stock IS NOT NULL AND p_stock < 0 THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object('field', 'stock', 'message', 'Stock cannot be negative'));
    END IF;

    -- Check for duplicate SKU
    IF p_sku IS NOT NULL AND TRIM(p_sku) != '' THEN
        SELECT id INTO v_existing_sku
        FROM product_variants
        WHERE store_id = v_product.store_id
          AND UPPER(TRIM(sku)) = UPPER(TRIM(p_sku))
          AND is_active = TRUE
          AND (p_variant_id IS NULL OR id != p_variant_id);

        IF FOUND THEN
            v_errors := v_errors || jsonb_build_array(jsonb_build_object('field', 'sku', 'message', 'SKU already exists for another variant'));
        END IF;

        -- Also check products table for SKU conflict
        SELECT id INTO v_existing_sku
        FROM products
        WHERE store_id = v_product.store_id
          AND UPPER(TRIM(sku)) = UPPER(TRIM(p_sku))
          AND is_active = TRUE
          AND id != p_product_id;

        IF FOUND THEN
            v_errors := v_errors || jsonb_build_array(jsonb_build_object('field', 'sku', 'message', 'SKU already exists for another product'));
        END IF;
    ELSE
        v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('field', 'sku', 'message', 'No SKU provided - variant will not be auto-mapped from webhooks'));
    END IF;

    -- Warnings
    IF p_stock IS NOT NULL AND p_stock > 100000 THEN
        v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('field', 'stock', 'message', 'Stock value seems unusually high'));
    END IF;

    RETURN QUERY SELECT (jsonb_array_length(v_errors) = 0), v_errors, v_warnings;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DO $$ BEGIN RAISE NOTICE '✅ Created validate_variant_data function'; END $$;

-- ============================================================================
-- STEP 12: Migration complete summary
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '============================================================';
    RAISE NOTICE '✅ MIGRATION 086 COMPLETE: Product Variants System';
    RAISE NOTICE '============================================================';
    RAISE NOTICE '';
    RAISE NOTICE 'TABLES CREATED:';
    RAISE NOTICE '  - product_variants (with full index coverage)';
    RAISE NOTICE '';
    RAISE NOTICE 'COLUMNS ADDED:';
    RAISE NOTICE '  - products.has_variants (BOOLEAN)';
    RAISE NOTICE '  - order_line_items.variant_id (UUID FK)';
    RAISE NOTICE '  - inventory_movements.variant_id (UUID FK)';
    RAISE NOTICE '';
    RAISE NOTICE 'FUNCTIONS CREATED:';
    RAISE NOTICE '  - find_product_or_variant_by_sku(store_id, sku)';
    RAISE NOTICE '  - adjust_variant_stock(variant_id, qty, type, order_id, notes)';
    RAISE NOTICE '  - validate_variant_data(...)';
    RAISE NOTICE '';
    RAISE NOTICE 'TRIGGERS UPDATED:';
    RAISE NOTICE '  - update_stock_on_order_status (now handles variants)';
    RAISE NOTICE '';
    RAISE NOTICE 'VIEWS CREATED:';
    RAISE NOTICE '  - v_products_with_variants';
    RAISE NOTICE '';
    RAISE NOTICE 'RLS POLICIES: Full CRUD for store owners';
    RAISE NOTICE '';
    RAISE NOTICE 'BACKWARD COMPATIBLE: Existing products unaffected';
    RAISE NOTICE '============================================================';
END $$;

-- ================================================================
-- SHOPIFY SYNC FIELDS
-- ================================================================
-- Adds Shopify ID tracking fields and sync configuration
-- ================================================================

-- ================================================================
-- ALTER TABLE: products
-- ================================================================
-- Add Shopify product and variant IDs for sync tracking
-- ================================================================

ALTER TABLE products
ADD COLUMN IF NOT EXISTS shopify_product_id VARCHAR(255) UNIQUE,
ADD COLUMN IF NOT EXISTS shopify_variant_id VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_products_shopify_id ON products(shopify_product_id);
CREATE INDEX IF NOT EXISTS idx_products_shopify_variant ON products(shopify_variant_id);

COMMENT ON COLUMN products.shopify_product_id IS 'Shopify product ID for sync tracking';
COMMENT ON COLUMN products.shopify_variant_id IS 'Shopify variant ID for inventory updates';

-- ================================================================
-- ALTER TABLE: customers
-- ================================================================
-- Add Shopify customer ID for sync tracking
-- ================================================================

ALTER TABLE customers
ADD COLUMN IF NOT EXISTS shopify_customer_id VARCHAR(255) UNIQUE;

CREATE INDEX IF NOT EXISTS idx_customers_shopify_id ON customers(shopify_customer_id);

COMMENT ON COLUMN customers.shopify_customer_id IS 'Shopify customer ID for sync tracking';

-- ================================================================
-- TABLE: shopify_sync_config
-- ================================================================
-- Stores sync preferences and tracking for each store
-- ================================================================

CREATE TABLE IF NOT EXISTS shopify_sync_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    auto_sync_inventory BOOLEAN DEFAULT false,
    sync_frequency VARCHAR(20) DEFAULT 'manual',
    last_sync_products TIMESTAMP,
    last_sync_customers TIMESTAMP,
    products_synced_count INTEGER DEFAULT 0,
    customers_synced_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, store_id)
);

CREATE INDEX IF NOT EXISTS idx_sync_config_user ON shopify_sync_config(user_id);
CREATE INDEX IF NOT EXISTS idx_sync_config_store ON shopify_sync_config(store_id);

COMMENT ON TABLE shopify_sync_config IS 'Shopify sync configuration and tracking per store';
COMMENT ON COLUMN shopify_sync_config.auto_sync_inventory IS 'Enable automatic inventory sync from Ordefy to Shopify';
COMMENT ON COLUMN shopify_sync_config.sync_frequency IS 'Sync frequency: manual, hourly, daily';
COMMENT ON COLUMN shopify_sync_config.last_sync_products IS 'Last successful products import from Shopify';
COMMENT ON COLUMN shopify_sync_config.last_sync_customers IS 'Last successful customers import from Shopify';

-- ================================================================
-- TABLE: shopify_sync_logs
-- ================================================================
-- Detailed logs of sync operations for debugging
-- ================================================================

CREATE TABLE IF NOT EXISTS shopify_sync_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    sync_type VARCHAR(50) NOT NULL,
    direction VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL,
    items_processed INTEGER DEFAULT 0,
    items_success INTEGER DEFAULT 0,
    items_failed INTEGER DEFAULT 0,
    error_details JSONB,
    started_at TIMESTAMP NOT NULL,
    completed_at TIMESTAMP,
    duration_ms INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_logs_store ON shopify_sync_logs(store_id);
CREATE INDEX IF NOT EXISTS idx_sync_logs_type ON shopify_sync_logs(sync_type);
CREATE INDEX IF NOT EXISTS idx_sync_logs_created ON shopify_sync_logs(created_at DESC);

COMMENT ON TABLE shopify_sync_logs IS 'Detailed sync operation logs for monitoring and debugging';
COMMENT ON COLUMN shopify_sync_logs.sync_type IS 'Type: products, customers, inventory';
COMMENT ON COLUMN shopify_sync_logs.direction IS 'Direction: import (Shopify→Ordefy), export (Ordefy→Shopify)';
COMMENT ON COLUMN shopify_sync_logs.status IS 'Status: running, completed, failed, partial';

-- ============================================================
-- MIGRATION 007: SHOPIFY WEBHOOK SYNC SYSTEM
-- ============================================================
-- Purpose: Enable automatic synchronization of orders, products, and customers
-- via Shopify webhooks (no historical sync)
-- ============================================================

-- Table: shopify_webhooks
-- Purpose: Track registered webhooks to enable deactivation later
-- ============================================================
CREATE TABLE IF NOT EXISTS shopify_webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id UUID REFERENCES shopify_integrations(id) ON DELETE CASCADE,
  webhook_id BIGINT NOT NULL,
  topic VARCHAR(100) NOT NULL,
  shop_domain VARCHAR(255) NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(integration_id, topic)
);

CREATE INDEX idx_shopify_webhooks_integration
  ON shopify_webhooks(integration_id);

-- Table: shopify_webhook_logs
-- Purpose: Track webhook processing to prevent duplicate processing
-- ============================================================
CREATE TABLE IF NOT EXISTS shopify_webhook_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id UUID REFERENCES shopify_integrations(id) ON DELETE CASCADE,
  webhook_topic VARCHAR(100),
  shopify_resource_id BIGINT,
  shop_domain VARCHAR(255),
  status VARCHAR(50), -- 'processed', 'error', 'pending'
  error_message TEXT,
  processed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_webhook_logs_integration
  ON shopify_webhook_logs(integration_id);
CREATE INDEX idx_webhook_logs_resource
  ON shopify_webhook_logs(shopify_resource_id);

-- Enhance products table for Shopify sync
-- ============================================================
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS shopify_product_id BIGINT,
  ADD COLUMN IF NOT EXISTS shopify_variant_id BIGINT,
  ADD COLUMN IF NOT EXISTS shopify_sync_status VARCHAR(50) DEFAULT 'pending', -- pending, synced, error
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS shop_domain VARCHAR(255),
  ADD COLUMN IF NOT EXISTS shopify_data JSONB;

CREATE INDEX IF NOT EXISTS idx_products_shopify_id
  ON products(shopify_product_id);
CREATE INDEX IF NOT EXISTS idx_products_sync_status
  ON products(shopify_sync_status);

-- Enhance customers table for Shopify sync
-- ============================================================
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS shopify_customer_id BIGINT,
  ADD COLUMN IF NOT EXISTS shop_domain VARCHAR(255),
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_customers_shopify_id
  ON customers(shopify_customer_id);

-- Add unique constraint for shopify_customer_id per store
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_shopify_store
  ON customers(shopify_customer_id, store_id)
  WHERE shopify_customer_id IS NOT NULL;

-- Enhance orders table for Shopify sync
-- ============================================================
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS shopify_order_id BIGINT,
  ADD COLUMN IF NOT EXISTS shopify_order_number VARCHAR(100),
  ADD COLUMN IF NOT EXISTS shop_domain VARCHAR(255),
  ADD COLUMN IF NOT EXISTS synced_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS shopify_data JSONB;

-- Add unique constraint for shopify orders
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_shopify_id
  ON orders(shopify_order_id)
  WHERE shopify_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_shop_domain
  ON orders(shop_domain);

-- ============================================================
-- END MIGRATION 007
-- ============================================================

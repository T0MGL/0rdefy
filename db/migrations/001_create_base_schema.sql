-- ================================================================
-- NEONFLOW - MULTITENANT SAAS ECOMMERCE DATABASE SCHEMA
-- ================================================================
-- MVP Version: Base schema for stores, products, orders, customers
-- Integration: Shopify + WhatsApp + n8n automation
-- Database: PostgreSQL (Supabase self-hosted)
-- ================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ================================================================
-- TABLE 1: stores
-- ================================================================
-- Core tenant table. Each store represents one e-commerce business.
-- ================================================================

CREATE TABLE IF NOT EXISTS stores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    country VARCHAR(2),
    timezone VARCHAR(50) DEFAULT 'America/Asuncion',
    currency VARCHAR(3) DEFAULT 'USD',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

COMMENT ON TABLE stores IS 'NeonFlow: Multitenant stores table - one row per e-commerce business';
COMMENT ON COLUMN stores.country IS 'ISO 3166-1 alpha-2 country code (e.g., PY, AR, BR)';
COMMENT ON COLUMN stores.timezone IS 'IANA timezone for scheduling follow-ups and reports';

-- ================================================================
-- TABLE 2: store_config
-- ================================================================
-- Store-specific configuration for integrations and automation.
-- One-to-one relationship with stores.
-- ================================================================

CREATE TABLE IF NOT EXISTS store_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL UNIQUE REFERENCES stores(id) ON DELETE CASCADE,
    whatsapp_business_account_id VARCHAR(255),
    whatsapp_phone_number_id VARCHAR(255),
    whatsapp_api_token TEXT,
    shopify_store_url VARCHAR(255),
    shopify_access_token TEXT,
    agent_name VARCHAR(100) DEFAULT 'Agente',
    follow_up_template_1 TEXT,
    follow_up_template_2 TEXT,
    follow_up_template_3 TEXT,
    follow_up_1_delay_hours INT DEFAULT 24,
    follow_up_2_delay_hours INT DEFAULT 48,
    follow_up_3_delay_hours INT DEFAULT 72,
    follow_up_enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

COMMENT ON TABLE store_config IS 'NeonFlow: Store-specific integration configs and WhatsApp templates';
COMMENT ON COLUMN store_config.follow_up_enabled IS 'Global toggle for automated follow-up sequences';

-- ================================================================
-- TABLE 3: products
-- ================================================================
-- Product catalog per store. Synced from Shopify or manually created.
-- ================================================================

CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    price DECIMAL(10,2),
    cost DECIMAL(10,2),
    stock INT DEFAULT 0,
    image_url TEXT,
    shopify_product_id VARCHAR(255),
    shopify_variant_id VARCHAR(255),
    sku VARCHAR(255),
    category VARCHAR(100),
    is_active BOOLEAN DEFAULT TRUE,
    modified_by VARCHAR(100) DEFAULT 'system',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_products_store ON products(store_id);
CREATE INDEX idx_products_shopify ON products(store_id, shopify_product_id);
CREATE INDEX idx_products_sku ON products(store_id, sku);

COMMENT ON TABLE products IS 'NeonFlow: Product catalog with Shopify sync support';
COMMENT ON COLUMN products.modified_by IS 'Track who last modified: dashboard user, n8n, shopify_sync';
COMMENT ON COLUMN products.cost IS 'COGS for profitability calculations';

-- ================================================================
-- TABLE 4: customers
-- ================================================================
-- Customer profiles aggregated from orders. Links to Shopify customers.
-- ================================================================

CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    shopify_customer_id VARCHAR(255),
    email VARCHAR(255),
    phone VARCHAR(20),
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    total_orders INT DEFAULT 0,
    total_spent DECIMAL(10,2) DEFAULT 0,
    last_order_at TIMESTAMP,
    accepts_marketing BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_customers_store ON customers(store_id);
CREATE INDEX idx_customers_email ON customers(store_id, email);
CREATE INDEX idx_customers_phone ON customers(store_id, phone);
CREATE INDEX idx_customers_shopify ON customers(store_id, shopify_customer_id);

COMMENT ON TABLE customers IS 'NeonFlow: Customer profiles with aggregate stats';
COMMENT ON COLUMN customers.total_orders IS 'Auto-updated via trigger on orders INSERT';

-- ================================================================
-- TABLE 5: orders
-- ================================================================
-- Core orders table. Synced from Shopify + enriched with confirmation data.
-- sleeves_status: NeonFlow internal status tracking.
-- ================================================================

CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES customers(id),
    shopify_order_id VARCHAR(255) UNIQUE,
    shopify_order_number INT,
    customer_email VARCHAR(255),
    customer_phone VARCHAR(20),
    customer_first_name VARCHAR(255),
    customer_last_name VARCHAR(255),
    billing_address JSONB,
    shipping_address JSONB,
    line_items JSONB,
    total_price DECIMAL(10,2),
    subtotal_price DECIMAL(10,2),
    total_tax DECIMAL(10,2),
    total_shipping DECIMAL(10,2),
    currency VARCHAR(3) DEFAULT 'USD',
    financial_status VARCHAR(50),
    fulfillment_status VARCHAR(50),
    sleeves_status VARCHAR(50) DEFAULT 'pending',
    confirmed_at TIMESTAMP,
    confirmation_method VARCHAR(50),
    confirmed_by VARCHAR(100),
    follow_up_1_sent_at TIMESTAMP,
    follow_up_2_sent_at TIMESTAMP,
    follow_up_3_sent_at TIMESTAMP,
    n8n_processed_at TIMESTAMP,
    shopify_raw_json JSONB,
    rejection_reason TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_orders_store ON orders(store_id);
CREATE INDEX idx_orders_status ON orders(store_id, sleeves_status, created_at DESC);
CREATE INDEX idx_orders_phone ON orders(store_id, customer_phone);
CREATE INDEX idx_orders_shopify ON orders(shopify_order_id);
CREATE INDEX idx_orders_created ON orders(store_id, created_at DESC);

COMMENT ON TABLE orders IS 'NeonFlow: Orders with WhatsApp confirmation tracking';
COMMENT ON COLUMN orders.sleeves_status IS 'NeonFlow status: pending, confirmed, rejected, shipped, delivered, cancelled';
COMMENT ON COLUMN orders.confirmed_by IS 'Who confirmed: whatsapp_ai, manual, dashboard_user';
COMMENT ON COLUMN orders.line_items IS 'Shopify line items JSON: [{product_id, variant_id, quantity, price}]';
COMMENT ON COLUMN orders.shopify_raw_json IS 'Full Shopify order JSON for debugging';

-- ================================================================
-- TABLE 6: order_status_history
-- ================================================================
-- Audit log for all order status changes. Triggered automatically.
-- ================================================================

CREATE TABLE IF NOT EXISTS order_status_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    previous_status VARCHAR(50),
    new_status VARCHAR(50),
    changed_by VARCHAR(100),
    changed_by_n8n BOOLEAN DEFAULT FALSE,
    change_source VARCHAR(50),
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_history_order ON order_status_history(order_id, created_at DESC);
CREATE INDEX idx_history_store ON order_status_history(store_id, created_at DESC);

COMMENT ON TABLE order_status_history IS 'NeonFlow: Audit trail for order status changes';
COMMENT ON COLUMN order_status_history.changed_by_n8n IS 'TRUE if change was made by n8n automation';
COMMENT ON COLUMN order_status_history.change_source IS 'dashboard, n8n, whatsapp_webhook, shopify_sync';

-- ================================================================
-- TABLE 7: follow_up_log
-- ================================================================
-- Track scheduled and sent WhatsApp follow-up messages.
-- Used by n8n to schedule reminders for unconfirmed orders.
-- ================================================================

CREATE TABLE IF NOT EXISTS follow_up_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    template_number INT,
    scheduled_for TIMESTAMP,
    sent_at TIMESTAMP,
    customer_phone VARCHAR(20),
    message_text TEXT,
    whatsapp_message_id VARCHAR(255),
    status VARCHAR(50) DEFAULT 'pending',
    error_message TEXT,
    n8n_execution_id VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_followup_scheduled ON follow_up_log(store_id, scheduled_for, status);
CREATE INDEX idx_followup_order ON follow_up_log(order_id);

COMMENT ON TABLE follow_up_log IS 'NeonFlow: WhatsApp follow-up message queue and history';
COMMENT ON COLUMN follow_up_log.template_number IS '1, 2, or 3 - which follow-up in sequence';
COMMENT ON COLUMN follow_up_log.status IS 'pending, sent, failed, cancelled';

-- ================================================================
-- TABLE 8: suppliers
-- ================================================================
-- Supplier management for product sourcing and cost tracking.
-- ================================================================

CREATE TABLE IF NOT EXISTS suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    contact_person VARCHAR(255),
    email VARCHAR(255),
    phone VARCHAR(20),
    rating DECIMAL(3,2),
    products_count INT DEFAULT 0,
    modified_by VARCHAR(100) DEFAULT 'system',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_suppliers_store ON suppliers(store_id);

COMMENT ON TABLE suppliers IS 'NeonFlow: Supplier directory for inventory management';
COMMENT ON COLUMN suppliers.rating IS 'Store rating 0.00-5.00';

-- ================================================================
-- TABLE 9: campaigns
-- ================================================================
-- Marketing campaign tracking for ROI/ROAS analysis.
-- ================================================================

CREATE TABLE IF NOT EXISTS campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    platform VARCHAR(50),
    campaign_name VARCHAR(255),
    investment DECIMAL(10,2),
    clicks INT DEFAULT 0,
    conversions INT DEFAULT 0,
    roas DECIMAL(10,2),
    status VARCHAR(50),
    modified_by VARCHAR(100) DEFAULT 'system',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_campaigns_store ON campaigns(store_id);
CREATE INDEX idx_campaigns_status ON campaigns(store_id, status);

COMMENT ON TABLE campaigns IS 'NeonFlow: Marketing campaign performance tracking';
COMMENT ON COLUMN campaigns.platform IS 'facebook, instagram, tiktok, google, etc.';
COMMENT ON COLUMN campaigns.roas IS 'Return on Ad Spend: revenue / investment';

-- ================================================================
-- TABLE 10: shipping_integrations
-- ================================================================
-- Carrier/shipping provider API configurations per store.
-- ================================================================

CREATE TABLE IF NOT EXISTS shipping_integrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    carrier_name VARCHAR(255),
    api_key TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    settings JSONB,
    modified_by VARCHAR(100) DEFAULT 'system',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_shipping_store ON shipping_integrations(store_id);

COMMENT ON TABLE shipping_integrations IS 'NeonFlow: Shipping carrier API configurations';
COMMENT ON COLUMN shipping_integrations.settings IS 'Carrier-specific config: {api_url, webhook_url, rate_limits}';

-- ================================================================
-- GRANT PERMISSIONS
-- ================================================================
-- Grant necessary permissions to authenticated and anon roles
-- ================================================================

GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;

-- ================================================================
-- SCHEMA CREATION COMPLETE
-- ================================================================
-- NeonFlow MVP Database Schema v1.0
-- 10 Tables Created | Indexes Applied | Ready for Triggers
-- ================================================================

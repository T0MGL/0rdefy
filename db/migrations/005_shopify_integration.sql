-- Migration: Shopify Integration Schema
-- Creates tables for storing Shopify integration configuration, import jobs, and synced data

-- Shopify integrations table
-- Stores configuration and credentials for each store's Shopify connection
CREATE TABLE IF NOT EXISTS shopify_integrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,

    -- Shopify credentials
    shop_domain VARCHAR(255) NOT NULL,
    api_key VARCHAR(255) NOT NULL,
    api_secret_key VARCHAR(255) NOT NULL,
    access_token TEXT NOT NULL,
    webhook_signature VARCHAR(255),

    -- Import configuration
    import_products BOOLEAN DEFAULT FALSE,
    import_customers BOOLEAN DEFAULT FALSE,
    import_orders BOOLEAN DEFAULT FALSE,
    import_historical_orders BOOLEAN DEFAULT FALSE,

    -- Status tracking
    status VARCHAR(50) DEFAULT 'active',
    last_sync_at TIMESTAMP,
    sync_error TEXT,

    -- Metadata
    shopify_shop_id VARCHAR(255),
    shop_name VARCHAR(255),
    shop_email VARCHAR(255),
    shop_currency VARCHAR(10),
    shop_timezone VARCHAR(100),
    shop_data JSONB,

    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),

    UNIQUE(store_id, shop_domain)
);

CREATE INDEX idx_shopify_integrations_store ON shopify_integrations(store_id);
CREATE INDEX idx_shopify_integrations_status ON shopify_integrations(status);

-- Shopify import jobs table
-- Tracks background import operations with progress monitoring
CREATE TABLE IF NOT EXISTS shopify_import_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    integration_id UUID NOT NULL REFERENCES shopify_integrations(id) ON DELETE CASCADE,
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,

    -- Job configuration
    job_type VARCHAR(50) NOT NULL,
    import_type VARCHAR(50) NOT NULL,

    -- Progress tracking
    status VARCHAR(50) DEFAULT 'pending',
    total_items INTEGER DEFAULT 0,
    processed_items INTEGER DEFAULT 0,
    failed_items INTEGER DEFAULT 0,
    success_items INTEGER DEFAULT 0,

    -- Pagination state
    current_page INTEGER DEFAULT 1,
    page_size INTEGER DEFAULT 50,
    has_more BOOLEAN DEFAULT TRUE,
    last_cursor VARCHAR(255),

    -- Error handling
    error_message TEXT,
    error_details JSONB,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,

    -- Timestamps
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_shopify_import_jobs_integration ON shopify_import_jobs(integration_id);
CREATE INDEX idx_shopify_import_jobs_store ON shopify_import_jobs(store_id);
CREATE INDEX idx_shopify_import_jobs_status ON shopify_import_jobs(status);
CREATE INDEX idx_shopify_import_jobs_type ON shopify_import_jobs(job_type, import_type);

-- Update products table to support Shopify sync
ALTER TABLE products ADD COLUMN IF NOT EXISTS shopify_product_id VARCHAR(255);
ALTER TABLE products ADD COLUMN IF NOT EXISTS shopify_variant_id VARCHAR(255);
ALTER TABLE products ADD COLUMN IF NOT EXISTS shopify_data JSONB;
ALTER TABLE products ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMP;
ALTER TABLE products ADD COLUMN IF NOT EXISTS sync_status VARCHAR(50) DEFAULT 'synced';

CREATE INDEX IF NOT EXISTS idx_products_shopify_id ON products(shopify_product_id) WHERE shopify_product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_sync_status ON products(sync_status);

-- Update customers table for Shopify sync
ALTER TABLE customers ADD COLUMN IF NOT EXISTS shopify_customer_id VARCHAR(255);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS shopify_data JSONB;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMP;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS sync_status VARCHAR(50) DEFAULT 'synced';

CREATE INDEX IF NOT EXISTS idx_customers_shopify_id ON customers(shopify_customer_id) WHERE shopify_customer_id IS NOT NULL;

-- Update orders table for Shopify sync
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shopify_order_id VARCHAR(255);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shopify_order_number VARCHAR(100);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shopify_data JSONB;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMP;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS sync_status VARCHAR(50) DEFAULT 'synced';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS n8n_sent BOOLEAN DEFAULT FALSE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS n8n_sent_at TIMESTAMP;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS n8n_error TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS n8n_retry_count INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_orders_shopify_id ON orders(shopify_order_id) WHERE shopify_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_shopify_number ON orders(shopify_order_number) WHERE shopify_order_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_n8n_sent ON orders(n8n_sent);

-- Shopify webhook events log
-- Stores all incoming webhook events for audit and replay
CREATE TABLE IF NOT EXISTS shopify_webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    integration_id UUID REFERENCES shopify_integrations(id) ON DELETE CASCADE,
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,

    -- Event data
    event_type VARCHAR(100) NOT NULL,
    shopify_topic VARCHAR(255) NOT NULL,
    shopify_event_id VARCHAR(255),

    -- Payload
    payload JSONB NOT NULL,
    headers JSONB,

    -- Processing status
    processed BOOLEAN DEFAULT FALSE,
    processed_at TIMESTAMP,
    processing_error TEXT,
    retry_count INTEGER DEFAULT 0,

    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_shopify_webhook_events_integration ON shopify_webhook_events(integration_id);
CREATE INDEX idx_shopify_webhook_events_store ON shopify_webhook_events(store_id);
CREATE INDEX idx_shopify_webhook_events_type ON shopify_webhook_events(event_type);
CREATE INDEX idx_shopify_webhook_events_processed ON shopify_webhook_events(processed);
CREATE INDEX idx_shopify_webhook_events_created ON shopify_webhook_events(created_at DESC);

-- Shopify sync conflicts table
-- Tracks conflicts when local and Shopify data diverge
CREATE TABLE IF NOT EXISTS shopify_sync_conflicts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    integration_id UUID NOT NULL REFERENCES shopify_integrations(id) ON DELETE CASCADE,
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,

    -- Conflict details
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID NOT NULL,
    shopify_entity_id VARCHAR(255),

    -- Conflict data
    local_data JSONB NOT NULL,
    shopify_data JSONB NOT NULL,
    conflict_fields JSONB,

    -- Resolution
    resolution_strategy VARCHAR(50),
    resolved BOOLEAN DEFAULT FALSE,
    resolved_at TIMESTAMP,
    resolved_by UUID REFERENCES users(id),

    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_shopify_sync_conflicts_integration ON shopify_sync_conflicts(integration_id);
CREATE INDEX idx_shopify_sync_conflicts_store ON shopify_sync_conflicts(store_id);
CREATE INDEX idx_shopify_sync_conflicts_entity ON shopify_sync_conflicts(entity_type, entity_id);
CREATE INDEX idx_shopify_sync_conflicts_resolved ON shopify_sync_conflicts(resolved);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_shopify_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE TRIGGER update_shopify_integrations_updated_at
    BEFORE UPDATE ON shopify_integrations
    FOR EACH ROW
    EXECUTE FUNCTION update_shopify_updated_at();

CREATE TRIGGER update_shopify_import_jobs_updated_at
    BEFORE UPDATE ON shopify_import_jobs
    FOR EACH ROW
    EXECUTE FUNCTION update_shopify_updated_at();

-- Comments for documentation
COMMENT ON TABLE shopify_integrations IS 'Stores Shopify integration configuration and credentials for each store';
COMMENT ON TABLE shopify_import_jobs IS 'Tracks background import jobs with progress monitoring and pagination';
COMMENT ON TABLE shopify_webhook_events IS 'Logs all incoming Shopify webhook events for audit and replay';
COMMENT ON TABLE shopify_sync_conflicts IS 'Tracks synchronization conflicts between local and Shopify data';

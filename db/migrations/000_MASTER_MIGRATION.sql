-- ================================================================
-- ORDEFY - MASTER DATABASE MIGRATION
-- ================================================================
-- Este archivo consolida TODAS las migraciones necesarias del proyecto
-- Puede ejecutarse múltiples veces (idempotente) gracias a los IF NOT EXISTS
-- ================================================================
-- IMPORTANTE: Ejecutar en orden secuencial
-- ================================================================

-- ================================================================
-- EXTENSIONES
-- ================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ================================================================
-- PARTE 1: TABLAS BASE (stores, users, store_config)
-- ================================================================

CREATE TABLE IF NOT EXISTS stores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    country VARCHAR(2),
    timezone VARCHAR(50) DEFAULT 'America/Asuncion',
    currency VARCHAR(3) DEFAULT 'USD',
    tax_rate DECIMAL(5,2) DEFAULT 10.00,
    admin_fee DECIMAL(5,2) DEFAULT 0.00,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    role VARCHAR(50) DEFAULT 'user',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS user_stores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    role VARCHAR(50) DEFAULT 'admin',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, store_id)
);

CREATE INDEX IF NOT EXISTS idx_user_stores_user ON user_stores(user_id);
CREATE INDEX IF NOT EXISTS idx_user_stores_store ON user_stores(store_id);

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

-- ================================================================
-- PARTE 2: TABLAS DE NEGOCIO (products, customers, carriers, suppliers, campaigns)
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
    shopify_data JSONB,
    last_synced_at TIMESTAMP,
    sync_status VARCHAR(50) DEFAULT 'synced',
    sku VARCHAR(255),
    category VARCHAR(100),
    is_active BOOLEAN DEFAULT TRUE,
    modified_by VARCHAR(100) DEFAULT 'system',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_store ON products(store_id);
CREATE INDEX IF NOT EXISTS idx_products_shopify ON products(store_id, shopify_product_id);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(store_id, sku);
CREATE INDEX IF NOT EXISTS idx_products_shopify_id ON products(shopify_product_id) WHERE shopify_product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_sync_status ON products(sync_status);

CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    shopify_customer_id VARCHAR(255),
    shopify_data JSONB,
    last_synced_at TIMESTAMP,
    sync_status VARCHAR(50) DEFAULT 'synced',
    email VARCHAR(255),
    phone VARCHAR(20),
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    name VARCHAR(255),
    address TEXT,
    city VARCHAR(100),
    state VARCHAR(100),
    postal_code VARCHAR(20),
    country VARCHAR(100),
    notes TEXT,
    tags TEXT,
    total_orders INT DEFAULT 0,
    total_spent DECIMAL(10,2) DEFAULT 0,
    last_order_at TIMESTAMP,
    accepts_marketing BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customers_store ON customers(store_id);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(store_id, email);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(store_id, phone);
CREATE INDEX IF NOT EXISTS idx_customers_shopify ON customers(store_id, shopify_customer_id);
CREATE INDEX IF NOT EXISTS idx_customers_shopify_id ON customers(shopify_customer_id) WHERE shopify_customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_store_phone ON customers(store_id, phone) WHERE phone IS NOT NULL AND phone <> '';
CREATE INDEX IF NOT EXISTS idx_customers_city ON customers(store_id, city);
CREATE INDEX IF NOT EXISTS idx_customers_country ON customers(store_id, country);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(store_id, name);
CREATE INDEX IF NOT EXISTS idx_customers_store_email ON customers(store_id, email) WHERE email IS NOT NULL AND email <> '';

CREATE TABLE IF NOT EXISTS carriers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    email VARCHAR(255),
    vehicle_type VARCHAR(50),
    license_plate VARCHAR(20),
    is_active BOOLEAN DEFAULT TRUE,
    notes TEXT,
    total_deliveries INT DEFAULT 0,
    successful_deliveries INT DEFAULT 0,
    failed_deliveries INT DEFAULT 0,
    delivery_rate DECIMAL(5,2) GENERATED ALWAYS AS (
        CASE
            WHEN total_deliveries > 0 THEN (successful_deliveries::DECIMAL / total_deliveries * 100)
            ELSE 0
        END
    ) STORED,
    average_rating DECIMAL(3,2) DEFAULT 0.00,
    total_ratings INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_carriers_store ON carriers(store_id);
CREATE INDEX IF NOT EXISTS idx_carriers_active ON carriers(store_id, is_active);

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

CREATE INDEX IF NOT EXISTS idx_suppliers_store ON suppliers(store_id);

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

CREATE INDEX IF NOT EXISTS idx_campaigns_store ON campaigns(store_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(store_id, status);

CREATE TABLE IF NOT EXISTS shipping_integrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    carrier_name VARCHAR(255),
    api_key TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    settings JSONB,
    coverage_zones TEXT,
    contact_phone VARCHAR(20),
    contact_email VARCHAR(255),
    modified_by VARCHAR(100) DEFAULT 'system',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shipping_store ON shipping_integrations(store_id);

CREATE TABLE IF NOT EXISTS additional_values (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    category VARCHAR(50) NOT NULL,
    description TEXT NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    type VARCHAR(20) NOT NULL,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_additional_values_store ON additional_values(store_id);
CREATE INDEX IF NOT EXISTS idx_additional_values_date ON additional_values(store_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_additional_values_type ON additional_values(store_id, type);
CREATE INDEX IF NOT EXISTS idx_additional_values_category ON additional_values(store_id, category);

-- ================================================================
-- PARTE 3: TABLA DE PEDIDOS (orders)
-- ================================================================

CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES customers(id),
    shopify_order_id VARCHAR(255),
    shopify_order_number VARCHAR(100),
    shopify_data JSONB,
    shopify_raw_json JSONB,
    last_synced_at TIMESTAMP,
    sync_status VARCHAR(50) DEFAULT 'synced',
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
    in_transit_at TIMESTAMP,
    delivered_at TIMESTAMP,
    cancelled_at TIMESTAMP,
    reconciled_at TIMESTAMP,
    confirmation_method VARCHAR(50),
    confirmed_by VARCHAR(100),
    follow_up_1_sent_at TIMESTAMP,
    follow_up_2_sent_at TIMESTAMP,
    follow_up_3_sent_at TIMESTAMP,
    n8n_processed_at TIMESTAMP,
    n8n_sent BOOLEAN DEFAULT FALSE,
    n8n_sent_at TIMESTAMP,
    n8n_error TEXT,
    n8n_retry_count INTEGER DEFAULT 0,
    rejection_reason TEXT,
    payment_status VARCHAR(20) DEFAULT 'pending',
    payment_method VARCHAR(50) DEFAULT 'online',
    delivery_attempts INT DEFAULT 0,
    failed_reason TEXT,
    risk_score INT DEFAULT 0,
    customer_address TEXT,
    address_reference TEXT,
    neighborhood VARCHAR(100),
    delivery_notes TEXT,
    phone_backup VARCHAR(20),
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    upsell_added BOOLEAN DEFAULT FALSE,
    courier_id UUID REFERENCES carriers(id) ON DELETE SET NULL,
    proof_photo_url TEXT,
    qr_code_url TEXT,
    delivery_link_token VARCHAR(10) UNIQUE,
    delivery_status VARCHAR(20) DEFAULT 'pending',
    delivery_failure_reason TEXT,
    delivery_rating INT CHECK (delivery_rating >= 1 AND delivery_rating <= 5),
    delivery_rating_comment TEXT,
    rated_at TIMESTAMP,
    cod_amount DECIMAL(10,2) DEFAULT 0.00,
    printed BOOLEAN DEFAULT FALSE,
    printed_at TIMESTAMP,
    printed_by VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_store ON orders(store_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(store_id, sleeves_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(store_id, customer_phone);
CREATE INDEX IF NOT EXISTS idx_orders_shopify ON orders(shopify_order_id);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_courier ON orders(courier_id);
CREATE INDEX IF NOT EXISTS idx_orders_delivery_token ON orders(delivery_link_token);
CREATE INDEX IF NOT EXISTS idx_orders_delivery_status ON orders(store_id, delivery_status);
CREATE INDEX IF NOT EXISTS idx_orders_rating ON orders(courier_id, delivery_rating) WHERE delivery_rating IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_n8n_sent ON orders(n8n_sent);
CREATE INDEX IF NOT EXISTS idx_orders_printed ON orders(store_id, printed);
CREATE INDEX IF NOT EXISTS idx_orders_in_transit_at ON orders(in_transit_at) WHERE in_transit_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_delivered_at ON orders(delivered_at) WHERE delivered_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_cancelled_at ON orders(cancelled_at) WHERE cancelled_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_cod ON orders(payment_method, cod_amount) WHERE payment_method = 'cash' OR cod_amount > 0;

-- ================================================================
-- CRITICAL: UNIQUE CONSTRAINT for Shopify UPSERTS
-- ================================================================
-- DO NOT use CREATE UNIQUE INDEX with WHERE clause - it cannot be used in ON CONFLICT
-- Use ALTER TABLE ADD CONSTRAINT instead
DO $$
BEGIN
    -- Drop old indexes/constraints if they exist
    DROP INDEX IF EXISTS idx_orders_shopify_id;
    DROP INDEX IF EXISTS orders_shopify_order_id_key;

    -- Add constraint if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'orders'::regclass
        AND conname = 'idx_orders_shopify_store_unique'
    ) THEN
        ALTER TABLE orders
        ADD CONSTRAINT idx_orders_shopify_store_unique
        UNIQUE (shopify_order_id, store_id);
    END IF;
END $$;

-- ================================================================
-- PARTE 4: TABLAS DE HISTORIAL Y LOGS
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

CREATE INDEX IF NOT EXISTS idx_history_order ON order_status_history(order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_history_store ON order_status_history(store_id, created_at DESC);

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

CREATE INDEX IF NOT EXISTS idx_followup_scheduled ON follow_up_log(store_id, scheduled_for, status);
CREATE INDEX IF NOT EXISTS idx_followup_order ON follow_up_log(order_id);

-- ================================================================
-- PARTE 5: TABLAS DE DELIVERY/COD
-- ================================================================

CREATE TABLE IF NOT EXISTS delivery_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    carrier_id UUID REFERENCES carriers(id),
    attempt_number INT NOT NULL,
    scheduled_date DATE NOT NULL,
    actual_date DATE,
    status VARCHAR(50) NOT NULL DEFAULT 'scheduled',
    notes TEXT,
    failed_reason TEXT,
    failure_notes TEXT,
    photo_url TEXT,
    payment_method VARCHAR(50),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    CONSTRAINT unique_order_attempt UNIQUE(order_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS idx_delivery_attempts_order ON delivery_attempts(order_id);
CREATE INDEX IF NOT EXISTS idx_delivery_attempts_store ON delivery_attempts(store_id);
CREATE INDEX IF NOT EXISTS idx_delivery_attempts_date ON delivery_attempts(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_delivery_attempts_status ON delivery_attempts(status);
CREATE INDEX IF NOT EXISTS idx_delivery_attempts_carrier ON delivery_attempts(carrier_id);
CREATE INDEX IF NOT EXISTS idx_delivery_attempts_payment_method ON delivery_attempts(payment_method) WHERE payment_method IS NOT NULL;

CREATE TABLE IF NOT EXISTS daily_settlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    carrier_id UUID REFERENCES carriers(id),
    settlement_date DATE NOT NULL,
    expected_cash DECIMAL(10,2) NOT NULL DEFAULT 0,
    collected_cash DECIMAL(10,2) NOT NULL DEFAULT 0,
    difference DECIMAL(10,2) GENERATED ALWAYS AS (collected_cash - expected_cash) STORED,
    status VARCHAR(20) DEFAULT 'pending',
    notes TEXT,
    settled_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    CONSTRAINT unique_store_date_carrier UNIQUE(store_id, settlement_date, carrier_id)
);

CREATE INDEX IF NOT EXISTS idx_settlements_store ON daily_settlements(store_id);
CREATE INDEX IF NOT EXISTS idx_settlements_date ON daily_settlements(settlement_date);
CREATE INDEX IF NOT EXISTS idx_settlements_status ON daily_settlements(status);
CREATE INDEX IF NOT EXISTS idx_settlements_carrier ON daily_settlements(carrier_id);

CREATE TABLE IF NOT EXISTS settlement_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    settlement_id UUID NOT NULL REFERENCES daily_settlements(id) ON DELETE CASCADE,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    amount DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    CONSTRAINT unique_settlement_order UNIQUE(settlement_id, order_id)
);

CREATE INDEX IF NOT EXISTS idx_settlement_orders_settlement ON settlement_orders(settlement_id);
CREATE INDEX IF NOT EXISTS idx_settlement_orders_order ON settlement_orders(order_id);

-- ================================================================
-- PARTE 6: TABLAS DE SHOPIFY INTEGRACIÓN
-- ================================================================

CREATE TABLE IF NOT EXISTS shopify_integrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    shop_domain VARCHAR(255) NOT NULL,
    shop VARCHAR(255),
    api_key VARCHAR(255),
    api_secret_key VARCHAR(255),
    access_token TEXT NOT NULL,
    webhook_signature VARCHAR(255),
    scope TEXT,
    import_products BOOLEAN DEFAULT FALSE,
    import_customers BOOLEAN DEFAULT FALSE,
    import_orders BOOLEAN DEFAULT FALSE,
    import_historical_orders BOOLEAN DEFAULT FALSE,
    status VARCHAR(50) DEFAULT 'active',
    last_sync_at TIMESTAMP,
    sync_error TEXT,
    shopify_shop_id VARCHAR(255),
    shop_name VARCHAR(255),
    shop_email VARCHAR(255),
    shop_currency VARCHAR(10),
    shop_timezone VARCHAR(100),
    shop_data JSONB,
    installed_at TIMESTAMP DEFAULT NOW(),
    uninstalled_at TIMESTAMP,
    webhook_registration_success INTEGER DEFAULT 0,
    webhook_registration_failed INTEGER DEFAULT 0,
    webhook_registration_errors JSONB,
    last_webhook_attempt TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(store_id, shop_domain)
);

CREATE INDEX IF NOT EXISTS idx_shopify_integrations_store ON shopify_integrations(store_id);
CREATE INDEX IF NOT EXISTS idx_shopify_integrations_status ON shopify_integrations(status);
CREATE INDEX IF NOT EXISTS idx_shopify_integrations_user ON shopify_integrations(user_id);
CREATE INDEX IF NOT EXISTS idx_shopify_integrations_shop ON shopify_integrations(shop);
CREATE INDEX IF NOT EXISTS idx_shopify_integrations_webhook_errors ON shopify_integrations(webhook_registration_failed) WHERE webhook_registration_failed > 0;
CREATE INDEX IF NOT EXISTS idx_shopify_integrations_last_attempt ON shopify_integrations(last_webhook_attempt);

CREATE TABLE IF NOT EXISTS shopify_oauth_states (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    state VARCHAR(255) UNIQUE NOT NULL,
    shop_domain VARCHAR(255) NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    store_id UUID REFERENCES stores(id) ON DELETE CASCADE,
    expires_at TIMESTAMP NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oauth_states_state ON shopify_oauth_states(state);
CREATE INDEX IF NOT EXISTS idx_oauth_states_shop ON shopify_oauth_states(shop_domain);
CREATE INDEX IF NOT EXISTS idx_oauth_states_user ON shopify_oauth_states(user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_states_store ON shopify_oauth_states(store_id);
CREATE INDEX IF NOT EXISTS idx_oauth_states_expires ON shopify_oauth_states(expires_at);

CREATE TABLE IF NOT EXISTS shopify_import_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    integration_id UUID NOT NULL REFERENCES shopify_integrations(id) ON DELETE CASCADE,
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    job_type VARCHAR(50) NOT NULL,
    import_type VARCHAR(50) NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    total_items INTEGER DEFAULT 0,
    processed_items INTEGER DEFAULT 0,
    failed_items INTEGER DEFAULT 0,
    success_items INTEGER DEFAULT 0,
    current_page INTEGER DEFAULT 1,
    page_size INTEGER DEFAULT 50,
    has_more BOOLEAN DEFAULT TRUE,
    last_cursor VARCHAR(255),
    error_message TEXT,
    error_details JSONB,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shopify_import_jobs_integration ON shopify_import_jobs(integration_id);
CREATE INDEX IF NOT EXISTS idx_shopify_import_jobs_store ON shopify_import_jobs(store_id);
CREATE INDEX IF NOT EXISTS idx_shopify_import_jobs_status ON shopify_import_jobs(status);
CREATE INDEX IF NOT EXISTS idx_shopify_import_jobs_type ON shopify_import_jobs(job_type, import_type);

CREATE TABLE IF NOT EXISTS shopify_webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    integration_id UUID REFERENCES shopify_integrations(id) ON DELETE CASCADE,
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    event_type VARCHAR(100) NOT NULL,
    shopify_topic VARCHAR(255) NOT NULL,
    shopify_event_id VARCHAR(255),
    payload JSONB NOT NULL,
    headers JSONB,
    processed BOOLEAN DEFAULT FALSE,
    processed_at TIMESTAMP,
    processing_error TEXT,
    retry_count INTEGER DEFAULT 0,
    idempotency_key VARCHAR(500),
    is_duplicate BOOLEAN DEFAULT FALSE,
    original_event_id UUID REFERENCES shopify_webhook_events(id),
    processing_time_ms INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shopify_webhook_events_integration ON shopify_webhook_events(integration_id);
CREATE INDEX IF NOT EXISTS idx_shopify_webhook_events_store ON shopify_webhook_events(store_id);
CREATE INDEX IF NOT EXISTS idx_shopify_webhook_events_type ON shopify_webhook_events(event_type);
CREATE INDEX IF NOT EXISTS idx_shopify_webhook_events_processed ON shopify_webhook_events(processed);
CREATE INDEX IF NOT EXISTS idx_shopify_webhook_events_created ON shopify_webhook_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_events_idempotency ON shopify_webhook_events(idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS shopify_sync_conflicts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    integration_id UUID NOT NULL REFERENCES shopify_integrations(id) ON DELETE CASCADE,
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID NOT NULL,
    shopify_entity_id VARCHAR(255),
    local_data JSONB NOT NULL,
    shopify_data JSONB NOT NULL,
    conflict_fields JSONB,
    resolution_strategy VARCHAR(50),
    resolved BOOLEAN DEFAULT FALSE,
    resolved_at TIMESTAMP,
    resolved_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shopify_sync_conflicts_integration ON shopify_sync_conflicts(integration_id);
CREATE INDEX IF NOT EXISTS idx_shopify_sync_conflicts_store ON shopify_sync_conflicts(store_id);
CREATE INDEX IF NOT EXISTS idx_shopify_sync_conflicts_entity ON shopify_sync_conflicts(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_shopify_sync_conflicts_resolved ON shopify_sync_conflicts(resolved);

-- ================================================================
-- PARTE 7: TABLAS DE WEBHOOK RELIABILITY
-- ================================================================

CREATE TABLE IF NOT EXISTS shopify_webhook_idempotency (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    integration_id UUID NOT NULL REFERENCES shopify_integrations(id) ON DELETE CASCADE,
    idempotency_key VARCHAR(500) NOT NULL UNIQUE,
    shopify_event_id VARCHAR(255) NOT NULL,
    shopify_topic VARCHAR(255) NOT NULL,
    processed BOOLEAN DEFAULT FALSE,
    processed_at TIMESTAMP,
    response_status INTEGER,
    response_body TEXT,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_idempotency_key ON shopify_webhook_idempotency(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_webhook_idempotency_expires ON shopify_webhook_idempotency(expires_at);
CREATE INDEX IF NOT EXISTS idx_webhook_idempotency_created ON shopify_webhook_idempotency(created_at DESC);

CREATE TABLE IF NOT EXISTS shopify_webhook_retry_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    integration_id UUID NOT NULL REFERENCES shopify_integrations(id) ON DELETE CASCADE,
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    webhook_event_id UUID REFERENCES shopify_webhook_events(id) ON DELETE CASCADE,
    shopify_topic VARCHAR(255) NOT NULL,
    payload JSONB NOT NULL,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 5,
    next_retry_at TIMESTAMP NOT NULL,
    last_error TEXT,
    last_error_code VARCHAR(50),
    error_history JSONB DEFAULT '[]'::jsonb,
    status VARCHAR(50) DEFAULT 'pending',
    backoff_seconds INTEGER DEFAULT 60,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_webhook_retry_integration ON shopify_webhook_retry_queue(integration_id);
CREATE INDEX IF NOT EXISTS idx_webhook_retry_store ON shopify_webhook_retry_queue(store_id);
CREATE INDEX IF NOT EXISTS idx_webhook_retry_status ON shopify_webhook_retry_queue(status);
CREATE INDEX IF NOT EXISTS idx_webhook_retry_next ON shopify_webhook_retry_queue(next_retry_at) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS shopify_webhook_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    integration_id UUID NOT NULL REFERENCES shopify_integrations(id) ON DELETE CASCADE,
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    metric_date DATE NOT NULL,
    metric_hour INTEGER NOT NULL,
    webhooks_received INTEGER DEFAULT 0,
    webhooks_processed INTEGER DEFAULT 0,
    webhooks_failed INTEGER DEFAULT 0,
    webhooks_retried INTEGER DEFAULT 0,
    webhooks_duplicates INTEGER DEFAULT 0,
    avg_processing_time_ms INTEGER DEFAULT 0,
    max_processing_time_ms INTEGER DEFAULT 0,
    min_processing_time_ms INTEGER DEFAULT 0,
    error_401_count INTEGER DEFAULT 0,
    error_404_count INTEGER DEFAULT 0,
    error_500_count INTEGER DEFAULT 0,
    error_timeout_count INTEGER DEFAULT 0,
    error_other_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(integration_id, metric_date, metric_hour)
);

CREATE INDEX IF NOT EXISTS idx_webhook_metrics_integration ON shopify_webhook_metrics(integration_id);
CREATE INDEX IF NOT EXISTS idx_webhook_metrics_date ON shopify_webhook_metrics(metric_date DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_metrics_store ON shopify_webhook_metrics(store_id);

-- ================================================================
-- PARTE 8: FUNCIONES Y TRIGGERS
-- ================================================================

-- Función para actualizar updated_at
CREATE OR REPLACE FUNCTION fn_update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Función para actualizar stats de clientes
CREATE OR REPLACE FUNCTION fn_update_customer_stats()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.customer_id IS NOT NULL THEN
        UPDATE customers
        SET
            total_orders = total_orders + 1,
            total_spent = total_spent + COALESCE(NEW.total_price, 0),
            last_order_at = NEW.created_at,
            updated_at = NOW()
        WHERE id = NEW.customer_id
        AND store_id = NEW.store_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Función para actualizar stats cuando cambia el total
CREATE OR REPLACE FUNCTION fn_update_customer_stats_on_update()
RETURNS TRIGGER AS $$
DECLARE
    v_diff DECIMAL(10,2);
BEGIN
    IF NEW.customer_id IS NOT NULL AND OLD.total_price IS DISTINCT FROM NEW.total_price THEN
        v_diff := COALESCE(NEW.total_price, 0) - COALESCE(OLD.total_price, 0);
        UPDATE customers
        SET
            total_spent = total_spent + v_diff,
            updated_at = NOW()
        WHERE id = NEW.customer_id
        AND store_id = NEW.store_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Función para log de cambios de estado
CREATE OR REPLACE FUNCTION fn_log_order_status_change()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.sleeves_status IS DISTINCT FROM NEW.sleeves_status THEN
        INSERT INTO order_status_history (
            order_id, store_id, previous_status, new_status,
            changed_by, changed_by_n8n, change_source, notes, created_at
        ) VALUES (
            NEW.id, NEW.store_id, OLD.sleeves_status, NEW.sleeves_status,
            COALESCE(NEW.confirmed_by, 'unknown'),
            (NEW.confirmed_by IS NULL),
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

-- Función para generar token de delivery
CREATE OR REPLACE FUNCTION generate_delivery_token()
RETURNS VARCHAR(10) AS $$
DECLARE
    chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    result TEXT := '';
    i INT;
BEGIN
    FOR i IN 1..10 LOOP
        result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
    END LOOP;
    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Función para setear delivery token
CREATE OR REPLACE FUNCTION set_delivery_token()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.sleeves_status = 'confirmed' AND NEW.delivery_link_token IS NULL THEN
        NEW.delivery_link_token := generate_delivery_token();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Función para actualizar stats de carriers
CREATE OR REPLACE FUNCTION update_carrier_delivery_stats()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.delivery_status != OLD.delivery_status AND NEW.courier_id IS NOT NULL THEN
        IF NEW.delivery_status = 'confirmed' THEN
            UPDATE carriers
            SET total_deliveries = total_deliveries + 1, successful_deliveries = successful_deliveries + 1
            WHERE id = NEW.courier_id;
        ELSIF NEW.delivery_status = 'failed' THEN
            UPDATE carriers
            SET total_deliveries = total_deliveries + 1, failed_deliveries = failed_deliveries + 1
            WHERE id = NEW.courier_id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Función para actualizar rating de carriers
CREATE OR REPLACE FUNCTION update_carrier_rating()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.delivery_rating IS NOT NULL AND
       (OLD.delivery_rating IS NULL OR OLD.delivery_rating != NEW.delivery_rating) AND
       NEW.courier_id IS NOT NULL THEN
        UPDATE carriers
        SET
            average_rating = (
                SELECT COALESCE(AVG(delivery_rating), 0)
                FROM orders
                WHERE courier_id = NEW.courier_id AND delivery_rating IS NOT NULL
            ),
            total_ratings = (
                SELECT COUNT(*)
                FROM orders
                WHERE courier_id = NEW.courier_id AND delivery_rating IS NOT NULL
            )
        WHERE id = NEW.courier_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Función para calcular COD amount
CREATE OR REPLACE FUNCTION calculate_cod_amount()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.payment_method IN ('cash', 'efectivo') THEN
        -- Cast to DECIMAL to match total_price type
        NEW.cod_amount = COALESCE(NEW.total_price, 0.0);
    ELSE
        -- Cast to DECIMAL to match cod_amount type
        NEW.cod_amount = 0.0;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Función para limpiar idempotency keys expiradas
CREATE OR REPLACE FUNCTION cleanup_expired_idempotency_keys()
RETURNS void AS $$
BEGIN
    DELETE FROM shopify_webhook_idempotency WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- Función para limpiar OAuth states expirados
CREATE OR REPLACE FUNCTION cleanup_expired_oauth_states()
RETURNS void AS $$
BEGIN
    DELETE FROM shopify_oauth_states
    WHERE expires_at < NOW() OR (used = TRUE AND created_at < NOW() - INTERVAL '1 hour');
END;
$$ LANGUAGE plpgsql;

-- Función para limpiar fotos de delivery antiguas
CREATE OR REPLACE FUNCTION delete_old_delivery_photos()
RETURNS void AS $$
DECLARE
    old_photo RECORD;
BEGIN
    FOR old_photo IN
        SELECT photo_url FROM delivery_attempts
        WHERE photo_url IS NOT NULL
          AND actual_date < CURRENT_DATE - INTERVAL '1 day'
          AND photo_url LIKE '%delivery-photos%'
    LOOP
        UPDATE delivery_attempts SET photo_url = NULL WHERE photo_url = old_photo.photo_url;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Función para Shopify updated_at
CREATE OR REPLACE FUNCTION update_shopify_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Función para métricas de webhooks
CREATE OR REPLACE FUNCTION record_webhook_metric(
    p_integration_id UUID,
    p_store_id UUID,
    p_metric_type VARCHAR(50),
    p_processing_time_ms INTEGER DEFAULT 0,
    p_error_code VARCHAR(50) DEFAULT NULL
)
RETURNS void AS $$
DECLARE
    v_date DATE := CURRENT_DATE;
    v_hour INTEGER := EXTRACT(HOUR FROM NOW());
BEGIN
    INSERT INTO shopify_webhook_metrics (
        integration_id, store_id, metric_date, metric_hour,
        webhooks_received, webhooks_processed, webhooks_failed, webhooks_retried, webhooks_duplicates,
        avg_processing_time_ms, max_processing_time_ms, min_processing_time_ms,
        error_401_count, error_404_count, error_500_count, error_timeout_count, error_other_count
    )
    VALUES (
        p_integration_id, p_store_id, v_date, v_hour,
        CASE WHEN p_metric_type = 'received' THEN 1 ELSE 0 END,
        CASE WHEN p_metric_type = 'processed' THEN 1 ELSE 0 END,
        CASE WHEN p_metric_type = 'failed' THEN 1 ELSE 0 END,
        CASE WHEN p_metric_type = 'retried' THEN 1 ELSE 0 END,
        CASE WHEN p_metric_type = 'duplicate' THEN 1 ELSE 0 END,
        p_processing_time_ms, p_processing_time_ms, p_processing_time_ms,
        CASE WHEN p_error_code = '401' THEN 1 ELSE 0 END,
        CASE WHEN p_error_code = '404' THEN 1 ELSE 0 END,
        CASE WHEN p_error_code = '500' THEN 1 ELSE 0 END,
        CASE WHEN p_error_code = 'timeout' THEN 1 ELSE 0 END,
        CASE WHEN p_error_code NOT IN ('401', '404', '500', 'timeout') AND p_error_code IS NOT NULL THEN 1 ELSE 0 END
    )
    ON CONFLICT (integration_id, metric_date, metric_hour) DO UPDATE SET
        webhooks_received = shopify_webhook_metrics.webhooks_received + CASE WHEN p_metric_type = 'received' THEN 1 ELSE 0 END,
        webhooks_processed = shopify_webhook_metrics.webhooks_processed + CASE WHEN p_metric_type = 'processed' THEN 1 ELSE 0 END,
        webhooks_failed = shopify_webhook_metrics.webhooks_failed + CASE WHEN p_metric_type = 'failed' THEN 1 ELSE 0 END,
        webhooks_retried = shopify_webhook_metrics.webhooks_retried + CASE WHEN p_metric_type = 'retried' THEN 1 ELSE 0 END,
        webhooks_duplicates = shopify_webhook_metrics.webhooks_duplicates + CASE WHEN p_metric_type = 'duplicate' THEN 1 ELSE 0 END,
        avg_processing_time_ms = CASE
            WHEN p_processing_time_ms > 0 THEN
                ((shopify_webhook_metrics.avg_processing_time_ms * shopify_webhook_metrics.webhooks_processed) + p_processing_time_ms) /
                (shopify_webhook_metrics.webhooks_processed + 1)
            ELSE shopify_webhook_metrics.avg_processing_time_ms
        END,
        max_processing_time_ms = GREATEST(shopify_webhook_metrics.max_processing_time_ms, p_processing_time_ms),
        min_processing_time_ms = CASE
            WHEN shopify_webhook_metrics.min_processing_time_ms = 0 THEN p_processing_time_ms
            ELSE LEAST(shopify_webhook_metrics.min_processing_time_ms, p_processing_time_ms)
        END,
        error_401_count = shopify_webhook_metrics.error_401_count + CASE WHEN p_error_code = '401' THEN 1 ELSE 0 END,
        error_404_count = shopify_webhook_metrics.error_404_count + CASE WHEN p_error_code = '404' THEN 1 ELSE 0 END,
        error_500_count = shopify_webhook_metrics.error_500_count + CASE WHEN p_error_code = '500' THEN 1 ELSE 0 END,
        error_timeout_count = shopify_webhook_metrics.error_timeout_count + CASE WHEN p_error_code = 'timeout' THEN 1 ELSE 0 END,
        error_other_count = shopify_webhook_metrics.error_other_count +
            CASE WHEN p_error_code NOT IN ('401', '404', '500', 'timeout') AND p_error_code IS NOT NULL THEN 1 ELSE 0 END,
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- FUNCIONES PARA MERCADERÍA
-- ================================================================

-- Función para generar referencia interna de inbound shipments
CREATE OR REPLACE FUNCTION generate_inbound_reference(p_store_id UUID)
RETURNS VARCHAR(50) AS $$
DECLARE
  v_date_part VARCHAR(8);
  v_sequence INTEGER;
  v_reference VARCHAR(50);
BEGIN
  v_date_part := TO_CHAR(NOW(), 'YYYYMMDD');
  SELECT COUNT(*) + 1 INTO v_sequence
  FROM inbound_shipments
  WHERE store_id = p_store_id
    AND DATE(created_at) = CURRENT_DATE;
  v_reference := 'ISH-' || v_date_part || '-' || LPAD(v_sequence::TEXT, 3, '0');
  RETURN v_reference;
END;
$$ LANGUAGE plpgsql;

-- Función para actualizar timestamp de inbound shipments
CREATE OR REPLACE FUNCTION update_inbound_shipment_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Función para actualizar total_cost de shipment
CREATE OR REPLACE FUNCTION update_shipment_total_cost()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE inbound_shipments
  SET total_cost = (
    SELECT COALESCE(SUM(total_cost), 0)
    FROM inbound_shipment_items
    WHERE shipment_id = COALESCE(NEW.shipment_id, OLD.shipment_id)
  )
  WHERE id = COALESCE(NEW.shipment_id, OLD.shipment_id);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Función para recibir mercadería y actualizar inventario
CREATE OR REPLACE FUNCTION receive_shipment_items(
  p_shipment_id UUID,
  p_items JSONB,
  p_received_by UUID
)
RETURNS JSONB AS $$
DECLARE
  v_item JSONB;
  v_product_id UUID;
  v_qty_received INTEGER;
  v_qty_rejected INTEGER;
  v_qty_ordered INTEGER;
  v_all_complete BOOLEAN := TRUE;
  v_any_received BOOLEAN := FALSE;
  v_updated_count INTEGER := 0;
BEGIN
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty_received := (v_item->>'qty_received')::INTEGER;
    v_qty_rejected := COALESCE((v_item->>'qty_rejected')::INTEGER, 0);

    UPDATE inbound_shipment_items
    SET
      qty_received = v_qty_received,
      qty_rejected = v_qty_rejected,
      discrepancy_notes = v_item->>'discrepancy_notes',
      updated_at = NOW()
    WHERE id = (v_item->>'item_id')::UUID
    RETURNING product_id, qty_ordered INTO v_product_id, v_qty_ordered;

    IF v_qty_received > 0 THEN
      UPDATE products
      SET
        stock = stock + v_qty_received,
        updated_at = NOW()
      WHERE id = v_product_id;
      v_any_received := TRUE;
    END IF;

    IF v_qty_received < v_qty_ordered THEN
      v_all_complete := FALSE;
    END IF;

    v_updated_count := v_updated_count + 1;
  END LOOP;

  UPDATE inbound_shipments
  SET
    status = CASE
      WHEN v_all_complete THEN 'received'
      WHEN v_any_received THEN 'partial'
      ELSE 'pending'
    END,
    received_date = CASE
      WHEN v_any_received THEN NOW()
      ELSE received_date
    END,
    received_by = CASE
      WHEN v_any_received THEN p_received_by
      ELSE received_by
    END,
    updated_at = NOW()
  WHERE id = p_shipment_id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'items_updated', v_updated_count,
    'status', CASE
      WHEN v_all_complete THEN 'received'
      WHEN v_any_received THEN 'partial'
      ELSE 'pending'
    END
  );
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- FUNCIONES PARA WAREHOUSE
-- ================================================================

-- Función para generar código único de sesión
-- Format: PREP-DDMMYYYY-NN (e.g., PREP-02122025-01 for Dec 2, 2025)
CREATE OR REPLACE FUNCTION generate_session_code()
RETURNS VARCHAR(50) AS $$
DECLARE
    new_code VARCHAR(50);
    code_exists BOOLEAN;
    attempt INTEGER := 0;
    max_attempts INTEGER := 100;
    date_part VARCHAR(10);
    sequence_num INTEGER;
BEGIN
    -- Get current date in DDMMYYYY format (Latin American format)
    date_part := TO_CHAR(NOW(), 'DDMMYYYY');
    LOOP
        SELECT COALESCE(MAX(
            CAST(
                SUBSTRING(code FROM 'PREP-[0-9]{8}-([0-9]+)') AS INTEGER
            )
        ), 0) + 1
        INTO sequence_num
        FROM picking_sessions
        WHERE code LIKE 'PREP-' || date_part || '-%';

        new_code := 'PREP-' || date_part || '-' || LPAD(sequence_num::TEXT, 2, '0');
        SELECT EXISTS(SELECT 1 FROM picking_sessions WHERE code = new_code) INTO code_exists;
        EXIT WHEN NOT code_exists OR attempt >= max_attempts;
        attempt := attempt + 1;
    END LOOP;

    IF attempt >= max_attempts THEN
        RAISE EXCEPTION 'Failed to generate unique session code after % attempts', max_attempts;
    END IF;

    RETURN new_code;
END;
$$ LANGUAGE plpgsql;

-- Función para actualizar timestamp de warehouse
CREATE OR REPLACE FUNCTION update_picking_session_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- FUNCIONES PARA CARRIER SETTLEMENTS
-- ================================================================

-- Función para crear liquidación de carrier
CREATE OR REPLACE FUNCTION create_carrier_settlement(
    p_store_id UUID,
    p_carrier_id UUID,
    p_period_start DATE,
    p_period_end DATE,
    p_created_by UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_settlement_id UUID;
    v_total_orders INT;
    v_total_cod DECIMAL(12,2);
    v_total_shipping DECIMAL(12,2);
BEGIN
    SELECT
        COUNT(*),
        COALESCE(SUM(total_price), 0),
        COALESCE(SUM(shipping_cost), 0)
    INTO v_total_orders, v_total_cod, v_total_shipping
    FROM orders
    WHERE store_id = p_store_id
      AND courier_id = p_carrier_id
      AND sleeves_status = 'delivered'
      AND delivered_at >= p_period_start
      AND delivered_at < (p_period_end + INTERVAL '1 day')
      AND carrier_settlement_id IS NULL;

    IF v_total_orders = 0 THEN
        RAISE EXCEPTION 'No hay pedidos entregados en el período seleccionado';
    END IF;

    INSERT INTO carrier_settlements (
        store_id, carrier_id,
        settlement_period_start, settlement_period_end,
        total_orders, total_cod_collected, total_shipping_cost,
        status, created_by
    ) VALUES (
        p_store_id, p_carrier_id,
        p_period_start, p_period_end,
        v_total_orders, v_total_cod, v_total_shipping,
        'pending', p_created_by
    )
    RETURNING id INTO v_settlement_id;

    UPDATE orders
    SET carrier_settlement_id = v_settlement_id
    WHERE store_id = p_store_id
      AND courier_id = p_carrier_id
      AND sleeves_status = 'delivered'
      AND delivered_at >= p_period_start
      AND delivered_at < (p_period_end + INTERVAL '1 day')
      AND carrier_settlement_id IS NULL;

    RETURN v_settlement_id;
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- CREAR TODOS LOS TRIGGERS
-- ================================================================

-- Triggers de updated_at
DROP TRIGGER IF EXISTS trigger_update_stores_timestamp ON stores;
CREATE TRIGGER trigger_update_stores_timestamp BEFORE UPDATE ON stores FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

DROP TRIGGER IF EXISTS trigger_update_store_config_timestamp ON store_config;
CREATE TRIGGER trigger_update_store_config_timestamp BEFORE UPDATE ON store_config FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

DROP TRIGGER IF EXISTS trigger_update_products_timestamp ON products;
CREATE TRIGGER trigger_update_products_timestamp BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

DROP TRIGGER IF EXISTS trigger_update_customers_timestamp ON customers;
CREATE TRIGGER trigger_update_customers_timestamp BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

DROP TRIGGER IF EXISTS trigger_update_orders_timestamp ON orders;
CREATE TRIGGER trigger_update_orders_timestamp BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

DROP TRIGGER IF EXISTS trigger_update_suppliers_timestamp ON suppliers;
CREATE TRIGGER trigger_update_suppliers_timestamp BEFORE UPDATE ON suppliers FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

DROP TRIGGER IF EXISTS trigger_update_campaigns_timestamp ON campaigns;
CREATE TRIGGER trigger_update_campaigns_timestamp BEFORE UPDATE ON campaigns FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

DROP TRIGGER IF EXISTS trigger_update_shipping_timestamp ON shipping_integrations;
CREATE TRIGGER trigger_update_shipping_timestamp BEFORE UPDATE ON shipping_integrations FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

DROP TRIGGER IF EXISTS trigger_update_carriers_timestamp ON carriers;
CREATE TRIGGER trigger_update_carriers_timestamp BEFORE UPDATE ON carriers FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

-- Triggers de customer stats
DROP TRIGGER IF EXISTS trigger_update_customer_stats ON orders;
CREATE TRIGGER trigger_update_customer_stats AFTER INSERT ON orders FOR EACH ROW EXECUTE FUNCTION fn_update_customer_stats();

DROP TRIGGER IF EXISTS trigger_update_customer_stats_on_update ON orders;
CREATE TRIGGER trigger_update_customer_stats_on_update AFTER UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION fn_update_customer_stats_on_update();

-- Trigger de log de cambios de estado
DROP TRIGGER IF EXISTS trigger_log_order_status_change ON orders;
CREATE TRIGGER trigger_log_order_status_change AFTER UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION fn_log_order_status_change();

-- Trigger de delivery token
DROP TRIGGER IF EXISTS trigger_set_delivery_token ON orders;
CREATE TRIGGER trigger_set_delivery_token BEFORE INSERT OR UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION set_delivery_token();

-- Trigger de carrier stats
DROP TRIGGER IF EXISTS trigger_update_carrier_stats ON orders;
CREATE TRIGGER trigger_update_carrier_stats AFTER UPDATE ON orders FOR EACH ROW WHEN (NEW.delivery_status IS DISTINCT FROM OLD.delivery_status) EXECUTE FUNCTION update_carrier_delivery_stats();

-- Trigger de carrier rating
DROP TRIGGER IF EXISTS trigger_update_carrier_rating ON orders;
CREATE TRIGGER trigger_update_carrier_rating AFTER INSERT OR UPDATE ON orders FOR EACH ROW WHEN (NEW.delivery_rating IS NOT NULL) EXECUTE FUNCTION update_carrier_rating();

-- Trigger de COD amount
DROP TRIGGER IF EXISTS trigger_calculate_cod_amount ON orders;
CREATE TRIGGER trigger_calculate_cod_amount BEFORE INSERT OR UPDATE OF payment_method, total_price ON orders FOR EACH ROW EXECUTE FUNCTION calculate_cod_amount();

-- Triggers de Shopify updated_at
DROP TRIGGER IF EXISTS update_shopify_integrations_updated_at ON shopify_integrations;
CREATE TRIGGER update_shopify_integrations_updated_at BEFORE UPDATE ON shopify_integrations FOR EACH ROW EXECUTE FUNCTION update_shopify_updated_at();

DROP TRIGGER IF EXISTS update_shopify_import_jobs_updated_at ON shopify_import_jobs;
CREATE TRIGGER update_shopify_import_jobs_updated_at BEFORE UPDATE ON shopify_import_jobs FOR EACH ROW EXECUTE FUNCTION update_shopify_updated_at();

DROP TRIGGER IF EXISTS update_webhook_retry_queue_updated_at ON shopify_webhook_retry_queue;
CREATE TRIGGER update_webhook_retry_queue_updated_at BEFORE UPDATE ON shopify_webhook_retry_queue FOR EACH ROW EXECUTE FUNCTION update_shopify_updated_at();

-- Triggers de Mercadería
DROP TRIGGER IF EXISTS trigger_update_inbound_shipment_timestamp ON inbound_shipments;
CREATE TRIGGER trigger_update_inbound_shipment_timestamp
  BEFORE UPDATE ON inbound_shipments
  FOR EACH ROW
  EXECUTE FUNCTION update_inbound_shipment_timestamp();

DROP TRIGGER IF EXISTS trigger_update_inbound_item_timestamp ON inbound_shipment_items;
CREATE TRIGGER trigger_update_inbound_item_timestamp
  BEFORE UPDATE ON inbound_shipment_items
  FOR EACH ROW
  EXECUTE FUNCTION update_inbound_shipment_timestamp();

DROP TRIGGER IF EXISTS trigger_update_shipment_total_after_item_change ON inbound_shipment_items;
CREATE TRIGGER trigger_update_shipment_total_after_item_change
  AFTER INSERT OR UPDATE OR DELETE ON inbound_shipment_items
  FOR EACH ROW
  EXECUTE FUNCTION update_shipment_total_cost();

-- Triggers de Warehouse
DROP TRIGGER IF EXISTS trigger_picking_sessions_updated_at ON picking_sessions;
CREATE TRIGGER trigger_picking_sessions_updated_at
    BEFORE UPDATE ON picking_sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_picking_session_timestamp();

DROP TRIGGER IF EXISTS trigger_picking_session_items_updated_at ON picking_session_items;
CREATE TRIGGER trigger_picking_session_items_updated_at
    BEFORE UPDATE ON picking_session_items
    FOR EACH ROW
    EXECUTE FUNCTION update_picking_session_timestamp();

DROP TRIGGER IF EXISTS trigger_packing_progress_updated_at ON packing_progress;
CREATE TRIGGER trigger_packing_progress_updated_at
    BEFORE UPDATE ON packing_progress
    FOR EACH ROW
    EXECUTE FUNCTION update_picking_session_timestamp();

-- Triggers de Carrier Zones
DROP TRIGGER IF EXISTS trigger_update_carrier_zones_timestamp ON carrier_zones;
CREATE TRIGGER trigger_update_carrier_zones_timestamp
    BEFORE UPDATE ON carrier_zones
    FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

DROP TRIGGER IF EXISTS trigger_update_carrier_settlements_timestamp ON carrier_settlements;
CREATE TRIGGER trigger_update_carrier_settlements_timestamp
    BEFORE UPDATE ON carrier_settlements
    FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

-- ================================================================
-- PARTE 9: TABLAS DE MERCADERÍA (INBOUND SHIPMENTS)
-- ================================================================

CREATE TABLE IF NOT EXISTS inbound_shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  internal_reference VARCHAR(50) NOT NULL,
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  carrier_id UUID REFERENCES carriers(id) ON DELETE SET NULL,
  tracking_code VARCHAR(100),
  estimated_arrival_date DATE,
  received_date TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  shipping_cost DECIMAL(10, 2) DEFAULT 0,
  total_cost DECIMAL(10, 2) DEFAULT 0,
  evidence_photo_url TEXT,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  received_by UUID REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT valid_inbound_status CHECK (status IN ('pending', 'partial', 'received')),
  CONSTRAINT unique_internal_reference UNIQUE (store_id, internal_reference)
);

CREATE INDEX IF NOT EXISTS idx_inbound_shipments_store ON inbound_shipments(store_id);
CREATE INDEX IF NOT EXISTS idx_inbound_shipments_status ON inbound_shipments(status);
CREATE INDEX IF NOT EXISTS idx_inbound_shipments_supplier ON inbound_shipments(supplier_id);
CREATE INDEX IF NOT EXISTS idx_inbound_shipments_eta ON inbound_shipments(estimated_arrival_date);
CREATE INDEX IF NOT EXISTS idx_inbound_shipments_created ON inbound_shipments(created_at DESC);

CREATE TABLE IF NOT EXISTS inbound_shipment_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES inbound_shipments(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  qty_ordered INTEGER NOT NULL CHECK (qty_ordered > 0),
  qty_received INTEGER DEFAULT 0 CHECK (qty_received >= 0),
  qty_rejected INTEGER DEFAULT 0 CHECK (qty_rejected >= 0),
  unit_cost DECIMAL(10, 2) NOT NULL CHECK (unit_cost >= 0),
  total_cost DECIMAL(10, 2) GENERATED ALWAYS AS (qty_ordered * unit_cost) STORED,
  discrepancy_notes TEXT,
  has_discrepancy BOOLEAN GENERATED ALWAYS AS (qty_received != qty_ordered) STORED,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT qty_valid CHECK (qty_received + qty_rejected <= qty_ordered)
);

CREATE INDEX IF NOT EXISTS idx_inbound_items_shipment ON inbound_shipment_items(shipment_id);
CREATE INDEX IF NOT EXISTS idx_inbound_items_product ON inbound_shipment_items(product_id);

-- ================================================================
-- PARTE 10: TABLAS DE WAREHOUSE (PICKING & PACKING)
-- ================================================================

CREATE TABLE IF NOT EXISTS picking_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) UNIQUE NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('picking', 'packing', 'completed')),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    picking_started_at TIMESTAMP WITH TIME ZONE,
    picking_completed_at TIMESTAMP WITH TIME ZONE,
    packing_started_at TIMESTAMP WITH TIME ZONE,
    packing_completed_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_picking_sessions_store_id ON picking_sessions(store_id);
CREATE INDEX IF NOT EXISTS idx_picking_sessions_status ON picking_sessions(status);
CREATE INDEX IF NOT EXISTS idx_picking_sessions_created_at ON picking_sessions(created_at DESC);

CREATE TABLE IF NOT EXISTS picking_session_orders (
    picking_session_id UUID NOT NULL REFERENCES picking_sessions(id) ON DELETE CASCADE,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    added_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (picking_session_id, order_id)
);

CREATE INDEX IF NOT EXISTS idx_picking_session_orders_session ON picking_session_orders(picking_session_id);
CREATE INDEX IF NOT EXISTS idx_picking_session_orders_order ON picking_session_orders(order_id);

CREATE TABLE IF NOT EXISTS picking_session_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    picking_session_id UUID NOT NULL REFERENCES picking_sessions(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    total_quantity_needed INTEGER NOT NULL CHECK (total_quantity_needed > 0),
    quantity_picked INTEGER NOT NULL DEFAULT 0 CHECK (quantity_picked >= 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (picking_session_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_picking_session_items_session ON picking_session_items(picking_session_id);
CREATE INDEX IF NOT EXISTS idx_picking_session_items_product ON picking_session_items(product_id);

CREATE TABLE IF NOT EXISTS packing_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    picking_session_id UUID NOT NULL REFERENCES picking_sessions(id) ON DELETE CASCADE,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    quantity_needed INTEGER NOT NULL CHECK (quantity_needed > 0),
    quantity_packed INTEGER NOT NULL DEFAULT 0 CHECK (quantity_packed >= 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (picking_session_id, order_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_packing_progress_session ON packing_progress(picking_session_id);
CREATE INDEX IF NOT EXISTS idx_packing_progress_order ON packing_progress(order_id);

-- ================================================================
-- PARTE 11: TABLAS DE CARRIER ZONES Y LIQUIDACIONES
-- ================================================================

CREATE TABLE IF NOT EXISTS carrier_zones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    carrier_id UUID NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,
    zone_name VARCHAR(100) NOT NULL,
    zone_code VARCHAR(20),
    rate DECIMAL(12,2) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    CONSTRAINT unique_carrier_zone UNIQUE(carrier_id, zone_name)
);

CREATE INDEX IF NOT EXISTS idx_carrier_zones_carrier ON carrier_zones(carrier_id);
CREATE INDEX IF NOT EXISTS idx_carrier_zones_store ON carrier_zones(store_id);
CREATE INDEX IF NOT EXISTS idx_carrier_zones_active ON carrier_zones(carrier_id, is_active) WHERE is_active = TRUE;

-- Add columns to carriers table for zone support
ALTER TABLE carriers ADD COLUMN IF NOT EXISTS carrier_type VARCHAR(20) DEFAULT 'internal';
ALTER TABLE carriers ADD COLUMN IF NOT EXISTS default_zone VARCHAR(100);

-- Add columns to orders table for shipping cost tracking
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_cost DECIMAL(12,2) DEFAULT 0.00;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_zone VARCHAR(100);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS carrier_settlement_id UUID;

CREATE INDEX IF NOT EXISTS idx_orders_shipping_cost ON orders(shipping_cost) WHERE shipping_cost > 0;
CREATE INDEX IF NOT EXISTS idx_orders_zone ON orders(delivery_zone) WHERE delivery_zone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_carrier_settlement ON orders(carrier_settlement_id) WHERE carrier_settlement_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS carrier_settlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    carrier_id UUID NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,
    settlement_period_start DATE NOT NULL,
    settlement_period_end DATE NOT NULL,
    total_orders INT NOT NULL DEFAULT 0,
    total_cod_collected DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    total_shipping_cost DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    net_amount DECIMAL(12,2) GENERATED ALWAYS AS (total_cod_collected - total_shipping_cost) STORED,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled')),
    payment_date DATE,
    payment_method VARCHAR(50),
    payment_reference VARCHAR(255),
    notes TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    CONSTRAINT unique_carrier_settlement_period UNIQUE(store_id, carrier_id, settlement_period_start, settlement_period_end)
);

CREATE INDEX IF NOT EXISTS idx_carrier_settlements_store ON carrier_settlements(store_id);
CREATE INDEX IF NOT EXISTS idx_carrier_settlements_carrier ON carrier_settlements(carrier_id);
CREATE INDEX IF NOT EXISTS idx_carrier_settlements_status ON carrier_settlements(status);
CREATE INDEX IF NOT EXISTS idx_carrier_settlements_period ON carrier_settlements(settlement_period_start, settlement_period_end);
CREATE INDEX IF NOT EXISTS idx_carrier_settlements_pending ON carrier_settlements(status, carrier_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_carrier_settlements_date ON carrier_settlements(created_at DESC);

-- Add foreign key to orders
ALTER TABLE orders DROP CONSTRAINT IF EXISTS fk_orders_carrier_settlement;
ALTER TABLE orders ADD CONSTRAINT fk_orders_carrier_settlement
    FOREIGN KEY (carrier_settlement_id)
    REFERENCES carrier_settlements(id)
    ON DELETE SET NULL;

-- ================================================================
-- PARTE 12: VISTAS
-- ================================================================

CREATE OR REPLACE VIEW courier_performance AS
SELECT
    c.id, c.name, c.phone, c.store_id,
    c.total_deliveries, c.successful_deliveries, c.failed_deliveries, c.delivery_rate,
    c.average_rating, c.total_ratings,
    COUNT(DISTINCT o.id) as assigned_orders,
    COUNT(DISTINCT CASE WHEN o.delivery_status = 'confirmed' THEN o.id END) as delivered_orders,
    COUNT(DISTINCT CASE WHEN o.delivery_status = 'failed' THEN o.id END) as failed_orders,
    COUNT(DISTINCT CASE WHEN o.delivery_status = 'pending' THEN o.id END) as pending_orders,
    AVG(CASE
        WHEN o.delivery_status = 'confirmed'
        THEN EXTRACT(EPOCH FROM (o.delivered_at - o.confirmed_at))/3600
    END) as avg_delivery_time_hours
FROM carriers c
LEFT JOIN orders o ON o.courier_id = c.id
GROUP BY c.id, c.name, c.phone, c.store_id, c.total_deliveries,
         c.successful_deliveries, c.failed_deliveries, c.delivery_rate,
         c.average_rating, c.total_ratings;

CREATE OR REPLACE VIEW shopify_integrations_with_webhook_issues AS
SELECT
    id, shop_domain, shop_name, status,
    webhook_registration_success, webhook_registration_failed,
    webhook_registration_errors, last_webhook_attempt, installed_at
FROM shopify_integrations
WHERE webhook_registration_failed > 0 AND status = 'active'
ORDER BY last_webhook_attempt DESC;

CREATE OR REPLACE VIEW inbound_shipments_summary AS
SELECT
  s.id,
  s.store_id,
  s.internal_reference,
  s.supplier_id,
  sup.name AS supplier_name,
  s.carrier_id,
  c.name AS carrier_name,
  s.tracking_code,
  s.estimated_arrival_date,
  s.received_date,
  s.status,
  s.shipping_cost,
  s.total_cost,
  s.evidence_photo_url,
  s.notes,
  s.created_at,
  s.updated_at,
  s.created_by,
  s.received_by,
  COUNT(i.id) AS total_items,
  SUM(i.qty_ordered) AS total_qty_ordered,
  SUM(i.qty_received) AS total_qty_received,
  SUM(i.qty_rejected) AS total_qty_rejected,
  COUNT(CASE WHEN i.has_discrepancy THEN 1 END) AS items_with_discrepancies
FROM inbound_shipments s
LEFT JOIN suppliers sup ON s.supplier_id = sup.id
LEFT JOIN carriers c ON s.carrier_id = c.id
LEFT JOIN inbound_shipment_items i ON s.id = i.shipment_id
GROUP BY
  s.id, s.store_id, s.internal_reference, s.supplier_id, sup.name,
  s.carrier_id, c.name, s.tracking_code, s.estimated_arrival_date,
  s.received_date, s.status, s.shipping_cost, s.total_cost,
  s.evidence_photo_url, s.notes, s.created_at, s.updated_at,
  s.created_by, s.received_by;

CREATE OR REPLACE VIEW pending_carrier_settlements_summary AS
SELECT
    c.id as carrier_id,
    c.name as carrier_name,
    c.carrier_type,
    c.store_id,
    COUNT(DISTINCT o.id) as pending_orders_count,
    COALESCE(SUM(o.total_price), 0) as total_cod_pending,
    COALESCE(SUM(o.shipping_cost), 0) as total_shipping_cost_pending,
    COALESCE(SUM(o.total_price) - SUM(o.shipping_cost), 0) as net_receivable_pending,
    MIN(o.delivered_at)::date as oldest_delivery_date,
    MAX(o.delivered_at)::date as newest_delivery_date
FROM carriers c
INNER JOIN orders o ON o.courier_id = c.id
WHERE o.sleeves_status = 'delivered'
  AND o.carrier_settlement_id IS NULL
  AND c.carrier_type = 'external'
  AND c.is_active = TRUE
GROUP BY c.id, c.name, c.carrier_type, c.store_id
HAVING COUNT(o.id) > 0
ORDER BY oldest_delivery_date ASC;

-- ================================================================
-- PARTE 13: SISTEMA DE DEVOLUCIONES (RETURNS)
-- ================================================================
-- Complete return/refund system with batch processing and inventory integration
-- Author: Bright Idea
-- Date: 2025-12-02

-- Add 'returned' status to order_status enum
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'order_status' AND e.enumlabel = 'returned'
  ) THEN
    ALTER TYPE order_status ADD VALUE 'returned';
  END IF;
END $$;

-- Create return_sessions table (similar to picking_sessions)
CREATE TABLE IF NOT EXISTS return_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  session_code VARCHAR(50) NOT NULL UNIQUE,
  status VARCHAR(20) DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'cancelled')),
  total_orders INT DEFAULT 0,
  processed_orders INT DEFAULT 0,
  total_items INT DEFAULT 0,
  accepted_items INT DEFAULT 0,
  rejected_items INT DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  created_by UUID REFERENCES users(id)
);

-- Create return_session_orders table (links orders to return sessions)
CREATE TABLE IF NOT EXISTS return_session_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES return_sessions(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  original_status order_status NOT NULL, -- Store original status before return
  processed BOOLEAN DEFAULT FALSE,
  processed_at TIMESTAMP,
  UNIQUE(session_id, order_id)
);

-- Create return_session_items table (individual items with accept/reject decision)
CREATE TABLE IF NOT EXISTS return_session_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES return_sessions(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity_expected INT NOT NULL, -- Original quantity from order
  quantity_received INT DEFAULT 0, -- Actual quantity received
  quantity_accepted INT DEFAULT 0, -- Quantity accepted (return to stock)
  quantity_rejected INT DEFAULT 0, -- Quantity rejected (damaged/defective)
  rejection_reason VARCHAR(50), -- damaged, defective, incomplete, wrong_item, other
  rejection_notes TEXT,
  unit_cost DECIMAL(10,2), -- Product cost at time of return
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMP
);

-- Function to generate return session codes (RET-DDMMYYYY-NN format)
CREATE OR REPLACE FUNCTION generate_return_session_code(p_store_id UUID)
RETURNS VARCHAR(50) AS $$
DECLARE
  v_date_part VARCHAR(8);
  v_sequence INT;
  v_code VARCHAR(50);
BEGIN
  -- Get date in DDMMYYYY format (Latin American standard)
  v_date_part := TO_CHAR(CURRENT_DATE, 'DDMMYYYY');

  -- Get next sequence number for today
  SELECT COALESCE(MAX(
    CAST(
      SUBSTRING(session_code FROM 'RET-[0-9]{8}-([0-9]+)') AS INT
    )
  ), 0) + 1
  INTO v_sequence
  FROM return_sessions
  WHERE store_id = p_store_id
    AND session_code LIKE 'RET-' || v_date_part || '-%';

  -- Generate code: RET-DDMMYYYY-NN (e.g., RET-02122025-01)
  v_code := 'RET-' || v_date_part || '-' || LPAD(v_sequence::TEXT, 2, '0');

  RETURN v_code;
END;
$$ LANGUAGE plpgsql;

-- Function to process return session (update inventory and order statuses)
CREATE OR REPLACE FUNCTION complete_return_session(p_session_id UUID)
RETURNS JSON AS $$
DECLARE
  v_session RECORD;
  v_item RECORD;
  v_order_id UUID;
  v_accepted_count INT := 0;
  v_rejected_count INT := 0;
  v_result JSON;
BEGIN
  -- Get session details
  SELECT * INTO v_session
  FROM return_sessions
  WHERE id = p_session_id AND status = 'in_progress';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Return session not found or already completed';
  END IF;

  -- Process each item
  FOR v_item IN
    SELECT * FROM return_session_items
    WHERE session_id = p_session_id
  LOOP
    -- Update product stock for accepted items
    IF v_item.quantity_accepted > 0 THEN
      UPDATE products
      SET stock = stock + v_item.quantity_accepted
      WHERE id = v_item.product_id;

      -- Log inventory movement
      INSERT INTO inventory_movements (
        product_id,
        order_id,
        movement_type,
        quantity,
        reason,
        created_at
      ) VALUES (
        v_item.product_id,
        v_item.order_id,
        'return_accepted',
        v_item.quantity_accepted,
        'Return session: ' || v_session.session_code,
        CURRENT_TIMESTAMP
      );

      v_accepted_count := v_accepted_count + v_item.quantity_accepted;
    END IF;

    -- Log rejected items (no stock update)
    IF v_item.quantity_rejected > 0 THEN
      INSERT INTO inventory_movements (
        product_id,
        order_id,
        movement_type,
        quantity,
        reason,
        created_at
      ) VALUES (
        v_item.product_id,
        v_item.order_id,
        'return_rejected',
        v_item.quantity_rejected,
        'Rejected - ' || COALESCE(v_item.rejection_reason, 'unknown') || ': ' || COALESCE(v_item.rejection_notes, ''),
        CURRENT_TIMESTAMP
      );

      v_rejected_count := v_rejected_count + v_item.quantity_rejected;
    END IF;

    -- Mark item as processed
    UPDATE return_session_items
    SET processed_at = CURRENT_TIMESTAMP
    WHERE id = v_item.id;
  END LOOP;

  -- Update order statuses to 'returned'
  FOR v_order_id IN
    SELECT DISTINCT order_id
    FROM return_session_items
    WHERE session_id = p_session_id
  LOOP
    UPDATE orders
    SET status = 'returned',
        updated_at = CURRENT_TIMESTAMP
    WHERE id = v_order_id;

    -- Mark order as processed in session
    UPDATE return_session_orders
    SET processed = TRUE,
        processed_at = CURRENT_TIMESTAMP
    WHERE session_id = p_session_id AND order_id = v_order_id;
  END LOOP;

  -- Update session status
  UPDATE return_sessions
  SET status = 'completed',
      completed_at = CURRENT_TIMESTAMP,
      accepted_items = v_accepted_count,
      rejected_items = v_rejected_count,
      processed_orders = (
        SELECT COUNT(DISTINCT order_id)
        FROM return_session_items
        WHERE session_id = p_session_id
      )
  WHERE id = p_session_id;

  -- Return summary
  SELECT json_build_object(
    'session_id', p_session_id,
    'session_code', v_session.session_code,
    'orders_processed', (SELECT processed_orders FROM return_sessions WHERE id = p_session_id),
    'items_accepted', v_accepted_count,
    'items_rejected', v_rejected_count,
    'completed_at', CURRENT_TIMESTAMP
  ) INTO v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_return_sessions_store_status
  ON return_sessions(store_id, status);
CREATE INDEX IF NOT EXISTS idx_return_session_orders_session
  ON return_session_orders(session_id);
CREATE INDEX IF NOT EXISTS idx_return_session_items_session
  ON return_session_items(session_id);
CREATE INDEX IF NOT EXISTS idx_return_session_items_product
  ON return_session_items(product_id);

-- Add comments
COMMENT ON TABLE return_sessions IS 'Batch return processing sessions';
COMMENT ON TABLE return_session_orders IS 'Orders included in return sessions';
COMMENT ON TABLE return_session_items IS 'Individual items with accept/reject decisions';
COMMENT ON FUNCTION generate_return_session_code IS 'Generates unique return session codes in RET-DDMMYYYY-NN format';
COMMENT ON FUNCTION complete_return_session IS 'Processes completed return session, updates inventory and order statuses';

-- ================================================================
-- PARTE 14: PERMISOS
-- ================================================================

GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;

-- Permisos para vistas
GRANT SELECT ON courier_performance TO authenticated;
GRANT SELECT ON shopify_integrations_with_webhook_issues TO authenticated;
GRANT SELECT ON inbound_shipments_summary TO authenticated;
GRANT SELECT ON pending_carrier_settlements_summary TO authenticated;

-- Permisos para funciones
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
GRANT EXECUTE ON FUNCTION generate_inbound_reference(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION receive_shipment_items(UUID, JSONB, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION generate_session_code() TO authenticated;
GRANT EXECUTE ON FUNCTION create_carrier_settlement(UUID, UUID, DATE, DATE, UUID) TO authenticated;

-- Permisos específicos para nuevas tablas
GRANT ALL ON inbound_shipments TO postgres;
GRANT SELECT, INSERT, UPDATE, DELETE ON inbound_shipments TO authenticated;

GRANT ALL ON inbound_shipment_items TO postgres;
GRANT SELECT, INSERT, UPDATE, DELETE ON inbound_shipment_items TO authenticated;

GRANT ALL ON picking_sessions TO postgres;
GRANT SELECT, INSERT, UPDATE, DELETE ON picking_sessions TO authenticated;

GRANT ALL ON picking_session_orders TO postgres;
GRANT SELECT, INSERT, UPDATE, DELETE ON picking_session_orders TO authenticated;

GRANT ALL ON picking_session_items TO postgres;
GRANT SELECT, INSERT, UPDATE, DELETE ON picking_session_items TO authenticated;

GRANT ALL ON packing_progress TO postgres;
GRANT SELECT, INSERT, UPDATE, DELETE ON packing_progress TO authenticated;

GRANT ALL ON carrier_zones TO postgres;
GRANT SELECT, INSERT, UPDATE, DELETE ON carrier_zones TO authenticated;

GRANT ALL ON carrier_settlements TO postgres;
GRANT SELECT, INSERT, UPDATE, DELETE ON carrier_settlements TO authenticated;

GRANT ALL ON return_sessions TO postgres;
GRANT SELECT, INSERT, UPDATE, DELETE ON return_sessions TO authenticated;

GRANT ALL ON return_session_orders TO postgres;
GRANT SELECT, INSERT, UPDATE, DELETE ON return_session_orders TO authenticated;

GRANT ALL ON return_session_items TO postgres;
GRANT SELECT, INSERT, UPDATE, DELETE ON return_session_items TO authenticated;

-- Permisos para funciones de returns
GRANT EXECUTE ON FUNCTION generate_return_session_code(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION complete_return_session(UUID) TO authenticated;

-- ================================================================
-- ✅ MIGRACIÓN MAESTRA COMPLETADA
-- ================================================================
-- Este archivo contiene TODAS las tablas y funciones necesarias
-- para ejecutar Ordefy en producción
-- ================================================================
--
-- TABLAS INCLUIDAS (53 tablas):
--   ✅ Core: stores, users, user_stores, store_config
--   ✅ Negocio: products, customers, carriers, suppliers, campaigns
--   ✅ Pedidos: orders, order_status_history, follow_up_log
--   ✅ Delivery/COD: delivery_attempts, daily_settlements, settlement_orders
--   ✅ Shopify: shopify_integrations, shopify_oauth_states, shopify_import_jobs,
--               shopify_webhook_events, shopify_sync_conflicts
--   ✅ Webhook Reliability: shopify_webhook_idempotency, shopify_webhook_retry_queue,
--                           shopify_webhook_metrics
--   ✅ Mercadería: inbound_shipments, inbound_shipment_items
--   ✅ Warehouse: picking_sessions, picking_session_orders, picking_session_items,
--                 packing_progress
--   ✅ Carrier Zones: carrier_zones, carrier_settlements
--   ✅ Returns: return_sessions, return_session_orders, return_session_items
--   ✅ Otros: shipping_integrations, additional_values
--
-- FUNCIONES INCLUIDAS (22+ funciones):
--   ✅ Timestamps: fn_update_timestamp, update_shopify_updated_at,
--                  update_inbound_shipment_timestamp, update_picking_session_timestamp
--   ✅ Customer Stats: fn_update_customer_stats, fn_update_customer_stats_on_update
--   ✅ Order Tracking: fn_log_order_status_change, set_delivery_token,
--                      generate_delivery_token, calculate_cod_amount
--   ✅ Carrier Stats: update_carrier_delivery_stats, update_carrier_rating
--   ✅ Cleanup: cleanup_expired_idempotency_keys, cleanup_expired_oauth_states,
--               delete_old_delivery_photos
--   ✅ Webhook Metrics: record_webhook_metric
--   ✅ Mercadería: generate_inbound_reference, receive_shipment_items,
--                  update_shipment_total_cost
--   ✅ Warehouse: generate_session_code
--   ✅ Carrier Settlements: create_carrier_settlement
--   ✅ Returns: generate_return_session_code, complete_return_session
--
-- VISTAS INCLUIDAS (4 vistas):
--   ✅ courier_performance (rendimiento de carriers con métricas)
--   ✅ shopify_integrations_with_webhook_issues (integraciones con problemas)
--   ✅ inbound_shipments_summary (resumen de mercadería con stats)
--   ✅ pending_carrier_settlements_summary (liquidaciones pendientes)
--
-- TRIGGERS INCLUIDOS (30+ triggers):
--   ✅ Updated_at: 15+ triggers automáticos
--   ✅ Customer Stats: 2 triggers para total_orders/total_spent
--   ✅ Order Tracking: Status change log, delivery token generation, COD calculation
--   ✅ Carrier Stats: Delivery stats y rating updates
--   ✅ Mercadería: Total cost updates
--   ✅ Warehouse: Picking/packing timestamps
--   ✅ Carrier Zones: Settlements timestamps
--
-- NUEVAS COLUMNAS EN TABLAS EXISTENTES:
--   ✅ carriers: carrier_type, default_zone
--   ✅ orders: shipping_cost, delivery_zone, carrier_settlement_id
--
-- CARACTERÍSTICAS ESPECIALES:
--   ✅ Idempotente: Puede ejecutarse múltiples veces sin errores
--   ✅ Multi-tenant: Isolation por store_id
--   ✅ Auditoria: Timestamps, user tracking, status history
--   ✅ Integridad: Foreign keys, constraints, checks
--   ✅ Performance: 50+ índices optimizados
--   ✅ Shopify Sync: Bidireccional con webhooks confiables
--   ✅ Warehouse: Picking & Packing sin barcode scanners
--   ✅ Mercadería: Inventory updates automáticos
--   ✅ Carrier Zones: Liquidaciones con cálculo de neto
-- ================================================================

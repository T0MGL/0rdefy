-- ================================================================
-- ORDEFY - MASTER DATABASE MIGRATION (COMPLETE VERSION)
-- ================================================================
-- Este archivo consolida TODAS las migraciones necesarias del proyecto
-- Puede ejecutarse múltiples veces (idempotente) gracias a los IF NOT EXISTS
-- ================================================================
-- IMPORTANTE: Ejecutar en orden secuencial
-- Last Updated: 2025-12-30
-- ================================================================

-- ================================================================
-- EXTENSIONES
-- ================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ================================================================
-- PARTE 1: ENUMS
-- ================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_status') THEN
        CREATE TYPE order_status AS ENUM (
            'pending',
            'confirmed',
            'in_preparation',
            'ready_to_ship',
            'shipped',
            'in_transit',
            'delivered',
            'not_delivered',
            'incident',
            'cancelled',
            'rejected',
            'returned'
        );
    ELSE
        -- Add missing values to existing enum
        IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'order_status'::regtype AND enumlabel = 'in_preparation') THEN
            ALTER TYPE order_status ADD VALUE 'in_preparation';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'order_status'::regtype AND enumlabel = 'ready_to_ship') THEN
            ALTER TYPE order_status ADD VALUE 'ready_to_ship';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'order_status'::regtype AND enumlabel = 'incident') THEN
            ALTER TYPE order_status ADD VALUE 'incident';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'order_status'::regtype AND enumlabel = 'returned') THEN
            ALTER TYPE order_status ADD VALUE 'returned';
        END IF;
    END IF;
END $$;

-- ================================================================
-- PARTE 2: TABLAS BASE (stores, users, store_config)
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
-- PARTE 3: TABLAS DE NEGOCIO
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
    packaging_cost DECIMAL(10,2) DEFAULT 0,
    additional_costs DECIMAL(10,2) DEFAULT 0,
    is_service BOOLEAN DEFAULT FALSE,
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
        CASE WHEN total_deliveries > 0 THEN (successful_deliveries::DECIMAL / total_deliveries * 100) ELSE 0 END
    ) STORED,
    average_rating DECIMAL(3,2) DEFAULT 0.00,
    total_ratings INT DEFAULT 0,
    carrier_type VARCHAR(20) DEFAULT 'internal',
    default_zone VARCHAR(100),
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

CREATE TABLE IF NOT EXISTS recurring_additional_values (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    category VARCHAR(50) NOT NULL,
    description TEXT NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    type VARCHAR(20) NOT NULL,
    frequency VARCHAR(20) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE,
    last_processed_date DATE,
    is_ordefy_subscription BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recurring_values_store ON recurring_additional_values(store_id);
CREATE INDEX IF NOT EXISTS idx_recurring_values_active ON recurring_additional_values(store_id, is_active);

-- ================================================================
-- PARTE 4: ORDERS TABLE
-- ================================================================

CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES customers(id),
    shopify_order_id VARCHAR(255),
    shopify_order_number VARCHAR(100),
    shopify_order_name VARCHAR(100),
    payment_gateway VARCHAR(100),
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
    courier_notes TEXT,
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
    google_maps_link TEXT,
    has_active_incident BOOLEAN DEFAULT FALSE,
    cancel_reason TEXT,
    shipping_cost DECIMAL(12,2) DEFAULT 0.00,
    delivery_zone VARCHAR(100),
    carrier_settlement_id UUID,
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
CREATE INDEX IF NOT EXISTS idx_orders_shipping_cost ON orders(shipping_cost) WHERE shipping_cost > 0;
CREATE INDEX IF NOT EXISTS idx_orders_zone ON orders(delivery_zone) WHERE delivery_zone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_carrier_settlement ON orders(carrier_settlement_id) WHERE carrier_settlement_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_active_incident ON orders(store_id, has_active_incident) WHERE has_active_incident = TRUE;
CREATE INDEX IF NOT EXISTS idx_orders_incident_status ON orders(sleeves_status) WHERE sleeves_status = 'incident';
CREATE INDEX IF NOT EXISTS idx_orders_courier_notes ON orders(courier_notes) WHERE courier_notes IS NOT NULL;

DO $$
BEGIN
    DROP INDEX IF EXISTS idx_orders_shopify_id;
    DROP INDEX IF EXISTS orders_shopify_order_id_key;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'orders'::regclass AND conname = 'idx_orders_shopify_store_unique') THEN
        ALTER TABLE orders ADD CONSTRAINT idx_orders_shopify_store_unique UNIQUE (shopify_order_id, store_id);
    END IF;
END $$;

-- ================================================================
-- PARTE 5: ORDER LINE ITEMS
-- ================================================================

CREATE TABLE IF NOT EXISTS order_line_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id UUID REFERENCES products(id) ON DELETE SET NULL,
    shopify_product_id VARCHAR(255),
    shopify_variant_id VARCHAR(255),
    shopify_line_item_id VARCHAR(255),
    product_name VARCHAR(500) NOT NULL,
    variant_title VARCHAR(255),
    sku VARCHAR(255),
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price DECIMAL(10,2) NOT NULL,
    total_price DECIMAL(10,2) NOT NULL,
    discount_amount DECIMAL(10,2) DEFAULT 0,
    tax_amount DECIMAL(10,2) DEFAULT 0,
    properties JSONB,
    fulfillment_status VARCHAR(50) DEFAULT 'unfulfilled',
    quantity_fulfilled INTEGER DEFAULT 0,
    stock_deducted BOOLEAN DEFAULT FALSE,
    stock_deducted_at TIMESTAMP,
    shopify_data JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_line_items_order ON order_line_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_line_items_product ON order_line_items(product_id);
CREATE INDEX IF NOT EXISTS idx_order_line_items_shopify_product ON order_line_items(shopify_product_id);
CREATE INDEX IF NOT EXISTS idx_order_line_items_shopify_variant ON order_line_items(shopify_variant_id);
CREATE INDEX IF NOT EXISTS idx_order_line_items_sku ON order_line_items(sku);
CREATE INDEX IF NOT EXISTS idx_order_line_items_stock_deducted ON order_line_items(stock_deducted);

-- ================================================================
-- PARTE 6: HISTORY AND LOGS
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
-- PARTE 7: DELIVERY/COD TABLES
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
-- PARTE 8: INVENTORY MOVEMENTS
-- ================================================================

CREATE TABLE IF NOT EXISTS inventory_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    quantity_change INT NOT NULL,
    stock_before INT NOT NULL,
    stock_after INT NOT NULL,
    movement_type VARCHAR(50) NOT NULL,
    order_status_from VARCHAR(50),
    order_status_to VARCHAR(50),
    reason TEXT,
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_store ON inventory_movements(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_product ON inventory_movements(product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_order ON inventory_movements(order_id);

-- ================================================================
-- PARTE 9: DELIVERY INCIDENTS
-- ================================================================

CREATE TABLE IF NOT EXISTS delivery_incidents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    initial_attempt_id UUID REFERENCES delivery_attempts(id) ON DELETE SET NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    max_retry_attempts INT NOT NULL DEFAULT 3,
    current_retry_count INT NOT NULL DEFAULT 0,
    resolution_type VARCHAR(50),
    resolved_at TIMESTAMP,
    resolved_by VARCHAR(100),
    resolution_notes TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    CONSTRAINT check_retry_count CHECK (current_retry_count >= 0 AND current_retry_count <= max_retry_attempts),
    CONSTRAINT check_status CHECK (status IN ('active', 'resolved', 'expired'))
);

CREATE INDEX IF NOT EXISTS idx_incidents_order ON delivery_incidents(order_id);
CREATE INDEX IF NOT EXISTS idx_incidents_store ON delivery_incidents(store_id);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON delivery_incidents(store_id, status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_incidents_created ON delivery_incidents(store_id, created_at DESC);

CREATE TABLE IF NOT EXISTS incident_retry_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id UUID NOT NULL REFERENCES delivery_incidents(id) ON DELETE CASCADE,
    delivery_attempt_id UUID REFERENCES delivery_attempts(id) ON DELETE SET NULL,
    retry_number INT NOT NULL,
    scheduled_date DATE,
    rescheduled_by VARCHAR(100),
    status VARCHAR(50) NOT NULL DEFAULT 'scheduled',
    courier_notes TEXT,
    failure_reason TEXT,
    payment_method VARCHAR(50),
    proof_photo_url TEXT,
    attempted_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    CONSTRAINT check_retry_number CHECK (retry_number >= 1 AND retry_number <= 3),
    CONSTRAINT check_retry_status CHECK (status IN ('scheduled', 'in_progress', 'delivered', 'failed', 'cancelled')),
    CONSTRAINT unique_incident_retry UNIQUE(incident_id, retry_number)
);

CREATE INDEX IF NOT EXISTS idx_retry_attempts_incident ON incident_retry_attempts(incident_id);
CREATE INDEX IF NOT EXISTS idx_retry_attempts_delivery ON incident_retry_attempts(delivery_attempt_id);
CREATE INDEX IF NOT EXISTS idx_retry_attempts_status ON incident_retry_attempts(incident_id, status);
CREATE INDEX IF NOT EXISTS idx_retry_attempts_scheduled ON incident_retry_attempts(scheduled_date) WHERE status = 'scheduled';

-- ================================================================
-- PARTE 10: USER SECURITY
-- ================================================================

CREATE TABLE IF NOT EXISTS user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL UNIQUE,
    device_info JSONB DEFAULT '{}',
    ip_address INET,
    last_activity TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    CONSTRAINT chk_expires_after_created CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_token_hash ON user_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_user_sessions_is_active ON user_sessions(is_active);

CREATE TABLE IF NOT EXISTS activity_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    store_id UUID REFERENCES stores(id) ON DELETE SET NULL,
    action_type VARCHAR(50) NOT NULL,
    description TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_log_user_id ON activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_store_id ON activity_log(store_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_action_type ON activity_log(action_type);
CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log(created_at DESC);

-- ================================================================
-- PARTE 11: SHOPIFY INTEGRATION
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
    is_popup BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oauth_states_state ON shopify_oauth_states(state);
CREATE INDEX IF NOT EXISTS idx_oauth_states_shop ON shopify_oauth_states(shop_domain);
CREATE INDEX IF NOT EXISTS idx_oauth_states_user ON shopify_oauth_states(user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_states_store ON shopify_oauth_states(store_id);
CREATE INDEX IF NOT EXISTS idx_oauth_states_expires ON shopify_oauth_states(expires_at);
CREATE INDEX IF NOT EXISTS idx_shopify_oauth_states_popup ON shopify_oauth_states(is_popup) WHERE is_popup = true;

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
-- PARTE 12: WEBHOOK RELIABILITY
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

CREATE TABLE IF NOT EXISTS webhook_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    integration_id UUID NOT NULL REFERENCES shopify_integrations(id) ON DELETE CASCADE,
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    topic VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    headers JSONB NOT NULL,
    idempotency_key VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 5,
    next_retry_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    processed_at TIMESTAMP WITH TIME ZONE,
    error TEXT,
    CONSTRAINT chk_webhook_queue_status CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    CONSTRAINT chk_webhook_queue_retry_count CHECK (retry_count >= 0 AND retry_count <= max_retries)
);

CREATE INDEX IF NOT EXISTS idx_webhook_queue_processing ON webhook_queue(status, next_retry_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_webhook_queue_idempotency ON webhook_queue(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_webhook_queue_cleanup ON webhook_queue(status, created_at) WHERE status = 'completed';
CREATE INDEX IF NOT EXISTS idx_webhook_queue_integration ON webhook_queue(integration_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_queue_topic ON webhook_queue(topic, created_at DESC);

-- ================================================================
-- PARTE 13: MERCADERÍA (INBOUND SHIPMENTS)
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
-- PARTE 14: WAREHOUSE (PICKING & PACKING)
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
-- PARTE 15: SHIPMENTS (OUTBOUND)
-- ================================================================

CREATE TABLE IF NOT EXISTS shipments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    courier_id UUID REFERENCES carriers(id) ON DELETE SET NULL,
    shipped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    shipped_by UUID REFERENCES users(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shipments_store_id ON shipments(store_id);
CREATE INDEX IF NOT EXISTS idx_shipments_order_id ON shipments(order_id);
CREATE INDEX IF NOT EXISTS idx_shipments_courier_id ON shipments(courier_id);
CREATE INDEX IF NOT EXISTS idx_shipments_shipped_at ON shipments(shipped_at DESC);

-- ================================================================
-- PARTE 16: CARRIER ZONES & SETTLEMENTS
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

ALTER TABLE orders DROP CONSTRAINT IF EXISTS fk_orders_carrier_settlement;
ALTER TABLE orders ADD CONSTRAINT fk_orders_carrier_settlement FOREIGN KEY (carrier_settlement_id) REFERENCES carrier_settlements(id) ON DELETE SET NULL;

-- ================================================================
-- PARTE 17: RETURNS SYSTEM
-- ================================================================

CREATE TABLE IF NOT EXISTS return_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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

CREATE INDEX IF NOT EXISTS idx_return_sessions_store_status ON return_sessions(store_id, status);

CREATE TABLE IF NOT EXISTS return_session_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES return_sessions(id) ON DELETE CASCADE,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    original_status VARCHAR(50) NOT NULL,
    processed BOOLEAN DEFAULT FALSE,
    processed_at TIMESTAMP,
    UNIQUE(session_id, order_id)
);

CREATE INDEX IF NOT EXISTS idx_return_session_orders_session ON return_session_orders(session_id);

CREATE TABLE IF NOT EXISTS return_session_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES return_sessions(id) ON DELETE CASCADE,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    quantity_expected INT NOT NULL,
    quantity_received INT DEFAULT 0,
    quantity_accepted INT DEFAULT 0,
    quantity_rejected INT DEFAULT 0,
    rejection_reason VARCHAR(50),
    rejection_notes TEXT,
    unit_cost DECIMAL(10,2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_return_session_items_session ON return_session_items(session_id);
CREATE INDEX IF NOT EXISTS idx_return_session_items_product ON return_session_items(product_id);

-- ================================================================
-- PARTE 18: FUNCIONES DE TIMESTAMP
-- ================================================================

CREATE OR REPLACE FUNCTION fn_update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_shopify_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_inbound_shipment_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_picking_session_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_shipments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- PARTE 19: FUNCIONES DE CUSTOMER STATS
-- ================================================================

CREATE OR REPLACE FUNCTION fn_update_customer_stats()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.customer_id IS NOT NULL THEN
        UPDATE customers
        SET
            total_orders = total_orders + 1,
            total_spent = total_spent + COALESCE(NEW.total_price, 0),
            last_order_at = NOW()
        WHERE id = NEW.customer_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_update_customer_stats_on_update()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.customer_id IS NOT NULL AND OLD.total_price IS DISTINCT FROM NEW.total_price THEN
        UPDATE customers
        SET total_spent = total_spent - COALESCE(OLD.total_price, 0) + COALESCE(NEW.total_price, 0)
        WHERE id = OLD.customer_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- PARTE 20: FUNCIONES DE ORDER STATUS
-- ================================================================

CREATE OR REPLACE FUNCTION fn_log_order_status_change()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.sleeves_status IS DISTINCT FROM NEW.sleeves_status THEN
        INSERT INTO order_status_history (
            order_id, store_id, previous_status, new_status,
            changed_by, changed_by_n8n, change_source, notes
        ) VALUES (
            NEW.id, NEW.store_id, OLD.sleeves_status, NEW.sleeves_status,
            COALESCE(NEW.confirmed_by, 'system'),
            COALESCE(NEW.n8n_sent, FALSE),
            CASE
                WHEN NEW.n8n_sent = TRUE THEN 'n8n'
                WHEN NEW.confirmation_method = 'whatsapp' THEN 'whatsapp_webhook'
                WHEN NEW.shopify_order_id IS NOT NULL THEN 'shopify_sync'
                ELSE 'dashboard'
            END,
            NULL
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- PARTE 21: FUNCIONES DE DELIVERY TOKEN Y COD
-- ================================================================

CREATE OR REPLACE FUNCTION generate_delivery_token()
RETURNS TEXT AS $$
DECLARE
    chars TEXT := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    result TEXT := '';
    i INTEGER;
BEGIN
    FOR i IN 1..10 LOOP
        result := result || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
    END LOOP;
    RETURN result;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_delivery_token()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.sleeves_status = 'confirmed' AND OLD.sleeves_status = 'pending' THEN
        IF NEW.delivery_link_token IS NULL THEN
            LOOP
                NEW.delivery_link_token := generate_delivery_token();
                EXIT WHEN NOT EXISTS (
                    SELECT 1 FROM orders WHERE delivery_link_token = NEW.delivery_link_token
                );
            END LOOP;
        END IF;
        NEW.confirmed_at := COALESCE(NEW.confirmed_at, NOW());
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION calculate_cod_amount()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.payment_method = 'cash' OR NEW.payment_method = 'cod' THEN
        NEW.cod_amount := COALESCE(NEW.total_price, 0);
    ELSE
        NEW.cod_amount := 0;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- PARTE 22: FUNCIONES DE CARRIER STATS
-- ================================================================

CREATE OR REPLACE FUNCTION update_carrier_delivery_stats()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.sleeves_status = 'delivered' AND OLD.sleeves_status != 'delivered' THEN
        UPDATE carriers
        SET
            total_deliveries = total_deliveries + 1,
            successful_deliveries = successful_deliveries + 1
        WHERE id = NEW.courier_id;
    ELSIF NEW.sleeves_status IN ('cancelled', 'rejected', 'not_delivered')
          AND OLD.sleeves_status NOT IN ('cancelled', 'rejected', 'not_delivered') THEN
        UPDATE carriers
        SET
            total_deliveries = total_deliveries + 1,
            failed_deliveries = failed_deliveries + 1
        WHERE id = NEW.courier_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_carrier_rating()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.delivery_rating IS NOT NULL AND OLD.delivery_rating IS NULL THEN
        UPDATE carriers
        SET
            average_rating = (
                (average_rating * total_ratings + NEW.delivery_rating) / (total_ratings + 1)
            ),
            total_ratings = total_ratings + 1
        WHERE id = NEW.courier_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- PARTE 23: FUNCIONES DE INVENTORY MANAGEMENT
-- ================================================================

CREATE OR REPLACE FUNCTION update_product_stock_on_order_status()
RETURNS TRIGGER AS $$
DECLARE
    line_item JSONB;
    product_uuid UUID;
    item_quantity INT;
    stock_before_change INT;
    stock_after_change INT;
BEGIN
    IF (TG_OP = 'UPDATE' AND OLD.sleeves_status = NEW.sleeves_status) THEN
        RETURN NEW;
    END IF;

    -- Case 1: Order moves to ready_to_ship (decrement stock)
    IF (TG_OP = 'UPDATE' AND NEW.sleeves_status = 'ready_to_ship' AND OLD.sleeves_status != 'ready_to_ship') THEN
        IF NEW.line_items IS NOT NULL AND jsonb_array_length(NEW.line_items) > 0 THEN
            FOR line_item IN SELECT * FROM jsonb_array_elements(NEW.line_items)
            LOOP
                product_uuid := (line_item->>'product_id')::UUID;
                item_quantity := COALESCE((line_item->>'quantity')::INT, 0);

                IF product_uuid IS NOT NULL AND item_quantity > 0 THEN
                    SELECT stock INTO stock_before_change
                    FROM products
                    WHERE id = product_uuid AND store_id = NEW.store_id
                    FOR UPDATE;

                    IF FOUND THEN
                        stock_after_change := GREATEST(0, stock_before_change - item_quantity);

                        UPDATE products
                        SET stock = stock_after_change, updated_at = NOW()
                        WHERE id = product_uuid AND store_id = NEW.store_id;

                        INSERT INTO inventory_movements (
                            store_id, product_id, order_id,
                            quantity_change, stock_before, stock_after,
                            movement_type, order_status_from, order_status_to, notes
                        ) VALUES (
                            NEW.store_id, product_uuid, NEW.id,
                            -item_quantity, stock_before_change, stock_after_change,
                            'order_ready', OLD.sleeves_status, NEW.sleeves_status,
                            'Stock decrementado para pedido listo para envío'
                        );
                    END IF;
                END IF;
            END LOOP;
        END IF;
    END IF;

    -- Case 2: Order cancelled/rejected from ready_to_ship or later (restore stock)
    IF (TG_OP = 'UPDATE' AND
        NEW.sleeves_status IN ('cancelled', 'rejected') AND
        OLD.sleeves_status IN ('ready_to_ship', 'shipped', 'delivered')) THEN

        IF NEW.line_items IS NOT NULL AND jsonb_array_length(NEW.line_items) > 0 THEN
            FOR line_item IN SELECT * FROM jsonb_array_elements(NEW.line_items)
            LOOP
                product_uuid := (line_item->>'product_id')::UUID;
                item_quantity := COALESCE((line_item->>'quantity')::INT, 0);

                IF product_uuid IS NOT NULL AND item_quantity > 0 THEN
                    SELECT stock INTO stock_before_change
                    FROM products
                    WHERE id = product_uuid AND store_id = NEW.store_id
                    FOR UPDATE;

                    IF FOUND THEN
                        stock_after_change := stock_before_change + item_quantity;

                        UPDATE products
                        SET stock = stock_after_change, updated_at = NOW()
                        WHERE id = product_uuid AND store_id = NEW.store_id;

                        INSERT INTO inventory_movements (
                            store_id, product_id, order_id,
                            quantity_change, stock_before, stock_after,
                            movement_type, order_status_from, order_status_to, notes
                        ) VALUES (
                            NEW.store_id, product_uuid, NEW.id,
                            item_quantity, stock_before_change, stock_after_change,
                            'order_cancelled', OLD.sleeves_status, NEW.sleeves_status,
                            'Stock restaurado al cancelar/rechazar pedido'
                        );
                    END IF;
                END IF;
            END LOOP;
        END IF;
    END IF;

    -- Case 3: Order reverted from ready_to_ship back to earlier status (restore stock)
    IF (TG_OP = 'UPDATE' AND
        OLD.sleeves_status IN ('ready_to_ship', 'shipped', 'delivered') AND
        NEW.sleeves_status IN ('pending', 'confirmed', 'in_preparation')) THEN

        IF NEW.line_items IS NOT NULL AND jsonb_array_length(NEW.line_items) > 0 THEN
            FOR line_item IN SELECT * FROM jsonb_array_elements(NEW.line_items)
            LOOP
                product_uuid := (line_item->>'product_id')::UUID;
                item_quantity := COALESCE((line_item->>'quantity')::INT, 0);

                IF product_uuid IS NOT NULL AND item_quantity > 0 THEN
                    SELECT stock INTO stock_before_change
                    FROM products
                    WHERE id = product_uuid AND store_id = NEW.store_id
                    FOR UPDATE;

                    IF FOUND THEN
                        stock_after_change := stock_before_change + item_quantity;

                        UPDATE products
                        SET stock = stock_after_change, updated_at = NOW()
                        WHERE id = product_uuid AND store_id = NEW.store_id;

                        INSERT INTO inventory_movements (
                            store_id, product_id, order_id,
                            quantity_change, stock_before, stock_after,
                            movement_type, order_status_from, order_status_to, notes
                        ) VALUES (
                            NEW.store_id, product_uuid, NEW.id,
                            item_quantity, stock_before_change, stock_after_change,
                            'order_reverted', OLD.sleeves_status, NEW.sleeves_status,
                            'Stock restaurado al revertir pedido a estado anterior'
                        );
                    END IF;
                END IF;
            END LOOP;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_line_items_edit_after_stock_deducted()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.sleeves_status IN ('ready_to_ship', 'shipped', 'delivered') AND
       OLD.line_items::text != NEW.line_items::text THEN
        RAISE EXCEPTION 'Cannot modify line_items for order % - stock has been decremented. Cancel the order and create a new one instead.', OLD.id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_order_deletion_after_stock_deducted()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.sleeves_status IN ('ready_to_ship', 'shipped', 'delivered') THEN
        RAISE EXCEPTION 'Cannot delete order % - stock has been decremented. Cancel the order instead.', OLD.id;
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- PARTE 24: FUNCIONES DE DELIVERY INCIDENTS
-- ================================================================

CREATE OR REPLACE FUNCTION create_incident_on_delivery_failure()
RETURNS TRIGGER AS $$
DECLARE
    v_attempt_id UUID;
    v_incident_id UUID;
    v_retry_date DATE;
BEGIN
    IF NEW.sleeves_status = 'incident'
       AND (OLD IS NULL OR OLD.sleeves_status != 'incident') THEN

        IF NOT EXISTS (
            SELECT 1 FROM delivery_incidents
            WHERE order_id = NEW.id AND status = 'active'
        ) THEN

            SELECT id INTO v_attempt_id
            FROM delivery_attempts
            WHERE order_id = NEW.id AND status = 'failed'
            ORDER BY created_at DESC
            LIMIT 1;

            INSERT INTO delivery_incidents (
                order_id, store_id, initial_attempt_id,
                status, max_retry_attempts, current_retry_count
            ) VALUES (
                NEW.id, NEW.store_id, v_attempt_id,
                'active', 3, 0
            )
            RETURNING id INTO v_incident_id;

            FOR i IN 1..3 LOOP
                v_retry_date := CURRENT_DATE + (i || ' days')::INTERVAL;

                INSERT INTO incident_retry_attempts (
                    incident_id, retry_number, scheduled_date,
                    rescheduled_by, status, courier_notes
                ) VALUES (
                    v_incident_id, i, v_retry_date,
                    'system', 'scheduled', 'Reintento automático programado'
                );
            END LOOP;

            NEW.has_active_incident := TRUE;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_incident_on_retry_completion()
RETURNS TRIGGER AS $$
DECLARE
    v_incident_id UUID;
    v_order_id UUID;
    v_store_id UUID;
BEGIN
    IF NEW.status IN ('delivered', 'failed')
       AND (OLD.status IS NULL OR OLD.status NOT IN ('delivered', 'failed')) THEN

        v_incident_id := NEW.incident_id;

        SELECT order_id, store_id INTO v_order_id, v_store_id
        FROM delivery_incidents
        WHERE id = v_incident_id;

        IF NEW.status = 'delivered' THEN
            UPDATE delivery_incidents
            SET status = 'resolved',
                resolution_type = 'delivered',
                resolved_at = NOW(),
                resolved_by = 'courier',
                updated_at = NOW()
            WHERE id = v_incident_id;

            UPDATE orders
            SET sleeves_status = 'delivered',
                delivery_status = 'confirmed',
                delivered_at = NOW(),
                has_active_incident = FALSE,
                updated_at = NOW()
            WHERE id = v_order_id;

        ELSIF NEW.status = 'failed' THEN
            UPDATE delivery_incidents
            SET current_retry_count = current_retry_count + 1,
                updated_at = NOW()
            WHERE id = v_incident_id;

            UPDATE delivery_incidents
            SET status = 'expired',
                resolution_type = 'max_retries_reached',
                resolved_at = NOW(),
                updated_at = NOW()
            WHERE id = v_incident_id
              AND current_retry_count >= max_retry_attempts;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- PARTE 25: FUNCIONES DE CLEANUP
-- ================================================================

CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM user_sessions
    WHERE expires_at < NOW() OR (is_active = false AND last_activity < NOW() - INTERVAL '30 days');
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION cleanup_old_activity_logs()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM activity_log
    WHERE created_at < NOW() - INTERVAL '90 days';
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION cleanup_expired_idempotency_keys()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM shopify_webhook_idempotency WHERE expires_at < NOW();
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION cleanup_expired_oauth_states()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM shopify_oauth_states WHERE expires_at < NOW();
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION cleanup_old_webhook_queue()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM webhook_queue
    WHERE status = 'completed' AND created_at < NOW() - INTERVAL '7 days';
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- PARTE 26: FUNCIONES DE USER ACTIVITY
-- ================================================================

CREATE OR REPLACE FUNCTION log_user_activity(
    p_user_id UUID,
    p_store_id UUID,
    p_action_type VARCHAR(50),
    p_description TEXT,
    p_metadata JSONB DEFAULT '{}',
    p_ip_address INET DEFAULT NULL,
    p_user_agent TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_log_id UUID;
BEGIN
    INSERT INTO activity_log (user_id, store_id, action_type, description, metadata, ip_address, user_agent)
    VALUES (p_user_id, p_store_id, p_action_type, p_description, p_metadata, p_ip_address, p_user_agent)
    RETURNING id INTO v_log_id;
    RETURN v_log_id;
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- PARTE 27: FUNCIONES DE MERCADERÍA
-- ================================================================

CREATE OR REPLACE FUNCTION generate_inbound_reference(p_store_id UUID)
RETURNS VARCHAR(50) AS $$
DECLARE
    v_date_part VARCHAR(8);
    v_sequence INTEGER;
    v_reference VARCHAR(50);
BEGIN
    v_date_part := TO_CHAR(CURRENT_DATE, 'YYYYMMDD');

    SELECT COALESCE(MAX(
        CASE
            WHEN internal_reference ~ ('^ISH-' || v_date_part || '-[0-9]+$')
            THEN SUBSTRING(internal_reference FROM '[0-9]+$')::INTEGER
            ELSE 0
        END
    ), 0) + 1 INTO v_sequence
    FROM inbound_shipments
    WHERE store_id = p_store_id
      AND internal_reference LIKE 'ISH-' || v_date_part || '-%';

    v_reference := 'ISH-' || v_date_part || '-' || LPAD(v_sequence::TEXT, 3, '0');
    RETURN v_reference;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION receive_shipment_items(
    p_shipment_id UUID,
    p_items JSONB,
    p_received_by UUID
)
RETURNS JSONB AS $$
DECLARE
    v_item JSONB;
    v_item_id UUID;
    v_qty_received INTEGER;
    v_qty_rejected INTEGER;
    v_discrepancy_notes TEXT;
    v_product_id UUID;
    v_updated_count INTEGER := 0;
    v_store_id UUID;
BEGIN
    SELECT store_id INTO v_store_id FROM inbound_shipments WHERE id = p_shipment_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_item_id := (v_item->>'id')::UUID;
        v_qty_received := COALESCE((v_item->>'qty_received')::INTEGER, 0);
        v_qty_rejected := COALESCE((v_item->>'qty_rejected')::INTEGER, 0);
        v_discrepancy_notes := v_item->>'discrepancy_notes';

        SELECT product_id INTO v_product_id FROM inbound_shipment_items WHERE id = v_item_id;

        UPDATE inbound_shipment_items
        SET qty_received = v_qty_received,
            qty_rejected = v_qty_rejected,
            discrepancy_notes = v_discrepancy_notes,
            updated_at = NOW()
        WHERE id = v_item_id;

        IF v_qty_received > 0 THEN
            UPDATE products
            SET stock = stock + v_qty_received,
                updated_at = NOW()
            WHERE id = v_product_id;
        END IF;

        v_updated_count := v_updated_count + 1;
    END LOOP;

    UPDATE inbound_shipments
    SET received_date = NOW(),
        received_by = p_received_by,
        status = CASE
            WHEN EXISTS (
                SELECT 1 FROM inbound_shipment_items
                WHERE shipment_id = p_shipment_id AND qty_received < qty_ordered
            ) THEN 'partial'
            ELSE 'received'
        END,
        updated_at = NOW()
    WHERE id = p_shipment_id;

    RETURN jsonb_build_object('updated_items', v_updated_count, 'success', TRUE);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_shipment_total_cost()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE inbound_shipments
    SET total_cost = (
        SELECT COALESCE(SUM(total_cost), 0)
        FROM inbound_shipment_items
        WHERE shipment_id = COALESCE(NEW.shipment_id, OLD.shipment_id)
    ) + shipping_cost,
    updated_at = NOW()
    WHERE id = COALESCE(NEW.shipment_id, OLD.shipment_id);

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- PARTE 28: FUNCIONES DE WAREHOUSE
-- ================================================================

CREATE OR REPLACE FUNCTION generate_session_code()
RETURNS TEXT AS $$
DECLARE
    v_date_part TEXT;
    v_sequence INTEGER;
    v_code TEXT;
BEGIN
    v_date_part := TO_CHAR(CURRENT_DATE, 'DDMMYYYY');

    SELECT COALESCE(MAX(
        CASE
            WHEN code ~ ('^PREP-' || v_date_part || '-[0-9]+$')
            THEN SUBSTRING(code FROM '[0-9]+$')::INTEGER
            ELSE 0
        END
    ), 0) + 1 INTO v_sequence
    FROM picking_sessions
    WHERE code LIKE 'PREP-' || v_date_part || '-%';

    v_code := 'PREP-' || v_date_part || '-' || LPAD(v_sequence::TEXT, 2, '0');
    RETURN v_code;
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- PARTE 29: FUNCIONES DE SHIPMENTS
-- ================================================================

CREATE OR REPLACE FUNCTION create_shipment(
    p_store_id UUID,
    p_order_id UUID,
    p_shipped_by UUID,
    p_notes TEXT DEFAULT NULL
)
RETURNS shipments AS $$
DECLARE
    v_order_status TEXT;
    v_courier_id UUID;
    v_shipment shipments;
BEGIN
    SELECT sleeves_status, courier_id
    INTO v_order_status, v_courier_id
    FROM orders
    WHERE id = p_order_id AND store_id = p_store_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order not found or does not belong to this store';
    END IF;

    IF v_order_status != 'ready_to_ship' THEN
        RAISE EXCEPTION 'Order must be in ready_to_ship status. Current status: %', v_order_status;
    END IF;

    INSERT INTO shipments (store_id, order_id, courier_id, shipped_by, notes)
    VALUES (p_store_id, p_order_id, v_courier_id, p_shipped_by, p_notes)
    RETURNING * INTO v_shipment;

    UPDATE orders SET sleeves_status = 'shipped' WHERE id = p_order_id;

    RETURN v_shipment;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION create_shipments_batch(
    p_store_id UUID,
    p_order_ids UUID[],
    p_shipped_by UUID,
    p_notes TEXT DEFAULT NULL
)
RETURNS TABLE (
    shipment_id UUID,
    order_id UUID,
    order_number TEXT,
    success BOOLEAN,
    error_message TEXT
) AS $$
DECLARE
    v_order_id UUID;
    v_shipment shipments;
BEGIN
    FOREACH v_order_id IN ARRAY p_order_ids
    LOOP
        BEGIN
            v_shipment := create_shipment(p_store_id, v_order_id, p_shipped_by, p_notes);

            RETURN QUERY
            SELECT
                v_shipment.id,
                v_order_id,
                COALESCE(o.shopify_order_number, 'ORD-' || SUBSTRING(o.id::TEXT, 1, 8)),
                TRUE,
                NULL::TEXT
            FROM orders o
            WHERE o.id = v_order_id;

        EXCEPTION WHEN OTHERS THEN
            RETURN QUERY
            SELECT
                NULL::UUID,
                v_order_id,
                COALESCE(o.shopify_order_number, 'ORD-' || SUBSTRING(o.id::TEXT, 1, 8)),
                FALSE,
                SQLERRM
            FROM orders o
            WHERE o.id = v_order_id;
        END;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- PARTE 30: FUNCIONES DE RETURNS
-- ================================================================

CREATE OR REPLACE FUNCTION generate_return_session_code(p_store_id UUID)
RETURNS VARCHAR(50) AS $$
DECLARE
    v_date_part TEXT;
    v_sequence INTEGER;
    v_code VARCHAR(50);
BEGIN
    v_date_part := TO_CHAR(CURRENT_DATE, 'DDMMYYYY');

    SELECT COALESCE(MAX(
        CASE
            WHEN session_code ~ ('^RET-' || v_date_part || '-[0-9]+$')
            THEN SUBSTRING(session_code FROM '[0-9]+$')::INTEGER
            ELSE 0
        END
    ), 0) + 1 INTO v_sequence
    FROM return_sessions
    WHERE store_id = p_store_id
      AND session_code LIKE 'RET-' || v_date_part || '-%';

    v_code := 'RET-' || v_date_part || '-' || LPAD(v_sequence::TEXT, 2, '0');
    RETURN v_code;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION complete_return_session(p_session_id UUID)
RETURNS JSONB AS $$
DECLARE
    v_item RECORD;
    v_order_id UUID;
    v_store_id UUID;
    v_total_accepted INT := 0;
    v_total_rejected INT := 0;
    v_orders_processed INT := 0;
BEGIN
    SELECT store_id INTO v_store_id FROM return_sessions WHERE id = p_session_id;

    FOR v_item IN
        SELECT * FROM return_session_items WHERE session_id = p_session_id
    LOOP
        IF v_item.quantity_accepted > 0 THEN
            UPDATE products
            SET stock = stock + v_item.quantity_accepted, updated_at = NOW()
            WHERE id = v_item.product_id;

            INSERT INTO inventory_movements (
                store_id, product_id, order_id, quantity_change,
                stock_before, stock_after, movement_type, notes
            )
            SELECT
                v_store_id, v_item.product_id, v_item.order_id, v_item.quantity_accepted,
                p.stock - v_item.quantity_accepted, p.stock, 'return_accepted',
                'Stock restaurado por devolución aceptada'
            FROM products p WHERE p.id = v_item.product_id;

            v_total_accepted := v_total_accepted + v_item.quantity_accepted;
        END IF;

        IF v_item.quantity_rejected > 0 THEN
            INSERT INTO inventory_movements (
                store_id, product_id, order_id, quantity_change,
                stock_before, stock_after, movement_type, notes, reason
            )
            SELECT
                v_store_id, v_item.product_id, v_item.order_id, 0,
                p.stock, p.stock, 'return_rejected',
                COALESCE(v_item.rejection_notes, 'Producto rechazado en devolución'),
                v_item.rejection_reason
            FROM products p WHERE p.id = v_item.product_id;

            v_total_rejected := v_total_rejected + v_item.quantity_rejected;
        END IF;

        UPDATE return_session_items
        SET processed_at = NOW()
        WHERE id = v_item.id;
    END LOOP;

    FOR v_order_id IN
        SELECT DISTINCT order_id FROM return_session_items WHERE session_id = p_session_id
    LOOP
        UPDATE orders SET sleeves_status = 'returned', updated_at = NOW() WHERE id = v_order_id;

        UPDATE return_session_orders
        SET processed = TRUE, processed_at = NOW()
        WHERE session_id = p_session_id AND order_id = v_order_id;

        v_orders_processed := v_orders_processed + 1;
    END LOOP;

    UPDATE return_sessions
    SET status = 'completed',
        completed_at = NOW(),
        processed_orders = v_orders_processed,
        accepted_items = v_total_accepted,
        rejected_items = v_total_rejected
    WHERE id = p_session_id;

    RETURN jsonb_build_object(
        'success', TRUE,
        'orders_processed', v_orders_processed,
        'items_accepted', v_total_accepted,
        'items_rejected', v_total_rejected
    );
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- PARTE 31: FUNCIONES DE SHOPIFY PRODUCT MAPPING
-- ================================================================

CREATE OR REPLACE FUNCTION find_product_by_shopify_ids(
    p_store_id UUID,
    p_shopify_product_id VARCHAR(255),
    p_shopify_variant_id VARCHAR(255) DEFAULT NULL,
    p_sku VARCHAR(255) DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_product_id UUID;
BEGIN
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

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION create_line_items_from_shopify(
    p_order_id UUID,
    p_store_id UUID,
    p_line_items JSONB
)
RETURNS INTEGER AS $$
DECLARE
    v_item JSONB;
    v_product_id UUID;
    v_count INTEGER := 0;
BEGIN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_line_items)
    LOOP
        v_product_id := find_product_by_shopify_ids(
            p_store_id,
            v_item->>'product_id',
            v_item->>'variant_id',
            v_item->>'sku'
        );

        INSERT INTO order_line_items (
            order_id, product_id, shopify_product_id, shopify_variant_id,
            shopify_line_item_id, product_name, variant_title, sku,
            quantity, unit_price, total_price, discount_amount, tax_amount,
            properties, shopify_data
        ) VALUES (
            p_order_id,
            v_product_id,
            v_item->>'product_id',
            v_item->>'variant_id',
            v_item->>'id',
            COALESCE(v_item->>'name', v_item->>'title', 'Unknown Product'),
            v_item->>'variant_title',
            v_item->>'sku',
            COALESCE((v_item->>'quantity')::INTEGER, 1),
            COALESCE((v_item->>'price')::DECIMAL, 0),
            COALESCE((v_item->>'price')::DECIMAL, 0) * COALESCE((v_item->>'quantity')::INTEGER, 1),
            COALESCE((v_item->>'total_discount')::DECIMAL, 0),
            COALESCE((SELECT SUM((tax->>'price')::DECIMAL) FROM jsonb_array_elements(v_item->'tax_lines') AS tax), 0),
            v_item->'properties',
            v_item
        )
        ON CONFLICT (order_id, product_id) WHERE product_id IS NOT NULL
        DO UPDATE SET
            quantity = EXCLUDED.quantity,
            unit_price = EXCLUDED.unit_price,
            total_price = EXCLUDED.total_price,
            updated_at = NOW();

        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- PARTE 32: FUNCIONES DE WEBHOOK METRICS
-- ================================================================

CREATE OR REPLACE FUNCTION record_webhook_metric(
    p_integration_id UUID,
    p_store_id UUID,
    p_received INT DEFAULT 0,
    p_processed INT DEFAULT 0,
    p_failed INT DEFAULT 0,
    p_retried INT DEFAULT 0,
    p_duplicates INT DEFAULT 0,
    p_processing_time_ms INT DEFAULT 0
)
RETURNS VOID AS $$
BEGIN
    INSERT INTO shopify_webhook_metrics (
        integration_id, store_id, metric_date, metric_hour,
        webhooks_received, webhooks_processed, webhooks_failed,
        webhooks_retried, webhooks_duplicates, avg_processing_time_ms,
        max_processing_time_ms, min_processing_time_ms
    ) VALUES (
        p_integration_id, p_store_id, CURRENT_DATE, EXTRACT(HOUR FROM NOW())::INTEGER,
        p_received, p_processed, p_failed, p_retried, p_duplicates,
        p_processing_time_ms, p_processing_time_ms, p_processing_time_ms
    )
    ON CONFLICT (integration_id, metric_date, metric_hour)
    DO UPDATE SET
        webhooks_received = shopify_webhook_metrics.webhooks_received + p_received,
        webhooks_processed = shopify_webhook_metrics.webhooks_processed + p_processed,
        webhooks_failed = shopify_webhook_metrics.webhooks_failed + p_failed,
        webhooks_retried = shopify_webhook_metrics.webhooks_retried + p_retried,
        webhooks_duplicates = shopify_webhook_metrics.webhooks_duplicates + p_duplicates,
        avg_processing_time_ms = (shopify_webhook_metrics.avg_processing_time_ms + p_processing_time_ms) / 2,
        max_processing_time_ms = GREATEST(shopify_webhook_metrics.max_processing_time_ms, p_processing_time_ms),
        min_processing_time_ms = LEAST(
            CASE WHEN shopify_webhook_metrics.min_processing_time_ms = 0
                 THEN p_processing_time_ms
                 ELSE shopify_webhook_metrics.min_processing_time_ms END,
            p_processing_time_ms
        ),
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- PARTE 33: FUNCIONES DE CARRIER SETTLEMENTS
-- ================================================================

CREATE OR REPLACE FUNCTION create_carrier_settlement(
    p_store_id UUID,
    p_carrier_id UUID,
    p_period_start DATE,
    p_period_end DATE,
    p_created_by UUID
)
RETURNS carrier_settlements AS $$
DECLARE
    v_settlement carrier_settlements;
    v_total_orders INT;
    v_total_cod DECIMAL(12,2);
    v_total_shipping DECIMAL(12,2);
BEGIN
    SELECT
        COUNT(*),
        COALESCE(SUM(cod_amount), 0),
        COALESCE(SUM(shipping_cost), 0)
    INTO v_total_orders, v_total_cod, v_total_shipping
    FROM orders
    WHERE store_id = p_store_id
      AND courier_id = p_carrier_id
      AND sleeves_status = 'delivered'
      AND delivered_at >= p_period_start
      AND delivered_at < p_period_end + INTERVAL '1 day'
      AND carrier_settlement_id IS NULL;

    INSERT INTO carrier_settlements (
        store_id, carrier_id, settlement_period_start, settlement_period_end,
        total_orders, total_cod_collected, total_shipping_cost, created_by
    ) VALUES (
        p_store_id, p_carrier_id, p_period_start, p_period_end,
        v_total_orders, v_total_cod, v_total_shipping, p_created_by
    )
    RETURNING * INTO v_settlement;

    UPDATE orders
    SET carrier_settlement_id = v_settlement.id
    WHERE store_id = p_store_id
      AND courier_id = p_carrier_id
      AND sleeves_status = 'delivered'
      AND delivered_at >= p_period_start
      AND delivered_at < p_period_end + INTERVAL '1 day'
      AND carrier_settlement_id IS NULL;

    RETURN v_settlement;
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- PARTE 34: TRIGGERS DE TIMESTAMP
-- ================================================================

-- Stores
DROP TRIGGER IF EXISTS trigger_update_stores_timestamp ON stores;
CREATE TRIGGER trigger_update_stores_timestamp
    BEFORE UPDATE ON stores FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

-- Store Config
DROP TRIGGER IF EXISTS trigger_update_store_config_timestamp ON store_config;
CREATE TRIGGER trigger_update_store_config_timestamp
    BEFORE UPDATE ON store_config FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

-- Products
DROP TRIGGER IF EXISTS trigger_update_products_timestamp ON products;
CREATE TRIGGER trigger_update_products_timestamp
    BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

-- Customers
DROP TRIGGER IF EXISTS trigger_update_customers_timestamp ON customers;
CREATE TRIGGER trigger_update_customers_timestamp
    BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

-- Carriers
DROP TRIGGER IF EXISTS trigger_update_carriers_timestamp ON carriers;
CREATE TRIGGER trigger_update_carriers_timestamp
    BEFORE UPDATE ON carriers FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

-- Suppliers
DROP TRIGGER IF EXISTS trigger_update_suppliers_timestamp ON suppliers;
CREATE TRIGGER trigger_update_suppliers_timestamp
    BEFORE UPDATE ON suppliers FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

-- Campaigns
DROP TRIGGER IF EXISTS trigger_update_campaigns_timestamp ON campaigns;
CREATE TRIGGER trigger_update_campaigns_timestamp
    BEFORE UPDATE ON campaigns FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

-- Shipping Integrations
DROP TRIGGER IF EXISTS trigger_update_shipping_integrations_timestamp ON shipping_integrations;
CREATE TRIGGER trigger_update_shipping_integrations_timestamp
    BEFORE UPDATE ON shipping_integrations FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

-- Orders
DROP TRIGGER IF EXISTS trigger_update_orders_timestamp ON orders;
CREATE TRIGGER trigger_update_orders_timestamp
    BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

-- Order Line Items
DROP TRIGGER IF EXISTS trigger_update_order_line_items_timestamp ON order_line_items;
CREATE TRIGGER trigger_update_order_line_items_timestamp
    BEFORE UPDATE ON order_line_items FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

-- Delivery Attempts
DROP TRIGGER IF EXISTS trigger_update_delivery_attempts_timestamp ON delivery_attempts;
CREATE TRIGGER trigger_update_delivery_attempts_timestamp
    BEFORE UPDATE ON delivery_attempts FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

-- Daily Settlements
DROP TRIGGER IF EXISTS trigger_update_daily_settlements_timestamp ON daily_settlements;
CREATE TRIGGER trigger_update_daily_settlements_timestamp
    BEFORE UPDATE ON daily_settlements FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

-- Carrier Zones
DROP TRIGGER IF EXISTS trigger_update_carrier_zones_timestamp ON carrier_zones;
CREATE TRIGGER trigger_update_carrier_zones_timestamp
    BEFORE UPDATE ON carrier_zones FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

-- Carrier Settlements
DROP TRIGGER IF EXISTS trigger_update_carrier_settlements_timestamp ON carrier_settlements;
CREATE TRIGGER trigger_update_carrier_settlements_timestamp
    BEFORE UPDATE ON carrier_settlements FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

-- Inbound Shipments
DROP TRIGGER IF EXISTS trigger_update_inbound_shipments_timestamp ON inbound_shipments;
CREATE TRIGGER trigger_update_inbound_shipments_timestamp
    BEFORE UPDATE ON inbound_shipments FOR EACH ROW EXECUTE FUNCTION update_inbound_shipment_timestamp();

-- Inbound Shipment Items
DROP TRIGGER IF EXISTS trigger_update_inbound_shipment_items_timestamp ON inbound_shipment_items;
CREATE TRIGGER trigger_update_inbound_shipment_items_timestamp
    BEFORE UPDATE ON inbound_shipment_items FOR EACH ROW EXECUTE FUNCTION update_inbound_shipment_timestamp();

-- Picking Sessions
DROP TRIGGER IF EXISTS trigger_update_picking_sessions_timestamp ON picking_sessions;
CREATE TRIGGER trigger_update_picking_sessions_timestamp
    BEFORE UPDATE ON picking_sessions FOR EACH ROW EXECUTE FUNCTION update_picking_session_timestamp();

-- Picking Session Items
DROP TRIGGER IF EXISTS trigger_update_picking_session_items_timestamp ON picking_session_items;
CREATE TRIGGER trigger_update_picking_session_items_timestamp
    BEFORE UPDATE ON picking_session_items FOR EACH ROW EXECUTE FUNCTION update_picking_session_timestamp();

-- Packing Progress
DROP TRIGGER IF EXISTS trigger_update_packing_progress_timestamp ON packing_progress;
CREATE TRIGGER trigger_update_packing_progress_timestamp
    BEFORE UPDATE ON packing_progress FOR EACH ROW EXECUTE FUNCTION update_picking_session_timestamp();

-- Shipments
DROP TRIGGER IF EXISTS trigger_update_shipments_timestamp ON shipments;
CREATE TRIGGER trigger_update_shipments_timestamp
    BEFORE UPDATE ON shipments FOR EACH ROW EXECUTE FUNCTION update_shipments_updated_at();

-- Shopify Integrations
DROP TRIGGER IF EXISTS trigger_update_shopify_integrations_timestamp ON shopify_integrations;
CREATE TRIGGER trigger_update_shopify_integrations_timestamp
    BEFORE UPDATE ON shopify_integrations FOR EACH ROW EXECUTE FUNCTION update_shopify_updated_at();

-- Shopify Import Jobs
DROP TRIGGER IF EXISTS trigger_update_shopify_import_jobs_timestamp ON shopify_import_jobs;
CREATE TRIGGER trigger_update_shopify_import_jobs_timestamp
    BEFORE UPDATE ON shopify_import_jobs FOR EACH ROW EXECUTE FUNCTION update_shopify_updated_at();

-- Shopify Webhook Retry Queue
DROP TRIGGER IF EXISTS trigger_update_shopify_webhook_retry_queue_timestamp ON shopify_webhook_retry_queue;
CREATE TRIGGER trigger_update_shopify_webhook_retry_queue_timestamp
    BEFORE UPDATE ON shopify_webhook_retry_queue FOR EACH ROW EXECUTE FUNCTION update_shopify_updated_at();

-- Shopify Webhook Metrics
DROP TRIGGER IF EXISTS trigger_update_shopify_webhook_metrics_timestamp ON shopify_webhook_metrics;
CREATE TRIGGER trigger_update_shopify_webhook_metrics_timestamp
    BEFORE UPDATE ON shopify_webhook_metrics FOR EACH ROW EXECUTE FUNCTION update_shopify_updated_at();

-- Delivery Incidents
DROP TRIGGER IF EXISTS trigger_update_delivery_incidents_timestamp ON delivery_incidents;
CREATE TRIGGER trigger_update_delivery_incidents_timestamp
    BEFORE UPDATE ON delivery_incidents FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

-- Incident Retry Attempts
DROP TRIGGER IF EXISTS trigger_update_incident_retry_attempts_timestamp ON incident_retry_attempts;
CREATE TRIGGER trigger_update_incident_retry_attempts_timestamp
    BEFORE UPDATE ON incident_retry_attempts FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

-- ================================================================
-- PARTE 35: TRIGGERS DE ORDERS (STATUS, DELIVERY, COD)
-- ================================================================

-- Log order status changes
DROP TRIGGER IF EXISTS trigger_log_order_status_change ON orders;
CREATE TRIGGER trigger_log_order_status_change
    AFTER UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION fn_log_order_status_change();

-- Set delivery token on confirmation
DROP TRIGGER IF EXISTS trigger_set_delivery_token ON orders;
CREATE TRIGGER trigger_set_delivery_token
    BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION set_delivery_token();

-- Calculate COD amount
DROP TRIGGER IF EXISTS trigger_calculate_cod_amount ON orders;
CREATE TRIGGER trigger_calculate_cod_amount
    BEFORE INSERT OR UPDATE OF payment_method ON orders
    FOR EACH ROW EXECUTE FUNCTION calculate_cod_amount();

-- ================================================================
-- PARTE 36: TRIGGERS DE CUSTOMER STATS
-- ================================================================

DROP TRIGGER IF EXISTS trigger_update_customer_stats ON orders;
CREATE TRIGGER trigger_update_customer_stats
    AFTER INSERT ON orders FOR EACH ROW EXECUTE FUNCTION fn_update_customer_stats();

DROP TRIGGER IF EXISTS trigger_update_customer_stats_on_update ON orders;
CREATE TRIGGER trigger_update_customer_stats_on_update
    AFTER UPDATE OF total_price ON orders FOR EACH ROW EXECUTE FUNCTION fn_update_customer_stats_on_update();

-- ================================================================
-- PARTE 37: TRIGGERS DE CARRIER STATS
-- ================================================================

DROP TRIGGER IF EXISTS trigger_update_carrier_stats ON orders;
CREATE TRIGGER trigger_update_carrier_stats
    AFTER UPDATE OF sleeves_status ON orders FOR EACH ROW EXECUTE FUNCTION update_carrier_delivery_stats();

DROP TRIGGER IF EXISTS trigger_update_carrier_rating ON orders;
CREATE TRIGGER trigger_update_carrier_rating
    AFTER UPDATE OF delivery_rating ON orders FOR EACH ROW EXECUTE FUNCTION update_carrier_rating();

-- ================================================================
-- PARTE 38: TRIGGERS DE INVENTORY MANAGEMENT
-- ================================================================

DROP TRIGGER IF EXISTS trigger_update_stock_on_order_status ON orders;
CREATE TRIGGER trigger_update_stock_on_order_status
    AFTER UPDATE OF sleeves_status ON orders
    FOR EACH ROW EXECUTE FUNCTION update_product_stock_on_order_status();

DROP TRIGGER IF EXISTS trigger_prevent_line_items_edit ON orders;
CREATE TRIGGER trigger_prevent_line_items_edit
    BEFORE UPDATE OF line_items ON orders
    FOR EACH ROW EXECUTE FUNCTION prevent_line_items_edit_after_stock_deducted();

DROP TRIGGER IF EXISTS trigger_prevent_order_deletion ON orders;
CREATE TRIGGER trigger_prevent_order_deletion
    BEFORE DELETE ON orders
    FOR EACH ROW EXECUTE FUNCTION prevent_order_deletion_after_stock_deducted();

-- ================================================================
-- PARTE 39: TRIGGERS DE DELIVERY INCIDENTS
-- ================================================================

DROP TRIGGER IF EXISTS trigger_create_incident_on_failure ON orders;
CREATE TRIGGER trigger_create_incident_on_failure
    BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION create_incident_on_delivery_failure();

DROP TRIGGER IF EXISTS trigger_update_incident_on_retry ON incident_retry_attempts;
CREATE TRIGGER trigger_update_incident_on_retry
    AFTER UPDATE ON incident_retry_attempts
    FOR EACH ROW EXECUTE FUNCTION update_incident_on_retry_completion();

-- ================================================================
-- PARTE 40: TRIGGERS DE MERCADERÍA
-- ================================================================

DROP TRIGGER IF EXISTS trigger_update_shipment_total_after_item_change ON inbound_shipment_items;
CREATE TRIGGER trigger_update_shipment_total_after_item_change
    AFTER INSERT OR UPDATE OR DELETE ON inbound_shipment_items
    FOR EACH ROW EXECUTE FUNCTION update_shipment_total_cost();

-- ================================================================
-- PARTE 41: VIEWS
-- ================================================================

-- Courier Performance View
CREATE OR REPLACE VIEW courier_performance AS
SELECT
    c.id,
    c.name,
    c.phone,
    c.store_id,
    c.total_deliveries,
    c.successful_deliveries,
    c.failed_deliveries,
    c.delivery_rate,
    c.average_rating,
    c.total_ratings,
    COUNT(o.id) AS assigned_orders,
    COUNT(CASE WHEN o.sleeves_status = 'delivered' THEN 1 END) AS delivered_orders,
    COUNT(CASE WHEN o.sleeves_status IN ('cancelled', 'rejected', 'not_delivered') THEN 1 END) AS failed_orders,
    COUNT(CASE WHEN o.sleeves_status NOT IN ('delivered', 'cancelled', 'rejected', 'not_delivered', 'returned') THEN 1 END) AS pending_orders,
    AVG(EXTRACT(EPOCH FROM (o.delivered_at - o.confirmed_at)) / 3600)::NUMERIC(10,2) AS avg_delivery_time_hours
FROM carriers c
LEFT JOIN orders o ON c.id = o.courier_id
GROUP BY c.id, c.name, c.phone, c.store_id, c.total_deliveries, c.successful_deliveries,
         c.failed_deliveries, c.delivery_rate, c.average_rating, c.total_ratings;

-- Shopify Integrations with Webhook Issues View
CREATE OR REPLACE VIEW shopify_integrations_with_webhook_issues AS
SELECT *
FROM shopify_integrations
WHERE webhook_registration_failed > 0 AND status = 'active';

-- Inbound Shipments Summary View
CREATE OR REPLACE VIEW inbound_shipments_summary AS
SELECT
    s.id,
    s.store_id,
    s.internal_reference,
    s.status,
    s.estimated_arrival_date,
    s.received_date,
    s.shipping_cost,
    s.total_cost,
    s.notes,
    s.created_at,
    s.updated_at,
    sup.name AS supplier_name,
    car.name AS carrier_name,
    COUNT(si.id) AS total_items,
    SUM(si.qty_ordered) AS total_qty_ordered,
    SUM(si.qty_received) AS total_qty_received,
    SUM(si.qty_rejected) AS total_qty_rejected,
    COUNT(CASE WHEN si.has_discrepancy THEN 1 END) AS items_with_discrepancies
FROM inbound_shipments s
LEFT JOIN suppliers sup ON s.supplier_id = sup.id
LEFT JOIN carriers car ON s.carrier_id = car.id
LEFT JOIN inbound_shipment_items si ON s.id = si.shipment_id
GROUP BY s.id, s.store_id, s.internal_reference, s.status, s.estimated_arrival_date,
         s.received_date, s.shipping_cost, s.total_cost, s.notes, s.created_at, s.updated_at,
         sup.name, car.name;

-- Pending Carrier Settlements Summary View
CREATE OR REPLACE VIEW pending_carrier_settlements_summary AS
SELECT
    c.id AS carrier_id,
    c.name AS carrier_name,
    c.store_id,
    COUNT(o.id) AS pending_orders,
    COALESCE(SUM(o.cod_amount), 0) AS total_cod_pending,
    COALESCE(SUM(o.shipping_cost), 0) AS total_shipping_pending,
    COALESCE(SUM(o.cod_amount), 0) - COALESCE(SUM(o.shipping_cost), 0) AS net_pending,
    MIN(o.delivered_at) AS oldest_delivery,
    MAX(o.delivered_at) AS newest_delivery
FROM carriers c
INNER JOIN orders o ON c.id = o.courier_id
    AND o.sleeves_status = 'delivered'
    AND o.carrier_settlement_id IS NULL
WHERE c.carrier_type = 'external'
  AND c.is_active = TRUE
GROUP BY c.id, c.name, c.store_id;

-- Active Incidents View
CREATE OR REPLACE VIEW v_active_incidents AS
SELECT
    i.id AS incident_id,
    i.order_id,
    i.store_id,
    i.status AS incident_status,
    i.current_retry_count,
    i.max_retry_attempts,
    i.created_at AS incident_created_at,
    o.shopify_order_number,
    o.customer_first_name,
    o.customer_last_name,
    o.customer_phone,
    o.customer_address,
    o.total_price,
    o.delivery_failure_reason,
    o.courier_notes,
    o.sleeves_status,
    c.name AS carrier_name,
    c.phone AS carrier_phone,
    da.failed_reason AS initial_failure_reason,
    da.failure_notes AS initial_failure_notes,
    da.actual_date AS initial_attempt_date,
    COALESCE(
        (
            SELECT json_agg(
                json_build_object(
                    'retry_number', ira.retry_number,
                    'status', ira.status,
                    'scheduled_date', ira.scheduled_date,
                    'courier_notes', ira.courier_notes,
                    'failure_reason', ira.failure_reason,
                    'attempted_at', COALESCE(ira.attempted_at, ira.created_at)
                ) ORDER BY ira.retry_number
            )
            FROM incident_retry_attempts ira
            WHERE ira.incident_id = i.id
        ),
        '[]'::json
    ) AS retry_attempts
FROM delivery_incidents i
INNER JOIN orders o ON i.order_id = o.id
LEFT JOIN carriers c ON o.courier_id = c.id
LEFT JOIN delivery_attempts da ON i.initial_attempt_id = da.id
WHERE i.status = 'active'
ORDER BY i.created_at DESC;

-- Webhook Queue Stats View
CREATE OR REPLACE VIEW webhook_queue_stats AS
SELECT
    integration_id,
    store_id,
    topic,
    status,
    COUNT(*) AS count,
    AVG(retry_count) AS avg_retries,
    MIN(created_at) AS oldest,
    MAX(created_at) AS newest
FROM webhook_queue
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY integration_id, store_id, topic, status;

-- ================================================================
-- PARTE 42: ROW LEVEL SECURITY (RLS) - OPTIONAL
-- ================================================================
-- Habilitar RLS para multi-tenancy seguro
-- Nota: Requiere configuración adicional de políticas

ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE carriers ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlement_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE incident_retry_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbound_shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbound_shipment_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE picking_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE picking_session_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE picking_session_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE packing_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE carrier_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE carrier_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE return_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE return_session_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE return_session_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopify_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopify_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopify_import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopify_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopify_sync_conflicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

-- ================================================================
-- PARTE 43: COMMENTS (DOCUMENTATION)
-- ================================================================

-- Tables
COMMENT ON TABLE stores IS 'Multi-tenant store management';
COMMENT ON TABLE users IS 'User authentication and profiles';
COMMENT ON TABLE user_stores IS 'Many-to-many relationship between users and stores';
COMMENT ON TABLE products IS 'Product catalog with Shopify sync support';
COMMENT ON TABLE customers IS 'Customer database with order history tracking';
COMMENT ON TABLE carriers IS 'Delivery carriers/couriers with performance metrics';
COMMENT ON TABLE orders IS 'Order management with full lifecycle tracking';
COMMENT ON TABLE order_line_items IS 'Normalized order line items with product mapping';
COMMENT ON TABLE inventory_movements IS 'Audit log for all inventory changes';
COMMENT ON TABLE delivery_incidents IS 'Tracks delivery incidents requiring retry attempts';
COMMENT ON TABLE incident_retry_attempts IS 'Individual retry attempts for delivery incidents';
COMMENT ON TABLE user_sessions IS 'Active user sessions for security monitoring';
COMMENT ON TABLE activity_log IS 'Comprehensive audit log of user actions';
COMMENT ON TABLE webhook_queue IS 'Async webhook processing queue for Shopify';
COMMENT ON TABLE inbound_shipments IS 'Inbound merchandise shipments from suppliers';
COMMENT ON TABLE picking_sessions IS 'Warehouse picking sessions for batch order processing';
COMMENT ON TABLE shipments IS 'Outbound shipment tracking when orders dispatched';
COMMENT ON TABLE return_sessions IS 'Batch return processing sessions';
COMMENT ON TABLE carrier_settlements IS 'Carrier payment settlements';

-- Functions
COMMENT ON FUNCTION update_product_stock_on_order_status() IS 'Automatically updates product stock on order status changes';
COMMENT ON FUNCTION prevent_line_items_edit_after_stock_deducted() IS 'Prevents modifying line_items after stock deducted';
COMMENT ON FUNCTION prevent_order_deletion_after_stock_deducted() IS 'Prevents deleting orders after stock deducted';
COMMENT ON FUNCTION create_incident_on_delivery_failure() IS 'Auto-creates delivery incident when order status changes to incident';
COMMENT ON FUNCTION update_incident_on_retry_completion() IS 'Updates incident status when retry attempt completes';
COMMENT ON FUNCTION cleanup_expired_sessions() IS 'Removes expired user sessions (run daily via cron)';
COMMENT ON FUNCTION cleanup_old_activity_logs() IS 'Removes activity logs older than 90 days';
COMMENT ON FUNCTION cleanup_old_webhook_queue() IS 'Removes completed webhooks older than 7 days';
COMMENT ON FUNCTION generate_session_code() IS 'Generates picking session codes in PREP-DDMMYYYY-NN format';
COMMENT ON FUNCTION generate_return_session_code(UUID) IS 'Generates return session codes in RET-DDMMYYYY-NN format';
COMMENT ON FUNCTION generate_inbound_reference(UUID) IS 'Generates inbound shipment references in ISH-YYYYMMDD-NNN format';
COMMENT ON FUNCTION create_shipment(UUID, UUID, UUID, TEXT) IS 'Creates shipment and updates order to shipped status';
COMMENT ON FUNCTION complete_return_session(UUID) IS 'Processes return session, updates inventory and order statuses';
COMMENT ON FUNCTION find_product_by_shopify_ids(UUID, VARCHAR, VARCHAR, VARCHAR) IS 'Finds local product by Shopify IDs or SKU';
COMMENT ON FUNCTION create_line_items_from_shopify(UUID, UUID, JSONB) IS 'Creates normalized line items from Shopify order data';

-- Triggers
COMMENT ON TRIGGER trigger_update_stock_on_order_status ON orders IS 'Maintains accurate inventory on order status changes';
COMMENT ON TRIGGER trigger_prevent_line_items_edit ON orders IS 'Blocks line_items modifications after stock deducted';
COMMENT ON TRIGGER trigger_prevent_order_deletion ON orders IS 'Prevents deletion of orders that affected inventory';
COMMENT ON TRIGGER trigger_create_incident_on_failure ON orders IS 'Auto-creates incident when order marked as incident';
COMMENT ON TRIGGER trigger_update_incident_on_retry ON incident_retry_attempts IS 'Updates incident when retry completes';

-- ================================================================
-- PARTE 44: CRON JOB RECOMMENDATIONS
-- ================================================================
-- Execute these functions periodically via external cron or pg_cron:
--
-- Every 5 minutes:
--   SELECT cleanup_expired_idempotency_keys();
--
-- Daily at 3 AM:
--   SELECT cleanup_expired_sessions();
--   SELECT cleanup_old_activity_logs();
--   SELECT cleanup_expired_oauth_states();
--   SELECT cleanup_old_webhook_queue();
--
-- ================================================================

-- ================================================================
-- MIGRATION SUMMARY
-- ================================================================
--
-- TABLES CREATED: 43
-- ├── Core: stores, users, user_stores, store_config
-- ├── Business: products, customers, carriers, suppliers, campaigns, shipping_integrations
-- ├── Financial: additional_values, recurring_additional_values
-- ├── Orders: orders, order_line_items, order_status_history, follow_up_log
-- ├── Delivery: delivery_attempts, daily_settlements, settlement_orders
-- ├── Inventory: inventory_movements
-- ├── Incidents: delivery_incidents, incident_retry_attempts
-- ├── Security: user_sessions, activity_log
-- ├── Shopify: shopify_integrations, shopify_oauth_states, shopify_import_jobs,
-- │            shopify_webhook_events, shopify_sync_conflicts, shopify_webhook_idempotency,
-- │            shopify_webhook_retry_queue, shopify_webhook_metrics, webhook_queue
-- ├── Merchandise: inbound_shipments, inbound_shipment_items
-- ├── Warehouse: picking_sessions, picking_session_orders, picking_session_items, packing_progress
-- ├── Shipments: shipments
-- ├── Settlements: carrier_zones, carrier_settlements
-- └── Returns: return_sessions, return_session_orders, return_session_items
--
-- FUNCTIONS CREATED: 35+
-- ├── Timestamp functions (5)
-- ├── Customer stats (2)
-- ├── Order status/delivery (4)
-- ├── Carrier stats (2)
-- ├── Inventory management (3)
-- ├── Delivery incidents (2)
-- ├── Cleanup functions (5)
-- ├── User activity (1)
-- ├── Merchandise (3)
-- ├── Warehouse (1)
-- ├── Shipments (2)
-- ├── Returns (2)
-- ├── Shopify product mapping (2)
-- ├── Webhook metrics (1)
-- └── Carrier settlements (1)
--
-- TRIGGERS CREATED: 30+
-- ├── Timestamp triggers for all tables
-- ├── Order lifecycle triggers
-- ├── Inventory management triggers
-- ├── Incident automation triggers
-- └── Merchandise cost triggers
--
-- VIEWS CREATED: 6
-- ├── courier_performance
-- ├── shopify_integrations_with_webhook_issues
-- ├── inbound_shipments_summary
-- ├── pending_carrier_settlements_summary
-- ├── v_active_incidents
-- └── webhook_queue_stats
--
-- ================================================================
-- USAGE:
-- Run this entire file on a fresh PostgreSQL database
-- The migration is idempotent (safe to run multiple times)
-- ================================================================

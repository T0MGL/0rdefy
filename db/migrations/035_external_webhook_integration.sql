-- ================================================================
-- MIGRATION 035: External Webhook Integration
-- ================================================================
-- Sistema de webhook externo para recibir pedidos desde landing pages
-- y sistemas externos (no Shopify)
-- ================================================================
-- Created: 2025-12-30
-- ================================================================

-- ================================================================
-- TABLA 1: external_webhook_configs
-- ================================================================
-- Configuración del webhook por tienda (uno por tienda)

CREATE TABLE IF NOT EXISTS external_webhook_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,

    -- Identificación
    name VARCHAR(255) NOT NULL DEFAULT 'Webhook Externo',
    description TEXT,

    -- Autenticación
    api_key VARCHAR(64) NOT NULL UNIQUE,
    api_key_prefix VARCHAR(12) NOT NULL, -- Primeros 8 chars para mostrar en UI (ej: "wh_abc123...")

    -- Configuración
    is_active BOOLEAN DEFAULT TRUE,
    auto_confirm_orders BOOLEAN DEFAULT FALSE, -- Si true, los pedidos llegan como "confirmed"
    default_currency VARCHAR(3) DEFAULT 'PYG',

    -- Estadísticas
    total_orders_received INTEGER DEFAULT 0,
    last_used_at TIMESTAMP,

    -- Metadata
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),

    -- Solo un webhook por tienda
    CONSTRAINT unique_store_webhook UNIQUE(store_id)
);

CREATE INDEX IF NOT EXISTS idx_external_webhook_store ON external_webhook_configs(store_id);
CREATE INDEX IF NOT EXISTS idx_external_webhook_api_key ON external_webhook_configs(api_key);
CREATE INDEX IF NOT EXISTS idx_external_webhook_active ON external_webhook_configs(is_active);

-- ================================================================
-- TABLA 2: external_webhook_logs
-- ================================================================
-- Registro de todas las peticiones recibidas (para debugging y auditoría)

CREATE TABLE IF NOT EXISTS external_webhook_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    config_id UUID NOT NULL REFERENCES external_webhook_configs(id) ON DELETE CASCADE,
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,

    -- Identificación de request
    request_id VARCHAR(64), -- Idempotency key del cliente (si se envía)

    -- Detalles de la petición
    source_ip INET,
    user_agent TEXT,

    -- Payload recibido
    payload JSONB NOT NULL,
    headers JSONB,

    -- Resultado del procesamiento
    status VARCHAR(20) DEFAULT 'pending', -- pending, success, failed, duplicate, validation_error
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    error_message TEXT,
    error_details JSONB,

    -- Performance
    processing_time_ms INTEGER,

    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_logs_config ON external_webhook_logs(config_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_store ON external_webhook_logs(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_request_id ON external_webhook_logs(request_id);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_status ON external_webhook_logs(status);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_order ON external_webhook_logs(order_id);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_created ON external_webhook_logs(created_at DESC);

-- ================================================================
-- TABLA 3: external_webhook_idempotency
-- ================================================================
-- Para prevenir pedidos duplicados (TTL de 24 horas)

CREATE TABLE IF NOT EXISTS external_webhook_idempotency (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    config_id UUID NOT NULL REFERENCES external_webhook_configs(id) ON DELETE CASCADE,
    idempotency_key VARCHAR(255) NOT NULL,
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    processed_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL,

    CONSTRAINT unique_idempotency_key UNIQUE(config_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_external_idempotency_key ON external_webhook_idempotency(config_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_external_idempotency_expires ON external_webhook_idempotency(expires_at);

-- ================================================================
-- FUNCIÓN: Limpiar registros de idempotency expirados
-- ================================================================

CREATE OR REPLACE FUNCTION cleanup_external_webhook_idempotency()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM external_webhook_idempotency
    WHERE expires_at < NOW();

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- FUNCIÓN: Actualizar contador de órdenes recibidas
-- ================================================================

CREATE OR REPLACE FUNCTION update_external_webhook_stats()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'success' AND (OLD IS NULL OR OLD.status != 'success') THEN
        UPDATE external_webhook_configs
        SET
            total_orders_received = total_orders_received + 1,
            last_used_at = NOW(),
            updated_at = NOW()
        WHERE id = NEW.config_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para actualizar estadísticas cuando un log cambia a success
DROP TRIGGER IF EXISTS trigger_update_external_webhook_stats ON external_webhook_logs;
CREATE TRIGGER trigger_update_external_webhook_stats
    AFTER INSERT OR UPDATE ON external_webhook_logs
    FOR EACH ROW
    EXECUTE FUNCTION update_external_webhook_stats();

-- ================================================================
-- FUNCIÓN: Generar API Key
-- ================================================================
-- Nota: Esta función es solo para referencia. La generación real
-- se hace en el backend con crypto.randomBytes() para mayor seguridad

CREATE OR REPLACE FUNCTION generate_external_webhook_api_key()
RETURNS TEXT AS $$
BEGIN
    RETURN 'wh_' || encode(gen_random_bytes(32), 'hex');
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- AGREGAR COLUMNA source A customers (si no existe)
-- ================================================================
-- Para identificar de dónde vino el cliente

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'customers' AND column_name = 'source'
    ) THEN
        ALTER TABLE customers ADD COLUMN source VARCHAR(50);
        COMMENT ON COLUMN customers.source IS 'Origen del cliente: shopify, webhook_externo, manual, etc.';
    END IF;
END $$;

-- ================================================================
-- AGREGAR COLUMNA external_order_id A orders (si no existe)
-- ================================================================
-- Para guardar el ID externo del pedido (idempotency key del cliente)

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders' AND column_name = 'external_order_id'
    ) THEN
        ALTER TABLE orders ADD COLUMN external_order_id VARCHAR(255);
        CREATE INDEX IF NOT EXISTS idx_orders_external_id ON orders(store_id, external_order_id);
        COMMENT ON COLUMN orders.external_order_id IS 'ID externo del pedido (de landing page, etc.)';
    END IF;
END $$;

-- ================================================================
-- AGREGAR COLUMNA source A orders (si no existe)
-- ================================================================
-- Para identificar de dónde vino el pedido

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders' AND column_name = 'source'
    ) THEN
        ALTER TABLE orders ADD COLUMN source VARCHAR(50) DEFAULT 'manual';
        COMMENT ON COLUMN orders.source IS 'Origen del pedido: shopify, webhook_externo, manual, etc.';
    END IF;
END $$;

-- ================================================================
-- COMENTARIOS DE DOCUMENTACIÓN
-- ================================================================

COMMENT ON TABLE external_webhook_configs IS 'Configuración del webhook externo por tienda. Una tienda puede tener máximo un webhook activo.';
COMMENT ON TABLE external_webhook_logs IS 'Log de todas las peticiones recibidas en el webhook. Útil para debugging y auditoría.';
COMMENT ON TABLE external_webhook_idempotency IS 'Registro de idempotency keys para prevenir pedidos duplicados. TTL de 24 horas.';

COMMENT ON COLUMN external_webhook_configs.api_key IS 'API Key completa (64 chars). Se usa para autenticación via header X-API-Key.';
COMMENT ON COLUMN external_webhook_configs.api_key_prefix IS 'Prefijo del API Key (12 chars) para mostrar en UI sin exponer la clave completa.';
COMMENT ON COLUMN external_webhook_configs.auto_confirm_orders IS 'Si true, los pedidos llegan con status "confirmed" en lugar de "pending".';

COMMENT ON COLUMN external_webhook_logs.status IS 'Estado del procesamiento: pending (en proceso), success (orden creada), failed (error), duplicate (ya procesado), validation_error (payload inválido)';
COMMENT ON COLUMN external_webhook_logs.request_id IS 'Idempotency key enviada por el cliente en el header X-Idempotency-Key o en el payload.';

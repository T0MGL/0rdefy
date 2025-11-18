-- ================================================================
-- ORDEFY - COD (CONTRA ENTREGA) IMPROVEMENTS - V2
-- ================================================================
-- Mejoras específicas para negocios de contra entrega
-- V2: Referencias a carriers opcionales (se agregan después si la tabla existe)
-- ================================================================

-- ================================================================
-- PASO 1: ADD COD FIELDS TO ORDERS TABLE
-- ================================================================

-- Agregar campos para gestión de contra entrega
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS delivery_attempts INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failed_reason TEXT,
  ADD COLUMN IF NOT EXISTS risk_score INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS customer_address TEXT,
  ADD COLUMN IF NOT EXISTS address_reference TEXT,
  ADD COLUMN IF NOT EXISTS neighborhood VARCHAR(100),
  ADD COLUMN IF NOT EXISTS delivery_notes TEXT,
  ADD COLUMN IF NOT EXISTS phone_backup VARCHAR(20),
  ADD COLUMN IF NOT EXISTS latitude DECIMAL(10, 8),
  ADD COLUMN IF NOT EXISTS longitude DECIMAL(11, 8);

-- Actualizar comentario de sleeves_status para incluir nuevos estados COD
COMMENT ON COLUMN orders.sleeves_status IS 'pending, confirmed, preparing, out_for_delivery, delivered, delivery_failed, rejected, cancelled, shipped';
COMMENT ON COLUMN orders.payment_status IS 'pending, collected, failed - Estado del pago en efectivo';
COMMENT ON COLUMN orders.delivery_attempts IS 'Número de intentos de entrega realizados';
COMMENT ON COLUMN orders.risk_score IS '0-100 - Score de riesgo de no pago';
COMMENT ON COLUMN orders.address_reference IS 'Referencias para encontrar la dirección (ej: casa verde al lado del kiosco)';
COMMENT ON COLUMN orders.latitude IS 'Latitud para el mapa de entregas';
COMMENT ON COLUMN orders.longitude IS 'Longitud para el mapa de entregas';

-- ================================================================
-- PASO 2: TABLE: delivery_attempts
-- ================================================================
-- Historial de intentos de entrega para cada pedido
-- SIN carrier_id por ahora (se agrega después si carriers existe)
-- ================================================================

CREATE TABLE IF NOT EXISTS delivery_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    attempt_number INT NOT NULL,
    scheduled_date DATE NOT NULL,
    actual_date DATE,
    status VARCHAR(50) NOT NULL DEFAULT 'scheduled',
    notes TEXT,
    failed_reason TEXT,
    photo_url TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    CONSTRAINT unique_order_attempt UNIQUE(order_id, attempt_number)
);

CREATE INDEX idx_delivery_attempts_order ON delivery_attempts(order_id);
CREATE INDEX idx_delivery_attempts_store ON delivery_attempts(store_id);
CREATE INDEX idx_delivery_attempts_date ON delivery_attempts(scheduled_date);
CREATE INDEX idx_delivery_attempts_status ON delivery_attempts(status);

COMMENT ON TABLE delivery_attempts IS 'Ordefy: Historial de intentos de entrega para pedidos COD';
COMMENT ON COLUMN delivery_attempts.status IS 'scheduled, in_progress, delivered, failed, customer_absent, address_wrong, customer_refused, cancelled';
COMMENT ON COLUMN delivery_attempts.photo_url IS 'URL de foto de la entrega como prueba';

-- ================================================================
-- PASO 3: TABLE: daily_settlements
-- ================================================================
-- Conciliación diaria de efectivo con repartidores
-- SIN carrier_id por ahora (se agrega después si carriers existe)
-- ================================================================

CREATE TABLE IF NOT EXISTS daily_settlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    settlement_date DATE NOT NULL,
    expected_cash DECIMAL(10,2) NOT NULL DEFAULT 0,
    collected_cash DECIMAL(10,2) NOT NULL DEFAULT 0,
    difference DECIMAL(10,2) GENERATED ALWAYS AS (collected_cash - expected_cash) STORED,
    status VARCHAR(20) DEFAULT 'pending',
    notes TEXT,
    settled_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    CONSTRAINT unique_store_date_v1 UNIQUE(store_id, settlement_date)
);

CREATE INDEX idx_settlements_store ON daily_settlements(store_id);
CREATE INDEX idx_settlements_date ON daily_settlements(settlement_date);
CREATE INDEX idx_settlements_status ON daily_settlements(status);

COMMENT ON TABLE daily_settlements IS 'Ordefy: Conciliación diaria de efectivo con repartidores';
COMMENT ON COLUMN daily_settlements.status IS 'pending, completed, with_issues';
COMMENT ON COLUMN daily_settlements.expected_cash IS 'Total esperado de pedidos entregados';
COMMENT ON COLUMN daily_settlements.collected_cash IS 'Efectivo recibido del repartidor';

-- ================================================================
-- PASO 4: TABLE: settlement_orders
-- ================================================================
-- Relación entre conciliaciones y pedidos
-- ================================================================

CREATE TABLE IF NOT EXISTS settlement_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    settlement_id UUID NOT NULL REFERENCES daily_settlements(id) ON DELETE CASCADE,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    amount DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    CONSTRAINT unique_settlement_order UNIQUE(settlement_id, order_id)
);

CREATE INDEX idx_settlement_orders_settlement ON settlement_orders(settlement_id);
CREATE INDEX idx_settlement_orders_order ON settlement_orders(order_id);

COMMENT ON TABLE settlement_orders IS 'Ordefy: Pedidos incluidos en cada conciliación diaria';

-- ================================================================
-- PASO 5: GRANT PERMISSIONS
-- ================================================================

GRANT ALL ON delivery_attempts TO postgres;
GRANT SELECT, INSERT, UPDATE, DELETE ON delivery_attempts TO authenticated;

GRANT ALL ON daily_settlements TO postgres;
GRANT SELECT, INSERT, UPDATE, DELETE ON daily_settlements TO authenticated;

GRANT ALL ON settlement_orders TO postgres;
GRANT SELECT, INSERT, UPDATE, DELETE ON settlement_orders TO authenticated;

-- ================================================================
-- MIGRATION COMPLETE (CORE)
-- ================================================================

-- ⚠️ NOTA IMPORTANTE:
-- Esta migración NO incluye las referencias a la tabla 'carriers'
-- Si quieres agregar soporte para carriers, ejecuta DESPUÉS:
--
-- 1. La migración 008b_create_carriers.sql
-- 2. Luego ejecuta estos ALTER TABLE:
--
-- ALTER TABLE orders ADD COLUMN IF NOT EXISTS carrier_id UUID REFERENCES carriers(id);
-- ALTER TABLE delivery_attempts ADD COLUMN IF NOT EXISTS carrier_id UUID REFERENCES carriers(id);
-- ALTER TABLE daily_settlements ADD COLUMN IF NOT EXISTS carrier_id UUID REFERENCES carriers(id);
--
-- CREATE INDEX idx_orders_carrier ON orders(carrier_id);
-- CREATE INDEX idx_delivery_attempts_carrier ON delivery_attempts(carrier_id);
-- CREATE INDEX idx_settlements_carrier ON daily_settlements(carrier_id);

-- Para aplicar esta migración:
-- Copia este SQL y ejecútalo en el SQL Editor de Supabase Dashboard

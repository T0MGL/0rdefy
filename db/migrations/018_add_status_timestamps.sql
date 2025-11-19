-- ================================================================
-- ADD STATUS TIMESTAMPS TO ORDERS TABLE
-- ================================================================
-- Agrega timestamps para rastrear cambios de estado en pedidos
-- ================================================================

-- Agregar columnas de timestamps para estados
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS in_transit_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP;

-- Agregar comentarios
COMMENT ON COLUMN orders.in_transit_at IS 'Timestamp cuando el pedido pasó a estado in_transit/out_for_delivery';
COMMENT ON COLUMN orders.delivered_at IS 'Timestamp cuando el pedido fue entregado';
COMMENT ON COLUMN orders.cancelled_at IS 'Timestamp cuando el pedido fue cancelado/rechazado';

-- Crear índices para mejorar queries por fecha
CREATE INDEX IF NOT EXISTS idx_orders_in_transit_at ON orders(in_transit_at) WHERE in_transit_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_delivered_at ON orders(delivered_at) WHERE delivered_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_cancelled_at ON orders(cancelled_at) WHERE cancelled_at IS NOT NULL;

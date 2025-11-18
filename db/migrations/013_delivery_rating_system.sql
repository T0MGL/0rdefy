-- ================================================================
-- ORDEFY - DELIVERY RATING SYSTEM
-- ================================================================
-- Sistema de calificación post-entrega con feedback del cliente
-- El cliente escanea el QR después de recibir su pedido y califica
-- al repartidor con 1-5 estrellas + comentario opcional
-- ================================================================

-- ================================================================
-- STEP 1: ADD RATING FIELDS TO ORDERS TABLE
-- ================================================================

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS delivery_rating INT CHECK (delivery_rating >= 1 AND delivery_rating <= 5),
  ADD COLUMN IF NOT EXISTS delivery_rating_comment TEXT,
  ADD COLUMN IF NOT EXISTS rated_at TIMESTAMP;

COMMENT ON COLUMN orders.delivery_rating IS 'Calificación del cliente (1-5 estrellas) sobre la entrega';
COMMENT ON COLUMN orders.delivery_rating_comment IS 'Comentario opcional del cliente sobre la entrega';
COMMENT ON COLUMN orders.rated_at IS 'Timestamp cuando el cliente calificó la entrega';

-- Index for rating queries
CREATE INDEX IF NOT EXISTS idx_orders_rating ON orders(courier_id, delivery_rating) WHERE delivery_rating IS NOT NULL;

-- ================================================================
-- STEP 2: ADD RATING FIELDS TO CARRIERS TABLE
-- ================================================================

ALTER TABLE carriers
  ADD COLUMN IF NOT EXISTS average_rating DECIMAL(3,2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS total_ratings INT DEFAULT 0;

COMMENT ON COLUMN carriers.average_rating IS 'Rating promedio del repartidor (1.00 - 5.00)';
COMMENT ON COLUMN carriers.total_ratings IS 'Número total de calificaciones recibidas';

-- ================================================================
-- STEP 3: CREATE FUNCTION TO UPDATE CARRIER RATING
-- ================================================================

CREATE OR REPLACE FUNCTION update_carrier_rating()
RETURNS TRIGGER AS $$
BEGIN
  -- Only update if a rating was added (not null and changed)
  IF NEW.delivery_rating IS NOT NULL AND
     (OLD.delivery_rating IS NULL OR OLD.delivery_rating != NEW.delivery_rating) AND
     NEW.courier_id IS NOT NULL THEN

    -- Recalculate average rating for the courier
    UPDATE carriers
    SET
      average_rating = (
        SELECT COALESCE(AVG(delivery_rating), 0)
        FROM orders
        WHERE courier_id = NEW.courier_id
          AND delivery_rating IS NOT NULL
      ),
      total_ratings = (
        SELECT COUNT(*)
        FROM orders
        WHERE courier_id = NEW.courier_id
          AND delivery_rating IS NOT NULL
      )
    WHERE id = NEW.courier_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- STEP 4: CREATE TRIGGER FOR RATING UPDATES
-- ================================================================

DROP TRIGGER IF EXISTS trigger_update_carrier_rating ON orders;
CREATE TRIGGER trigger_update_carrier_rating
  AFTER INSERT OR UPDATE ON orders
  FOR EACH ROW
  WHEN (NEW.delivery_rating IS NOT NULL)
  EXECUTE FUNCTION update_carrier_rating();

-- ================================================================
-- STEP 5: UPDATE COURIER PERFORMANCE VIEW
-- ================================================================

-- Drop existing view first to avoid column mismatch errors
DROP VIEW IF EXISTS courier_performance;

-- Recreate view with new rating columns
CREATE VIEW courier_performance AS
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

COMMENT ON VIEW courier_performance IS 'Aggregated courier performance with delivery stats and ratings';

-- ================================================================
-- STEP 6: GRANT PERMISSIONS
-- ================================================================

GRANT SELECT ON courier_performance TO authenticated;

-- ================================================================
-- MIGRATION COMPLETE
-- ================================================================
-- Delivery Rating System Implementation
-- Clientes pueden calificar entregas 1-5 estrellas + comentario
-- Rating promedio se actualiza automáticamente por repartidor
-- Token se elimina después de calificar o después de 48 horas
-- ================================================================

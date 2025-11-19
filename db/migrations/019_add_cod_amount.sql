-- ================================================================
-- ADD COD (CASH ON DELIVERY) AMOUNT TO ORDERS
-- ================================================================
-- Agrega el monto que la transportadora debe cobrar al entregar
-- ================================================================

-- Agregar columna para el monto COD
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS cod_amount DECIMAL(10,2) DEFAULT 0.00;

-- Agregar columna para indicar si es pago en efectivo
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50) DEFAULT 'online';

COMMENT ON COLUMN orders.cod_amount IS 'Monto en efectivo que debe cobrar la transportadora al entregar';
COMMENT ON COLUMN orders.payment_method IS 'Método de pago: cash, online, card, transfer, yape, plin, etc.';

-- Crear índice para queries de COD
CREATE INDEX IF NOT EXISTS idx_orders_cod ON orders(payment_method, cod_amount) WHERE payment_method = 'cash' OR cod_amount > 0;

-- ================================================================
-- FUNCTION TO CALCULATE COD AMOUNT
-- ================================================================
-- Calcula automáticamente el monto COD cuando payment_method es 'cash' o 'efectivo'
-- ================================================================

CREATE OR REPLACE FUNCTION calculate_cod_amount()
RETURNS TRIGGER AS $$
BEGIN
  -- Si el método de pago es efectivo/cash, el COD amount es igual al total_price
  IF NEW.payment_method IN ('cash', 'efectivo') THEN
    NEW.cod_amount = COALESCE(NEW.total_price, 0);
  ELSE
    -- Si no es efectivo, el COD amount es 0
    NEW.cod_amount = 0;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- TRIGGER TO AUTO-CALCULATE COD AMOUNT
-- ================================================================

DROP TRIGGER IF EXISTS trigger_calculate_cod_amount ON orders;
CREATE TRIGGER trigger_calculate_cod_amount
  BEFORE INSERT OR UPDATE OF payment_method, total_price ON orders
  FOR EACH ROW
  EXECUTE FUNCTION calculate_cod_amount();

-- ================================================================
-- UPDATE EXISTING ORDERS
-- ================================================================
-- Actualiza órdenes existentes que tienen pago en efectivo
-- ================================================================

UPDATE orders
SET
  payment_method = 'cash',
  cod_amount = total_price
WHERE payment_method IS NULL
  AND delivery_status = 'pending';

-- ================================================================
-- MIGRATION COMPLETE
-- ================================================================

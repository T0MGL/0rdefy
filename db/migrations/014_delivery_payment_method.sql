-- ================================================================
-- ORDEFY - DELIVERY PAYMENT METHOD & ENHANCED FAILURE INFO
-- ================================================================
-- Agrega campo payment_method para registrar método de pago usado
-- Agrega campo failure_notes para información adicional de fallas
-- ================================================================

-- ================================================================
-- STEP 1: ADD PAYMENT METHOD FIELD
-- ================================================================

ALTER TABLE delivery_attempts
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50);

COMMENT ON COLUMN delivery_attempts.payment_method IS 'Método de pago usado por el cliente: efectivo, tarjeta, transferencia, yape, plin, etc.';

-- ================================================================
-- STEP 2: ADD FAILURE NOTES FIELD
-- ================================================================

ALTER TABLE delivery_attempts
  ADD COLUMN IF NOT EXISTS failure_notes TEXT;

COMMENT ON COLUMN delivery_attempts.failure_notes IS 'Información adicional sobre el problema en la entrega (para fallas)';

-- ================================================================
-- STEP 3: CREATE INDEX FOR PAYMENT METHOD QUERIES
-- ================================================================

CREATE INDEX IF NOT EXISTS idx_delivery_attempts_payment_method
  ON delivery_attempts(payment_method)
  WHERE payment_method IS NOT NULL;

-- ================================================================
-- MIGRATION COMPLETE
-- ================================================================
-- Delivery attempts ahora pueden registrar:
-- 1. Método de pago usado (payment_method)
-- 2. Información adicional de fallas (failure_notes)
-- 3. Foto de evidencia (photo_url - ya existente)
-- ================================================================

-- ================================================================
-- ORDEFY - FIX DELIVERY CONFIRMATION DATA SYNC
-- ================================================================
-- Problema: El tipo de pago y las notas del transportista no se
-- están registrando cuando confirma/reporta entregas.
--
-- Solución:
-- 1. Agregar estado 'incident' para pedidos con problemas
-- 2. Asegurar que delivery_attempts tenga todos los campos necesarios
-- 3. Agregar campo courier_notes a orders para notas del transportista
-- ================================================================

-- ================================================================
-- STEP 1: ADD 'incident' STATUS COMMENT
-- ================================================================

COMMENT ON COLUMN orders.sleeves_status IS 'Status flow: pending, confirmed, in_preparation, ready_to_ship, shipped, delivered, not_delivered, incident, cancelled, returned - incident is for orders requiring manual review';

-- ================================================================
-- STEP 2: ADD COURIER NOTES TO ORDERS
-- ================================================================

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS courier_notes TEXT;

COMMENT ON COLUMN orders.courier_notes IS 'Notes from courier during delivery confirmation or failure';

-- ================================================================
-- STEP 3: ENSURE delivery_attempts HAS ALL REQUIRED FIELDS
-- ================================================================

-- These should already exist from migration 014, but we ensure they're present
ALTER TABLE delivery_attempts
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50);

ALTER TABLE delivery_attempts
  ADD COLUMN IF NOT EXISTS notes TEXT;

ALTER TABLE delivery_attempts
  ADD COLUMN IF NOT EXISTS failure_notes TEXT;

-- ================================================================
-- STEP 4: ADD INDEX FOR incident STATUS
-- ================================================================

CREATE INDEX IF NOT EXISTS idx_orders_incident_status
  ON orders(sleeves_status)
  WHERE sleeves_status = 'incident';

-- ================================================================
-- STEP 5: ADD INDEX FOR COURIER NOTES
-- ================================================================

CREATE INDEX IF NOT EXISTS idx_orders_courier_notes
  ON orders(courier_notes)
  WHERE courier_notes IS NOT NULL;

-- ================================================================
-- MIGRATION COMPLETE
-- ================================================================
-- Changes:
-- 1. Added 'incident' status for orders requiring manual review
-- 2. Added courier_notes field to orders table
-- 3. Ensured delivery_attempts has payment_method, notes, failure_notes
-- 4. Added indexes for better query performance
-- ================================================================

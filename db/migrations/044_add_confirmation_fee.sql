-- ================================================================
-- MIGRATION 044: ADD CONFIRMATION FEE TO STORE CONFIG
-- ================================================================
-- Agrega un campo de "costo de confirmación" a la configuración de tienda
-- Este es un costo fijo que se cobra por cada pedido confirmado
-- Ejemplo: Gs. 5,000 por pedido confirmado
-- ================================================================

-- Add confirmation_fee column to store_config
ALTER TABLE store_config
ADD COLUMN IF NOT EXISTS confirmation_fee DECIMAL(12,2) DEFAULT 0.00;

-- Add comment explaining the field
COMMENT ON COLUMN store_config.confirmation_fee IS 'Costo fijo por confirmar un pedido (ej: llamada telefónica, gestión administrativa)';

-- Update existing stores to have 0 as default
UPDATE store_config
SET confirmation_fee = 0.00
WHERE confirmation_fee IS NULL;

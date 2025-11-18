-- ================================================================
-- ORDEFY - ADD CARRIER FIELDS TO SHIPPING_INTEGRATIONS
-- ================================================================
-- Adds coverage zones and contact fields to carriers
-- ================================================================

-- Add new columns to shipping_integrations
ALTER TABLE shipping_integrations
  ADD COLUMN IF NOT EXISTS coverage_zones TEXT,
  ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(20),
  ADD COLUMN IF NOT EXISTS contact_email VARCHAR(255);

-- Add comments
COMMENT ON COLUMN shipping_integrations.coverage_zones IS 'Comma-separated list of coverage areas/cities';
COMMENT ON COLUMN shipping_integrations.contact_phone IS 'Contact phone number for the carrier';
COMMENT ON COLUMN shipping_integrations.contact_email IS 'Contact email for the carrier';

-- ================================================================
-- MIGRATION COMPLETE
-- ================================================================

-- Para aplicar esta migración:
-- Copia este SQL y ejecútalo en el SQL Editor de Supabase Dashboard

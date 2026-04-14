-- ============================================================
-- Migration 160: Timbrado format check constraint
-- ============================================================
-- SIFEN / DNIT issues timbrado numbers as 8-digit strings. The xmlgen
-- library and SIFEN's DE schema both reject anything else. Enforce it at
-- the DB boundary so malformed values never reach the XML generator.
--
-- Idempotent: drops the constraint first if it exists (allows re-running
-- without error on a DB where it's already applied).
-- ============================================================

ALTER TABLE fiscal_config
  DROP CONSTRAINT IF EXISTS fiscal_config_timbrado_numeric;

ALTER TABLE fiscal_config
  ADD CONSTRAINT fiscal_config_timbrado_numeric
  CHECK (timbrado IS NULL OR timbrado ~ '^[0-9]{8}$');

COMMENT ON CONSTRAINT fiscal_config_timbrado_numeric ON fiscal_config IS
  'SIFEN requires timbrado as exactly 8 digits. Reject anything else at the DB boundary.';

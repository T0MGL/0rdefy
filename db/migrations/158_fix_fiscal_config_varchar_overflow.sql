-- ================================================================
-- Migration 158: Fix fiscal_config VARCHAR(20) overflow
-- ================================================================
-- timbrado VARCHAR(20) and establecimiento_telefono VARCHAR(20) are
-- too narrow. Paraguay timbrado numbers can exceed 12 digits and
-- international phone formats (+595 XXX XXXXXX) regularly approach
-- or exceed 20 characters. Expanding both to VARCHAR(50).
-- ================================================================

ALTER TABLE fiscal_config
  ALTER COLUMN timbrado TYPE VARCHAR(50),
  ALTER COLUMN establecimiento_telefono TYPE VARCHAR(50);

-- ================================================================
-- Migration 162: stores.country as first-class country gate
-- ================================================================
-- Today stores.country is VARCHAR(2) NULL with no default and no CHECK.
-- Every existing row is 'PY'. We harden it so the invoicing backend can
-- trust it as the gate for country-specific features (SIFEN, AFIP, SII,
-- DGI, etc).
--
-- After this migration:
--   - NOT NULL + DEFAULT 'PY'
--   - CHECK restricts to the 8 countries the platform targets
--   - Narrowed to CHAR(2) (fixed-width, clearer intent)
--
-- This does not widen the SIFEN scope. fiscal_identities.country still
-- has CHECK (country IN ('PY')) to gate fiscal identity creation. The
-- stores.country CHECK is the broader "which market is this store in"
-- knob.
--
-- Migration 161 (backend refactor prereq) intentionally left this alone;
-- this migration finishes step 8 of the Paraguay-only invoicing hardening
-- plan.
-- ================================================================

-- Backfill any NULL rows to 'PY' just in case future data imports land
-- before the DEFAULT is set.
UPDATE stores SET country = 'PY' WHERE country IS NULL;

-- Normalize to uppercase to avoid 'py'/'Py'/'PY' drift.
UPDATE stores SET country = UPPER(country) WHERE country <> UPPER(country);

-- Drop any leftover CHECK constraint on country so we can redefine it
-- cleanly. No-op if none exists.
DO $$
DECLARE
    v_conname TEXT;
BEGIN
    FOR v_conname IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'stores'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%country%'
    LOOP
        EXECUTE format('ALTER TABLE stores DROP CONSTRAINT %I', v_conname);
    END LOOP;
END $$;

-- Narrow to CHAR(2) (VARCHAR(2) -> CHAR(2) is safe because all values
-- are exactly 2 chars now).
ALTER TABLE stores
    ALTER COLUMN country TYPE CHAR(2) USING country::CHAR(2);

ALTER TABLE stores
    ALTER COLUMN country SET DEFAULT 'PY';

ALTER TABLE stores
    ALTER COLUMN country SET NOT NULL;

ALTER TABLE stores
    ADD CONSTRAINT stores_country_check
    CHECK (country IN ('PY', 'AR', 'BR', 'UY', 'CL', 'MX', 'US', 'ES'));

CREATE INDEX IF NOT EXISTS idx_stores_country ON stores(country);

COMMENT ON COLUMN stores.country IS
    'ISO 3166-1 alpha-2 country code. Gates country-specific features (invoicing = PY only today). Default PY.';

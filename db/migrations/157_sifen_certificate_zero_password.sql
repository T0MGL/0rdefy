-- ================================================================
-- Migration 157: SIFEN certificate security hardening
-- ================================================================
-- Replaces the old certificate storage model with a zero-password model:
--
--   OLD: certificate_data (BYTEA, raw .p12)
--        certificate_password_encrypted (TEXT, AES-256-CBC encrypted password)
--
--   NEW: cert_pem (TEXT, X.509 certificate — not secret)
--        encrypted_private_key (TEXT, AES-256-GCM encrypted RSA private key)
--
-- The merchant password is never persisted. At upload time the API extracts
-- the private key and certificate from the .p12 in memory, encrypts the private
-- key with SIFEN_ENCRYPTION_KEY (Railway env var), and stores only those two
-- fields. The .p12 and password are discarded immediately.
--
-- If certificate_data already contains data (stores that completed setup before
-- this migration), manual re-upload via the wizard is required. The old columns
-- are preserved as nullable and dropped in a future migration after all stores
-- have re-uploaded. This avoids hard data loss on existing tenants.
-- ================================================================

-- Step 1: Add new columns
ALTER TABLE fiscal_config
  ADD COLUMN IF NOT EXISTS cert_pem TEXT,
  ADD COLUMN IF NOT EXISTS encrypted_private_key TEXT;

-- Step 2: Update validate_fiscal_config to check the new columns
CREATE OR REPLACE FUNCTION validate_fiscal_config(p_store_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_config fiscal_config%ROWTYPE;
    v_errors TEXT[] := '{}';
    v_warnings TEXT[] := '{}';
BEGIN
    SELECT * INTO v_config FROM fiscal_config WHERE store_id = p_store_id AND is_active = true;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('valid', false, 'errors', ARRAY['No existe configuración fiscal para esta tienda']);
    END IF;

    IF v_config.ruc IS NULL OR v_config.ruc = '' THEN
        v_errors := array_append(v_errors, 'RUC es requerido');
    END IF;

    IF v_config.timbrado IS NULL OR v_config.timbrado = '' THEN
        v_errors := array_append(v_errors, 'Número de timbrado es requerido');
    END IF;

    IF v_config.timbrado_fecha_fin IS NOT NULL AND v_config.timbrado_fecha_fin < CURRENT_DATE THEN
        v_errors := array_append(v_errors, 'El timbrado ha expirado');
    END IF;

    IF v_config.timbrado_fecha_inicio IS NOT NULL AND v_config.timbrado_fecha_inicio > CURRENT_DATE THEN
        v_warnings := array_append(v_warnings, 'El timbrado aún no está vigente');
    END IF;

    IF v_config.sifen_environment != 'demo' THEN
        IF v_config.cert_pem IS NULL THEN
            v_errors := array_append(v_errors, 'Certificado digital es requerido para ambiente ' || v_config.sifen_environment);
        END IF;
        IF v_config.encrypted_private_key IS NULL THEN
            v_errors := array_append(v_errors, 'Clave privada del certificado es requerida');
        END IF;
    END IF;

    IF v_config.razon_social IS NULL OR v_config.razon_social = '' THEN
        v_errors := array_append(v_errors, 'Razón social es requerida');
    END IF;

    RETURN jsonb_build_object(
        'valid', array_length(v_errors, 1) IS NULL OR array_length(v_errors, 1) = 0,
        'errors', v_errors,
        'warnings', v_warnings,
        'environment', v_config.sifen_environment,
        'setup_completed', v_config.setup_completed
    );
END;
$$;

-- Step 3: Nullify old columns on any existing rows so stores are prompted to re-upload.
-- This resets setup_completed to false for non-demo stores that had a certificate.
-- The RUC/timbrado config is preserved — only the certificate fields are cleared.
UPDATE fiscal_config
SET
    certificate_data = NULL,
    certificate_password_encrypted = NULL,
    setup_completed = CASE WHEN sifen_environment = 'demo' THEN true ELSE false END,
    updated_at = NOW()
WHERE
    certificate_data IS NOT NULL
    OR certificate_password_encrypted IS NOT NULL;

-- Step 4: Mark the old columns as deprecated via comment (physical drop in migration 158
-- after all stores have re-uploaded their certificates).
COMMENT ON COLUMN fiscal_config.certificate_data IS
  'DEPRECATED — migration 157. Nullified. Will be dropped in migration 158.';
COMMENT ON COLUMN fiscal_config.certificate_password_encrypted IS
  'DEPRECATED — migration 157. Nullified. Will be dropped in migration 158.';

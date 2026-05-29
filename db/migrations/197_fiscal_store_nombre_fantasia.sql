-- ================================================================
-- 197_fiscal_store_nombre_fantasia.sql
-- ================================================================
-- Per-store commercial name (nombre de fantasia) override.
--
-- Problem: one fiscal identity (one RUC) shared across stores carried a
-- single nombre_fantasia at the identity level. When the same company runs
-- multiple brands (e.g. Solenne and NOCTE under the same RUC), every store
-- emitted invoices under the same brand name. There was no way to make
-- NOCTE invoices show "NOCTE" while Solenne keeps "Solenne".
--
-- Fix: add a nullable nombre_fantasia override on fiscal_identity_stores.
-- The emitter reads link.nombre_fantasia first and falls back to
-- identity.nombre_fantasia (then razon_social) when NULL, so existing
-- stores are unaffected. dNomFanEmi is a free-text, optional, informational
-- field on the DTE (it does not enter the CDC hash nor a SET catalog), so a
-- per-emission-point value is safe.
--
-- Idempotente: IF NOT EXISTS + CREATE OR REPLACE.
-- ================================================================

BEGIN;

ALTER TABLE fiscal_identity_stores
  ADD COLUMN IF NOT EXISTS nombre_fantasia VARCHAR(255);

COMMENT ON COLUMN fiscal_identity_stores.nombre_fantasia IS
  'Per-store commercial name (dNomFanEmi). NULL = inherit identity.nombre_fantasia.';

-- Recreate get_fiscal_context_for_store to expose link.nombre_fantasia.
-- Based on the migration 189 definition (latest); only the link block gains
-- one key. Same signature and SECURITY DEFINER, so existing callers keep
-- working unchanged.
CREATE OR REPLACE FUNCTION get_fiscal_context_for_store(p_store_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_link fiscal_identity_stores%ROWTYPE;
    v_identity fiscal_identities%ROWTYPE;
    v_activities JSONB;
BEGIN
    SELECT fis.* INTO v_link
    FROM fiscal_identity_stores fis
    WHERE fis.store_id = p_store_id
      AND fis.is_active = true
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    SELECT fi.* INTO v_identity
    FROM fiscal_identities fi
    WHERE fi.id = v_link.identity_id;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', fia.id,
            'codigo', fia.codigo,
            'descripcion', fia.descripcion,
            'is_principal', fia.is_principal,
            'display_order', fia.display_order
        )
        ORDER BY fia.display_order, fia.codigo
    ), '[]'::jsonb)
    INTO v_activities
    FROM fiscal_identity_activities fia
    WHERE fia.identity_id = v_identity.id;

    RETURN jsonb_build_object(
        'identity', jsonb_build_object(
            'id', v_identity.id,
            'owner_user_id', v_identity.owner_user_id,
            'ruc', v_identity.ruc,
            'ruc_dv', v_identity.ruc_dv,
            'razon_social', v_identity.razon_social,
            'nombre_fantasia', v_identity.nombre_fantasia,
            'tipo_contribuyente', v_identity.tipo_contribuyente,
            'tipo_regimen', v_identity.tipo_regimen,
            'country', v_identity.country,
            'sifen_environment', v_identity.sifen_environment,
            'sifen_async_enabled', COALESCE(v_identity.sifen_async_enabled, false),
            'has_certificate', (v_identity.cert_pem IS NOT NULL
                             AND v_identity.encrypted_private_key IS NOT NULL),
            'csc_id', v_identity.csc_id,
            'representante_legal_nombre', v_identity.representante_legal_nombre,
            'representante_legal_documento_tipo', v_identity.representante_legal_documento_tipo,
            'representante_legal_documento_numero', v_identity.representante_legal_documento_numero,
            'representante_legal_cargo', v_identity.representante_legal_cargo,
            'domicilio_fiscal_direccion', v_identity.domicilio_fiscal_direccion,
            'domicilio_fiscal_numero_casa', v_identity.domicilio_fiscal_numero_casa,
            'domicilio_fiscal_departamento', v_identity.domicilio_fiscal_departamento,
            'domicilio_fiscal_distrito', v_identity.domicilio_fiscal_distrito,
            'domicilio_fiscal_ciudad', v_identity.domicilio_fiscal_ciudad,
            'is_active', v_identity.is_active,
            'created_at', v_identity.created_at,
            'updated_at', v_identity.updated_at
        ),
        'link', jsonb_build_object(
            'id', v_link.id,
            'store_id', v_link.store_id,
            'timbrado', v_link.timbrado,
            'timbrado_fecha_inicio', v_link.timbrado_fecha_inicio,
            'timbrado_fecha_fin', v_link.timbrado_fecha_fin,
            'establecimiento_codigo', v_link.establecimiento_codigo,
            'punto_expedicion', v_link.punto_expedicion,
            'establecimiento_direccion', v_link.establecimiento_direccion,
            'establecimiento_departamento', v_link.establecimiento_departamento,
            'establecimiento_distrito', v_link.establecimiento_distrito,
            'establecimiento_ciudad', v_link.establecimiento_ciudad,
            'establecimiento_telefono', v_link.establecimiento_telefono,
            'establecimiento_email', v_link.establecimiento_email,
            'nombre_fantasia', v_link.nombre_fantasia,
            'next_document_number', v_link.next_document_number,
            'is_active', v_link.is_active,
            'setup_completed', v_link.setup_completed,
            'default_generic_description', v_link.default_generic_description,
            'use_generic_description', v_link.use_generic_description,
            'auto_emit_invoice_on_delivery', v_link.auto_emit_invoice_on_delivery
        ),
        'activities', v_activities
    );
END;
$$;

GRANT EXECUTE ON FUNCTION get_fiscal_context_for_store(UUID) TO service_role;

COMMIT;

-- ================================================================
-- Rollback (manual):
--   ALTER TABLE fiscal_identity_stores DROP COLUMN nombre_fantasia;
--   (and re-run migration 189's get_fiscal_context_for_store definition)
-- ================================================================

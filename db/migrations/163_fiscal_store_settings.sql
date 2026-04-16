-- ================================================================
-- Migration 163: Fiscal store-level settings + owner alerts
-- ================================================================
-- Adds per-store invoicing customization and a server-side owner alerts
-- channel so the service can notify the store owner when a SIFEN dispatch
-- fails, without relying on client-side localStorage notifications.
--
-- Columns added to fiscal_identity_stores:
--   default_generic_description   : fallback description used when the
--                                   owner chooses to keep product names
--                                   off the fiscal document (privacy or
--                                   catalog hygiene). Defaults to
--                                   'Productos varios'.
--   use_generic_description       : global toggle. When true, every auto
--                                   generated XML item uses
--                                   default_generic_description instead
--                                   of the product_name. Per-item override
--                                   is also available on manual invoices.
--   auto_emit_invoice_on_delivery : when true, delivery confirmation
--                                   attempts automatic invoice emission.
--                                   Requires setup_completed = true.
--
-- Table added: owner_alerts
--   Server-side alert channel for the store owner. Used by the invoicing
--   pipeline when SIFEN rejects an invoice (email to the customer is NOT
--   sent in that case; the owner is asked to resolve it manually). Also
--   available for future pipelines (settlements discrepancies, stuck
--   orders, etc).
--
-- RLS: owner_alerts follows the standard store-scoped pattern. The
-- service role writes via supabaseAdmin (bypass). Clients read via RLS
-- with user_stores membership.
-- ================================================================

-- ================================================================
-- 1. fiscal_identity_stores: new columns
-- ================================================================
ALTER TABLE fiscal_identity_stores
    ADD COLUMN IF NOT EXISTS default_generic_description VARCHAR(120)
        NOT NULL DEFAULT 'Productos varios';

ALTER TABLE fiscal_identity_stores
    ADD COLUMN IF NOT EXISTS use_generic_description BOOLEAN
        NOT NULL DEFAULT false;

ALTER TABLE fiscal_identity_stores
    ADD COLUMN IF NOT EXISTS auto_emit_invoice_on_delivery BOOLEAN
        NOT NULL DEFAULT false;

-- Length guard for default_generic_description (<=120 chars is already
-- enforced by VARCHAR(120), but blank strings are not useful)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fiscal_identity_stores_default_generic_description_chk'
    ) THEN
        ALTER TABLE fiscal_identity_stores
            ADD CONSTRAINT fiscal_identity_stores_default_generic_description_chk
            CHECK (char_length(trim(default_generic_description)) BETWEEN 1 AND 120);
    END IF;
END$$;

-- ================================================================
-- 2. owner_alerts table
-- ================================================================
CREATE TABLE IF NOT EXISTS owner_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,

    -- 'invoice_rejected' | 'invoice_send_error' | 'auto_emit_failed'
    -- (string, not enum, so new alert types do not require a migration)
    alert_type VARCHAR(64) NOT NULL,

    -- 'low' | 'medium' | 'high' | 'critical'
    severity VARCHAR(16) NOT NULL DEFAULT 'high'
        CHECK (severity IN ('low', 'medium', 'high', 'critical')),

    -- Short human title ('Factura rechazada por SIFEN')
    title VARCHAR(200) NOT NULL,

    -- Long form context (response message, guidance, next action)
    message TEXT NOT NULL,

    -- Optional links to the originating entities
    invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,

    -- Arbitrary payload (sifen response, CDC, etc)
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Resolution tracking
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by UUID REFERENCES users(id) ON DELETE SET NULL,
    resolved_at TIMESTAMPTZ,
    resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_owner_alerts_store_unresolved
    ON owner_alerts (store_id, created_at DESC)
    WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_owner_alerts_invoice
    ON owner_alerts (invoice_id)
    WHERE invoice_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_owner_alerts_order
    ON owner_alerts (order_id)
    WHERE order_id IS NOT NULL;

ALTER TABLE owner_alerts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'owner_alerts' AND policyname = 'owner_alerts_store_access'
    ) THEN
        CREATE POLICY owner_alerts_store_access ON owner_alerts
            FOR SELECT
            USING (
                store_id IN (
                    SELECT user_stores.store_id
                    FROM user_stores
                    WHERE user_stores.user_id = auth.uid()
                )
            );
    END IF;

    -- Only owners can acknowledge/resolve (UPDATE). Service role bypasses.
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'owner_alerts' AND policyname = 'owner_alerts_store_update'
    ) THEN
        CREATE POLICY owner_alerts_store_update ON owner_alerts
            FOR UPDATE
            USING (
                store_id IN (
                    SELECT user_stores.store_id
                    FROM user_stores
                    WHERE user_stores.user_id = auth.uid()
                      AND user_stores.role = 'owner'
                )
            );
    END IF;
END$$;

-- ================================================================
-- 3. invoice_events: ensure service role can INSERT
-- ================================================================
-- invoice_events ships with SELECT-only RLS. The backend writes via
-- supabaseAdmin (service role bypasses RLS) so this is not strictly
-- required, but adding an explicit INSERT policy for service_role makes
-- the audit trail resilient if the write path ever moves to a
-- user-scoped client.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'invoice_events' AND policyname = 'invoice_events_service_role_insert'
    ) THEN
        CREATE POLICY invoice_events_service_role_insert ON invoice_events
            FOR INSERT
            TO service_role
            WITH CHECK (true);
    END IF;
END$$;

-- ================================================================
-- 4. get_fiscal_context_for_store: expose new columns
-- ================================================================
-- The RPC returns the full context as JSON. New columns should surface so
-- the service can read them without a second query.
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

COMMENT ON COLUMN fiscal_identity_stores.default_generic_description IS
    'Fallback description used on fiscal documents when use_generic_description=true or item lacks a name.';
COMMENT ON COLUMN fiscal_identity_stores.use_generic_description IS
    'Global toggle: when true, every auto generated XML item uses default_generic_description.';
COMMENT ON COLUMN fiscal_identity_stores.auto_emit_invoice_on_delivery IS
    'When true, /delivery-confirm attempts to auto-emit a fiscal invoice for the order.';

COMMENT ON TABLE owner_alerts IS
    'Server-side alerts surfaced to the store owner (invoice rejections, auto-emit failures, etc). DB-backed so it survives refreshes and is visible across devices.';

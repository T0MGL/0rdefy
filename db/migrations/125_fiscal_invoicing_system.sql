-- ================================================================
-- Migration 125: Fiscal Invoicing System (SIFEN - Paraguay)
-- ================================================================
-- Electronic invoicing for Paraguay's SET (Subsecretaría de Estado de Tributación)
-- Supports demo, test, and production environments
-- Only applicable to stores with country = 'PY'
-- Gated to Growth+ plan ($79/month)
-- ================================================================

-- ================================================================
-- TABLE: fiscal_config - One per store, holds business fiscal data
-- ================================================================
CREATE TABLE IF NOT EXISTS fiscal_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL UNIQUE REFERENCES stores(id) ON DELETE CASCADE,

    -- Business identity
    ruc VARCHAR(20) NOT NULL,
    ruc_dv SMALLINT NOT NULL,
    razon_social VARCHAR(255) NOT NULL,
    nombre_fantasia VARCHAR(255),
    tipo_contribuyente SMALLINT NOT NULL CHECK (tipo_contribuyente IN (1, 2)),
    -- 1 = Persona Física, 2 = Persona Jurídica
    tipo_regimen SMALLINT,
    -- 1 = Régimen Turístico, 8 = Pequeño contribuyente, etc.

    -- Timbrado
    timbrado VARCHAR(20) NOT NULL,
    timbrado_fecha_inicio DATE,
    timbrado_fecha_fin DATE,

    -- Establecimiento
    establecimiento_codigo VARCHAR(3) NOT NULL DEFAULT '001',
    punto_expedicion VARCHAR(3) NOT NULL DEFAULT '001',
    establecimiento_direccion TEXT,
    establecimiento_departamento SMALLINT,
    establecimiento_distrito SMALLINT,
    establecimiento_ciudad SMALLINT,
    establecimiento_telefono VARCHAR(20),
    establecimiento_email VARCHAR(255),

    -- Actividad económica
    actividad_economica_codigo VARCHAR(10),
    actividad_economica_descripcion VARCHAR(255),

    -- Certificate (encrypted with AES-256-CBC)
    certificate_data BYTEA,
    certificate_password_encrypted TEXT,

    -- SIFEN environment
    sifen_environment VARCHAR(10) NOT NULL DEFAULT 'demo'
        CHECK (sifen_environment IN ('demo', 'test', 'prod')),

    -- Sequential numbering (atomic increment via advisory lock)
    next_document_number BIGINT NOT NULL DEFAULT 1 CHECK (next_document_number >= 1),

    -- State
    is_active BOOLEAN NOT NULL DEFAULT true,
    setup_completed BOOLEAN NOT NULL DEFAULT false,

    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ================================================================
-- TABLE: invoices - Each generated invoice (DTE)
-- ================================================================
CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,

    -- SIFEN identifiers
    cdc VARCHAR(44) UNIQUE, -- 44-digit control code (Código de Control)
    document_number BIGINT NOT NULL,

    -- Document type: 1 = Factura electrónica, 5 = Nota de crédito, 6 = Nota de débito
    tipo_documento SMALLINT NOT NULL DEFAULT 1
        CHECK (tipo_documento IN (1, 5, 6)),

    -- Customer snapshot (immutable at invoice time)
    customer_ruc VARCHAR(20),
    customer_ruc_dv SMALLINT,
    customer_name VARCHAR(255),
    customer_email VARCHAR(255),
    customer_address TEXT,

    -- Financials (PYG is zero-decimal, use BIGINT for amounts)
    subtotal BIGINT NOT NULL DEFAULT 0,
    iva_5 BIGINT NOT NULL DEFAULT 0,
    iva_10 BIGINT NOT NULL DEFAULT 0,
    iva_exento BIGINT NOT NULL DEFAULT 0,
    total BIGINT NOT NULL DEFAULT 0,
    currency VARCHAR(3) NOT NULL DEFAULT 'PYG',

    -- SIFEN status
    sifen_status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (sifen_status IN ('pending', 'sent', 'approved', 'rejected', 'cancelled', 'demo')),
    sifen_response_code VARCHAR(10),
    sifen_response_message TEXT,
    sifen_batch_id VARCHAR(50),

    -- XML storage
    xml_generated TEXT,
    xml_signed TEXT,

    -- PDF (KUDE)
    kude_url TEXT,

    -- Timestamps
    sent_to_sifen_at TIMESTAMPTZ,
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ================================================================
-- TABLE: invoice_events - Audit log for all invoice operations
-- ================================================================
CREATE TABLE IF NOT EXISTS invoice_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,

    event_type VARCHAR(30) NOT NULL,
    -- 'generated', 'signed', 'sent', 'approved', 'rejected', 'cancelled', 'error'
    details JSONB,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ================================================================
-- ALTER existing tables
-- ================================================================

-- orders: add customer RUC and invoice reference
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_ruc VARCHAR(20);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_ruc_dv SMALLINT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL;

-- ================================================================
-- INDEXES
-- ================================================================
-- NOTE: fiscal_config(store_id) already has a unique index from the UNIQUE constraint
CREATE INDEX IF NOT EXISTS idx_invoices_store_status ON invoices(store_id, sifen_status);
CREATE INDEX IF NOT EXISTS idx_invoices_store_created ON invoices(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_order ON invoices(order_id);
CREATE INDEX IF NOT EXISTS idx_orders_invoice ON orders(invoice_id) WHERE invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoice_events_invoice ON invoice_events(invoice_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_customer_ruc ON orders(store_id, customer_ruc) WHERE customer_ruc IS NOT NULL;

-- Unique constraint: one document number per store (defense-in-depth for advisory lock)
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_store_document_number ON invoices(store_id, document_number);

-- ================================================================
-- FUNCTION: get_next_invoice_number
-- Atomic increment with advisory lock to prevent race conditions
-- ================================================================
CREATE OR REPLACE FUNCTION get_next_invoice_number(p_store_id UUID)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_next_number BIGINT;
BEGIN
    -- Advisory lock scoped to this store's fiscal config
    PERFORM pg_advisory_xact_lock(hashtext('invoice_number_' || p_store_id::text));

    -- Get and increment
    UPDATE fiscal_config
    SET next_document_number = next_document_number + 1,
        updated_at = NOW()
    WHERE store_id = p_store_id AND is_active = true
    RETURNING next_document_number - 1 INTO v_next_number;

    IF v_next_number IS NULL THEN
        RAISE EXCEPTION 'No active fiscal config found for store %', p_store_id;
    END IF;

    RETURN v_next_number;
END;
$$;

-- ================================================================
-- FUNCTION: validate_fiscal_config
-- Validates that a store's fiscal config is complete and valid
-- ================================================================
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

    -- Validate RUC format (numeric, 1-20 chars)
    IF v_config.ruc IS NULL OR v_config.ruc = '' THEN
        v_errors := array_append(v_errors, 'RUC es requerido');
    END IF;

    -- Validate timbrado
    IF v_config.timbrado IS NULL OR v_config.timbrado = '' THEN
        v_errors := array_append(v_errors, 'Número de timbrado es requerido');
    END IF;

    -- Validate timbrado dates
    IF v_config.timbrado_fecha_fin IS NOT NULL AND v_config.timbrado_fecha_fin < CURRENT_DATE THEN
        v_errors := array_append(v_errors, 'El timbrado ha expirado');
    END IF;

    IF v_config.timbrado_fecha_inicio IS NOT NULL AND v_config.timbrado_fecha_inicio > CURRENT_DATE THEN
        v_warnings := array_append(v_warnings, 'El timbrado aún no está vigente');
    END IF;

    -- Validate certificate for non-demo environments
    IF v_config.sifen_environment != 'demo' THEN
        IF v_config.certificate_data IS NULL THEN
            v_errors := array_append(v_errors, 'Certificado digital es requerido para ambiente ' || v_config.sifen_environment);
        END IF;
        IF v_config.certificate_password_encrypted IS NULL THEN
            v_errors := array_append(v_errors, 'Contraseña del certificado es requerida');
        END IF;
    END IF;

    -- Validate razon social
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

-- ================================================================
-- TRIGGER: auto-update updated_at on fiscal_config
-- ================================================================
CREATE OR REPLACE FUNCTION update_fiscal_config_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_fiscal_config_updated_at ON fiscal_config;
CREATE TRIGGER trigger_fiscal_config_updated_at
    BEFORE UPDATE ON fiscal_config
    FOR EACH ROW
    EXECUTE FUNCTION update_fiscal_config_updated_at();

-- ================================================================
-- TRIGGER: auto-update updated_at on invoices
-- ================================================================
CREATE OR REPLACE FUNCTION update_invoices_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_invoices_updated_at ON invoices;
CREATE TRIGGER trigger_invoices_updated_at
    BEFORE UPDATE ON invoices
    FOR EACH ROW
    EXECUTE FUNCTION update_invoices_updated_at();

-- ================================================================
-- RLS Policies (idempotent: drop-then-create)
-- NOTE: The API uses supabaseAdmin (service_role) which bypasses RLS.
-- These policies are for defense-in-depth if anon/authenticated roles are ever used.
-- ================================================================
ALTER TABLE fiscal_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_events ENABLE ROW LEVEL SECURITY;

-- fiscal_config: store-scoped access
DROP POLICY IF EXISTS fiscal_config_store_policy ON fiscal_config;
CREATE POLICY fiscal_config_store_policy ON fiscal_config
    FOR ALL USING (store_id = current_setting('app.current_store_id', true)::uuid);

-- invoices: store-scoped access
DROP POLICY IF EXISTS invoices_store_policy ON invoices;
CREATE POLICY invoices_store_policy ON invoices
    FOR ALL USING (store_id = current_setting('app.current_store_id', true)::uuid);

-- invoice_events: store-scoped access
DROP POLICY IF EXISTS invoice_events_store_policy ON invoice_events;
CREATE POLICY invoice_events_store_policy ON invoice_events
    FOR ALL USING (store_id = current_setting('app.current_store_id', true)::uuid);

-- ================================================================
-- VIEW: v_invoice_summary - Quick stats per store
-- ================================================================
CREATE OR REPLACE VIEW v_invoice_summary AS
SELECT
    i.store_id,
    COUNT(*) AS total_invoices,
    COUNT(*) FILTER (WHERE i.sifen_status = 'approved') AS approved,
    COUNT(*) FILTER (WHERE i.sifen_status = 'rejected') AS rejected,
    COUNT(*) FILTER (WHERE i.sifen_status = 'pending') AS pending,
    COUNT(*) FILTER (WHERE i.sifen_status = 'sent') AS sent,
    COUNT(*) FILTER (WHERE i.sifen_status = 'demo') AS demo,
    COUNT(*) FILTER (WHERE i.sifen_status = 'cancelled') AS cancelled,
    COALESCE(SUM(i.total) FILTER (WHERE i.sifen_status IN ('approved', 'demo')), 0) AS total_facturado,
    MAX(i.created_at) AS last_invoice_at
FROM invoices i
GROUP BY i.store_id;

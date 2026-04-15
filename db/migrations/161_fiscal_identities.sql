-- ================================================================
-- Migration 161: Fiscal Identities (Paraguay SIFEN refactor)
-- ================================================================
-- Splits the legacy single-table fiscal_config into three tables:
--
--   1. fiscal_identities           - one row per RUC the user/owner owns
--   2. fiscal_identity_activities  - N economic activities per identity
--   3. fiscal_identity_stores      - link identity <-> store + per-link
--                                    establecimiento / punto_expedicion /
--                                    document numbering / timbrado window
--
-- Why this matters:
--   The owner can reuse the same RUC (Bright Commerce Group E.A.S., for
--   example) across multiple Ordefy stores (Solenne, NOCTE, Venisse) without
--   re-uploading the certificate or re-typing razon social. Each store gets
--   its own establecimiento_codigo + punto_expedicion + invoice sequence,
--   which is what SIFEN requires for DTE numeration.
--
-- Decisions (documented in ax mailbox 2026-04-14 MSG-ORDEFY-FISCAL-IDENTITIES-BLOCKERS):
--
--   Decision A: DO NOT rename fiscal_config. The legacy table stays in
--   place with its data. We create the three new tables alongside and
--   populate them from existing rows. The backend refactor (step 3) reads
--   from new tables via a getFiscalContext() helper; writes go to new
--   tables only. Legacy columns on fiscal_config get dropped in a future
--   migration (~162) once the backend has been deployed and verified.
--   No UPDATE-able view is needed because the table never moves.
--
--   Decision X: next_document_number lives on fiscal_identity_stores, not
--   on the identity. SIFEN requires sequential numbering per
--   establecimiento+punto_expedicion. One identity linked to N stores must
--   have N independent counters. The link row is the natural home for
--   that counter.
--
-- Scope of this migration (idempotent, safe to re-run):
--   - CREATE 3 new tables with constraints + indexes + RLS
--   - CREATE RPC: validate_fiscal_config(store_id) preserves legacy
--     signature, now reads from the new schema
--   - CREATE RPC: get_next_invoice_number(store_id) preserves legacy
--     signature, increments the link-level counter
--   - CREATE helper RPC: get_fiscal_context_for_store(store_id)
--   - Data migration: one row in fiscal_identities + one link row per
--     existing fiscal_config row (1 in production: Solenne)
--   - Legacy fiscal_config table UNCHANGED (no rename, no column drop)
--
-- Out of scope (follows in later migrations / backend commits):
--   - Dropping legacy columns on fiscal_config
--   - Switching the backend to write to new tables (that's step 3 in
--     the refactor plan)
--
-- Transaction: not wrapped here. When applied via apply_migration the
-- runner wraps the whole statement in a transaction. When applied via
-- psql the migration runner in db/ does the same. Wrapping explicitly
-- would nest BEGIN and conflict.
-- ================================================================

-- ================================================================
-- TABLE: fiscal_identities
-- One row per RUC the owner operates under. Owns the certificate,
-- razon social, tipo contribuyente, and SIFEN environment. Reusable
-- across multiple stores via fiscal_identity_stores.
-- ================================================================
CREATE TABLE IF NOT EXISTS fiscal_identities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

    -- Identity (immutable once invoices exist)
    ruc VARCHAR(20) NOT NULL,
    ruc_dv SMALLINT NOT NULL CHECK (ruc_dv BETWEEN 0 AND 9),
    razon_social VARCHAR(255) NOT NULL,
    nombre_fantasia VARCHAR(255),
    tipo_contribuyente SMALLINT NOT NULL CHECK (tipo_contribuyente IN (1, 2)),
    -- 1 = Persona Fisica, 2 = Persona Juridica
    tipo_regimen SMALLINT,

    -- Country gate (SIFEN = PY only). Relaxable via CHECK edit if we ever
    -- expand to AR/BR/UY.
    country CHAR(2) NOT NULL DEFAULT 'PY' CHECK (country IN ('PY')),

    -- SIFEN environment (applies to every store linked to this identity)
    sifen_environment VARCHAR(10) NOT NULL DEFAULT 'demo'
        CHECK (sifen_environment IN ('demo', 'test', 'prod')),

    -- Certificate (encrypted private key + cert PEM). Shared across all
    -- stores linked to this identity. Null until the wizard uploads it.
    cert_pem TEXT,
    encrypted_private_key TEXT,

    -- Optional CSC for QR injection (per SIFEN prod/test environment).
    -- When null, the xmlgen injector uses the documented test CSC.
    csc_id VARCHAR(10),
    csc TEXT,

    -- Representante legal (captured on identity, used by xmlgen gOpeDE /
    -- gEmis blocks). Replaces the old hardcoded values in buildUsuarioBlock.
    representante_legal_nombre VARCHAR(255),
    representante_legal_documento_tipo SMALLINT CHECK (representante_legal_documento_tipo IN (1, 2, 3, 4, 5, 6, 9)),
    -- 1=CI, 2=Pasaporte, 3=Cedula extranjera, 4=Carnet migratorio, 5=Tarjeta diplomatica, 6=RUC, 9=Otro (per SIFEN Anexo)
    representante_legal_documento_numero VARCHAR(50),
    representante_legal_cargo VARCHAR(100),

    -- Domicilio fiscal del titular (distinto del establecimiento, que va en
    -- fiscal_identity_stores). Este es el domicilio registrado ante DNIT.
    domicilio_fiscal_direccion TEXT,
    domicilio_fiscal_numero_casa VARCHAR(20),
    domicilio_fiscal_departamento SMALLINT,
    domicilio_fiscal_distrito SMALLINT,
    domicilio_fiscal_ciudad SMALLINT,

    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- RUC+DV is scoped per owner, not globally unique. Two different
    -- owners could each have a business with the same RUC in theory
    -- (shouldn't happen in PY, but we don't enforce that at the DB level
    -- to avoid false collisions if a new user imports an existing RUC
    -- for testing).
    CONSTRAINT uniq_fiscal_identity_owner_ruc UNIQUE (owner_user_id, ruc, ruc_dv)
);

CREATE INDEX IF NOT EXISTS idx_fiscal_identities_owner
    ON fiscal_identities(owner_user_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_fiscal_identities_ruc
    ON fiscal_identities(ruc, ruc_dv) WHERE is_active = true;

COMMENT ON TABLE fiscal_identities IS
    'Paraguay SIFEN fiscal identity (RUC owner). One identity reusable across multiple stores via fiscal_identity_stores.';
COMMENT ON COLUMN fiscal_identities.cert_pem IS
    'X.509 certificate PEM (not secret). Shared across all stores linked to this identity.';
COMMENT ON COLUMN fiscal_identities.encrypted_private_key IS
    'AES-256-GCM encrypted RSA private key (SIFEN_ENCRYPTION_KEY env var). Only secret in the row.';

-- ================================================================
-- TABLE: fiscal_identity_activities
-- N economic activities per identity. One must be marked principal.
-- Replaces the old single-column actividad_economica_codigo/descripcion.
-- ================================================================
CREATE TABLE IF NOT EXISTS fiscal_identity_activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    identity_id UUID NOT NULL REFERENCES fiscal_identities(id) ON DELETE CASCADE,

    codigo VARCHAR(10) NOT NULL,
    descripcion VARCHAR(255) NOT NULL,
    is_principal BOOLEAN NOT NULL DEFAULT false,

    display_order SMALLINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uniq_activity_per_identity UNIQUE (identity_id, codigo)
);

-- Exactly one principal activity per identity (enforced via partial unique)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_principal_activity_per_identity
    ON fiscal_identity_activities(identity_id) WHERE is_principal = true;

CREATE INDEX IF NOT EXISTS idx_activities_identity
    ON fiscal_identity_activities(identity_id, display_order);

-- ================================================================
-- TABLE: fiscal_identity_stores
-- Link identity <-> store. Carries the per-store SIFEN local state:
-- establecimiento code, punto de expedicion, timbrado (one timbrado
-- per link because a timbrado is authorized for a specific
-- establecimiento), and the sequential counter.
-- ================================================================
CREATE TABLE IF NOT EXISTS fiscal_identity_stores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    identity_id UUID NOT NULL REFERENCES fiscal_identities(id) ON DELETE CASCADE,
    store_id UUID NOT NULL UNIQUE REFERENCES stores(id) ON DELETE CASCADE,

    -- Timbrado (per-link: each establecimiento+punto_expedicion combo has
    -- its own timbrado issued by DNIT).
    timbrado VARCHAR(50) NOT NULL,
    timbrado_fecha_inicio DATE,
    timbrado_fecha_fin DATE,

    -- Establecimiento
    establecimiento_codigo VARCHAR(3) NOT NULL DEFAULT '001',
    punto_expedicion VARCHAR(3) NOT NULL DEFAULT '001',
    establecimiento_direccion TEXT,
    establecimiento_departamento SMALLINT,
    establecimiento_distrito SMALLINT,
    establecimiento_ciudad SMALLINT,
    establecimiento_telefono VARCHAR(50),
    establecimiento_email VARCHAR(255),

    -- Sequential numeration per SIFEN (atomic increment via advisory lock).
    -- One counter per (establecimiento, punto_expedicion) combo, which is
    -- modeled here as one counter per link row.
    next_document_number BIGINT NOT NULL DEFAULT 1
        CHECK (next_document_number >= 1),

    is_active BOOLEAN NOT NULL DEFAULT true,
    setup_completed BOOLEAN NOT NULL DEFAULT false,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uniq_identity_estab_punto
        UNIQUE (identity_id, establecimiento_codigo, punto_expedicion),
    CONSTRAINT fiscal_identity_stores_timbrado_numeric
        CHECK (timbrado ~ '^[0-9]{8}$')
);

CREATE INDEX IF NOT EXISTS idx_fiscal_identity_stores_identity
    ON fiscal_identity_stores(identity_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_fiscal_identity_stores_store
    ON fiscal_identity_stores(store_id) WHERE is_active = true;

COMMENT ON TABLE fiscal_identity_stores IS
    'Per-store SIFEN state: timbrado, establecimiento, invoice counter. Many-to-one against fiscal_identities.';

-- ================================================================
-- TRIGGER: updated_at auto-touch on all three tables
-- ================================================================
CREATE OR REPLACE FUNCTION touch_fiscal_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fiscal_identities_touch ON fiscal_identities;
CREATE TRIGGER trg_fiscal_identities_touch
    BEFORE UPDATE ON fiscal_identities
    FOR EACH ROW EXECUTE FUNCTION touch_fiscal_updated_at();

DROP TRIGGER IF EXISTS trg_fiscal_identity_stores_touch ON fiscal_identity_stores;
CREATE TRIGGER trg_fiscal_identity_stores_touch
    BEFORE UPDATE ON fiscal_identity_stores
    FOR EACH ROW EXECUTE FUNCTION touch_fiscal_updated_at();

-- ================================================================
-- RLS: defense-in-depth. API uses service_role (bypasses RLS) but we
-- enable policies so any future use of anon/authenticated is safe.
-- ================================================================
ALTER TABLE fiscal_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiscal_identity_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiscal_identity_stores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fiscal_identities_owner_policy ON fiscal_identities;
CREATE POLICY fiscal_identities_owner_policy ON fiscal_identities
    FOR ALL
    USING (
        owner_user_id = current_setting('app.current_user_id', true)::uuid
        OR EXISTS (
            SELECT 1 FROM fiscal_identity_stores fis
            WHERE fis.identity_id = fiscal_identities.id
              AND fis.store_id = current_setting('app.current_store_id', true)::uuid
        )
    );

DROP POLICY IF EXISTS fiscal_identity_activities_policy ON fiscal_identity_activities;
CREATE POLICY fiscal_identity_activities_policy ON fiscal_identity_activities
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM fiscal_identities fi
            WHERE fi.id = fiscal_identity_activities.identity_id
              AND (
                  fi.owner_user_id = current_setting('app.current_user_id', true)::uuid
                  OR EXISTS (
                      SELECT 1 FROM fiscal_identity_stores fis
                      WHERE fis.identity_id = fi.id
                        AND fis.store_id = current_setting('app.current_store_id', true)::uuid
                  )
              )
        )
    );

DROP POLICY IF EXISTS fiscal_identity_stores_policy ON fiscal_identity_stores;
CREATE POLICY fiscal_identity_stores_policy ON fiscal_identity_stores
    FOR ALL
    USING (store_id = current_setting('app.current_store_id', true)::uuid);

-- ================================================================
-- DATA MIGRATION: copy existing fiscal_config rows into the new schema.
-- Idempotent: skip rows that already have a matching identity/link.
--
-- One fiscal_config row becomes:
--   - one fiscal_identities row (keyed by owner + RUC + DV)
--   - one fiscal_identity_stores row (keyed by store_id)
--   - optionally one fiscal_identity_activities row (if config had one)
--
-- Owner resolution: pick the user_stores row with role = 'owner' for
-- that store. If multiple exist, pick the oldest.
-- ================================================================
DO $$
DECLARE
    cfg RECORD;
    v_owner_id UUID;
    v_identity_id UUID;
BEGIN
    FOR cfg IN
        SELECT * FROM fiscal_config WHERE is_active = true
    LOOP
        -- Resolve owner user for this store
        SELECT us.user_id INTO v_owner_id
        FROM user_stores us
        WHERE us.store_id = cfg.store_id
          AND us.role = 'owner'
        ORDER BY us.created_at ASC
        LIMIT 1;

        IF v_owner_id IS NULL THEN
            RAISE WARNING 'Skipping fiscal_config for store % - no owner found', cfg.store_id;
            CONTINUE;
        END IF;

        -- Upsert identity (match by owner + RUC + DV)
        SELECT id INTO v_identity_id
        FROM fiscal_identities
        WHERE owner_user_id = v_owner_id
          AND ruc = cfg.ruc
          AND ruc_dv = cfg.ruc_dv;

        IF v_identity_id IS NULL THEN
            INSERT INTO fiscal_identities (
                owner_user_id, ruc, ruc_dv, razon_social, nombre_fantasia,
                tipo_contribuyente, tipo_regimen, country, sifen_environment,
                cert_pem, encrypted_private_key,
                is_active, created_at, updated_at
            ) VALUES (
                v_owner_id,
                cfg.ruc,
                cfg.ruc_dv,
                cfg.razon_social,
                cfg.nombre_fantasia,
                cfg.tipo_contribuyente,
                cfg.tipo_regimen,
                'PY',
                cfg.sifen_environment,
                cfg.cert_pem,
                cfg.encrypted_private_key,
                cfg.is_active,
                cfg.created_at,
                cfg.updated_at
            )
            RETURNING id INTO v_identity_id;

            -- Copy single activity if present on legacy config
            IF cfg.actividad_economica_codigo IS NOT NULL
               AND cfg.actividad_economica_descripcion IS NOT NULL THEN
                INSERT INTO fiscal_identity_activities (
                    identity_id, codigo, descripcion, is_principal, display_order
                ) VALUES (
                    v_identity_id,
                    cfg.actividad_economica_codigo,
                    cfg.actividad_economica_descripcion,
                    true,
                    0
                )
                ON CONFLICT DO NOTHING;
            END IF;
        END IF;

        -- Upsert link (one per store)
        INSERT INTO fiscal_identity_stores (
            identity_id, store_id,
            timbrado, timbrado_fecha_inicio, timbrado_fecha_fin,
            establecimiento_codigo, punto_expedicion,
            establecimiento_direccion, establecimiento_departamento,
            establecimiento_distrito, establecimiento_ciudad,
            establecimiento_telefono, establecimiento_email,
            next_document_number, is_active, setup_completed,
            created_at, updated_at
        ) VALUES (
            v_identity_id, cfg.store_id,
            cfg.timbrado, cfg.timbrado_fecha_inicio, cfg.timbrado_fecha_fin,
            cfg.establecimiento_codigo, cfg.punto_expedicion,
            cfg.establecimiento_direccion, cfg.establecimiento_departamento,
            cfg.establecimiento_distrito, cfg.establecimiento_ciudad,
            cfg.establecimiento_telefono, cfg.establecimiento_email,
            cfg.next_document_number, cfg.is_active, cfg.setup_completed,
            cfg.created_at, cfg.updated_at
        )
        ON CONFLICT (store_id) DO NOTHING;
    END LOOP;
END $$;

-- ================================================================
-- RPC: get_fiscal_context_for_store(store_id)
-- Returns the joined identity + link + activities for a store, masking
-- secrets. Used by the backend helper getFiscalContext().
-- ================================================================
CREATE OR REPLACE FUNCTION get_fiscal_context_for_store(p_store_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_identity fiscal_identities%ROWTYPE;
    v_link fiscal_identity_stores%ROWTYPE;
    v_activities JSONB;
BEGIN
    SELECT fis.* INTO v_link
    FROM fiscal_identity_stores fis
    WHERE fis.store_id = p_store_id AND fis.is_active = true
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    SELECT fi.* INTO v_identity
    FROM fiscal_identities fi
    WHERE fi.id = v_link.identity_id AND fi.is_active = true;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', a.id,
            'codigo', a.codigo,
            'descripcion', a.descripcion,
            'is_principal', a.is_principal,
            'display_order', a.display_order
        ) ORDER BY a.display_order, a.created_at
    ), '[]'::jsonb) INTO v_activities
    FROM fiscal_identity_activities a
    WHERE a.identity_id = v_identity.id;

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
            'has_certificate', v_identity.cert_pem IS NOT NULL
                               AND v_identity.encrypted_private_key IS NOT NULL,
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
            'setup_completed', v_link.setup_completed
        ),
        'activities', v_activities
    );
END;
$$;

GRANT EXECUTE ON FUNCTION get_fiscal_context_for_store(UUID) TO service_role;

-- ================================================================
-- RPC: validate_fiscal_config(p_store_id UUID) - LEGACY SIGNATURE
-- Now reads from the new schema. Keeps the exact JSONB shape returned
-- by migration 125/157 so callers (backend + any SQL consumers) work
-- unchanged.
-- ================================================================
CREATE OR REPLACE FUNCTION validate_fiscal_config(p_store_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_identity fiscal_identities%ROWTYPE;
    v_link fiscal_identity_stores%ROWTYPE;
    v_errors TEXT[] := '{}';
    v_warnings TEXT[] := '{}';
BEGIN
    -- Try new schema first
    SELECT fis.* INTO v_link
    FROM fiscal_identity_stores fis
    WHERE fis.store_id = p_store_id AND fis.is_active = true
    LIMIT 1;

    IF FOUND THEN
        SELECT fi.* INTO v_identity
        FROM fiscal_identities fi
        WHERE fi.id = v_link.identity_id AND fi.is_active = true;

        IF NOT FOUND THEN
            RETURN jsonb_build_object(
                'valid', false,
                'errors', ARRAY['La tienda esta vinculada a una identidad fiscal inactiva'],
                'warnings', ARRAY[]::TEXT[]
            );
        END IF;

        IF v_identity.ruc IS NULL OR v_identity.ruc = '' THEN
            v_errors := array_append(v_errors, 'RUC es requerido');
        END IF;

        IF v_link.timbrado IS NULL OR v_link.timbrado = '' THEN
            v_errors := array_append(v_errors, 'Numero de timbrado es requerido');
        END IF;

        IF v_link.timbrado_fecha_fin IS NOT NULL AND v_link.timbrado_fecha_fin < CURRENT_DATE THEN
            v_errors := array_append(v_errors, 'El timbrado ha expirado');
        END IF;

        IF v_link.timbrado_fecha_inicio IS NOT NULL AND v_link.timbrado_fecha_inicio > CURRENT_DATE THEN
            v_warnings := array_append(v_warnings, 'El timbrado aun no esta vigente');
        END IF;

        IF v_identity.sifen_environment != 'demo' THEN
            IF v_identity.cert_pem IS NULL THEN
                v_errors := array_append(v_errors, 'Certificado digital es requerido para ambiente ' || v_identity.sifen_environment);
            END IF;
            IF v_identity.encrypted_private_key IS NULL THEN
                v_errors := array_append(v_errors, 'Clave privada del certificado es requerida');
            END IF;
        END IF;

        IF v_identity.razon_social IS NULL OR v_identity.razon_social = '' THEN
            v_errors := array_append(v_errors, 'Razon social es requerida');
        END IF;

        RETURN jsonb_build_object(
            'valid', array_length(v_errors, 1) IS NULL OR array_length(v_errors, 1) = 0,
            'errors', v_errors,
            'warnings', v_warnings,
            'environment', v_identity.sifen_environment,
            'setup_completed', v_link.setup_completed
        );
    END IF;

    -- Fallback: legacy fiscal_config path (deploy gap safety). Mirrors the
    -- validation logic the legacy RPC used (migration 157).
    DECLARE
        v_cfg fiscal_config%ROWTYPE;
    BEGIN
        SELECT * INTO v_cfg FROM fiscal_config
        WHERE store_id = p_store_id AND is_active = true;

        IF NOT FOUND THEN
            RETURN jsonb_build_object(
                'valid', false,
                'errors', ARRAY['No existe configuracion fiscal para esta tienda'],
                'warnings', ARRAY[]::TEXT[]
            );
        END IF;

        IF v_cfg.ruc IS NULL OR v_cfg.ruc = '' THEN
            v_errors := array_append(v_errors, 'RUC es requerido');
        END IF;
        IF v_cfg.timbrado IS NULL OR v_cfg.timbrado = '' THEN
            v_errors := array_append(v_errors, 'Numero de timbrado es requerido');
        END IF;
        IF v_cfg.timbrado_fecha_fin IS NOT NULL AND v_cfg.timbrado_fecha_fin < CURRENT_DATE THEN
            v_errors := array_append(v_errors, 'El timbrado ha expirado');
        END IF;
        IF v_cfg.timbrado_fecha_inicio IS NOT NULL AND v_cfg.timbrado_fecha_inicio > CURRENT_DATE THEN
            v_warnings := array_append(v_warnings, 'El timbrado aun no esta vigente');
        END IF;
        IF v_cfg.sifen_environment != 'demo' THEN
            IF v_cfg.cert_pem IS NULL THEN
                v_errors := array_append(v_errors, 'Certificado digital es requerido para ambiente ' || v_cfg.sifen_environment);
            END IF;
            IF v_cfg.encrypted_private_key IS NULL THEN
                v_errors := array_append(v_errors, 'Clave privada del certificado es requerida');
            END IF;
        END IF;
        IF v_cfg.razon_social IS NULL OR v_cfg.razon_social = '' THEN
            v_errors := array_append(v_errors, 'Razon social es requerida');
        END IF;

        RETURN jsonb_build_object(
            'valid', array_length(v_errors, 1) IS NULL OR array_length(v_errors, 1) = 0,
            'errors', v_errors,
            'warnings', v_warnings,
            'environment', v_cfg.sifen_environment,
            'setup_completed', v_cfg.setup_completed
        );
    END;
END;
$$;

GRANT EXECUTE ON FUNCTION validate_fiscal_config(UUID) TO service_role;

-- ================================================================
-- RPC: get_next_invoice_number(p_store_id UUID) - LEGACY SIGNATURE
-- Now increments the link-level counter instead of fiscal_config.
-- Falls back to legacy fiscal_config.next_document_number if no link
-- exists yet (deploy-gap safety until backend refactor ships).
-- ================================================================
CREATE OR REPLACE FUNCTION get_next_invoice_number(p_store_id UUID)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_next_number BIGINT;
    v_link_id UUID;
BEGIN
    -- Advisory lock scoped to this store
    PERFORM pg_advisory_xact_lock(hashtext('invoice_number_' || p_store_id::text));

    -- Prefer new schema
    SELECT id INTO v_link_id
    FROM fiscal_identity_stores
    WHERE store_id = p_store_id AND is_active = true
    LIMIT 1;

    IF v_link_id IS NOT NULL THEN
        UPDATE fiscal_identity_stores
        SET next_document_number = next_document_number + 1,
            updated_at = NOW()
        WHERE id = v_link_id
        RETURNING next_document_number - 1 INTO v_next_number;

        -- Keep legacy fiscal_config counter in sync so rollback to legacy
        -- code path doesn't duplicate a number. Best-effort, not locked.
        UPDATE fiscal_config
        SET next_document_number = v_next_number + 1,
            updated_at = NOW()
        WHERE store_id = p_store_id AND is_active = true;

        RETURN v_next_number;
    END IF;

    -- Fallback: legacy path (no link yet = backend still writing to fiscal_config)
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

GRANT EXECUTE ON FUNCTION get_next_invoice_number(UUID) TO service_role;

-- ================================================================
-- Annotate legacy columns for future removal
-- ================================================================
COMMENT ON TABLE fiscal_config IS
    'LEGACY (migration 161): superseded by fiscal_identities + fiscal_identity_stores. Kept for backwards compatibility during the backend refactor. Scheduled for column drop in migration 162+.';

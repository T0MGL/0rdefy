-- ================================================================
-- 189_sifen_async.sql
-- ================================================================
-- SIFEN sync -> async migration. SET/DNIT prod restringe el envio
-- sincronico de DE (clausula 7.10 final del Manual Tecnico v150).
-- Toda emision en prod debe ir por el WS asincrono siRecepLoteDE y
-- el resultado se consulta despues con siResultLoteDE.
--
-- Esta migration:
--   1. Agrega columnas async en `invoices` (protocolo de lote, timing,
--      idempotencia, ultimo error).
--   2. Extiende el CHECK de `sifen_status` con el estado 'queued'.
--   3. Crea indices parciales para que dispatcher y poller no escaneen
--      la tabla entera (escala a millones de invoices sin degradar).
--   4. Agrega feature flag `sifen_async_enabled` en `fiscal_identities`
--      (default false: rollout per-tenant via UPDATE, rollback trivial).
--   5. Triggers `pg_notify` que despiertan dispatcher y poller sin
--      polling continuo sobre la tabla.
--
-- Idempotente: usa IF NOT EXISTS / DROP IF EXISTS donde aplica para
-- poder re-correrla sin romper.
-- ================================================================

BEGIN;

-- 1. Columnas async en invoices.
--
-- identity_id: el dispatcher agrupa lotes por (identity_id, tipo_documento)
-- porque cada identidad tiene su propio RUC + cert + CSC + mTLS. El insert
-- de invoice en path async la puebla a partir del contexto fiscal del store.
-- ON DELETE SET NULL: si la identidad se borra, la invoice historica
-- queda con metadata huerfana pero la fila no se pierde (auditoria).
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS identity_id                 UUID
    REFERENCES fiscal_identities(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sifen_protocol_number       VARCHAR(20),
  ADD COLUMN IF NOT EXISTS sifen_lote_dispatch_key     VARCHAR(64),
  ADD COLUMN IF NOT EXISTS sifen_lote_submitted_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sifen_lote_next_poll_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sifen_lote_poll_attempts    SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sifen_lote_last_error       TEXT;

-- Idempotencia del dispatch. El dispatcher arma el lote, hashea su
-- contenido, y lo escribe en esta columna ANTES de pegarle a SIFEN.
-- Si el worker reinicia mid-flight y vuelve a tomar las mismas
-- invoices, el UNIQUE bloquea el doble dispatch.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_invoices_sifen_lote_dispatch_key
  ON invoices (sifen_lote_dispatch_key)
  WHERE sifen_lote_dispatch_key IS NOT NULL;

-- 2. Extender el CHECK de sifen_status con 'queued'.
-- El constraint inline de migration 125 quedo con nombre autogenerado
-- por Postgres (invoices_sifen_status_check). Lo encontramos por el
-- contype 'c' sobre la columna.
DO $$
DECLARE
  cname TEXT;
BEGIN
  SELECT conname INTO cname
  FROM pg_constraint
  WHERE conrelid = 'public.invoices'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%sifen_status%';

  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE invoices DROP CONSTRAINT %I', cname);
  END IF;
END $$;

ALTER TABLE invoices
  ADD CONSTRAINT invoices_sifen_status_check
  CHECK (sifen_status IN (
    'queued',     -- nuevo: lista para que el dispatcher la tome
    'pending',    -- legacy sync: insertada, sin enviar todavia
    'sent',       -- async: enviada a SIFEN, esperando consulta de resultado
    'approved',
    'rejected',
    'cancelled',
    'demo'
  ));

-- 3. Indices parciales para el path async.
-- Dispatcher: busca invoices recien encoladas, sin dispatch_key todavia.
-- En idle el indice esta vacio (rows en flight = <1% del total).
CREATE INDEX IF NOT EXISTS idx_invoices_dispatch_queue
  ON invoices (store_id, identity_id, tipo_documento, created_at)
  WHERE sifen_status = 'queued' AND sifen_lote_dispatch_key IS NULL;

-- Poller: busca lotes que ya superaron su next_poll_at.
CREATE INDEX IF NOT EXISTS idx_invoices_poll_due
  ON invoices (sifen_lote_next_poll_at)
  WHERE sifen_status = 'sent' AND sifen_protocol_number IS NOT NULL;

-- 4. Feature flag por identidad fiscal.
-- Default false: rollout per-tenant via UPDATE. Rollback inmediato
-- volviendo a false (la identidad vuelve al path sync legacy).
ALTER TABLE fiscal_identities
  ADD COLUMN IF NOT EXISTS sifen_async_enabled BOOLEAN NOT NULL DEFAULT false;

-- 5. Trigger: notificar al dispatcher al encolar una invoice.
-- Reduce 100% el polling en idle: el worker queda en LISTEN y se
-- despierta solo cuando hay trabajo real.
CREATE OR REPLACE FUNCTION notify_sifen_invoice_queued() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.sifen_status = 'queued'
     AND NEW.sifen_lote_dispatch_key IS NULL THEN
    PERFORM pg_notify('sifen_invoice_queued', NEW.store_id::text);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoices_notify_dispatch ON invoices;
CREATE TRIGGER trg_invoices_notify_dispatch
AFTER INSERT OR UPDATE OF sifen_status ON invoices
FOR EACH ROW EXECUTE FUNCTION notify_sifen_invoice_queued();

-- 6. Trigger: notificar al poller cuando un lote queda 'sent' con
-- numero de protocolo asignado.
CREATE OR REPLACE FUNCTION notify_sifen_lote_pending() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.sifen_status = 'sent'
     AND NEW.sifen_protocol_number IS NOT NULL
     AND (OLD IS NULL
          OR OLD.sifen_status IS DISTINCT FROM NEW.sifen_status
          OR OLD.sifen_protocol_number IS DISTINCT FROM NEW.sifen_protocol_number) THEN
    PERFORM pg_notify('sifen_lote_pending', NEW.sifen_protocol_number);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoices_notify_poll ON invoices;
CREATE TRIGGER trg_invoices_notify_poll
AFTER INSERT OR UPDATE OF sifen_status, sifen_protocol_number ON invoices
FOR EACH ROW EXECUTE FUNCTION notify_sifen_lote_pending();

-- 7. Actualizar RPC get_fiscal_context_for_store para incluir
-- sifen_async_enabled. Misma firma, mismo retorno (jsonb_build_object
-- en 'identity' suma la nueva key); el resto del payload no cambia, asi
-- que el codigo TypeScript existente sigue funcionando sin tocar nada
-- mas. Mantiene SECURITY DEFINER y search_path por consistencia con la
-- definicion de migration 163.
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
--   DROP TRIGGER trg_invoices_notify_poll ON invoices;
--   DROP TRIGGER trg_invoices_notify_dispatch ON invoices;
--   DROP FUNCTION notify_sifen_lote_pending();
--   DROP FUNCTION notify_sifen_invoice_queued();
--   ALTER TABLE fiscal_identities DROP COLUMN sifen_async_enabled;
--   DROP INDEX idx_invoices_poll_due;
--   DROP INDEX idx_invoices_dispatch_queue;
--   DROP INDEX uniq_invoices_sifen_lote_dispatch_key;
--   ALTER TABLE invoices DROP CONSTRAINT invoices_sifen_status_check;
--   ALTER TABLE invoices ADD CONSTRAINT invoices_sifen_status_check
--     CHECK (sifen_status IN ('pending','sent','approved','rejected','cancelled','demo'));
--   ALTER TABLE invoices
--     DROP COLUMN sifen_lote_last_error,
--     DROP COLUMN sifen_lote_poll_attempts,
--     DROP COLUMN sifen_lote_next_poll_at,
--     DROP COLUMN sifen_lote_submitted_at,
--     DROP COLUMN sifen_lote_dispatch_key,
--     DROP COLUMN sifen_protocol_number,
--     DROP COLUMN identity_id;
-- ================================================================

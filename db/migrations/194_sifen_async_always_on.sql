-- ================================================================
-- 194_sifen_async_always_on.sql
-- ================================================================
-- SIFEN async es el unico path viable en produccion desde 2024 (la
-- SET descontinuo el WS sincronico de recepcion DE; ver clausula 7.10
-- final del Manual Tecnico v150). Sync solo sirve para integradores
-- legacy en whitelist, y para eventos no-emision (cancelacion, etc).
--
-- Migration 189 introdujo `fiscal_identities.sifen_async_enabled` como
-- feature flag de rollout quirurgico para migrar tienda por tienda
-- mientras validabamos la integracion. El flag cumplio su funcion:
-- Solenne valido end-to-end (CDC 01801678455001001620629822026051719521645047,
-- dProtAut 3236307941). Ahora corresponde dejar async como default
-- para que toda nueva tienda PY arranque lista sin intervencion.
--
-- Cambios:
--   1. DEFAULT pasa de false a true.
--   2. Backfill: todas las identidades existentes en true.
--   3. Comentario en la columna refleja el nuevo significado.
--
-- Nota: la columna SE MANTIENE como kill switch de emergencia (si
-- alguna vez SIFEN cambia algo y necesitamos volver al WS sync temporal
-- para alguna identidad, lo hacemos via UPDATE puntual). Pero el dia a
-- dia es transparente, ningun owner/admin necesita tocarla.
--
-- Solo afecta identidades PY (fiscal_identities tiene CHECK country='PY'
-- por migration 161, asi que cualquier fila existente es paraguaya).
-- Idempotente.
-- ================================================================

BEGIN;

ALTER TABLE fiscal_identities
  ALTER COLUMN sifen_async_enabled SET DEFAULT true;

UPDATE fiscal_identities
SET sifen_async_enabled = true
WHERE sifen_async_enabled = false;

COMMENT ON COLUMN fiscal_identities.sifen_async_enabled IS
  'Legacy rollout flag de migration 189. Async es el unico path viable en SIFEN prod desde 2024; default true. Kill switch de emergencia para volver al WS sync legacy si SIFEN async cae prolongadamente (UPDATE puntual). Owners no lo gestionan: es interno.';

COMMIT;

-- ================================================================
-- Rollback manual (no recomendado):
--   ALTER TABLE fiscal_identities
--     ALTER COLUMN sifen_async_enabled SET DEFAULT false;
--   UPDATE fiscal_identities SET sifen_async_enabled = false;
-- ================================================================

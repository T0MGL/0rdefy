-- ================================================================
-- 193_invoicing_opt_in_gate.sql
-- ================================================================
-- Auto-emit de facturas al confirmar delivery vuelve a ser OPT-IN
-- explicito por tienda. Migration 164 puso el default en true y
-- forzo todas las identidades existentes a true; eso vivio sin UI
-- toggle (el frontend nunca expuso el control), asi que el feature
-- quedo siempre prendido para todos. Esta migration revierte el
-- comportamiento:
--   1. DEFAULT auto_emit_invoice_on_delivery vuelve a false
--   2. Apagamos TODAS las identidades existentes -> nadie auto-emite
--      hasta que el owner haga opt-in explicito via la UI nueva
--   3. Nueva columna products.fiscal_description: cuando esta poblada
--      indica que el producto esta listo para usarse en una factura
--      electronica. El auto-emit en delivery NO procede si algun
--      line_item del order apunta a un producto con esta columna en
--      NULL (gate de calidad: previene facturas con descripciones
--      genericas o malas).
--
-- Idempotente.
-- ================================================================

BEGIN;

-- 1. Default false en fiscal_identity_stores.auto_emit_invoice_on_delivery
ALTER TABLE fiscal_identity_stores
  ALTER COLUMN auto_emit_invoice_on_delivery SET DEFAULT false;

-- 2. Apagar todas las identidades existentes. Owner debe opt-in.
UPDATE fiscal_identity_stores
SET auto_emit_invoice_on_delivery = false
WHERE auto_emit_invoice_on_delivery = true;

COMMENT ON COLUMN fiscal_identity_stores.auto_emit_invoice_on_delivery IS
  'Opt-in explicito por tienda. Cuando true, marcar order como delivered intenta auto-emitir factura electronica. Default false. Migration 193 lo bajo a false despues de que migration 164 lo dejara en true sin UI toggle.';

-- 3. Columna products.fiscal_description
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS fiscal_description TEXT;

COMMENT ON COLUMN products.fiscal_description IS
  'Descripcion explicita para usar en la factura electronica. Cuando esta poblada, el auto-emit-on-delivery considera al producto listo para facturar; cuando esta NULL, skip el auto-emit y owner_alert. Editable desde UI de producto.';

COMMIT;

-- ================================================================
-- Rollback (manual):
--   ALTER TABLE products DROP COLUMN fiscal_description;
--   ALTER TABLE fiscal_identity_stores
--     ALTER COLUMN auto_emit_invoice_on_delivery SET DEFAULT true;
--   UPDATE fiscal_identity_stores SET auto_emit_invoice_on_delivery=true;
-- ================================================================

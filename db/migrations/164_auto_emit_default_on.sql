-- ================================================================
-- Migration 164: auto_emit_invoice_on_delivery default ON + backfill
-- ================================================================
-- In Paraguay, electronic invoicing is a legal obligation when the
-- customer provides a RUC. Requiring merchants to flip an opt-in toggle
-- before the pipeline fires creates a foot-gun (orders get delivered
-- without a factura, merchant forgets, customer asks weeks later, RUC
-- window has moved).
--
-- Decision: auto-emit is ON by default for every store that has a
-- completed fiscal setup. Merchants who want to opt out can still flip
-- the flag off from Settings. This migration:
--
--   1. Flips the column default to TRUE for future rows.
--   2. Backfills existing rows where setup_completed = true to TRUE.
--
-- Setup-incomplete rows stay FALSE, so we never attempt auto-emission
-- for a store that hasn't uploaded a cert.
-- ================================================================

ALTER TABLE fiscal_identity_stores
    ALTER COLUMN auto_emit_invoice_on_delivery SET DEFAULT true;

UPDATE fiscal_identity_stores
   SET auto_emit_invoice_on_delivery = true
 WHERE setup_completed = true
   AND auto_emit_invoice_on_delivery = false;

COMMENT ON COLUMN fiscal_identity_stores.auto_emit_invoice_on_delivery IS
    'When true, /delivery-confirm fires generateInvoice for orders with a customer_ruc. Default TRUE (PY invoicing is legally required when customer provides RUC). Merchants can opt out from Settings.';

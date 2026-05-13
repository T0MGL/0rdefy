-- ================================================================
-- Migration 185: allow negative amounts in settlement_extra_charges
-- ================================================================
-- Created: 2026-05-13
--
-- WHY:
--   Migration 184 modeled settlement_extra_charges.amount as `>= 0`, treating
--   the row as an "additional fee" only. Real-world reconciliations also need
--   the opposite sign: rebates that cancel a per-order flete the system over-
--   charged.
--
--   Concrete case audited with Mike Vargas (Solenne):
--     - "Tsi(2)Maria.Romina" line in the courier report = two prepaid orders
--       (Romina + Maria Ysabel) shipped to TSI in a SINGLE physical handoff.
--     - The system per-order flete charged 25k to each (50k total).
--     - The courier only collected one 25k flete for that handoff.
--     - Without a negative adjustment, the recon comes 25k off and the admin
--       sees a false "Cobró 25.000 de más".
--
--   New rule: amount must be non-zero and not null. Sign is free.
--
-- ROLLBACK (manual):
--   ALTER TABLE settlement_extra_charges DROP CONSTRAINT settlement_extra_charges_amount_check;
--   ALTER TABLE settlement_extra_charges ADD CONSTRAINT settlement_extra_charges_amount_check CHECK (amount >= 0);
-- ================================================================

ALTER TABLE settlement_extra_charges
  DROP CONSTRAINT IF EXISTS settlement_extra_charges_amount_check;

ALTER TABLE settlement_extra_charges
  ADD CONSTRAINT settlement_extra_charges_amount_check
  CHECK (amount IS NOT NULL AND amount <> 0);

COMMENT ON COLUMN settlement_extra_charges.amount IS
  'Flete amount. Positive for additional charges (relay, re-delivery). Negative for adjustments/rebates (shared delivery with duplicate orders). Zero is rejected.';

-- ============================================================
-- Migration 194: Courier portal self-close settlements
-- ============================================================
--
-- Adds the data model and storage primitives required for a courier
-- to close their own daily settlement from the portal, attaching a
-- bank-transfer screenshot as audit evidence.
--
-- Companion to Migration 184 (settlement extras) and Migration 182
-- (reconciliation by carrier). This migration is additive: it does
-- not modify the v_pending_reconciliation_by_carrier view, the
-- process_reconciliation_by_carrier function, or any pre-existing
-- settlement column. It only:
--
--   1. Creates a private storage bucket `settlement-proofs` for the
--      screenshots (5 MB cap, images + PDF).
--   2. Creates `settlement_payment_proofs` (1:N on daily_settlements)
--      to persist proof metadata + storage path.
--   3. Adds `submitted_by_courier_at` / `submitted_by_courier_user_id`
--      columns to `daily_settlements` so we can trace which proofs
--      came from a self-close vs. admin-side ops.
--
-- Trust model is auto-paid: when a courier closes a settlement from
-- the portal, the calling backend marks the resulting settlement as
-- `status='paid'` and `amount_paid = total_amount_collected`. The
-- proof in this table is evidence, not a gate.
--
-- Note on Storage RLS:
--   Bucket-level INSERT/SELECT policies require Supabase Storage's
--   `storage.objects` policies, which are declared on the platform
--   side (Dashboard or migration with the right role). This SQL file
--   creates the bucket row (idempotent INSERT into storage.buckets)
--   and the table-level RLS for settlement_payment_proofs. The
--   storage.objects policies must be applied via the matching
--   `194_portal_settlement_self_close_storage_policies.sql` file or
--   the Supabase Dashboard. See README in db/migrations/.
--
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1) Private storage bucket for settlement proofs
-- ------------------------------------------------------------
INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'settlement-proofs',
  'settlement-proofs',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------
-- 2) Table: settlement_payment_proofs (1:N on daily_settlements)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settlement_payment_proofs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id    UUID NOT NULL REFERENCES daily_settlements(id) ON DELETE CASCADE,
  store_id         UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  carrier_id       UUID NOT NULL REFERENCES carriers(id),
  uploaded_by      UUID NOT NULL REFERENCES users(id),
  storage_path     TEXT NOT NULL,
  mime_type        TEXT NOT NULL,
  file_size_bytes  INT  NOT NULL CHECK (file_size_bytes > 0 AND file_size_bytes <= 5242880),
  payment_reference TEXT CHECK (payment_reference IS NULL OR length(payment_reference) <= 200),
  payment_method   TEXT CHECK (
    payment_method IS NULL OR payment_method IN ('transfer','qr','cash_deposit','other')
  ),
  amount_claimed   NUMERIC(14,2) NOT NULL CHECK (amount_claimed >= 0),
  notes            TEXT CHECK (notes IS NULL OR length(notes) <= 2000),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_settlement_proofs_settlement
  ON settlement_payment_proofs (settlement_id);

CREATE INDEX IF NOT EXISTS idx_settlement_proofs_store_carrier
  ON settlement_payment_proofs (store_id, carrier_id, created_at DESC);

COMMENT ON TABLE settlement_payment_proofs IS
  'Bank-transfer screenshots and other payment proofs attached to a daily '
  'settlement. 1:N because a courier may transfer in multiple installments '
  '(e.g. partial transfer + complement via QR). Storage object lives at '
  '`settlement-proofs/{store_id}/{settlement_id}/{uuid}.{ext}` and is private '
  '(signed-URL access only). See Migration 194.';

COMMENT ON COLUMN settlement_payment_proofs.storage_path IS
  'Path inside the settlement-proofs bucket. Never expose to clients '
  'directly: always resolve through createSignedUrl with a short TTL.';

-- ------------------------------------------------------------
-- 3) Audit trace on daily_settlements
-- ------------------------------------------------------------
ALTER TABLE daily_settlements
  ADD COLUMN IF NOT EXISTS submitted_by_courier_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS submitted_by_courier_user_id UUID REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_daily_settlements_courier_submission
  ON daily_settlements (store_id, carrier_id, submitted_by_courier_at DESC)
  WHERE submitted_by_courier_at IS NOT NULL;

COMMENT ON COLUMN daily_settlements.submitted_by_courier_at IS
  'Timestamp at which the courier self-closed the settlement from the '
  'portal. NULL means the settlement was created admin-side (CSV import, '
  '/api/settlements/reconcile-by-carrier with an admin user, etc.). See '
  'Migration 194.';

COMMENT ON COLUMN daily_settlements.submitted_by_courier_user_id IS
  'User id of the courier who closed this settlement from the portal. '
  'NULL if it was created admin-side. Joins to users(id).';

-- ------------------------------------------------------------
-- 4) RLS on settlement_payment_proofs
-- ------------------------------------------------------------
ALTER TABLE settlement_payment_proofs ENABLE ROW LEVEL SECURITY;

-- Service role: full access (the backend writes with this role).
DROP POLICY IF EXISTS "service_role full access on settlement_payment_proofs"
  ON settlement_payment_proofs;
CREATE POLICY "service_role full access on settlement_payment_proofs"
  ON settlement_payment_proofs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Authenticated users: can SELECT proofs for stores they are an active
-- member of. INSERTs go through the service role from the portal route;
-- we keep authenticated INSERT closed off here so a leaked JWT cannot
-- write directly.
DROP POLICY IF EXISTS "members of store can read settlement proofs"
  ON settlement_payment_proofs;
CREATE POLICY "members of store can read settlement proofs"
  ON settlement_payment_proofs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_stores us
      WHERE us.user_id   = auth.uid()
        AND us.store_id  = settlement_payment_proofs.store_id
        AND us.is_active = true
    )
  );

GRANT SELECT ON settlement_payment_proofs TO authenticated, service_role;
GRANT INSERT, UPDATE, DELETE ON settlement_payment_proofs TO service_role;

COMMIT;

-- ============================================================
-- ROLLBACK (manual)
-- ============================================================
-- BEGIN;
--   DROP POLICY IF EXISTS "members of store can read settlement proofs" ON settlement_payment_proofs;
--   DROP POLICY IF EXISTS "service_role full access on settlement_payment_proofs" ON settlement_payment_proofs;
--   ALTER TABLE daily_settlements DROP COLUMN IF EXISTS submitted_by_courier_user_id;
--   ALTER TABLE daily_settlements DROP COLUMN IF EXISTS submitted_by_courier_at;
--   DROP TABLE IF EXISTS settlement_payment_proofs;
--   -- The bucket is intentionally left behind; deleting it via SQL
--   -- requires the objects to be empty. Use the Supabase Dashboard.
-- COMMIT;

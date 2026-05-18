-- ============================================================
-- Migration 194 (companion): storage.objects policies for
-- the `settlement-proofs` bucket.
-- ============================================================
--
-- Apply this AFTER 194_portal_settlement_self_close.sql.
-- These policies live on storage.objects, which often requires
-- elevated privileges. If `apply_migration` rejects this file due
-- to ownership errors, apply each CREATE POLICY manually in the
-- Supabase Dashboard under Storage → settlement-proofs → Policies.
--
-- Path convention (set by the backend in portal-settlements.service):
--   settlement-proofs / {store_id} / {settlement_id} / {uuid}.{ext}
--
-- foldername(name) -> { '{store_id}', '{settlement_id}', '{uuid}.{ext}' }
-- foldername(name)[1] is therefore the store_id segment.
-- ============================================================

BEGIN;

-- Drop pre-existing policies (idempotent re-apply)
DROP POLICY IF EXISTS "settlement-proofs: service_role full"     ON storage.objects;
DROP POLICY IF EXISTS "settlement-proofs: store members read"    ON storage.objects;
DROP POLICY IF EXISTS "settlement-proofs: courier of carrier write" ON storage.objects;

-- 1) Service role bypass.
CREATE POLICY "settlement-proofs: service_role full"
  ON storage.objects
  FOR ALL
  TO service_role
  USING (bucket_id = 'settlement-proofs')
  WITH CHECK (bucket_id = 'settlement-proofs');

-- 2) Authenticated members of the store: SELECT only.
--    Even though the backend uses signed URLs for download, we still
--    want a defense-in-depth row policy so a leaked JWT cannot list
--    or fetch arbitrary objects.
CREATE POLICY "settlement-proofs: store members read"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'settlement-proofs'
    AND EXISTS (
      SELECT 1 FROM user_stores us
      WHERE us.user_id   = auth.uid()
        AND us.store_id  = ((storage.foldername(name))[1])::UUID
        AND us.is_active = true
    )
  );

-- 3) Couriers of a carrier: INSERT into their own store's path only.
--    The backend uses the service role so this is also defense-in-depth.
CREATE POLICY "settlement-proofs: courier of carrier write"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'settlement-proofs'
    AND EXISTS (
      SELECT 1 FROM user_stores us
      WHERE us.user_id      = auth.uid()
        AND us.store_id     = ((storage.foldername(name))[1])::UUID
        AND us.is_active    = true
        AND us.role         = 'courier'
        AND us.carrier_id IS NOT NULL
    )
  );

COMMIT;

-- ============================================================
-- ROLLBACK (manual)
-- ============================================================
-- BEGIN;
--   DROP POLICY IF EXISTS "settlement-proofs: courier of carrier write" ON storage.objects;
--   DROP POLICY IF EXISTS "settlement-proofs: store members read"       ON storage.objects;
--   DROP POLICY IF EXISTS "settlement-proofs: service_role full"        ON storage.objects;
-- COMMIT;

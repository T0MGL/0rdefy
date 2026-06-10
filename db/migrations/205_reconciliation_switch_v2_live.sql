-- ============================================================================
-- Migration 205: switch process_reconciliation_by_carrier to the v2 body
-- ============================================================================
-- THE SWITCH. This is the write that makes v2 the live function the portal
-- caller hits. Until now v2 was shadow (nothing called it).
--
-- Mechanism: atomic rename swap inside one transaction.
--   process_reconciliation_by_carrier      -> process_reconciliation_by_carrier_v1_archived
--   process_reconciliation_by_carrier_v2   -> process_reconciliation_by_carrier
--
-- The caller (api/services/portal-settlements.service.ts:564) invokes the RPC
-- by name, so it resolves to the new body with no code change and no deploy.
-- The archived v1 stays in place for an instant rollback (rename back).
--
-- After this migration, every NEW by-carrier close:
--   - persists total_cod_expected (was 0), so difference and discrepancy_amount
--     compute the real settlement discrepancy,
--   - writes the settlement_orders junction for delivered COD,
--   - leaves the per-order has_amount_discrepancy flag untouched.
-- Historical settlements are NOT changed. Forward-only.
--
-- Idempotent: the swap only runs when both functions exist in the pre-switch
-- state (live + v2). After the switch v2 no longer exists, so a re-run is a
-- no-op. Safe if a deploy pipeline replays migrations.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.oid = 'public.process_reconciliation_by_carrier_v2(uuid,uuid,uuid,numeric,text,jsonb,jsonb)'::regprocedure
     )
     AND EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.oid = 'public.process_reconciliation_by_carrier(uuid,uuid,uuid,numeric,text,jsonb,jsonb)'::regprocedure
     )
  THEN
    ALTER FUNCTION public.process_reconciliation_by_carrier(uuid,uuid,uuid,numeric,text,jsonb,jsonb)
      RENAME TO process_reconciliation_by_carrier_v1_archived;
    ALTER FUNCTION public.process_reconciliation_by_carrier_v2(uuid,uuid,uuid,numeric,text,jsonb,jsonb)
      RENAME TO process_reconciliation_by_carrier;
    RAISE NOTICE 'Switched process_reconciliation_by_carrier to v2 body. v1 archived.';
  ELSE
    RAISE NOTICE 'Switch skipped: pre-switch state not present (already switched or v2 missing).';
  END IF;
END $$;

COMMIT;

-- ============================================================================
-- ROLLBACK (documented, NOT run): rename back, instant revert to mig 200 body.
-- ============================================================================
-- BEGIN;
-- ALTER FUNCTION public.process_reconciliation_by_carrier(uuid,uuid,uuid,numeric,text,jsonb,jsonb)
--   RENAME TO process_reconciliation_by_carrier_v2;
-- ALTER FUNCTION public.process_reconciliation_by_carrier_v1_archived(uuid,uuid,uuid,numeric,text,jsonb,jsonb)
--   RENAME TO process_reconciliation_by_carrier;
-- COMMIT;
-- ============================================================================

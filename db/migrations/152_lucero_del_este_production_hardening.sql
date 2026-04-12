-- ================================================================
-- MIGRATION 152: Lucero del Este Production Hardening (4 stores)
-- ================================================================
-- Date: 2026-04-11
-- Author: ordefy-ceo
-- Priority: CRITICAL (Richard Figueredo moved from beta to production,
--                    Solenne is live DTC, NOCTE is live DTC. All four
--                    stores must share an identical Lucero del Este
--                    footprint, zero fantasma carriers, zero casing
--                    drift, zero accidental config divergence.)
--
-- SCOPE: Closes every operational gap around the Lucero del Este
--        carrier across NOCTE, Solenne, Venisse, and MiniGenios that
--        was left open after migrations 149, 150, 151.
--
-- GAPS CLOSED:
--   1. carrier_zones. Investigated explicitly. NOCTE (source of truth)
--      holds ZERO zones for its Lucero del Este carrier. Lucero runs
--      100% on carrier_coverage (city-level), not carrier_zones
--      (zone-level). Other NOCTE carriers (TSI, Adrian Torales) use
--      zones, but Lucero does not. Therefore nothing to replicate. The
--      get_carriers_for_city RPC resolves city -> rate via
--      carrier_coverage directly, so no zone row is required for live
--      rate calculation. This migration documents the decision and
--      does NOT invent zone rows.
--
--   2. Phantom default carrier "Solenne Delivery"
--      (c62e22b1-a558-4dd6-9df0-fcc3ed699b89). Active with zero
--      coverage, appeared in checkout as a broken option. Deactivated.
--      Audit of the remaining three stores (NOCTE, Venisse, MiniGenios)
--      confirms no equivalent phantom exists: every other active
--      carrier already has coverage rows or zone rows.
--
--   3. Phone column on Lucero carrier. NOCTE uses empty string ''
--      (not NULL). The three Richard stores had NULL. Normalized to ''
--      for byte-exact parity with NOCTE. The real Lucero del Este
--      contact phone is NOT invented; surfaced to Gaston as a pending
--      commercial decision (needs a real number from the courier).
--
--   4. Name casing. NOCTE stores "Lucero del este" (lowercase e).
--      Solenne, Venisse, MiniGenios were created with "Lucero del
--      Este" (capital E). NOCTE is source of truth (live months in
--      production, referenced by reports, exports, and customer
--      communications). The three newer stores are aligned to the
--      NOCTE spelling.
--
--   5. End-to-end live rate resolution. Verified (post-apply) via
--      get_carriers_for_city(store_id, city) across the 4 stores x 3
--      key cities (Asunción, Ciudad del Este, Encarnación). 12/12
--      passed with identical rates.
--
-- IDEMPOTENCY: every statement is guarded. Re-running is safe:
--              UPDATE ... WHERE reshapes only rows that drift.
--              Deactivation of Solenne Delivery is a no-op after the
--              first run.
--
-- SCOPE GUARD: hard fails if any target store id does not exist, so
--              a copy paste into the wrong environment aborts before
--              touching data.
--
-- DEPLOYMENT: already applied live on 2026-04-11 via Supabase REST +
--             service role (PATCH /rest/v1/carriers) during the
--             production hardening pass. This .sql is the canonical
--             audit trail and should be re-runnable against any
--             restore or fresh environment.
-- ================================================================

BEGIN;

-- ----------------------------------------------------------------
-- Guards: abort if any target store is missing
-- ----------------------------------------------------------------
DO $$
DECLARE
    v_stores UUID[] := ARRAY[
        '1eeaf2c7-2cd2-4257-8213-d90b1280a19d'::UUID,  -- NOCTE
        '0b3f13f8-d1dc-48a5-a707-27a095c9c545'::UUID,  -- Solenne
        '6504d5bd-7bae-4081-9274-6305da432177'::UUID,  -- Venisse
        '2b5a5638-a956-428a-8d1f-f6cb6a90d597'::UUID   -- MiniGenios
    ];
    v_sid UUID;
BEGIN
    FOREACH v_sid IN ARRAY v_stores LOOP
        IF NOT EXISTS (SELECT 1 FROM stores WHERE id = v_sid) THEN
            RAISE EXCEPTION '[152] target store % not found', v_sid;
        END IF;
    END LOOP;
    RAISE NOTICE '[152] guard OK, all 4 target stores exist';
END $$;

-- ----------------------------------------------------------------
-- 1. Deactivate the phantom default carrier on Solenne
--    ("Solenne Delivery" was active with zero coverage, bleeding
--    broken options into the live checkout.)
-- ----------------------------------------------------------------
UPDATE carriers
   SET is_active = FALSE,
       updated_at = NOW()
 WHERE id         = 'c62e22b1-a558-4dd6-9df0-fcc3ed699b89'
   AND store_id   = '0b3f13f8-d1dc-48a5-a707-27a095c9c545'
   AND is_active  = TRUE;

-- ----------------------------------------------------------------
-- 2. Unify name casing and normalize phone across the three Richard
--    Figueredo / Solenne Lucero rows to byte-exact parity with
--    NOCTE ("Lucero del este", phone = '').
--    NOCTE is source of truth and is intentionally NOT touched.
--    Guarded by id + store_id so a copy paste cannot mutate another
--    store's carrier.
-- ----------------------------------------------------------------
UPDATE carriers
   SET name       = 'Lucero del este',
       phone      = '',
       updated_at = NOW()
 WHERE (id, store_id) IN (
        ('1c8fbe21-e2c5-4514-8038-b33d732c434b'::UUID,
         '0b3f13f8-d1dc-48a5-a707-27a095c9c545'::UUID),  -- Solenne
        ('a97108eb-58db-4331-84e6-4040af5c58eb'::UUID,
         '6504d5bd-7bae-4081-9274-6305da432177'::UUID),  -- Venisse
        ('5e0488e8-5d74-4661-b023-78b89abd9f3f'::UUID,
         '2b5a5638-a956-428a-8d1f-f6cb6a90d597'::UUID)   -- MiniGenios
       )
   AND (name IS DISTINCT FROM 'Lucero del este'
        OR phone IS DISTINCT FROM '');

-- ----------------------------------------------------------------
-- 3. carrier_zones. Intentionally NO inserts. NOCTE holds zero
--    zones for its Lucero del Este carrier (verified directly
--    against carrier_zones on 2026-04-11 pre-migration). Replicating
--    nothing from the source is the correct behavior. Lucero runs
--    on carrier_coverage (266 rows per store, 59 with a rate).
--    This block exists only to assert and document the invariant
--    so a future engineer does not "fix" an imaginary gap.
-- ----------------------------------------------------------------
DO $$
DECLARE
    v_nocte_carrier_id UUID;
    v_zone_count       INT;
BEGIN
    SELECT id INTO v_nocte_carrier_id
      FROM carriers
     WHERE store_id = '1eeaf2c7-2cd2-4257-8213-d90b1280a19d'
       AND LOWER(TRIM(name)) LIKE '%lucero del este%'
       AND is_active = TRUE
     LIMIT 1;

    IF v_nocte_carrier_id IS NULL THEN
        RAISE EXCEPTION '[152] NOCTE Lucero carrier not found, aborting';
    END IF;

    SELECT COUNT(*) INTO v_zone_count
      FROM carrier_zones
     WHERE carrier_id = v_nocte_carrier_id;

    IF v_zone_count <> 0 THEN
        RAISE WARNING '[152] NOCTE Lucero now holds % zone rows (expected 0). '
                      'Source of truth changed. Review this migration '
                      'before re-running on another environment.',
                      v_zone_count;
    END IF;
END $$;

-- ----------------------------------------------------------------
-- 4. Post-apply verification across the 4 stores x 3 key cities.
--    Uses the exact RPC that the checkout endpoint consumes, so a
--    PASS here means the live buyer experience resolves correctly.
-- ----------------------------------------------------------------
DO $$
DECLARE
    v_stores UUID[] := ARRAY[
        '1eeaf2c7-2cd2-4257-8213-d90b1280a19d'::UUID,
        '0b3f13f8-d1dc-48a5-a707-27a095c9c545'::UUID,
        '6504d5bd-7bae-4081-9274-6305da432177'::UUID,
        '2b5a5638-a956-428a-8d1f-f6cb6a90d597'::UUID
    ];
    v_cities TEXT[] := ARRAY['Asunción', 'Ciudad del Este', 'Encarnación'];
    v_sid        UUID;
    v_city       TEXT;
    v_found      BOOLEAN;
    v_rate       NUMERIC;
    v_fail_count INT := 0;
BEGIN
    FOREACH v_sid IN ARRAY v_stores LOOP
        FOREACH v_city IN ARRAY v_cities LOOP
            SELECT TRUE, r.rate
              INTO v_found, v_rate
              FROM get_carriers_for_city(v_sid, v_city) r
             WHERE LOWER(r.carrier_name) LIKE '%lucero del este%'
               AND r.has_coverage = TRUE
               AND r.rate IS NOT NULL
             LIMIT 1;

            IF NOT FOUND THEN
                v_fail_count := v_fail_count + 1;
                RAISE WARNING '[152] FAIL store=% city=% no Lucero row with rate',
                              v_sid, v_city;
            ELSE
                RAISE NOTICE '[152] PASS store=% city=% rate=%',
                             v_sid, v_city, v_rate;
            END IF;

            v_found := NULL;
            v_rate  := NULL;
        END LOOP;
    END LOOP;

    IF v_fail_count > 0 THEN
        RAISE EXCEPTION '[152] % verification(s) failed', v_fail_count;
    END IF;
    RAISE NOTICE '[152] 12/12 verifications passed';
END $$;

-- ----------------------------------------------------------------
-- 5. Phantom sweep. Confirm no other active carrier with zero
--    coverage AND zero zones exists in any of the four stores. If
--    one appears in the future it will fire a warning here.
-- ----------------------------------------------------------------
DO $$
DECLARE
    v_phantom RECORD;
    v_count   INT := 0;
BEGIN
    FOR v_phantom IN
        SELECT c.id, c.store_id, c.name
          FROM carriers c
         WHERE c.store_id IN (
                '1eeaf2c7-2cd2-4257-8213-d90b1280a19d',
                '0b3f13f8-d1dc-48a5-a707-27a095c9c545',
                '6504d5bd-7bae-4081-9274-6305da432177',
                '2b5a5638-a956-428a-8d1f-f6cb6a90d597'
               )
           AND c.is_active = TRUE
           AND NOT EXISTS (
                SELECT 1 FROM carrier_coverage cc
                 WHERE cc.carrier_id = c.id AND cc.is_active = TRUE
               )
           AND NOT EXISTS (
                SELECT 1 FROM carrier_zones cz
                 WHERE cz.carrier_id = c.id AND cz.is_active = TRUE
               )
    LOOP
        v_count := v_count + 1;
        RAISE WARNING '[152] phantom carrier detected: id=% store=% name=%',
                      v_phantom.id, v_phantom.store_id, v_phantom.name;
    END LOOP;
    IF v_count = 0 THEN
        RAISE NOTICE '[152] no phantom carriers across the 4 target stores';
    END IF;
END $$;

COMMIT;

-- ================================================================
-- MIGRATION 152 COMPLETED
-- ================================================================
-- Changes applied:
--   - Deactivated "Solenne Delivery" phantom on Solenne store
--   - Unified 3 Lucero carriers (Solenne/Venisse/MiniGenios) to
--     name="Lucero del este", phone=""
--   - Asserted NOCTE Lucero holds zero carrier_zones (intentional)
--   - Verified get_carriers_for_city across 4 stores x 3 cities
--   - Swept for any phantom carrier across the 4 target stores
--
-- Pending commercial decisions (NOT technical, flagged to Gaston):
--   - Real phone number for Lucero del Este (all 4 stores now hold
--     the empty string). Requires an official courier contact.
--   - Plan upgrade for Venisse and MiniGenios (both on free,
--     max_users=1). Richard is in production and may need seats.
-- ================================================================

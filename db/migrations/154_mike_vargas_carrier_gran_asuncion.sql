-- ================================================================
-- MIGRATION 154: Mike Vargas carrier for NOCTE + Solenne
--                (Gran Asunción, 15 serviced cities)
-- ================================================================
-- Date: 2026-04-11
-- Author: ordefy-ceo
-- Priority: HIGH (third carrier for NOCTE + Solenne. Adds a Gran
--                Asunción option that coexists with Lucero del este
--                and Orlando Nuñez so the buyer can pick by rate.)
--
-- SCOPE (hard locked): exactly two store ids.
--   - NOCTE    1eeaf2c7-2cd2-4257-8213-d90b1280a19d
--   - Solenne  0b3f13f8-d1dc-48a5-a707-27a095c9c545
--
-- OUT OF SCOPE (must never appear in any INSERT/UPDATE here):
--   - Venisse     6504d5bd-7bae-4081-9274-6305da432177
--   - MiniGenios  2b5a5638-a956-428a-8d1f-f6cb6a90d597
--   Any drift that lets one of those ids into this migration raises
--   and rolls back the whole transaction.
--
-- RATES (PYG, provided by Gaston, pre normalized against the existing
--        paraguay_locations master dictionary, and against the existing
--        carrier_coverage rows for Lucero del este NOCTE where the
--        city name was already canonicalized):
--
--     Asunción              ASUNCION   25000
--     Loma Pytá             CENTRAL    25000
--     Lambaré               CENTRAL    25000
--     Fernando de la Mora   CENTRAL    25000
--     Villa Elisa           CENTRAL    25000
--     Mariano Roque Alonso  CENTRAL    30000
--     Luque                 CENTRAL    30000
--     San Lorenzo           CENTRAL    30000
--     Ñemby                 CENTRAL    30000
--     San Antonio           CENTRAL    30000
--     Limpio                CENTRAL    35000
--     Capiatá               CENTRAL    35000
--     Areguá                CENTRAL    35000
--     Ypané                 CENTRAL    35000
--     J. Augusto Saldivar   CENTRAL    35000
--
--   Total: 15 serviced cities (not 16 as originally briefed).
--
-- DELIBERATE OMISSION, NOT A BUG: Zeballos Cue
--   Gaston provided 16 cities. 15 resolve cleanly against the
--   paraguay_locations master dictionary and against the existing
--   carrier_coverage shape. Zeballos Cue does NOT exist in
--   paraguay_locations under any casing, accent, or alias tested
--   (zeballos, ceballos, zevallos, cue, zeballos cue, zeballos cué).
--   It does not appear in any carrier_coverage row of any store
--   either. Geographically it is a barrio in the north of Asunción,
--   not a listed city. Creating it as a new row in paraguay_locations
--   plus carrier_coverage would fork the dictionary and silently
--   split routing semantics across stores (an address typed as
--   "Asunción" would still resolve to Asunción, while an address
--   typed as "Zeballos Cue" would route to a barrio rate), so the
--   choice is escalated to the commercial owner:
--     (a) add Zeballos Cue to paraguay_locations as a CENTRAL city
--         and let every carrier receive its own rate row. Requires
--         a dictionary migration.
--     (b) route Zeballos Cue to Asunción, sharing the 25000 rate
--         Mike Vargas already covers for Asunción. Zero new rows.
--     (c) leave it out and let the checkout fall back to a generic
--         rate.
--   Migration 154 intentionally stops at 15 cities. Zeballos Cue is
--   documented in ~/founder-os/outputs/ordefy/ceo/ as a pending gap.
--
-- NOTE ON LOMA PYTÁ (addresses Gaston's red flag explicitly):
--   Gaston flagged Loma Pytá as a likely barrio, not an independent
--   city. Verified live before writing this migration:
--     - paraguay_locations contains exactly one row:
--         Loma Pytá, department=CENTRAL, zone_code=CENTRAL, is_active=true
--     - carrier_coverage already holds a rated row for Loma Pytá
--         on Adrian Torales NOCTE (rate 20000), proving the system
--         already treats Loma Pytá as an operable city.
--     - Lucero del este NOCTE does NOT hold a coverage row for
--         Loma Pytá, so Mike Vargas will be the second carrier to
--         quote the city, not the first.
--   Conclusion: Loma Pytá is canonical in the dictionary, so it is
--   safe to include. The canonical spelling carries the tilde
--   (Loma Pytá, not Loma Pyta).
--
-- COEXISTENCE WITH LUCERO DEL ESTE AND ORLANDO NUÑEZ:
--   Lucero del este NOCTE already serves 59 cities, including all
--   14 of the confirmed Mike Vargas targets (not Loma Pytá). Orlando
--   Nuñez NOCTE/Solenne already serves 10 Gran Asunción cities. Once
--   migration 154 applies, Asunción will resolve to three carriers
--   (Lucero 25000, Orlando 15000, Mike 25000), San Lorenzo to three
--   (Lucero 25000, Orlando 25000, Mike 30000), Capiatá to three
--   (Lucero 35000, Orlando 30000, Mike 35000), and so on. The buyer
--   sees all three at checkout and picks. This is verified post apply
--   via get_carriers_for_city.
--
-- PARITY WITH PRIOR MIGRATIONS (149, 151, 153):
--   name         = 'Mike Vargas'      (plain ASCII, single casing)
--   phone        = ''                  (not NULL, parity with prior)
--   carrier_type = 'internal'          (parity with prior)
--   is_active    = TRUE
--
-- IDEMPOTENCY:
--   - Carrier creation is guarded by a (store_id, LOWER(name)) lookup.
--   - Coverage rows use import_carrier_coverage() which upserts by
--     (carrier_id, LOWER(city), LOWER(COALESCE(department, ''))).
--   - Re-running this migration against the same database is a no op.
--
-- DEPLOYMENT:
--   Applied live on 2026-04-11 via Supabase REST + service role key
--   (POST /rest/v1/carriers + POST /rest/v1/rpc/import_carrier_coverage)
--   during the Mike Vargas onboarding pass. This .sql is the canonical
--   audit trail and is re-runnable against any restore or fresh
--   environment. Verification block at the bottom confirms 30/30 rate
--   resolutions (15 cities x 2 stores) and rolls back on any drift.
-- ================================================================

BEGIN;

-- ----------------------------------------------------------------
-- Guard 0: hard scope lock. Only NOCTE and Solenne.
-- ----------------------------------------------------------------
DO $$
DECLARE
    v_target_stores UUID[] := ARRAY[
        '1eeaf2c7-2cd2-4257-8213-d90b1280a19d'::UUID,  -- NOCTE
        '0b3f13f8-d1dc-48a5-a707-27a095c9c545'::UUID   -- Solenne
    ];
    v_forbidden_stores UUID[] := ARRAY[
        '6504d5bd-7bae-4081-9274-6305da432177'::UUID,  -- Venisse
        '2b5a5638-a956-428a-8d1f-f6cb6a90d597'::UUID   -- MiniGenios
    ];
    v_sid UUID;
BEGIN
    FOREACH v_sid IN ARRAY v_target_stores LOOP
        IF NOT EXISTS (
            SELECT 1 FROM stores
             WHERE id = v_sid
               AND is_active = TRUE
               AND country = 'PY'
               AND currency = 'PYG'
        ) THEN
            RAISE EXCEPTION
                '[154] target store % missing, inactive, or not PY/PYG. Aborting.',
                v_sid;
        END IF;
    END LOOP;

    FOREACH v_sid IN ARRAY v_forbidden_stores LOOP
        IF v_sid = ANY (v_target_stores) THEN
            RAISE EXCEPTION
                '[154] forbidden store % leaked into target set. Aborting.',
                v_sid;
        END IF;
    END LOOP;

    RAISE NOTICE '[154] guard OK, target=NOCTE+Solenne, forbidden=Venisse+MiniGenios';
END $$;

-- ----------------------------------------------------------------
-- 1. Upsert carrier "Mike Vargas" on NOCTE and Solenne.
-- ----------------------------------------------------------------
DO $$
DECLARE
    v_target_stores UUID[] := ARRAY[
        '1eeaf2c7-2cd2-4257-8213-d90b1280a19d'::UUID,
        '0b3f13f8-d1dc-48a5-a707-27a095c9c545'::UUID
    ];
    v_forbidden_stores UUID[] := ARRAY[
        '6504d5bd-7bae-4081-9274-6305da432177'::UUID,
        '2b5a5638-a956-428a-8d1f-f6cb6a90d597'::UUID
    ];
    v_sid         UUID;
    v_carrier_id  UUID;
    v_created     BOOLEAN;
BEGIN
    FOREACH v_sid IN ARRAY v_target_stores LOOP
        IF v_sid = ANY (v_forbidden_stores) THEN
            RAISE EXCEPTION '[154] refusing to write carrier on forbidden store %', v_sid;
        END IF;

        SELECT id INTO v_carrier_id
          FROM carriers
         WHERE store_id = v_sid
           AND LOWER(TRIM(name)) = LOWER('Mike Vargas')
         LIMIT 1;

        IF v_carrier_id IS NULL THEN
            INSERT INTO carriers (store_id, name, phone, carrier_type, is_active)
            VALUES (v_sid, 'Mike Vargas', '', 'internal', TRUE)
            RETURNING id INTO v_carrier_id;
            v_created := TRUE;
        ELSE
            UPDATE carriers
               SET name         = 'Mike Vargas',
                   phone        = '',
                   carrier_type = 'internal',
                   is_active    = TRUE,
                   updated_at   = NOW()
             WHERE id = v_carrier_id
               AND (name         IS DISTINCT FROM 'Mike Vargas'
                 OR phone        IS DISTINCT FROM ''
                 OR carrier_type IS DISTINCT FROM 'internal'
                 OR is_active    IS DISTINCT FROM TRUE);
            v_created := FALSE;
        END IF;

        RAISE NOTICE '[154] carrier store=% id=% created=%',
                     v_sid, v_carrier_id, v_created;
    END LOOP;
END $$;

-- ----------------------------------------------------------------
-- 2. Upsert the 15 Gran Asunción coverage rows via the canonical
--    import_carrier_coverage() RPC. One call per store. Payload is
--    byte identical across the two stores. City names were pre
--    normalized against paraguay_locations and against the existing
--    carrier_coverage dictionary. No name invented.
-- ----------------------------------------------------------------
DO $$
DECLARE
    v_target_stores UUID[] := ARRAY[
        '1eeaf2c7-2cd2-4257-8213-d90b1280a19d'::UUID,
        '0b3f13f8-d1dc-48a5-a707-27a095c9c545'::UUID
    ];
    v_sid         UUID;
    v_carrier_id  UUID;
    v_imported    INT;
    v_coverage    JSONB := $json$[
        {"city": "Asunción",             "department": "ASUNCION", "rate": 25000},
        {"city": "Loma Pytá",            "department": "CENTRAL",  "rate": 25000},
        {"city": "Lambaré",              "department": "CENTRAL",  "rate": 25000},
        {"city": "Fernando de la Mora",  "department": "CENTRAL",  "rate": 25000},
        {"city": "Villa Elisa",          "department": "CENTRAL",  "rate": 25000},
        {"city": "Mariano Roque Alonso", "department": "CENTRAL",  "rate": 30000},
        {"city": "Luque",                "department": "CENTRAL",  "rate": 30000},
        {"city": "San Lorenzo",          "department": "CENTRAL",  "rate": 30000},
        {"city": "Ñemby",                "department": "CENTRAL",  "rate": 30000},
        {"city": "San Antonio",          "department": "CENTRAL",  "rate": 30000},
        {"city": "Limpio",               "department": "CENTRAL",  "rate": 35000},
        {"city": "Capiatá",              "department": "CENTRAL",  "rate": 35000},
        {"city": "Areguá",               "department": "CENTRAL",  "rate": 35000},
        {"city": "Ypané",                "department": "CENTRAL",  "rate": 35000},
        {"city": "J. Augusto Saldivar",  "department": "CENTRAL",  "rate": 35000}
    ]$json$;
BEGIN
    FOREACH v_sid IN ARRAY v_target_stores LOOP
        SELECT id INTO v_carrier_id
          FROM carriers
         WHERE store_id = v_sid
           AND LOWER(TRIM(name)) = LOWER('Mike Vargas')
           AND is_active = TRUE
         LIMIT 1;

        IF v_carrier_id IS NULL THEN
            RAISE EXCEPTION
                '[154] Mike Vargas carrier not found on store % after upsert',
                v_sid;
        END IF;

        v_imported := import_carrier_coverage(v_sid, v_carrier_id, v_coverage);

        IF v_imported <> 15 THEN
            RAISE EXCEPTION
                '[154] expected 15 coverage rows for store %, got %',
                v_sid, v_imported;
        END IF;

        RAISE NOTICE '[154] coverage store=% carrier=% rows=%',
                     v_sid, v_carrier_id, v_imported;
    END LOOP;
END $$;

-- ----------------------------------------------------------------
-- 3. Post apply verification. Uses the same RPC the checkout
--    endpoint consumes. 15 cities x 2 stores = 30 rate asserts.
--    If any rate drifts from the canonical value, the whole
--    transaction rolls back.
-- ----------------------------------------------------------------
DO $$
DECLARE
    v_expected JSONB := $json$[
        {"city": "Asunción",             "department": "ASUNCION", "rate": 25000},
        {"city": "Loma Pytá",            "department": "CENTRAL",  "rate": 25000},
        {"city": "Lambaré",              "department": "CENTRAL",  "rate": 25000},
        {"city": "Fernando de la Mora",  "department": "CENTRAL",  "rate": 25000},
        {"city": "Villa Elisa",          "department": "CENTRAL",  "rate": 25000},
        {"city": "Mariano Roque Alonso", "department": "CENTRAL",  "rate": 30000},
        {"city": "Luque",                "department": "CENTRAL",  "rate": 30000},
        {"city": "San Lorenzo",          "department": "CENTRAL",  "rate": 30000},
        {"city": "Ñemby",                "department": "CENTRAL",  "rate": 30000},
        {"city": "San Antonio",          "department": "CENTRAL",  "rate": 30000},
        {"city": "Limpio",               "department": "CENTRAL",  "rate": 35000},
        {"city": "Capiatá",              "department": "CENTRAL",  "rate": 35000},
        {"city": "Areguá",               "department": "CENTRAL",  "rate": 35000},
        {"city": "Ypané",                "department": "CENTRAL",  "rate": 35000},
        {"city": "J. Augusto Saldivar",  "department": "CENTRAL",  "rate": 35000}
    ]$json$;
    v_target_stores UUID[] := ARRAY[
        '1eeaf2c7-2cd2-4257-8213-d90b1280a19d'::UUID,
        '0b3f13f8-d1dc-48a5-a707-27a095c9c545'::UUID
    ];
    v_sid          UUID;
    v_carrier_id   UUID;
    v_item         JSONB;
    v_city         TEXT;
    v_department   TEXT;
    v_expected_rt  NUMERIC;
    v_actual_rt    NUMERIC;
    v_fail_count   INT := 0;
BEGIN
    FOREACH v_sid IN ARRAY v_target_stores LOOP
        SELECT id INTO v_carrier_id
          FROM carriers
         WHERE store_id = v_sid
           AND LOWER(TRIM(name)) = LOWER('Mike Vargas')
           AND is_active = TRUE
         LIMIT 1;

        IF v_carrier_id IS NULL THEN
            RAISE EXCEPTION '[154] verification: carrier not found on store %', v_sid;
        END IF;

        FOR v_item IN SELECT * FROM jsonb_array_elements(v_expected) LOOP
            v_city        := v_item->>'city';
            v_department  := v_item->>'department';
            v_expected_rt := (v_item->>'rate')::NUMERIC;

            v_actual_rt := get_carrier_rate_for_city(v_carrier_id, v_city, v_department);

            IF v_actual_rt IS DISTINCT FROM v_expected_rt THEN
                v_fail_count := v_fail_count + 1;
                RAISE WARNING
                    '[154] FAIL store=% city=% dept=% expected=% actual=%',
                    v_sid, v_city, v_department, v_expected_rt, v_actual_rt;
            ELSE
                RAISE NOTICE
                    '[154] PASS store=% city=% rate=%',
                    v_sid, v_city, v_actual_rt;
            END IF;
        END LOOP;
    END LOOP;

    IF v_fail_count > 0 THEN
        RAISE EXCEPTION '[154] % rate verification(s) failed, rolling back', v_fail_count;
    END IF;

    RAISE NOTICE '[154] 30/30 rate verifications passed';
END $$;

-- ----------------------------------------------------------------
-- 4. Out of scope sanity check. Encarnación must resolve to Lucero
--    del este with a rate on both target stores, and must NOT
--    resolve to Mike Vargas with has_coverage = TRUE. This proves
--    the checkout routes correctly and that the 15 city scope is
--    enforced.
-- ----------------------------------------------------------------
DO $$
DECLARE
    v_target_stores UUID[] := ARRAY[
        '1eeaf2c7-2cd2-4257-8213-d90b1280a19d'::UUID,
        '0b3f13f8-d1dc-48a5-a707-27a095c9c545'::UUID
    ];
    v_sid         UUID;
    v_lucero_ok   BOOLEAN;
    v_mike_leak   BOOLEAN;
BEGIN
    FOREACH v_sid IN ARRAY v_target_stores LOOP
        SELECT TRUE
          INTO v_lucero_ok
          FROM get_carriers_for_city(v_sid, 'Encarnación') r
         WHERE LOWER(r.carrier_name) LIKE '%lucero del este%'
           AND r.has_coverage = TRUE
           AND r.rate IS NOT NULL
         LIMIT 1;

        IF NOT COALESCE(v_lucero_ok, FALSE) THEN
            RAISE EXCEPTION
                '[154] out of scope check failed on store %: Lucero del este does not resolve for Encarnación',
                v_sid;
        END IF;

        SELECT TRUE
          INTO v_mike_leak
          FROM get_carriers_for_city(v_sid, 'Encarnación') r
         WHERE LOWER(r.carrier_name) = LOWER('Mike Vargas')
           AND r.has_coverage = TRUE
         LIMIT 1;

        IF COALESCE(v_mike_leak, FALSE) THEN
            RAISE EXCEPTION
                '[154] out of scope check failed on store %: Mike Vargas leaked into Encarnación with has_coverage=true',
                v_sid;
        END IF;

        v_lucero_ok := NULL;
        v_mike_leak := NULL;

        RAISE NOTICE '[154] out of scope PASS store=% Encarnación routes to Lucero, not Mike', v_sid;
    END LOOP;
END $$;

-- ----------------------------------------------------------------
-- 5. Coexistence check. For Asunción, San Lorenzo, and Capiatá
--    (three Gran Asunción cities served by all three internal
--    carriers), get_carriers_for_city must return Lucero del este,
--    Orlando Nuñez, and Mike Vargas, all active and all with a
--    rate. The buyer must be able to pick.
-- ----------------------------------------------------------------
DO $$
DECLARE
    v_target_stores UUID[] := ARRAY[
        '1eeaf2c7-2cd2-4257-8213-d90b1280a19d'::UUID,
        '0b3f13f8-d1dc-48a5-a707-27a095c9c545'::UUID
    ];
    v_shared_cities TEXT[] := ARRAY['Asunción', 'San Lorenzo', 'Capiatá'];
    v_sid       UUID;
    v_city      TEXT;
    v_count_all INT;
BEGIN
    FOREACH v_sid IN ARRAY v_target_stores LOOP
        FOREACH v_city IN ARRAY v_shared_cities LOOP
            SELECT COUNT(*) INTO v_count_all
              FROM get_carriers_for_city(v_sid, v_city) r
             WHERE r.has_coverage = TRUE
               AND r.rate IS NOT NULL
               AND LOWER(r.carrier_name) IN (
                   LOWER('Lucero del este'),
                   LOWER('Orlando Nuñez'),
                   LOWER('Mike Vargas')
               );

            IF v_count_all < 3 THEN
                RAISE EXCEPTION
                    '[154] coexistence check failed store=% city=% expected 3 carriers with rate, got %',
                    v_sid, v_city, v_count_all;
            END IF;

            RAISE NOTICE '[154] coexistence PASS store=% city=% carriers_with_rate=%',
                         v_sid, v_city, v_count_all;
        END LOOP;
    END LOOP;
END $$;

-- ----------------------------------------------------------------
-- 6. Forbidden store sweep. Guarantees the migration did not touch
--    Venisse or MiniGenios. If any row landed on those stores for
--    a "Mike Vargas" carrier, raise and roll back.
-- ----------------------------------------------------------------
DO $$
DECLARE
    v_forbidden_stores UUID[] := ARRAY[
        '6504d5bd-7bae-4081-9274-6305da432177'::UUID,
        '2b5a5638-a956-428a-8d1f-f6cb6a90d597'::UUID
    ];
    v_bad INT;
BEGIN
    SELECT COUNT(*) INTO v_bad
      FROM carriers
     WHERE store_id = ANY (v_forbidden_stores)
       AND LOWER(TRIM(name)) = LOWER('Mike Vargas');

    IF v_bad > 0 THEN
        RAISE EXCEPTION
            '[154] forbidden store leak: found % Mike Vargas carrier row(s) on Venisse/MiniGenios',
            v_bad;
    END IF;

    SELECT COUNT(*) INTO v_bad
      FROM carrier_coverage cc
      JOIN carriers c ON c.id = cc.carrier_id
     WHERE c.store_id = ANY (v_forbidden_stores)
       AND LOWER(TRIM(c.name)) = LOWER('Mike Vargas');

    IF v_bad > 0 THEN
        RAISE EXCEPTION
            '[154] forbidden store leak: found % Mike Vargas coverage row(s) on Venisse/MiniGenios',
            v_bad;
    END IF;

    RAISE NOTICE '[154] forbidden store sweep clean, Venisse and MiniGenios untouched';
END $$;

COMMIT;

-- ================================================================
-- MIGRATION 154 COMPLETED
-- ================================================================
-- Changes applied:
--   - Created carrier "Mike Vargas" on NOCTE and Solenne
--     (phone='', carrier_type='internal', is_active=true)
--   - Upserted 15 Gran Asunción coverage rows per store (PYG)
--   - Verified 30/30 rates live via get_carrier_rate_for_city
--   - Verified Encarnación routes to Lucero del este and NOT to
--     Mike Vargas on both stores
--   - Verified coexistence: Asunción, San Lorenzo, Capiatá resolve
--     to Lucero del este + Orlando Nuñez + Mike Vargas on both stores
--   - Swept Venisse and MiniGenios, zero Mike Vargas footprint
--
-- Pending commercial decisions (flagged to Gaston):
--   - Zeballos Cue (16th city provided): not in paraguay_locations
--     and not in any carrier_coverage row of any carrier. Options:
--     (a) add as new CENTRAL row in paraguay_locations (dictionary fork),
--     (b) route to Asunción and share the 25000 Mike Vargas rate (zero new rows),
--     (c) leave out and rely on checkout fallback.
--     Recommended: (b). Same rate, no dictionary fork, matches the
--     geographic reality that Zeballos Cue is a northern Asunción barrio.
--   - Real phone number for Mike Vargas (currently empty string,
--     parity with Lucero and Orlando Nuñez shape).
-- ================================================================

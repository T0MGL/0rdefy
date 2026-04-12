-- ================================================================
-- MIGRATION 153: Orlando Nuñez carrier for NOCTE + Solenne
--                (Gran Asunción, 10 cities)
-- ================================================================
-- Date: 2026-04-11
-- Author: ordefy-ceo
-- Priority: HIGH (second carrier for NOCTE + Solenne, closes a
--                 coverage gap where the Gran Asunción belt has a
--                 cheaper option than Lucero del Este for the 10
--                 cities the courier actually services.)
--
-- SCOPE (hard locked): exactly two store ids.
--   - NOCTE    1eeaf2c7-2cd2-4257-8213-d90b1280a19d
--   - Solenne  0b3f13f8-d1dc-48a5-a707-27a095c9c545
--
-- OUT OF SCOPE (must never appear in any INSERT/UPDATE here):
--   - Venisse     6504d5bd-7bae-4081-9274-6305da432177
--   - MiniGenios  2b5a5638-a956-428a-8d1f-f6cb6a90d597
--   Richard Figueredo does not operate with this courier. Any drift
--   that lets a Richard store id into this migration raises and
--   rolls back the whole transaction.
--
-- DIFFERENCE VS LUCERO DEL ESTE:
--   Lucero del Este is a full country carrier (266 rows per store,
--   59 with a rate, covering Asunción, Central, Alto Paraná, Itapúa,
--   Concepción, Amambay, Guairá, Canindeyú, Cordillera, Caaguazú).
--   Orlando Nuñez is a Gran Asunción only operator with exactly
--   10 serviced cities. Migration 153 does NOT clone the Lucero
--   baseline. The other 256 cities intentionally hold NO coverage
--   row for Orlando Nuñez, so get_carriers_for_city resolves Lucero
--   del Este as the only option for any city outside the 10
--   serviced ones. Verified live post-apply with Encarnación:
--   Lucero del este has_coverage=true, Orlando Nuñez has_coverage=
--   false on both stores.
--
-- RATES (PYG, provided by Gaston, canonical city names normalized
--        against the existing NOCTE carrier_coverage dictionary via
--        ILIKE matches before writing):
--
--     Asunción              ASUNCION   15000
--     Fernando de la Mora   CENTRAL    20000
--     San Lorenzo           CENTRAL    25000
--     Lambaré               CENTRAL    30000
--     Mariano Roque Alonso  CENTRAL    35000
--     Ñemby                 CENTRAL    35000
--     Ypané                 CENTRAL    55000
--     Limpio                CENTRAL    45000
--     Itauguá               CENTRAL    45000
--     Capiatá               CENTRAL    30000
--
-- PARITY WITH LUCERO SHAPE:
--   name         = 'Orlando Nuñez'     (real ñ, single casing)
--   phone        = ''                   (not NULL, matches NOCTE Lucero)
--   carrier_type = 'internal'           (matches NOCTE Lucero)
--   is_active    = TRUE
--
-- IDEMPOTENCY:
--   - Carrier creation is guarded by a (store_id, LOWER(name)) lookup
--     so re-running does not create duplicates. If the carrier
--     already exists on a store, its row is normalized to the
--     canonical name, phone, carrier_type, is_active shape.
--   - Coverage rows use import_carrier_coverage() which upserts by
--     (carrier_id, LOWER(city), LOWER(COALESCE(department,''))).
--
-- DEPLOYMENT:
--   Applied live on 2026-04-11 via Supabase REST + service role
--   (POST /rest/v1/carriers + POST /rest/v1/rpc/import_carrier_coverage)
--   during the Orlando Nuñez onboarding pass. This .sql is the
--   canonical audit trail and is re-runnable against any restore
--   or fresh environment.
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
                '[153] target store % missing, inactive, or not PY/PYG. Aborting.',
                v_sid;
        END IF;
    END LOOP;

    FOREACH v_sid IN ARRAY v_forbidden_stores LOOP
        IF v_sid = ANY (v_target_stores) THEN
            RAISE EXCEPTION
                '[153] forbidden store % leaked into target set. Aborting.',
                v_sid;
        END IF;
    END LOOP;

    RAISE NOTICE '[153] guard OK, target=NOCTE+Solenne, forbidden=Venisse+MiniGenios';
END $$;

-- ----------------------------------------------------------------
-- 1. Upsert carrier "Orlando Nuñez" on NOCTE and Solenne with
--    byte exact parity to the NOCTE Lucero shape.
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
        -- Defense in depth, reject any forbidden id that slipped in
        IF v_sid = ANY (v_forbidden_stores) THEN
            RAISE EXCEPTION '[153] refusing to write carrier on forbidden store %', v_sid;
        END IF;

        SELECT id INTO v_carrier_id
          FROM carriers
         WHERE store_id = v_sid
           AND LOWER(TRIM(name)) = LOWER('Orlando Nuñez')
         LIMIT 1;

        IF v_carrier_id IS NULL THEN
            INSERT INTO carriers (store_id, name, phone, carrier_type, is_active)
            VALUES (v_sid, 'Orlando Nuñez', '', 'internal', TRUE)
            RETURNING id INTO v_carrier_id;
            v_created := TRUE;
        ELSE
            UPDATE carriers
               SET name         = 'Orlando Nuñez',
                   phone        = '',
                   carrier_type = 'internal',
                   is_active    = TRUE,
                   updated_at   = NOW()
             WHERE id = v_carrier_id
               AND (name         IS DISTINCT FROM 'Orlando Nuñez'
                 OR phone        IS DISTINCT FROM ''
                 OR carrier_type IS DISTINCT FROM 'internal'
                 OR is_active    IS DISTINCT FROM TRUE);
            v_created := FALSE;
        END IF;

        RAISE NOTICE '[153] carrier store=% id=% created=%',
                     v_sid, v_carrier_id, v_created;
    END LOOP;
END $$;

-- ----------------------------------------------------------------
-- 2. Upsert the 10 Gran Asunción coverage rows via the canonical
--    import_carrier_coverage() RPC. One call per store. Payload is
--    byte identical across the two stores. City names were
--    pre normalized against the existing NOCTE Lucero coverage
--    dictionary before this migration was written. No name invented.
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
        {"city": "Asunción",            "department": "ASUNCION", "rate": 15000},
        {"city": "Fernando de la Mora", "department": "CENTRAL",  "rate": 20000},
        {"city": "San Lorenzo",         "department": "CENTRAL",  "rate": 25000},
        {"city": "Lambaré",             "department": "CENTRAL",  "rate": 30000},
        {"city": "Mariano Roque Alonso","department": "CENTRAL",  "rate": 35000},
        {"city": "Ñemby",               "department": "CENTRAL",  "rate": 35000},
        {"city": "Ypané",               "department": "CENTRAL",  "rate": 55000},
        {"city": "Limpio",              "department": "CENTRAL",  "rate": 45000},
        {"city": "Itauguá",             "department": "CENTRAL",  "rate": 45000},
        {"city": "Capiatá",             "department": "CENTRAL",  "rate": 30000}
    ]$json$;
BEGIN
    FOREACH v_sid IN ARRAY v_target_stores LOOP
        SELECT id INTO v_carrier_id
          FROM carriers
         WHERE store_id = v_sid
           AND LOWER(TRIM(name)) = LOWER('Orlando Nuñez')
           AND is_active = TRUE
         LIMIT 1;

        IF v_carrier_id IS NULL THEN
            RAISE EXCEPTION
                '[153] Orlando Nuñez carrier not found on store % after upsert',
                v_sid;
        END IF;

        v_imported := import_carrier_coverage(v_sid, v_carrier_id, v_coverage);

        IF v_imported <> 10 THEN
            RAISE EXCEPTION
                '[153] expected 10 coverage rows for store %, got %',
                v_sid, v_imported;
        END IF;

        RAISE NOTICE '[153] coverage store=% carrier=% rows=%',
                     v_sid, v_carrier_id, v_imported;
    END LOOP;
END $$;

-- ----------------------------------------------------------------
-- 3. Post apply verification. Uses the same RPC the checkout
--    endpoint consumes. 10 cities x 2 stores = 20 rate asserts.
--    If any rate drifts from the canonical value, the whole
--    transaction rolls back.
-- ----------------------------------------------------------------
DO $$
DECLARE
    v_expected JSONB := $json$[
        {"city": "Asunción",            "department": "ASUNCION", "rate": 15000},
        {"city": "Fernando de la Mora", "department": "CENTRAL",  "rate": 20000},
        {"city": "San Lorenzo",         "department": "CENTRAL",  "rate": 25000},
        {"city": "Lambaré",             "department": "CENTRAL",  "rate": 30000},
        {"city": "Mariano Roque Alonso","department": "CENTRAL",  "rate": 35000},
        {"city": "Ñemby",               "department": "CENTRAL",  "rate": 35000},
        {"city": "Ypané",               "department": "CENTRAL",  "rate": 55000},
        {"city": "Limpio",              "department": "CENTRAL",  "rate": 45000},
        {"city": "Itauguá",             "department": "CENTRAL",  "rate": 45000},
        {"city": "Capiatá",             "department": "CENTRAL",  "rate": 30000}
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
           AND LOWER(TRIM(name)) = LOWER('Orlando Nuñez')
           AND is_active = TRUE
         LIMIT 1;

        IF v_carrier_id IS NULL THEN
            RAISE EXCEPTION '[153] verification: carrier not found on store %', v_sid;
        END IF;

        FOR v_item IN SELECT * FROM jsonb_array_elements(v_expected) LOOP
            v_city        := v_item->>'city';
            v_department  := v_item->>'department';
            v_expected_rt := (v_item->>'rate')::NUMERIC;

            v_actual_rt := get_carrier_rate_for_city(v_carrier_id, v_city, v_department);

            IF v_actual_rt IS DISTINCT FROM v_expected_rt THEN
                v_fail_count := v_fail_count + 1;
                RAISE WARNING
                    '[153] FAIL store=% city=% dept=% expected=% actual=%',
                    v_sid, v_city, v_department, v_expected_rt, v_actual_rt;
            ELSE
                RAISE NOTICE
                    '[153] PASS store=% city=% rate=%',
                    v_sid, v_city, v_actual_rt;
            END IF;
        END LOOP;
    END LOOP;

    IF v_fail_count > 0 THEN
        RAISE EXCEPTION '[153] % rate verification(s) failed, rolling back', v_fail_count;
    END IF;

    RAISE NOTICE '[153] 20/20 rate verifications passed';
END $$;

-- ----------------------------------------------------------------
-- 4. Out of scope sanity check. Encarnación must resolve to
--    Lucero del Este with a rate on both target stores, and must
--    NOT resolve to Orlando Nuñez with has_coverage = TRUE. This
--    proves the checkout routes correctly by city and that the
--    deliberate 10 city scope is enforced.
-- ----------------------------------------------------------------
DO $$
DECLARE
    v_target_stores UUID[] := ARRAY[
        '1eeaf2c7-2cd2-4257-8213-d90b1280a19d'::UUID,
        '0b3f13f8-d1dc-48a5-a707-27a095c9c545'::UUID
    ];
    v_sid           UUID;
    v_lucero_ok     BOOLEAN;
    v_orlando_leak  BOOLEAN;
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
                '[153] out of scope check failed on store %: Lucero del este does not resolve for Encarnación',
                v_sid;
        END IF;

        SELECT TRUE
          INTO v_orlando_leak
          FROM get_carriers_for_city(v_sid, 'Encarnación') r
         WHERE LOWER(r.carrier_name) = LOWER('Orlando Nuñez')
           AND r.has_coverage = TRUE
         LIMIT 1;

        IF COALESCE(v_orlando_leak, FALSE) THEN
            RAISE EXCEPTION
                '[153] out of scope check failed on store %: Orlando Nuñez leaked into Encarnación with has_coverage=true',
                v_sid;
        END IF;

        v_lucero_ok    := NULL;
        v_orlando_leak := NULL;

        RAISE NOTICE '[153] out of scope PASS store=% Encarnación routes to Lucero, not Orlando', v_sid;
    END LOOP;
END $$;

-- ----------------------------------------------------------------
-- 5. Forbidden store sweep. Guarantees the migration did not touch
--    Venisse or MiniGenios. If any row landed on those stores for
--    an "Orlando Nuñez" carrier, raise and roll back.
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
       AND LOWER(TRIM(name)) = LOWER('Orlando Nuñez');

    IF v_bad > 0 THEN
        RAISE EXCEPTION
            '[153] forbidden store leak: found % Orlando Nuñez carrier row(s) on Venisse/MiniGenios',
            v_bad;
    END IF;

    SELECT COUNT(*) INTO v_bad
      FROM carrier_coverage cc
      JOIN carriers c ON c.id = cc.carrier_id
     WHERE c.store_id = ANY (v_forbidden_stores)
       AND LOWER(TRIM(c.name)) = LOWER('Orlando Nuñez');

    IF v_bad > 0 THEN
        RAISE EXCEPTION
            '[153] forbidden store leak: found % Orlando Nuñez coverage row(s) on Venisse/MiniGenios',
            v_bad;
    END IF;

    RAISE NOTICE '[153] forbidden store sweep clean, Venisse and MiniGenios untouched';
END $$;

COMMIT;

-- ================================================================
-- MIGRATION 153 COMPLETED
-- ================================================================
-- Changes applied:
--   - Created carrier "Orlando Nuñez" on NOCTE and Solenne
--     (phone='', carrier_type='internal', is_active=true, real ñ)
--   - Upserted 10 Gran Asunción coverage rows per store (PYG)
--   - Verified 20/20 rates live via get_carrier_rate_for_city
--   - Verified Encarnación routes to Lucero del Este and NOT to
--     Orlando Nuñez on both stores
--   - Swept Venisse and MiniGenios, zero Orlando Nuñez footprint
--
-- Pending commercial decisions (flagged to Gaston):
--   - Real phone number for Orlando Nuñez (currently empty string,
--     parity with Lucero shape, needs a real courier contact)
-- ================================================================

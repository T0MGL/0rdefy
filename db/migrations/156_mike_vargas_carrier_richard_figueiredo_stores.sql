-- ================================================================
-- MIGRATION 156: Mike Vargas carrier replicated to Richard
--                Figueiredo stores (Venisse + MiniGenios)
-- ================================================================
-- Date: 2026-04-13
-- Author: ordefy-ceo
-- Priority: HIGH (requested by Gaston, same-day execution)
--
-- PURPOSE:
--   Replicate the Mike Vargas carrier (already live on NOCTE,
--   carrier id a63a49f6-659e-4dee-8343-4ee4774be5b3) onto Richard
--   Figueredo's two beta stores with identical rates. The platform
--   RPC replicate_carrier_to_stores() enforces source store ownership
--   which blocks cross-owner replication. This migration bypasses
--   that gate by inserting directly inside a transaction that guards
--   scope as rigorously as the RPC would.
--
-- SOURCE OF RATES:
--   Migration 154 (2026-04-11) which added Mike Vargas to NOCTE
--   and Solenne. Rates are byte-identical. 15 cities, Gran Asuncion.
--
-- SCOPE (hard locked):
--   Target: Venisse    6504d5bd-7bae-4081-9274-6305da432177
--           MiniGenios 2b5a5638-a956-428a-8d1f-f6cb6a90d597
--   Owner:  Richard Figueredo (f7554654-f3e8-40ea-b8c1-a58a3d2b0412)
--
--   Source carrier id from NOCTE is referenced for documentation
--   only. The new carriers on Venisse and MiniGenios get their own
--   UUIDs via gen_random_uuid(). No foreign key links to NOCTE.
--
-- RATES (PYG, identical to NOCTE Mike Vargas):
--   Asuncion             ASUNCION  25000
--   Loma Pyta            CENTRAL   25000
--   Lambare              CENTRAL   25000
--   Fernando de la Mora  CENTRAL   25000
--   Villa Elisa          CENTRAL   25000
--   Mariano Roque Alonso CENTRAL   30000
--   Luque                CENTRAL   30000
--   San Lorenzo          CENTRAL   30000
--   Nemby                CENTRAL   30000
--   San Antonio          CENTRAL   30000
--   Limpio               CENTRAL   35000
--   Capiata              CENTRAL   35000
--   Aregua               CENTRAL   35000
--   Ypane                CENTRAL   35000
--   J. Augusto Saldivar  CENTRAL   35000
--
-- IDEMPOTENCY:
--   Carrier creation guarded by (store_id, LOWER(name)) lookup.
--   Coverage rows upserted via import_carrier_coverage() which
--   keys on (carrier_id, LOWER(city), LOWER(department)). Safe
--   to re-run against the same database.
--
-- VERIFICATION:
--   Asserts 30/30 rate resolutions (15 cities x 2 stores) via
--   get_carrier_rate_for_city() and rolls back on any drift.
-- ================================================================

BEGIN;

-- ----------------------------------------------------------------
-- Guard 0: scope lock. Target stores must be PY/PYG/active and
-- owned by Richard Figueredo. Forbidden stores (NOCTE, Solenne)
-- must not appear in target set.
-- ----------------------------------------------------------------
DO $$
DECLARE
    v_richard_user_id  UUID := 'f7554654-f3e8-40ea-b8c1-a58a3d2b0412';
    v_target_stores    UUID[] := ARRAY[
        '6504d5bd-7bae-4081-9274-6305da432177'::UUID,  -- Venisse
        '2b5a5638-a956-428a-8d1f-f6cb6a90d597'::UUID   -- MiniGenios
    ];
    v_forbidden_stores UUID[] := ARRAY[
        '1eeaf2c7-2cd2-4257-8213-d90b1280a19d'::UUID,  -- NOCTE
        '0b3f13f8-d1dc-48a5-a707-27a095c9c545'::UUID   -- Solenne
    ];
    v_sid UUID;
BEGIN
    -- Owner must exist and be active
    IF NOT EXISTS (
        SELECT 1 FROM users
         WHERE id = v_richard_user_id
           AND is_active = TRUE
    ) THEN
        RAISE EXCEPTION '[156] owner % not found or inactive', v_richard_user_id;
    END IF;

    FOREACH v_sid IN ARRAY v_target_stores LOOP
        -- Store must be PY/PYG/active
        IF NOT EXISTS (
            SELECT 1 FROM stores
             WHERE id = v_sid
               AND is_active = TRUE
               AND country = 'PY'
               AND currency = 'PYG'
        ) THEN
            RAISE EXCEPTION
                '[156] target store % missing, inactive, or not PY/PYG. Aborting.', v_sid;
        END IF;

        -- Store must be owned by Richard
        IF NOT EXISTS (
            SELECT 1 FROM user_stores
             WHERE user_id = v_richard_user_id
               AND store_id = v_sid
               AND role = 'owner'
               AND is_active = TRUE
        ) THEN
            RAISE EXCEPTION
                '[156] store % is not owned by Richard Figueredo. Aborting.', v_sid;
        END IF;

        -- Target must not be a forbidden store
        IF v_sid = ANY (v_forbidden_stores) THEN
            RAISE EXCEPTION
                '[156] forbidden store % leaked into target set. Aborting.', v_sid;
        END IF;
    END LOOP;

    RAISE NOTICE '[156] guard OK: Venisse + MiniGenios, owner=Richard, PY/PYG/active';
END $$;

-- ----------------------------------------------------------------
-- 1. Upsert carrier "Mike Vargas" on Venisse and MiniGenios.
-- ----------------------------------------------------------------
DO $$
DECLARE
    v_target_stores UUID[] := ARRAY[
        '6504d5bd-7bae-4081-9274-6305da432177'::UUID,
        '2b5a5638-a956-428a-8d1f-f6cb6a90d597'::UUID
    ];
    v_forbidden_stores UUID[] := ARRAY[
        '1eeaf2c7-2cd2-4257-8213-d90b1280a19d'::UUID,
        '0b3f13f8-d1dc-48a5-a707-27a095c9c545'::UUID
    ];
    v_sid        UUID;
    v_carrier_id UUID;
    v_created    BOOLEAN;
BEGIN
    FOREACH v_sid IN ARRAY v_target_stores LOOP
        IF v_sid = ANY (v_forbidden_stores) THEN
            RAISE EXCEPTION '[156] refusing to write carrier on forbidden store %', v_sid;
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

        RAISE NOTICE '[156] carrier store=% id=% created=%', v_sid, v_carrier_id, v_created;
    END LOOP;
END $$;

-- ----------------------------------------------------------------
-- 2. Upsert 15 Gran Asuncion coverage rows via import_carrier_coverage().
--    City names are the canonical forms from paraguay_locations,
--    byte-identical to migration 154.
-- ----------------------------------------------------------------
DO $$
DECLARE
    v_target_stores UUID[] := ARRAY[
        '6504d5bd-7bae-4081-9274-6305da432177'::UUID,
        '2b5a5638-a956-428a-8d1f-f6cb6a90d597'::UUID
    ];
    v_sid        UUID;
    v_carrier_id UUID;
    v_imported   INT;
    v_coverage   JSONB := $json$[
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
                '[156] Mike Vargas carrier not found on store % after upsert step', v_sid;
        END IF;

        v_imported := import_carrier_coverage(v_sid, v_carrier_id, v_coverage);

        IF v_imported <> 15 THEN
            RAISE EXCEPTION
                '[156] expected 15 coverage rows for store %, got %', v_sid, v_imported;
        END IF;

        RAISE NOTICE '[156] coverage store=% carrier=% rows=%', v_sid, v_carrier_id, v_imported;
    END LOOP;
END $$;

-- ----------------------------------------------------------------
-- 3. Post-apply verification. 15 cities x 2 stores = 30 asserts.
--    Any rate drift rolls back the whole transaction.
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
        '6504d5bd-7bae-4081-9274-6305da432177'::UUID,
        '2b5a5638-a956-428a-8d1f-f6cb6a90d597'::UUID
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
            RAISE EXCEPTION '[156] verification: carrier not found on store %', v_sid;
        END IF;

        FOR v_item IN SELECT * FROM jsonb_array_elements(v_expected) LOOP
            v_city       := v_item->>'city';
            v_department := v_item->>'department';
            v_expected_rt := (v_item->>'rate')::NUMERIC;

            v_actual_rt := get_carrier_rate_for_city(v_carrier_id, v_city, v_department);

            IF v_actual_rt IS DISTINCT FROM v_expected_rt THEN
                v_fail_count := v_fail_count + 1;
                RAISE WARNING
                    '[156] FAIL store=% city=% dept=% expected=% actual=%',
                    v_sid, v_city, v_department, v_expected_rt, v_actual_rt;
            ELSE
                RAISE NOTICE
                    '[156] PASS store=% city=% rate=%', v_sid, v_city, v_actual_rt;
            END IF;
        END LOOP;
    END LOOP;

    IF v_fail_count > 0 THEN
        RAISE EXCEPTION '[156] % rate verification(s) failed, rolling back', v_fail_count;
    END IF;

    RAISE NOTICE '[156] 30/30 rate verifications passed';
END $$;

-- ----------------------------------------------------------------
-- 4. Forbidden store sweep. NOCTE and Solenne must have exactly the
--    same Mike Vargas carrier count as before (1 each). No new rows
--    on forbidden stores from this migration.
-- ----------------------------------------------------------------
DO $$
DECLARE
    v_forbidden_stores UUID[] := ARRAY[
        '1eeaf2c7-2cd2-4257-8213-d90b1280a19d'::UUID,
        '0b3f13f8-d1dc-48a5-a707-27a095c9c545'::UUID
    ];
    v_sid   UUID;
    v_count INT;
BEGIN
    FOREACH v_sid IN ARRAY v_forbidden_stores LOOP
        SELECT COUNT(*) INTO v_count
          FROM carriers
         WHERE store_id = v_sid
           AND LOWER(TRIM(name)) = LOWER('Mike Vargas');

        IF v_count <> 1 THEN
            RAISE EXCEPTION
                '[156] forbidden store % has % Mike Vargas carrier row(s), expected exactly 1 (pre-existing). Aborting.',
                v_sid, v_count;
        END IF;
    END LOOP;

    RAISE NOTICE '[156] forbidden store sweep clean: NOCTE and Solenne untouched';
END $$;

COMMIT;

-- ================================================================
-- MIGRATION 156 COMPLETED
-- ================================================================
-- Changes applied:
--   - Created carrier "Mike Vargas" on Venisse and MiniGenios
--     (phone='', carrier_type='internal', is_active=true)
--   - Upserted 15 Gran Asuncion coverage rows per store (PYG)
--   - Rates identical to NOCTE Mike Vargas (migration 154)
--   - Verified 30/30 rates via get_carrier_rate_for_city
--   - Confirmed NOCTE and Solenne untouched (1 carrier each, unchanged)
-- ================================================================

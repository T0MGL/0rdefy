-- ================================================================
-- MIGRATION 109: Add Carrier Adrian Torales for NOCTE Store
-- ================================================================
-- Purpose: Add new delivery person "Adrian Torales" with zone-based
-- rates for the store NOCTE
--
-- Store: NOCTE
-- Store ID: 1eeaf2c7-2cd2-4257-8213-d90b1280a19d
--
-- IDEMPOTENT: Safe to run multiple times
-- PRODUCTION-READY: Hardcoded UUIDs, proper conflict handling
-- ================================================================

BEGIN;

-- ================================================================
-- CONFIGURATION
-- ================================================================
DO $$
DECLARE
    -- NOCTE store UUID (verified from migration 091)
    v_store_id UUID := '1eeaf2c7-2cd2-4257-8213-d90b1280a19d';
    v_carrier_id UUID;
    v_carrier_name TEXT := 'Adrian Torales';
    v_existing_count INT;
BEGIN
    -- ============================================================
    -- VALIDATION: Ensure store exists
    -- ============================================================
    IF NOT EXISTS (SELECT 1 FROM stores WHERE id = v_store_id) THEN
        RAISE EXCEPTION 'Store NOCTE (%) not found. Migration aborted.', v_store_id;
    END IF;

    RAISE NOTICE 'Store NOCTE found. Proceeding with carrier creation...';

    -- ============================================================
    -- CHECK FOR EXISTING CARRIER
    -- ============================================================
    SELECT id INTO v_carrier_id
    FROM carriers
    WHERE store_id = v_store_id
      AND LOWER(TRIM(name)) = LOWER(TRIM(v_carrier_name));

    IF v_carrier_id IS NOT NULL THEN
        RAISE NOTICE 'Carrier "%" already exists with ID: %. Skipping creation.', v_carrier_name, v_carrier_id;
    ELSE
        -- ============================================================
        -- CREATE CARRIER
        -- ============================================================
        INSERT INTO carriers (
            store_id,
            name,
            phone,
            vehicle_type,
            carrier_type,
            is_active,
            notes,
            created_at,
            updated_at
        ) VALUES (
            v_store_id,
            v_carrier_name,
            NULL,
            'moto',
            'internal',
            TRUE,
            'Agregado via migración 109 - Enero 2026',
            NOW(),
            NOW()
        )
        RETURNING id INTO v_carrier_id;

        RAISE NOTICE 'Created carrier "%" with ID: %', v_carrier_name, v_carrier_id;
    END IF;

    -- ============================================================
    -- INSERT ZONES (using ON CONFLICT for idempotency)
    -- ============================================================
    -- The UNIQUE constraint on carrier_zones(carrier_id, zone_name)
    -- ensures ON CONFLICT DO UPDATE works correctly

    -- Asunción y zonas cercanas (15.000 Gs)
    INSERT INTO carrier_zones (store_id, carrier_id, zone_name, zone_code, rate, is_active)
    VALUES (v_store_id, v_carrier_id, 'Asunción', 'ASU', 15000.00, TRUE)
    ON CONFLICT (carrier_id, zone_name) DO UPDATE SET rate = EXCLUDED.rate, is_active = TRUE, updated_at = NOW();

    INSERT INTO carrier_zones (store_id, carrier_id, zone_name, zone_code, rate, is_active)
    VALUES (v_store_id, v_carrier_id, 'Sajonia', 'SAJ', 15000.00, TRUE)
    ON CONFLICT (carrier_id, zone_name) DO UPDATE SET rate = EXCLUDED.rate, is_active = TRUE, updated_at = NOW();

    INSERT INTO carrier_zones (store_id, carrier_id, zone_name, zone_code, rate, is_active)
    VALUES (v_store_id, v_carrier_id, 'Lambaré', 'LAM', 15000.00, TRUE)
    ON CONFLICT (carrier_id, zone_name) DO UPDATE SET rate = EXCLUDED.rate, is_active = TRUE, updated_at = NOW();

    INSERT INTO carrier_zones (store_id, carrier_id, zone_name, zone_code, rate, is_active)
    VALUES (v_store_id, v_carrier_id, 'Botánico', 'BOT', 15000.00, TRUE)
    ON CONFLICT (carrier_id, zone_name) DO UPDATE SET rate = EXCLUDED.rate, is_active = TRUE, updated_at = NOW();

    -- Fernando de la Mora, San Lorenzo, Villa Elisa, San Antonio, Ñemby (20.000 Gs)
    INSERT INTO carrier_zones (store_id, carrier_id, zone_name, zone_code, rate, is_active)
    VALUES (v_store_id, v_carrier_id, 'Fernando de la Mora', 'FDM', 20000.00, TRUE)
    ON CONFLICT (carrier_id, zone_name) DO UPDATE SET rate = EXCLUDED.rate, is_active = TRUE, updated_at = NOW();

    INSERT INTO carrier_zones (store_id, carrier_id, zone_name, zone_code, rate, is_active)
    VALUES (v_store_id, v_carrier_id, 'San Lorenzo', 'SLO', 20000.00, TRUE)
    ON CONFLICT (carrier_id, zone_name) DO UPDATE SET rate = EXCLUDED.rate, is_active = TRUE, updated_at = NOW();

    INSERT INTO carrier_zones (store_id, carrier_id, zone_name, zone_code, rate, is_active)
    VALUES (v_store_id, v_carrier_id, 'Villa Elisa', 'VEL', 20000.00, TRUE)
    ON CONFLICT (carrier_id, zone_name) DO UPDATE SET rate = EXCLUDED.rate, is_active = TRUE, updated_at = NOW();

    INSERT INTO carrier_zones (store_id, carrier_id, zone_name, zone_code, rate, is_active)
    VALUES (v_store_id, v_carrier_id, 'San Antonio', 'SAN', 20000.00, TRUE)
    ON CONFLICT (carrier_id, zone_name) DO UPDATE SET rate = EXCLUDED.rate, is_active = TRUE, updated_at = NOW();

    INSERT INTO carrier_zones (store_id, carrier_id, zone_name, zone_code, rate, is_active)
    VALUES (v_store_id, v_carrier_id, 'Ñemby', 'NEM', 20000.00, TRUE)
    ON CONFLICT (carrier_id, zone_name) DO UPDATE SET rate = EXCLUDED.rate, is_active = TRUE, updated_at = NOW();

    -- Capiatá, Ypané (25.000 Gs)
    INSERT INTO carrier_zones (store_id, carrier_id, zone_name, zone_code, rate, is_active)
    VALUES (v_store_id, v_carrier_id, 'Capiatá', 'CAP', 25000.00, TRUE)
    ON CONFLICT (carrier_id, zone_name) DO UPDATE SET rate = EXCLUDED.rate, is_active = TRUE, updated_at = NOW();

    INSERT INTO carrier_zones (store_id, carrier_id, zone_name, zone_code, rate, is_active)
    VALUES (v_store_id, v_carrier_id, 'Ypané', 'YPA', 25000.00, TRUE)
    ON CONFLICT (carrier_id, zone_name) DO UPDATE SET rate = EXCLUDED.rate, is_active = TRUE, updated_at = NOW();

    -- Luque, Mariano Roque Alonso, Loma Pytá, J. Augusto Saldívar, Villeta, Guarambaré (30.000 Gs)
    INSERT INTO carrier_zones (store_id, carrier_id, zone_name, zone_code, rate, is_active)
    VALUES (v_store_id, v_carrier_id, 'Luque', 'LUQ', 30000.00, TRUE)
    ON CONFLICT (carrier_id, zone_name) DO UPDATE SET rate = EXCLUDED.rate, is_active = TRUE, updated_at = NOW();

    INSERT INTO carrier_zones (store_id, carrier_id, zone_name, zone_code, rate, is_active)
    VALUES (v_store_id, v_carrier_id, 'Mariano Roque Alonso', 'MRA', 30000.00, TRUE)
    ON CONFLICT (carrier_id, zone_name) DO UPDATE SET rate = EXCLUDED.rate, is_active = TRUE, updated_at = NOW();

    INSERT INTO carrier_zones (store_id, carrier_id, zone_name, zone_code, rate, is_active)
    VALUES (v_store_id, v_carrier_id, 'Loma Pytá', 'LPY', 30000.00, TRUE)
    ON CONFLICT (carrier_id, zone_name) DO UPDATE SET rate = EXCLUDED.rate, is_active = TRUE, updated_at = NOW();

    INSERT INTO carrier_zones (store_id, carrier_id, zone_name, zone_code, rate, is_active)
    VALUES (v_store_id, v_carrier_id, 'J. Augusto Saldívar', 'JAS', 30000.00, TRUE)
    ON CONFLICT (carrier_id, zone_name) DO UPDATE SET rate = EXCLUDED.rate, is_active = TRUE, updated_at = NOW();

    INSERT INTO carrier_zones (store_id, carrier_id, zone_name, zone_code, rate, is_active)
    VALUES (v_store_id, v_carrier_id, 'Villeta', 'VIL', 30000.00, TRUE)
    ON CONFLICT (carrier_id, zone_name) DO UPDATE SET rate = EXCLUDED.rate, is_active = TRUE, updated_at = NOW();

    INSERT INTO carrier_zones (store_id, carrier_id, zone_name, zone_code, rate, is_active)
    VALUES (v_store_id, v_carrier_id, 'Guarambaré', 'GUA', 30000.00, TRUE)
    ON CONFLICT (carrier_id, zone_name) DO UPDATE SET rate = EXCLUDED.rate, is_active = TRUE, updated_at = NOW();

    -- Limpio, Areguá, Itauguá, Itá (35.000 Gs)
    INSERT INTO carrier_zones (store_id, carrier_id, zone_name, zone_code, rate, is_active)
    VALUES (v_store_id, v_carrier_id, 'Limpio', 'LIM', 35000.00, TRUE)
    ON CONFLICT (carrier_id, zone_name) DO UPDATE SET rate = EXCLUDED.rate, is_active = TRUE, updated_at = NOW();

    INSERT INTO carrier_zones (store_id, carrier_id, zone_name, zone_code, rate, is_active)
    VALUES (v_store_id, v_carrier_id, 'Areguá', 'ARE', 35000.00, TRUE)
    ON CONFLICT (carrier_id, zone_name) DO UPDATE SET rate = EXCLUDED.rate, is_active = TRUE, updated_at = NOW();

    INSERT INTO carrier_zones (store_id, carrier_id, zone_name, zone_code, rate, is_active)
    VALUES (v_store_id, v_carrier_id, 'Itauguá', 'ITG', 35000.00, TRUE)
    ON CONFLICT (carrier_id, zone_name) DO UPDATE SET rate = EXCLUDED.rate, is_active = TRUE, updated_at = NOW();

    INSERT INTO carrier_zones (store_id, carrier_id, zone_name, zone_code, rate, is_active)
    VALUES (v_store_id, v_carrier_id, 'Itá', 'ITA', 35000.00, TRUE)
    ON CONFLICT (carrier_id, zone_name) DO UPDATE SET rate = EXCLUDED.rate, is_active = TRUE, updated_at = NOW();

    -- ============================================================
    -- VERIFICATION
    -- ============================================================
    SELECT COUNT(*) INTO v_existing_count
    FROM carrier_zones
    WHERE carrier_id = v_carrier_id AND is_active = TRUE;

    RAISE NOTICE '========================================';
    RAISE NOTICE 'MIGRATION 109 COMPLETED SUCCESSFULLY';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Store: NOCTE (%)' , v_store_id;
    RAISE NOTICE 'Carrier: % (%)', v_carrier_name, v_carrier_id;
    RAISE NOTICE 'Active zones configured: %', v_existing_count;
    RAISE NOTICE '========================================';
END $$;

COMMIT;

-- ================================================================
-- MIGRATION 109 COMPLETED
-- ================================================================
-- Created:
--   - Carrier: Adrian Torales (for store NOCTE)
--   - 18 delivery zones with rates:
--     * 15.000 Gs: Asunción, Sajonia, Lambaré, Botánico
--     * 20.000 Gs: Fernando de la Mora, San Lorenzo, Villa Elisa,
--                  San Antonio, Ñemby
--     * 25.000 Gs: Capiatá, Ypané
--     * 30.000 Gs: Luque, Mariano Roque Alonso, Loma Pytá,
--                  J. Augusto Saldívar, Villeta, Guarambaré
--     * 35.000 Gs: Limpio, Areguá, Itauguá, Itá
--
-- IDEMPOTENT BEHAVIOR:
--   - If carrier exists: skips creation, updates zones
--   - If zones exist: updates rates and ensures is_active = TRUE
--
-- ROLLBACK (if needed):
--   DELETE FROM carrier_zones WHERE carrier_id IN (
--     SELECT id FROM carriers WHERE store_id = '1eeaf2c7-2cd2-4257-8213-d90b1280a19d'
--     AND name = 'Adrian Torales'
--   );
--   DELETE FROM carriers WHERE store_id = '1eeaf2c7-2cd2-4257-8213-d90b1280a19d'
--     AND name = 'Adrian Torales';
-- ================================================================

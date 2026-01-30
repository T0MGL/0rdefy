-- ================================================================
-- MIGRATION 117: Update Adrian Torales Rates for NOCTE Store
-- ================================================================
-- Date: 2026-01-28
-- Purpose: Update carrier rates for Adrian Torales to match new pricing
--
-- Store: NOCTE
-- Store ID: 1eeaf2c7-2cd2-4257-8213-d90b1280a19d
-- Carrier: Adrian Torales
--
-- PRICE CHANGES:
--   * Loma Pytá:            30,000 → 20,000
--   * Mariano Roque Alonso: 30,000 → 25,000
--   * Luque:                30,000 → 25,000
--   * Areguá:               35,000 → 30,000
--   * Itauguá:              35,000 → 32,000
--
-- FINAL RATE STRUCTURE:
--   * 15,000 Gs: Asunción, Sajonia, Lambaré
--   * 20,000 Gs: Loma Pytá, Fernando de la Mora, San Lorenzo,
--                Villa Elisa, San Antonio, Ñemby
--   * 25,000 Gs: Mariano Roque Alonso, Luque, Capiatá, Ypané
--   * 30,000 Gs: Areguá, J. Augusto Saldívar, Villeta, Guarambaré
--   * 32,000 Gs: Itauguá
--   * 35,000 Gs: Limpio, Itá
--
-- IDEMPOTENT: Safe to run multiple times
-- ================================================================

BEGIN;

-- ================================================================
-- 1. ADD LOMA PYTA TO PARAGUAY_LOCATIONS IF NOT EXISTS
-- ================================================================
-- Loma Pytá is a barrio/neighborhood in the Gran Asunción area
-- (specifically in the Asunción/Luque boundary area)
INSERT INTO paraguay_locations (city, department, zone_code, city_normalized, department_normalized)
VALUES ('Loma Pytá', 'CENTRAL', 'CENTRAL', 'loma pyta', 'central')
ON CONFLICT (city, department) DO NOTHING;

-- ================================================================
-- 2. UPDATE CARRIER_ZONES (Legacy Zone-Based System)
-- ================================================================
DO $$
DECLARE
    v_store_id UUID := '1eeaf2c7-2cd2-4257-8213-d90b1280a19d';
    v_carrier_id UUID;
    v_carrier_name TEXT := 'Adrian Torales';
    v_updated_count INT := 0;
BEGIN
    -- Find the carrier
    SELECT id INTO v_carrier_id
    FROM carriers
    WHERE store_id = v_store_id
      AND LOWER(TRIM(name)) LIKE LOWER('%adrian%torales%')
      AND is_active = TRUE
    LIMIT 1;

    IF v_carrier_id IS NULL THEN
        RAISE EXCEPTION 'Carrier "Adrian Torales" not found or inactive for store NOCTE';
    END IF;

    RAISE NOTICE 'Found carrier "%" with ID: %', v_carrier_name, v_carrier_id;

    -- ============================================================
    -- UPDATE ZONE RATES (carrier_zones table)
    -- ============================================================

    -- Loma Pytá: 30,000 → 20,000
    UPDATE carrier_zones
    SET rate = 20000.00, updated_at = NOW()
    WHERE carrier_id = v_carrier_id
      AND LOWER(zone_name) = LOWER('Loma Pytá');
    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    IF v_updated_count > 0 THEN
        RAISE NOTICE 'Updated Loma Pytá: 30,000 → 20,000';
    END IF;

    -- Mariano Roque Alonso: 30,000 → 25,000
    UPDATE carrier_zones
    SET rate = 25000.00, updated_at = NOW()
    WHERE carrier_id = v_carrier_id
      AND LOWER(zone_name) = LOWER('Mariano Roque Alonso');
    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    IF v_updated_count > 0 THEN
        RAISE NOTICE 'Updated Mariano Roque Alonso: 30,000 → 25,000';
    END IF;

    -- Luque: 30,000 → 25,000
    UPDATE carrier_zones
    SET rate = 25000.00, updated_at = NOW()
    WHERE carrier_id = v_carrier_id
      AND LOWER(zone_name) = LOWER('Luque');
    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    IF v_updated_count > 0 THEN
        RAISE NOTICE 'Updated Luque: 30,000 → 25,000';
    END IF;

    -- Areguá: 35,000 → 30,000
    UPDATE carrier_zones
    SET rate = 30000.00, updated_at = NOW()
    WHERE carrier_id = v_carrier_id
      AND LOWER(zone_name) IN (LOWER('Areguá'), LOWER('Aregua'));
    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    IF v_updated_count > 0 THEN
        RAISE NOTICE 'Updated Areguá: 35,000 → 30,000';
    END IF;

    -- Itauguá: 35,000 → 32,000
    UPDATE carrier_zones
    SET rate = 32000.00, updated_at = NOW()
    WHERE carrier_id = v_carrier_id
      AND LOWER(zone_name) IN (LOWER('Itauguá'), LOWER('Itagua'));
    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    IF v_updated_count > 0 THEN
        RAISE NOTICE 'Updated Itauguá: 35,000 → 32,000';
    END IF;

    RAISE NOTICE '========================================';
    RAISE NOTICE 'CARRIER_ZONES UPDATES COMPLETED';
    RAISE NOTICE '========================================';
END $$;

-- ================================================================
-- 3. UPDATE/INSERT CARRIER_COVERAGE (New City-Based System)
-- ================================================================
-- This ensures the new city-based coverage system has the correct rates
DO $$
DECLARE
    v_store_id UUID := '1eeaf2c7-2cd2-4257-8213-d90b1280a19d';
    v_carrier_id UUID;
    v_coverage JSONB;
BEGIN
    -- Find the carrier
    SELECT id INTO v_carrier_id
    FROM carriers
    WHERE store_id = v_store_id
      AND LOWER(TRIM(name)) LIKE LOWER('%adrian%torales%')
      AND is_active = TRUE
    LIMIT 1;

    IF v_carrier_id IS NULL THEN
        RAISE NOTICE 'Carrier not found, skipping carrier_coverage updates';
        RETURN;
    END IF;

    -- Build the complete coverage JSON with ALL cities and new rates
    v_coverage := '[
        {"city": "Asunción", "department": "ASUNCION", "rate": 15000},
        {"city": "Sajonia", "department": "CENTRAL", "rate": 15000},
        {"city": "Lambaré", "department": "CENTRAL", "rate": 15000},
        {"city": "Loma Pytá", "department": "CENTRAL", "rate": 20000},
        {"city": "Fernando de la Mora", "department": "CENTRAL", "rate": 20000},
        {"city": "San Lorenzo", "department": "CENTRAL", "rate": 20000},
        {"city": "Villa Elisa", "department": "CENTRAL", "rate": 20000},
        {"city": "San Antonio", "department": "CENTRAL", "rate": 20000},
        {"city": "Ñemby", "department": "CENTRAL", "rate": 20000},
        {"city": "Mariano Roque Alonso", "department": "CENTRAL", "rate": 25000},
        {"city": "Luque", "department": "CENTRAL", "rate": 25000},
        {"city": "Capiatá", "department": "CENTRAL", "rate": 25000},
        {"city": "Ypané", "department": "CENTRAL", "rate": 25000},
        {"city": "Areguá", "department": "CENTRAL", "rate": 30000},
        {"city": "J. Augusto Saldivar", "department": "CENTRAL", "rate": 30000},
        {"city": "Villeta", "department": "CENTRAL", "rate": 30000},
        {"city": "Guarambaré", "department": "CENTRAL", "rate": 30000},
        {"city": "Itauguá", "department": "CENTRAL", "rate": 32000},
        {"city": "Limpio", "department": "CENTRAL", "rate": 35000},
        {"city": "Itá", "department": "CENTRAL", "rate": 35000}
    ]'::JSONB;

    -- Use the import function to upsert all coverage entries
    PERFORM import_carrier_coverage(v_store_id, v_carrier_id, v_coverage);

    RAISE NOTICE '========================================';
    RAISE NOTICE 'CARRIER_COVERAGE IMPORT COMPLETED';
    RAISE NOTICE 'Updated 20 city coverage entries';
    RAISE NOTICE '========================================';
END $$;

-- ================================================================
-- 4. VERIFICATION QUERY
-- ================================================================
-- This query shows the final state of rates for Adrian Torales

DO $$
DECLARE
    v_store_id UUID := '1eeaf2c7-2cd2-4257-8213-d90b1280a19d';
    v_carrier_id UUID;
    v_zone_count INT;
    v_coverage_count INT;
BEGIN
    SELECT id INTO v_carrier_id
    FROM carriers
    WHERE store_id = v_store_id
      AND LOWER(TRIM(name)) LIKE LOWER('%adrian%torales%')
    LIMIT 1;

    -- Count zones
    SELECT COUNT(*) INTO v_zone_count
    FROM carrier_zones
    WHERE carrier_id = v_carrier_id AND is_active = TRUE;

    -- Count coverage entries
    SELECT COUNT(*) INTO v_coverage_count
    FROM carrier_coverage
    WHERE carrier_id = v_carrier_id AND is_active = TRUE AND rate IS NOT NULL;

    RAISE NOTICE '================================================';
    RAISE NOTICE 'MIGRATION 117 COMPLETED SUCCESSFULLY';
    RAISE NOTICE '================================================';
    RAISE NOTICE 'Carrier: Adrian Torales';
    RAISE NOTICE 'Store: NOCTE';
    RAISE NOTICE 'Active zones (carrier_zones): %', v_zone_count;
    RAISE NOTICE 'Active coverage (carrier_coverage): %', v_coverage_count;
    RAISE NOTICE '================================================';
    RAISE NOTICE 'FINAL RATES:';
    RAISE NOTICE '  15,000 Gs: Asunción, Sajonia, Lambaré';
    RAISE NOTICE '  20,000 Gs: Loma Pytá, Fernando, San Lorenzo,';
    RAISE NOTICE '             Villa Elisa, San Antonio, Ñemby';
    RAISE NOTICE '  25,000 Gs: MRA, Luque, Capiatá, Ypané';
    RAISE NOTICE '  30,000 Gs: Areguá, J.Augusto, Villeta, Guarambaré';
    RAISE NOTICE '  32,000 Gs: Itauguá';
    RAISE NOTICE '  35,000 Gs: Limpio, Itá';
    RAISE NOTICE '================================================';
END $$;

COMMIT;

-- ================================================================
-- MIGRATION 117 COMPLETED
-- ================================================================
-- Updates to Adrian Torales rates for NOCTE store:
--
-- CHANGED RATES:
--   * Loma Pytá:            30,000 → 20,000 ✓
--   * Mariano Roque Alonso: 30,000 → 25,000 ✓
--   * Luque:                30,000 → 25,000 ✓
--   * Areguá:               35,000 → 30,000 ✓
--   * Itauguá:              35,000 → 32,000 ✓
--
-- UNCHANGED RATES:
--   * 15,000 Gs: Asunción, Sajonia, Lambaré
--   * 20,000 Gs: Fernando de la Mora, San Lorenzo, Villa Elisa,
--                San Antonio, Ñemby
--   * 25,000 Gs: Capiatá, Ypané
--   * 30,000 Gs: J. Augusto Saldívar, Villeta, Guarambaré
--   * 35,000 Gs: Limpio, Itá
--
-- NOTES:
--   - All cities are in Gran Asunción metropolitan area (Central dept)
--   - Updated both carrier_zones (legacy) and carrier_coverage (new) tables
--   - Added Loma Pytá to paraguay_locations master table
--
-- ROLLBACK (if needed):
--   -- Restore original rates in carrier_zones:
--   UPDATE carrier_zones SET rate = 30000 WHERE carrier_id = (
--     SELECT id FROM carriers WHERE store_id = '1eeaf2c7-2cd2-4257-8213-d90b1280a19d'
--     AND LOWER(name) LIKE '%adrian%torales%'
--   ) AND zone_name IN ('Loma Pytá', 'Mariano Roque Alonso', 'Luque');
--
--   UPDATE carrier_zones SET rate = 35000 WHERE carrier_id = (
--     SELECT id FROM carriers WHERE store_id = '1eeaf2c7-2cd2-4257-8213-d90b1280a19d'
--     AND LOWER(name) LIKE '%adrian%torales%'
--   ) AND zone_name IN ('Areguá', 'Itauguá');
-- ================================================================

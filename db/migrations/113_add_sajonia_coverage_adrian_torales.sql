-- Migration 113: Add Sajonia (Central) location and carrier coverage for Adrian Torales
-- Date: 2026-01-26
-- Description: Adds barrio Sajonia as a location in Central department,
--              then adds carrier coverage for Adrian Torales at 15,000 Gs

-- Step 1: Add Sajonia to paraguay_locations (if not exists)
INSERT INTO paraguay_locations (id, city, department, zone_code, city_normalized, department_normalized, is_active)
VALUES (
    gen_random_uuid(),
    'Sajonia',
    'CENTRAL',
    'CENTRAL',
    'sajonia',
    'central',
    true
)
ON CONFLICT (city, department) DO NOTHING;

-- Step 2: Add carrier coverage for Adrian Torales
DO $$
DECLARE
    v_carrier_id UUID;
    v_store_id UUID;
BEGIN
    -- Find Adrian Torales carrier
    SELECT id, store_id INTO v_carrier_id, v_store_id
    FROM carriers
    WHERE LOWER(name) LIKE '%adrian torales%'
    AND is_active = true
    LIMIT 1;

    IF v_carrier_id IS NULL THEN
        RAISE EXCEPTION 'Carrier "Adrian Torales" not found or inactive';
    END IF;

    -- Remove existing coverage if any (safe upsert)
    DELETE FROM carrier_coverage
    WHERE carrier_id = v_carrier_id
      AND LOWER(city) = 'sajonia'
      AND LOWER(COALESCE(NULLIF(department, ''), '')) = 'central';

    -- Insert coverage for Sajonia at 15,000 Gs
    INSERT INTO carrier_coverage (id, store_id, carrier_id, city, department, rate, is_active)
    VALUES (
        gen_random_uuid(),
        v_store_id,
        v_carrier_id,
        'Sajonia',
        'CENTRAL',
        15000,
        true
    );

    RAISE NOTICE 'Coverage added: Adrian Torales -> Sajonia (CENTRAL) @ 15,000 Gs';
END $$;

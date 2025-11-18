-- ================================================================
-- SEED DATA: COURIERS (REPARTIDORES)
-- ================================================================
-- Creates sample couriers for testing the delivery confirmation flow
-- Run this after migration 011 is applied
-- ================================================================

-- ⚠️ WARNING: This will insert couriers for ALL stores in the database
-- If you want to insert for a specific store only, replace 'stores.id'
-- with your actual store UUID in the VALUES section

-- Insert sample couriers for each store
INSERT INTO carriers (store_id, name, phone, email, vehicle_type, license_plate, is_active, notes)
SELECT
    s.id as store_id,
    unnest(ARRAY['Juan Pérez', 'María González', 'Carlos López', 'Ana Martínez']) as name,
    unnest(ARRAY['+595981234567', '+595981234568', '+595981234569', '+595981234570']) as phone,
    unnest(ARRAY['juan@example.com', 'maria@example.com', 'carlos@example.com', 'ana@example.com']) as email,
    unnest(ARRAY['moto', 'auto', 'moto', 'bicicleta']) as vehicle_type,
    unnest(ARRAY['ABC123', 'DEF456', 'GHI789', null]) as license_plate,
    true as is_active,
    unnest(ARRAY[
        'Repartidor experimentado, conoce bien la zona norte',
        'Muy puntual y amable con los clientes',
        'Especializado en entregas express',
        'Ideal para entregas en el centro de la ciudad'
    ]) as notes
FROM stores s
WHERE NOT EXISTS (
    SELECT 1 FROM carriers c
    WHERE c.store_id = s.id
    AND c.name IN ('Juan Pérez', 'María González', 'Carlos López', 'Ana Martínez')
);

-- Verify insertion
SELECT
    c.id,
    c.name,
    c.phone,
    c.vehicle_type,
    c.is_active,
    s.name as store_name
FROM carriers c
JOIN stores s ON s.id = c.store_id
ORDER BY c.created_at DESC
LIMIT 20;

-- Check count by store
SELECT
    s.name as store_name,
    COUNT(c.id) as courier_count
FROM stores s
LEFT JOIN carriers c ON c.store_id = s.id
GROUP BY s.id, s.name
ORDER BY courier_count DESC;

-- ================================================================
-- ALTERNATIVE: Insert for specific store only
-- ================================================================
-- Uncomment and replace YOUR_STORE_ID with your actual store UUID

/*
DO $$
DECLARE
    target_store_id UUID := 'YOUR_STORE_ID'; -- ⚠️ REPLACE THIS
BEGIN
    INSERT INTO carriers (store_id, name, phone, email, vehicle_type, license_plate, is_active, notes)
    VALUES
        (target_store_id, 'Juan Pérez', '+595981234567', 'juan@example.com', 'moto', 'ABC123', true, 'Repartidor experimentado, conoce bien la zona norte'),
        (target_store_id, 'María González', '+595981234568', 'maria@example.com', 'auto', 'DEF456', true, 'Muy puntual y amable con los clientes'),
        (target_store_id, 'Carlos López', '+595981234569', 'carlos@example.com', 'moto', 'GHI789', true, 'Especializado en entregas express'),
        (target_store_id, 'Ana Martínez', '+595981234570', 'ana@example.com', 'bicicleta', null, true, 'Ideal para entregas en el centro de la ciudad')
    ON CONFLICT DO NOTHING;

    RAISE NOTICE 'Couriers inserted successfully for store %', target_store_id;
END $$;
*/

-- ================================================================
-- SEED COMPLETE
-- ================================================================
-- To run this file:
-- psql -h YOUR_HOST -U YOUR_USER -d YOUR_DATABASE -f db/seed-couriers.sql
-- ================================================================

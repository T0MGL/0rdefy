-- ================================================================
-- ORDEFY - CARRIERS TABLE
-- ================================================================
-- Tabla de transportistas/repartidores para gestión de entregas
-- DEBE EJECUTARSE ANTES DE migration 009
-- ================================================================

-- ================================================================
-- TABLE: carriers
-- ================================================================
-- Transportistas/repartidores que realizan las entregas
-- ================================================================

CREATE TABLE IF NOT EXISTS carriers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    email VARCHAR(255),
    vehicle_type VARCHAR(50),
    license_plate VARCHAR(20),
    is_active BOOLEAN DEFAULT TRUE,
    notes TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Índices
CREATE INDEX idx_carriers_store ON carriers(store_id);
CREATE INDEX idx_carriers_active ON carriers(store_id, is_active);

-- Comentarios
COMMENT ON TABLE carriers IS 'Ordefy: Transportistas/repartidores para entregas';
COMMENT ON COLUMN carriers.vehicle_type IS 'moto, auto, bicicleta, caminando';
COMMENT ON COLUMN carriers.is_active IS 'Si el transportista está activo para asignar entregas';

-- Permisos
GRANT ALL ON carriers TO postgres;
GRANT SELECT, INSERT, UPDATE, DELETE ON carriers TO authenticated;

-- ================================================================
-- SEED DATA (OPCIONAL)
-- ================================================================
-- Datos de ejemplo para testing
-- ================================================================

-- Descomentar las siguientes líneas si quieres datos de ejemplo
/*
INSERT INTO carriers (store_id, name, phone, vehicle_type, is_active)
SELECT
    id as store_id,
    'Juan Pérez' as name,
    '+595981234567' as phone,
    'moto' as vehicle_type,
    TRUE as is_active
FROM stores
LIMIT 1;

INSERT INTO carriers (store_id, name, phone, vehicle_type, is_active)
SELECT
    id as store_id,
    'María González' as name,
    '+595981234568' as phone,
    'auto' as vehicle_type,
    TRUE as is_active
FROM stores
LIMIT 1;
*/

-- ================================================================
-- MIGRATION COMPLETE
-- ================================================================

-- Para aplicar esta migración:
-- Copia este SQL y ejecútalo en el SQL Editor de Supabase Dashboard
-- IMPORTANTE: Ejecuta ESTA migración ANTES de la 009

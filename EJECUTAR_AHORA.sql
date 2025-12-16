-- ================================================================
-- EJECUTAR ESTE SQL EN SUPABASE AHORA MISMO
-- ================================================================
-- Copia todo este contenido y pégalo en el SQL Editor de Supabase
-- URL: https://supabase.com/dashboard/project/vlcwlwuuobazamuzjzsm/sql
-- ================================================================

-- Paso 1: Eliminar la columna vieja si existe (additional_cost singular)
ALTER TABLE products DROP COLUMN IF EXISTS additional_cost;

-- Paso 2: Agregar las columnas correctas
ALTER TABLE products
ADD COLUMN IF NOT EXISTS packaging_cost DECIMAL(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS additional_costs DECIMAL(10,2) DEFAULT 0;

-- Paso 3: Verificar que se crearon correctamente
SELECT
    'packaging_cost' as columna,
    CASE WHEN EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'products' AND column_name = 'packaging_cost'
    ) THEN '✅ Existe' ELSE '❌ No existe' END as estado
UNION ALL
SELECT
    'additional_costs' as columna,
    CASE WHEN EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'products' AND column_name = 'additional_costs'
    ) THEN '✅ Existe' ELSE '❌ No existe' END as estado;

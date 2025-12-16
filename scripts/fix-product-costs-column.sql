-- ================================================================
-- FIX: Renombrar additional_cost a additional_costs y asegurar que existan las columnas
-- ================================================================

-- Paso 1: Renombrar additional_cost a additional_costs si existe
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'products'
        AND column_name = 'additional_cost'
    ) THEN
        ALTER TABLE products RENAME COLUMN additional_cost TO additional_costs;
        RAISE NOTICE 'Columna additional_cost renombrada a additional_costs';
    END IF;
END $$;

-- Paso 2: Agregar columnas si no existen
ALTER TABLE products
ADD COLUMN IF NOT EXISTS packaging_cost DECIMAL(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS additional_costs DECIMAL(10,2) DEFAULT 0;

-- Paso 3: Agregar comentarios
COMMENT ON COLUMN products.packaging_cost IS 'Cost of packaging materials per unit';
COMMENT ON COLUMN products.additional_costs IS 'Other per-unit costs (labels, handling, etc)';

-- Verificación
DO $$
DECLARE
    has_packaging BOOLEAN;
    has_additional BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'products' AND column_name = 'packaging_cost'
    ) INTO has_packaging;

    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'products' AND column_name = 'additional_costs'
    ) INTO has_additional;

    IF has_packaging AND has_additional THEN
        RAISE NOTICE '✅ Columnas de costos configuradas correctamente';
    ELSE
        RAISE EXCEPTION '❌ Error: Faltan columnas de costos';
    END IF;
END $$;

# 🔧 Corrección de Columnas de Costos en Products

## Problema

La tabla `products` tiene la columna `additional_cost` (singular) pero el código está usando `additional_costs` (plural).

## Solución

Ejecuta el siguiente SQL en tu base de datos Supabase para corregir el esquema:

### 📍 Dónde ejecutar:

1. Ve a https://supabase.com/dashboard/project/vlcwlwuuobazamuzjzsm
2. Navega a **SQL Editor** en el menú lateral
3. Haz clic en **"New query"**
4. Pega el SQL de abajo
5. Haz clic en **"Run"** (o presiona Ctrl/Cmd + Enter)

### 📝 SQL a ejecutar:

```sql
-- ================================================================
-- FIX: Renombrar additional_cost a additional_costs
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
        RAISE NOTICE '✅ Columna additional_cost renombrada a additional_costs';
    ELSE
        RAISE NOTICE 'ℹ️  Columna additional_cost no existe (probablemente ya fue renombrada)';
    END IF;
END $$;

-- Paso 2: Asegurar que existan ambas columnas de costos
ALTER TABLE products
ADD COLUMN IF NOT EXISTS packaging_cost DECIMAL(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS additional_costs DECIMAL(10,2) DEFAULT 0;

-- Paso 3: Actualizar comentarios
COMMENT ON COLUMN products.packaging_cost IS 'Cost of packaging materials per unit';
COMMENT ON COLUMN products.additional_costs IS 'Other per-unit costs (labels, handling, etc)';

-- Paso 4: Verificación
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
```

### ✅ Resultado esperado:

Deberías ver mensajes como:
- `✅ Columna additional_cost renombrada a additional_costs` (o ya renombrada)
- `✅ Columnas de costos configuradas correctamente`

### 🔍 Verificación:

Después de ejecutar el SQL, verifica que las columnas existan ejecutando:

```sql
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'products'
AND column_name IN ('packaging_cost', 'additional_costs')
ORDER BY column_name;
```

Deberías ver:
```
column_name       | data_type | column_default
------------------|-----------|-----------------
additional_costs  | numeric   | 0
packaging_cost    | numeric   | 0
```

---

## ¿Por qué este error?

La migración original (`030_add_product_costs.sql`) creó la columna como `additional_cost` (singular), pero el código del frontend y backend usa `additional_costs` (plural) para mantener consistencia con otros campos plurales en el sistema.

## Archivos actualizados:

- ✅ `db/migrations/030_add_product_costs.sql` - Corregido para usar `additional_costs`
- ✅ `src/services/products.service.ts` - Usa `additional_costs`
- ✅ `src/types/index.ts` - Usa `additional_costs`
- ✅ `api/routes/products.ts` - Usa `additional_costs`

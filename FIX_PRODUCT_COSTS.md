# 🔧 Corrección URGENTE: Columnas de Costos en Products

## ⚠️ Error Actual

```
Error: Could not find the 'additional_costs' column of 'products' in the schema cache
```

**Causa:** La base de datos no tiene las columnas `packaging_cost` y `additional_costs`.

## ✅ Solución (2 minutos)

### 📍 PASO 1: Abrir SQL Editor

1. **Abre este link:** https://supabase.com/dashboard/project/vlcwlwuuobazamuzjzsm/sql/new
2. Se abrirá el SQL Editor directamente

### 📝 PASO 2: Copiar y pegar este SQL:

**⚡ Versión rápida (recomendada):**

```sql
-- Eliminar columna vieja si existe
ALTER TABLE products DROP COLUMN IF EXISTS additional_cost;

-- Agregar columnas correctas
ALTER TABLE products
ADD COLUMN IF NOT EXISTS packaging_cost DECIMAL(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS additional_costs DECIMAL(10,2) DEFAULT 0;

-- Verificar
SELECT column_name FROM information_schema.columns
WHERE table_name = 'products'
AND column_name IN ('packaging_cost', 'additional_costs');
```

### ⚡ PASO 3: Ejecutar

Presiona el botón **"Run"** (o `Ctrl + Enter` / `Cmd + Enter`)

### ✅ Resultado esperado:

Deberías ver una tabla con 2 filas:
```
column_name
-----------------
additional_costs
packaging_cost
```

---

## 📋 Versión detallada (con verificación completa)

Si prefieres una versión más detallada con logs:

```sql
-- Paso 1: Eliminar columna vieja
ALTER TABLE products DROP COLUMN IF EXISTS additional_cost;

-- Paso 2: Agregar columnas correctas
ALTER TABLE products
ADD COLUMN IF NOT EXISTS packaging_cost DECIMAL(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS additional_costs DECIMAL(10,2) DEFAULT 0;

-- Paso 3: Verificación visual
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

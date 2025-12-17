# 📋 INSTRUCCIONES: Copiar y Pegar SQL

**Para ejecutar en Supabase SQL Editor, pgAdmin, o cualquier cliente PostgreSQL**

---

## 🔢 ORDEN DE EJECUCIÓN

### PASO 1: Verificar Estado Actual ✅

**Archivo:** [VERIFICACION_SIMPLE.sql](VERIFICACION_SIMPLE.sql)

**Qué hace:** Muestra el estado actual (NO modifica nada)

**Copiar y pegar:**
```sql
-- Ver contenido en VERIFICACION_SIMPLE.sql
```

**Output esperado:**
- Si todo OK: "✅ Columna id EXISTE" y "✅ Índice UNIQUE EXISTE"
- Si necesita fix: "❌ NO EXISTE (será creado)"
- Si hay duplicados: "⚠️ HAY DUPLICADOS"

---

### PASO 2: Limpiar Duplicados (SOLO SI NECESARIO) 🧹

**Archivo:** [CLEANUP_DUPLICADOS_SIMPLE.sql](CLEANUP_DUPLICADOS_SIMPLE.sql)

**Cuándo ejecutar:** SOLO si PASO 1 detectó duplicados

**⚠️ ADVERTENCIA:** Este script ELIMINA datos. Hacer backup antes.

**Copiar y pegar:**
```sql
-- Ver contenido en CLEANUP_DUPLICADOS_SIMPLE.sql
```

**Output esperado:**
- Al final: `duplicados_restantes = 0`

---

### PASO 3: Ejecutar Migración 029 🚀

**Archivo:** [029_FINAL_CLEAN.sql](029_FINAL_CLEAN.sql) ⭐ **USAR ESTE**

**Qué hace:**
- Agrega columna `id` a `shopify_webhook_idempotency`
- Crea índices UNIQUE en `orders`

**Copiar y pegar:**
```sql
-- Ver contenido en 029_FINAL_CLEAN.sql
```

**Output esperado:**
- Al final: `"Migración 029 completada exitosamente"`
- Si hay error: Se muestra "FALLO: ..." y NO se aplica nada

---

### PASO 4: Testing Post-Migración ✅

**Archivo:** [TESTING_POST_MIGRACION.sql](TESTING_POST_MIGRACION.sql)

**Qué hace:** Ejecuta 6 tests para verificar que todo funciona

**Copiar y pegar:**
```sql
-- Ver contenido en TESTING_POST_MIGRACION.sql
```

**Output esperado:**
- TEST 1: Retorna 1 fila con `id | uuid | NO`
- TEST 2: Retorna 2 filas (los índices)
- TEST 3: Retorna un UUID
- TEST 4: Retorna pedido con `total_price = 100.00`
- TEST 5: Retorna mismo pedido con `total_price = 200.00` (UPDATE)
- TEST 6: Limpia datos de prueba
- Al final: "TODOS LOS TESTS PASARON ✅"

---

## 📝 RESUMEN DE ARCHIVOS

| Archivo | Cuándo Usar | Modifica DB |
|---------|-------------|-------------|
| `VERIFICACION_SIMPLE.sql` | SIEMPRE (primero) | ❌ NO |
| `CLEANUP_DUPLICADOS_SIMPLE.sql` | Solo si hay duplicados | ✅ SÍ (elimina) |
| `029_FINAL_CLEAN.sql` | SIEMPRE (migración principal) | ✅ SÍ (agrega) |
| `TESTING_POST_MIGRACION.sql` | SIEMPRE (al final) | ⚠️ SÍ (temporal) |

---

## ⚡ MODO ULTRA-RÁPIDO (Sin Duplicados)

Si ya verificaste que NO hay duplicados, solo ejecuta:

1. **[029_FINAL_CLEAN.sql](029_FINAL_CLEAN.sql)** - Copiar y pegar TODO el archivo
2. Esperar mensaje: "Migración 029 completada exitosamente"
3. **[TESTING_POST_MIGRACION.sql](TESTING_POST_MIGRACION.sql)** - Copiar y pegar TODO el archivo
4. Verificar: "TODOS LOS TESTS PASARON ✅"

**Tiempo total: 30 segundos**

---

## 🎯 CONTENIDO EXACTO PARA COPIAR

### OPCIÓN A: Todo en Un Solo Bloque (Recomendado)

Si tu cliente SQL soporta múltiples queries, puedes copiar esto:

```sql
-- ============================================================
-- MIGRACIÓN 029 COMPLETA (COPIAR TODO ESTE BLOQUE)
-- ============================================================

-- Fix 1: Columna id en shopify_webhook_idempotency
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'shopify_webhook_idempotency' AND column_name = 'id'
    ) THEN
        ALTER TABLE shopify_webhook_idempotency ADD COLUMN id UUID DEFAULT gen_random_uuid();
        UPDATE shopify_webhook_idempotency SET id = gen_random_uuid() WHERE id IS NULL;
        ALTER TABLE shopify_webhook_idempotency ALTER COLUMN id SET NOT NULL;
        ALTER TABLE shopify_webhook_idempotency DROP CONSTRAINT IF EXISTS shopify_webhook_idempotency_pkey CASCADE;
        ALTER TABLE shopify_webhook_idempotency ADD CONSTRAINT shopify_webhook_idempotency_pkey PRIMARY KEY (id);
    END IF;
END $$;

-- Fix 2: Índices UNIQUE en orders
DROP INDEX IF EXISTS idx_orders_shopify_id;
CREATE UNIQUE INDEX idx_orders_shopify_id ON orders(shopify_order_id) WHERE shopify_order_id IS NOT NULL;

DROP INDEX IF EXISTS idx_orders_shopify_store_unique;
CREATE UNIQUE INDEX idx_orders_shopify_store_unique ON orders(shopify_order_id, store_id) WHERE shopify_order_id IS NOT NULL;

-- Verificación
DO $$
DECLARE
    v_id_exists BOOLEAN;
    v_idx_composite_exists BOOLEAN;
BEGIN
    SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shopify_webhook_idempotency' AND column_name = 'id') INTO v_id_exists;
    SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'orders' AND indexname = 'idx_orders_shopify_store_unique') INTO v_idx_composite_exists;
    IF NOT v_id_exists THEN RAISE EXCEPTION 'FALLO: columna id no existe'; END IF;
    IF NOT v_idx_composite_exists THEN RAISE EXCEPTION 'FALLO: índice no existe'; END IF;
END $$;

SELECT 'Migración 029 completada exitosamente' as status;
```

---

### OPCIÓN B: Paso a Paso Manual

#### 1. Solo Fix Columna ID
```sql
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'shopify_webhook_idempotency' AND column_name = 'id'
    ) THEN
        ALTER TABLE shopify_webhook_idempotency ADD COLUMN id UUID DEFAULT gen_random_uuid();
        UPDATE shopify_webhook_idempotency SET id = gen_random_uuid() WHERE id IS NULL;
        ALTER TABLE shopify_webhook_idempotency ALTER COLUMN id SET NOT NULL;
        ALTER TABLE shopify_webhook_idempotency DROP CONSTRAINT IF EXISTS shopify_webhook_idempotency_pkey CASCADE;
        ALTER TABLE shopify_webhook_idempotency ADD CONSTRAINT shopify_webhook_idempotency_pkey PRIMARY KEY (id);
    END IF;
END $$;
```

#### 2. Solo Fix Índice Simple
```sql
DROP INDEX IF EXISTS idx_orders_shopify_id;
CREATE UNIQUE INDEX idx_orders_shopify_id ON orders(shopify_order_id) WHERE shopify_order_id IS NOT NULL;
```

#### 3. Solo Fix Índice Compuesto (CRÍTICO)
```sql
DROP INDEX IF EXISTS idx_orders_shopify_store_unique;
CREATE UNIQUE INDEX idx_orders_shopify_store_unique ON orders(shopify_order_id, store_id) WHERE shopify_order_id IS NOT NULL;
```

#### 4. Verificar
```sql
SELECT
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = 'shopify_webhook_idempotency' AND column_name = 'id') as columna_id_ok,
    EXISTS(SELECT 1 FROM pg_indexes WHERE tablename = 'orders' AND indexname = 'idx_orders_shopify_store_unique') as indice_compuesto_ok;
```

Debe retornar: `columna_id_ok = true` y `indice_compuesto_ok = true`

---

## 🆘 Troubleshooting

### Error: "column id already exists"
✅ **Solución:** La migración ya fue ejecutada. No hacer nada.

### Error: "could not create unique index"
❌ **Causa:** Hay duplicados en orders
✅ **Solución:** Ejecutar CLEANUP_DUPLICADOS_SIMPLE.sql primero

### Error: "permission denied"
❌ **Causa:** Usuario sin permisos
✅ **Solución:** Usar usuario con permisos de ALTER TABLE y CREATE INDEX

---

## ✅ Checklist

```
[ ] PASO 1: Ejecutar VERIFICACION_SIMPLE.sql
[ ] PASO 2: Si hay duplicados, ejecutar CLEANUP_DUPLICADOS_SIMPLE.sql
[ ] PASO 3: Ejecutar 029_FINAL_CLEAN.sql
[ ] PASO 4: Ver mensaje "Migración 029 completada exitosamente"
[ ] PASO 5: Ejecutar TESTING_POST_MIGRACION.sql
[ ] PASO 6: Ver mensaje "TODOS LOS TESTS PASARON ✅"
[ ] PASO 7: Crear pedido de prueba en Shopify
[ ] PASO 8: Verificar que aparece en la base de datos
```

---

**Tiempo total estimado: 2-5 minutos**
**Última actualización: 2025-01-17**

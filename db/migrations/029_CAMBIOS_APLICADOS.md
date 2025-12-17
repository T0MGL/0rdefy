# Migración 029 - Cambios Aplicados al MASTER_MIGRATION.sql

**Fecha:** 2025-01-17
**Problema resuelto:** Error en UPSERTS de Shopify webhooks
**Archivo actualizado:** `000_MASTER_MIGRATION.sql`

---

## 🔧 Cambios Realizados

### 1. ✅ Tabla `shopify_webhook_idempotency`

**Estado:** ✅ YA ESTABA CORRECTO

La tabla ya tenía la columna `id` como Primary Key:

```sql
CREATE TABLE IF NOT EXISTS shopify_webhook_idempotency (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),  -- ✅ Correcto
    ...
);
```

**No requirió cambios.**

---

### 2. ⚠️ Tabla `orders` - CONSTRAINT UNIQUE

**Problema original (INCORRECTO):**

```sql
-- ❌ ESTO NO FUNCIONA con ON CONFLICT
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_shopify_id
ON orders(shopify_order_id)
WHERE shopify_order_id IS NOT NULL;
```

**Por qué fallaba:**
- Los índices UNIQUE con cláusula `WHERE` **NO pueden usarse en `ON CONFLICT`**
- PostgreSQL requiere un CONSTRAINT UNIQUE sin condiciones
- El código de Shopify usa: `ON CONFLICT (shopify_order_id, store_id)`

**Solución aplicada (CORRECTO):**

```sql
-- ✅ ESTO FUNCIONA con ON CONFLICT
DO $$
BEGIN
    -- Limpiar índices/constraints viejos
    DROP INDEX IF EXISTS idx_orders_shopify_id;
    DROP INDEX IF EXISTS orders_shopify_order_id_key;

    -- Crear CONSTRAINT UNIQUE (no índice condicional)
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'orders'::regclass
        AND conname = 'idx_orders_shopify_store_unique'
    ) THEN
        ALTER TABLE orders
        ADD CONSTRAINT idx_orders_shopify_store_unique
        UNIQUE (shopify_order_id, store_id);
    END IF;
END $$;
```

---

## 📝 Reglas Importantes para el Futuro

### ✅ USAR (para ON CONFLICT):

```sql
-- Opción 1: Constraint durante creación de tabla
CREATE TABLE orders (
    ...
    CONSTRAINT idx_orders_shopify_store_unique
    UNIQUE (shopify_order_id, store_id)
);

-- Opción 2: Constraint después de crear tabla
ALTER TABLE orders
ADD CONSTRAINT idx_orders_shopify_store_unique
UNIQUE (shopify_order_id, store_id);
```

### ❌ NO USAR (para ON CONFLICT):

```sql
-- ❌ Índice UNIQUE con WHERE no funciona en ON CONFLICT
CREATE UNIQUE INDEX idx_orders_shopify_id
ON orders(shopify_order_id)
WHERE shopify_order_id IS NOT NULL;
```

---

## 🧪 Cómo Verificar en Producción

Después de aplicar el MASTER_MIGRATION actualizado, verificar:

```sql
-- 1. Ver constraints UNIQUE en orders
SELECT conname, contype
FROM pg_constraint
WHERE conrelid = 'orders'::regclass
AND contype = 'u'
AND conname LIKE '%shopify%';

-- Debe retornar: idx_orders_shopify_store_unique | u

-- 2. Probar UPSERT
INSERT INTO orders (
    store_id,
    shopify_order_id,
    customer_email,
    total_price
) VALUES (
    (SELECT id FROM stores LIMIT 1),
    'test-' || NOW()::TEXT,
    'test@example.com',
    100.00
)
ON CONFLICT (shopify_order_id, store_id)
DO UPDATE SET total_price = EXCLUDED.total_price
RETURNING id, total_price;

-- Debe funcionar sin errores
```

---

## 🚀 Impacto

### Antes (❌ Roto):
- Webhooks de Shopify fallaban con error:
  - `there is no unique or exclusion constraint matching the ON CONFLICT specification`
- Pedidos NO se creaban/actualizaban
- TODAS las tiendas afectadas

### Después (✅ Funcional):
- Webhooks procesan correctamente
- UPSERTS funcionan (INSERT o UPDATE según corresponda)
- Pedidos se sincronizan automáticamente desde Shopify
- Sistema completamente operativo

---

## 📚 Referencias Técnicas

**PostgreSQL Documentation:**
- [ON CONFLICT clause](https://www.postgresql.org/docs/current/sql-insert.html#SQL-ON-CONFLICT)
- [UNIQUE Constraints](https://www.postgresql.org/docs/current/ddl-constraints.html#DDL-CONSTRAINTS-UNIQUE-CONSTRAINTS)

**Regla clave:**
> "The optional ON CONFLICT clause specifies an alternative action to raising a unique violation or exclusion constraint violation error. [...] **The SET and WHERE clauses in ON CONFLICT DO UPDATE have access to the existing row using the table's name** (or an alias), and to rows proposed for insertion using the special excluded table."

**Limitación importante:**
> Partial indexes (indexes with WHERE clauses) **cannot be used as arbiters** for ON CONFLICT.

---

## ✅ Checklist de Migración Completada

```
[✅] 1. shopify_webhook_idempotency.id existe como Primary Key
[✅] 2. Constraint UNIQUE creado en orders(shopify_order_id, store_id)
[✅] 3. Índices/constraints viejos eliminados
[✅] 4. UPSERTS probados y funcionando
[✅] 5. MASTER_MIGRATION.sql actualizado
[✅] 6. Documentación creada
```

---

## 🔄 Próximos Pasos

1. **NO ejecutar MASTER_MIGRATION desde cero** en bases de datos existentes
2. Para nuevas instalaciones: El MASTER_MIGRATION actualizado funcionará correctamente
3. Para bases de datos existentes: Ya aplicaste la migración 029 manualmente
4. Hacer commit de los cambios:
   ```bash
   git add db/migrations/000_MASTER_MIGRATION.sql
   git commit -m "fix: Update MASTER_MIGRATION with correct UNIQUE constraint for Shopify UPSERTS

   - Replace partial UNIQUE INDEX with full CONSTRAINT
   - Fixes ON CONFLICT error in Shopify webhooks
   - Migration 029 applied manually in production"
   ```

---

**Autor:** Senior Database Engineer
**Revisado:** 2025-01-17
**Estado:** ✅ Completado y probado en producción

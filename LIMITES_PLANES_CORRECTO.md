# Límites de Planes - CORREGIDO

## 📊 Límites por Plan (Actualizado)

| Plan | Precio/mes | Tiendas | Usuarios | Pedidos/mes | Productos |
|------|------------|---------|----------|-------------|-----------|
| **Free** | $0 | **1** | 1 | 50 | 100 |
| **Starter** | $29 | **1** | 3 | 500 | 500 |
| **Growth** | $79 | **3** | 10 | 2,000 | 2,000 |
| **Professional** | $169 | **10** | 25 | 10,000 | Ilimitado |

---

## 🔄 Cambio Aplicado

### Antes (INCORRECTO):
```
Free: 1 tienda
Starter: 1 tienda ✓
Growth: 1 tienda ❌
Professional: 3 tiendas ❌
```

### Después (CORRECTO):
```
Free: 1 tienda ✓
Starter: 1 tienda ✓
Growth: 3 tiendas ✓ (plan del medio)
Professional: 10 tiendas ✓ (plan más caro)
```

---

## 📝 Migración a Ejecutar

**Archivo:** `db/migrations/055_update_max_stores_limits.sql`

```bash
# Ejecutar en Supabase SQL Editor o via psql:
psql -h <host> -U <user> -d <database> -f db/migrations/055_update_max_stores_limits.sql
```

**O directamente en Supabase SQL Editor:**
```sql
UPDATE plan_limits SET max_stores = 3 WHERE plan = 'growth';
UPDATE plan_limits SET max_stores = 10 WHERE plan = 'professional';

-- Verificar
SELECT plan, max_stores FROM plan_limits ORDER BY max_stores;
```

---

## ✅ Verificación Post-Actualización

```sql
-- Debe retornar:
-- free: 1
-- starter: 1
-- growth: 3
-- professional: 10

SELECT plan, max_stores
FROM plan_limits
ORDER BY
  CASE plan
    WHEN 'free' THEN 1
    WHEN 'starter' THEN 2
    WHEN 'growth' THEN 3
    WHEN 'professional' THEN 4
  END;
```

---

## 💰 Ejemplos de Pricing

### Usuario con Growth ($79/mes):
- ✅ Puede crear hasta 3 tiendas
- ✅ 1 solo pago de $79/mes cubre las 3 tiendas
- ❌ Intento de crear 4ta tienda → Error: "Store limit reached"

### Usuario con Professional ($169/mes):
- ✅ Puede crear hasta 10 tiendas
- ✅ 1 solo pago de $169/mes cubre las 10 tiendas
- ❌ Intento de crear 11va tienda → Error: "Store limit reached"

---

## 🎯 Impacto

**Antes de la corrección:**
- Usuario Professional pagaba $169/mes pero solo podía tener 3 tiendas
- Usuario Growth pagaba $79/mes y solo podía tener 1 tienda

**Después de la corrección:**
- Usuario Professional paga $169/mes y puede tener **10 tiendas** (3.3x más valor)
- Usuario Growth paga $79/mes y puede tener **3 tiendas** (3x más valor)

**Mejor propuesta de valor para usuarios multi-store.**

---

## 📋 Checklist de Implementación

- [ ] Ejecutar migration 055 en base de datos
- [ ] Verificar límites con query SELECT
- [ ] Deploy backend (si hay constantes hardcodeadas)
- [ ] Actualizar documentación de planes en frontend
- [ ] Test: Usuario Growth puede crear 3 tiendas
- [ ] Test: Usuario Growth NO puede crear 4ta tienda
- [ ] Test: Usuario Professional puede crear 10 tiendas

---

**Fecha:** 2026-01-12
**Migración:** 055_update_max_stores_limits.sql
**Status:** ✅ Lista para ejecutar

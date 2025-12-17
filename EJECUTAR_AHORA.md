# 🚨 EJECUTAR MIGRACIÓN 029 AHORA

**Tu situación:** Producción caída, sin tráfico, modo test
**Solución:** Script automático que lo hace todo

---

## ⚡ Opción 1: Script Automático (RECOMENDADO)

### Paso 1: Configurar DATABASE_URL

```bash
# Ir al directorio del proyecto
cd /Users/gastonlopez/Documents/Code/ORDEFY

# Configurar variable (REEMPLAZA CON TUS DATOS REALES)
export DATABASE_URL='postgresql://usuario:contraseña@host:5432/database'
```

**¿Dónde obtengo mi DATABASE_URL?**

**Si usas Supabase:**
1. Ir a https://supabase.com/dashboard
2. Tu proyecto → Settings → Database
3. Connection string → URI
4. Copiar y reemplazar `[YOUR-PASSWORD]` con tu contraseña

**Si usas Render/Railway/Heroku:**
- Dashboard → Environment Variables → DATABASE_URL

**Ejemplo:**
```bash
export DATABASE_URL='postgresql://postgres.abcd:MiP@ssw0rd123@aws-0-us-east-1.pooler.supabase.com:6543/postgres'
```

### Paso 2: Ejecutar Script

```bash
./scripts/fix-production-now.sh
```

El script hará TODO automáticamente:
- ✅ Verificar estado actual
- ✅ Detectar y limpiar duplicados (si existen)
- ✅ Ejecutar migración transaccional
- ✅ Verificar que todo se aplicó correctamente
- ✅ Ejecutar tests funcionales
- ✅ Mostrar resumen

**Tiempo total: 2-3 minutos**

---

## ⚡ Opción 2: Paso a Paso Manual

Si prefieres hacerlo manualmente:

### 1. Verificar estado
```bash
psql "$DATABASE_URL" -f db/migrations/verify_schema_before_029.sql
```

### 2. Ejecutar migración
```bash
psql "$DATABASE_URL" -f db/migrations/029_fix_critical_schema_transactional.sql
```

### 3. Verificar
```bash
psql "$DATABASE_URL" -c "
SELECT
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = 'shopify_webhook_idempotency' AND column_name = 'id') as webhook_ok,
    EXISTS(SELECT 1 FROM pg_indexes WHERE tablename = 'orders' AND indexname = 'idx_orders_shopify_store_unique') as orders_ok;
"
```

Debe retornar:
```
 webhook_ok | orders_ok
------------+-----------
 t          | t
```

---

## ⚡ Opción 3: Desde Node.js

```bash
node scripts/apply-migration-029.js --transactional
```

---

## 🧪 Testing Post-Migración

Después de ejecutar la migración:

### Test 1: Crear pedido desde Shopify
1. Ir a Shopify Admin → Orders
2. Create order (pedido de prueba)
3. Verificar que NO hay errores en logs
4. Verificar que el pedido aparece en tu base de datos:

```bash
psql "$DATABASE_URL" -c "
SELECT id, shopify_order_id, customer_email, total_price, created_at
FROM orders
ORDER BY created_at DESC
LIMIT 5;
"
```

### Test 2: Verificar webhooks
```bash
psql "$DATABASE_URL" -c "
SELECT shopify_topic, COUNT(*) as count
FROM shopify_webhook_idempotency
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY shopify_topic;
"
```

---

## 📋 Checklist de Éxito

```
[ ] DATABASE_URL configurada
[ ] Script ejecutado sin errores
[ ] Output muestra "✅ Migración 029 completada exitosamente"
[ ] Tests funcionales pasaron
[ ] Pedido de prueba creado en Shopify
[ ] Pedido aparece en base de datos
```

---

## 🆘 Troubleshooting

### Error: "DATABASE_URL not found"
```bash
# Verificar que está configurada
echo $DATABASE_URL

# Si está vacío, configúrala de nuevo
export DATABASE_URL='postgresql://...'
```

### Error: "psql: command not found"
```bash
# macOS
brew install postgresql

# Ubuntu
sudo apt-get install postgresql-client
```

### Error: "connection failed"
- Verificar que el DATABASE_URL es correcto
- Verificar que tienes acceso a internet
- Verificar que la base de datos está activa

---

## 📊 Qué Hace Exactamente

La migración corrige 2 errores:

**Error 1:** `column shopify_webhook_idempotency.id does not exist`
```sql
ALTER TABLE shopify_webhook_idempotency
ADD COLUMN id UUID PRIMARY KEY DEFAULT gen_random_uuid();
```

**Error 2:** `no unique or exclusion constraint matching ON CONFLICT`
```sql
CREATE UNIQUE INDEX idx_orders_shopify_store_unique
ON orders(shopify_order_id, store_id)
WHERE shopify_order_id IS NOT NULL;
```

---

## 🎯 Comando Único (Copiar y Pegar)

```bash
# REEMPLAZA postgresql://... con tu DATABASE_URL real
export DATABASE_URL='postgresql://usuario:password@host:5432/database' && \
cd /Users/gastonlopez/Documents/Code/ORDEFY && \
./scripts/fix-production-now.sh
```

---

## 📞 Ayuda

Si algo sale mal:

1. **NO ejecutar más comandos**
2. Capturar el error completo
3. Revisar logs:
   ```bash
   tail -f logs/backend.log
   ```
4. Verificar estado:
   ```bash
   psql "$DATABASE_URL" -f db/migrations/verify_schema_before_029.sql
   ```

---

**Última actualización:** 2025-01-17
**Tiempo estimado:** 2-3 minutos
**Downtime:** ~5 segundos (durante creación de índices)

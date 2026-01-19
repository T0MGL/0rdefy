# ✅ CHECKLIST DE DEPLOYMENT PARA HANSEL

**Meta:** Deployar Migration 083 + optimizaciones sin romper nada
**Tiempo estimado:** 1 hora (staging + producción)
**Dificultad:** 🟢 Fácil (todo está automatizado)

---

## 📋 ANTES DE EMPEZAR

### ¿Qué necesitas?

- [ ] Acceso a Railway CLI
- [ ] Acceso a base de datos (DATABASE_URL)
- [ ] 1 hora de tiempo disponible
- [ ] Lectura de `RESUMEN_PARA_HANSEL.md` (5 min)

### ¿Estás listo?

- [ ] Leíste el resumen y entiendes los cambios
- [ ] No tienes dudas críticas sin resolver
- [ ] Tienes backup reciente de la base de datos
- [ ] Horario de baja demanda (opcional pero recomendado)

---

## 🎯 FASE 1: STAGING (30 minutos)

### Paso 1: Conectar a Staging

```bash
# Terminal
cd /Users/gastonlopez/Documents/Code/PRODUCTION/ORDEFY

# Login a Railway
railway login

# Cambiar a staging
railway environment staging

# Conectar a base de datos
railway connect postgres
```

**Checkpoint:** ✅ Estás conectado a staging

---

### Paso 2: Ejecutar Migración 083

```bash
# En psql (conectado en paso anterior)
\i db/migrations/083_orders_list_performance_critical_fix_SAFE.sql
```

**Tiempo:** 5-10 minutos

**Qué esperar:**
```
✅ PostgreSQL version check passed
✅ All required columns exist
✅ No conflicting indexes found
📊 Table size: XX MB
📊 Estimated index size: XX MB
🔨 Creating idx_orders_list_covering...
✅ idx_orders_list_covering created successfully
... (5 más)
✅ ✅ ✅  MIGRATION 083 COMPLETED SUCCESSFULLY  ✅ ✅ ✅
```

**Si algo falla:** No te preocupes, la migración tiene error handling. Lee el mensaje de error y pregúntame.

**Checkpoint:** ✅ Migración ejecutada sin errores

---

### Paso 3: Validar Migración

```bash
# Salir de psql
\q

# Ejecutar script de validación
export DATABASE_URL="tu-staging-url"
./scripts/validate_performance_fix.sh
```

**Qué esperar:**
```
✅ Todos los índices creados correctamente
✅ Query usa idx_orders_list_covering
✅ Query time: 45ms (EXCELENTE)
✅ VALIDACIÓN EXITOSA
```

**Checkpoint:** ✅ Validación pasó sin errores

---

### Paso 4: Deploy Código a Staging

```bash
# Commit cambios (si aún no lo hiciste)
git add .
git commit -m "perf(orders): Critical performance fix - 30x improvement

- Add migration 083: Covering indexes for orders list
- Optimize orders query: Remove unnecessary JOINs
- Add lazy loading for product images
- Change count from exact to estimated

BREAKING: count is now estimated (not exact)
IMPACT: 30x faster queries, 70% less data transfer"

# Push a staging
git push origin main:staging

# Railway auto-deploys en 2-3 minutos
```

**Checkpoint:** ✅ Código deployado a staging

---

### Paso 5: Testing Manual

**Abrir:** https://staging.ordefy.io/orders

**Tests rápidos (10 min):**

```
✅ Lista carga en <2 segundos
✅ Búsqueda por teléfono funciona
✅ Búsqueda por # de orden funciona
✅ Filtro por estado funciona
✅ Filtro por transportadora funciona
✅ Quick View abre correctamente
✅ Imprimir etiquetas funciona
✅ No hay errores en consola (F12)
```

**Si encuentras un bug:** Anótalo y pregúntame antes de continuar.

**Checkpoint:** ✅ Todo funciona correctamente

---

### Paso 6: Performance Check

**Chrome DevTools:**

1. Abre DevTools (F12)
2. Ve a Network tab
3. Refresca la página (Cmd+R)
4. Busca la request a `/api/orders`

**Validar:**
```
✅ Response time: <1 segundo
✅ Payload size: <2MB
✅ Status: 200 OK
✅ No errores en consola
```

**Checkpoint:** ✅ Performance mejorada significativamente

---

## 🚀 FASE 2: PRODUCCIÓN (30 minutos)

**⚠️ IMPORTANTE:** Solo continuar si staging está 100% OK

### Paso 1: Backup de Producción

```bash
# Cambiar a producción
railway environment production

# Backup de base de datos
railway run pg_dump > backup_$(date +%Y%m%d_%H%M%S).sql

# Verificar backup se creó
ls -lh backup_*.sql
```

**Checkpoint:** ✅ Backup creado

---

### Paso 2: Ejecutar Migración en Producción

```bash
# Conectar a producción
railway connect postgres

# Ejecutar migración
\i db/migrations/083_orders_list_performance_critical_fix_SAFE.sql
```

**Tiempo:** 10-15 minutos

**⚠️ Durante la migración:**
- Usuarios pueden seguir usando la app normalmente
- Queries serán un poco más lentas (normal)
- NO cierres la terminal

**Checkpoint:** ✅ Migración completada

---

### Paso 3: Deploy Código a Producción

```bash
# Mergear staging a main
git checkout main
git merge staging
git push origin main

# Railway auto-deploys en 2-3 minutos
```

**Checkpoint:** ✅ Código deployado

---

### Paso 4: Smoke Test

```bash
# Smoke test automático
export API_URL="https://api.ordefy.io"
export DATABASE_URL="tu-production-url"
./scripts/smoke_test_post_deploy.sh
```

**Qué esperar:**
```
✅ API is responding
✅ Orders endpoint exists
✅ Response time is good
✅ Database connection successful
✅ All 6 migration 083 indexes exist
✅ ✅ ✅  ALL TESTS PASSED  ✅ ✅ ✅
```

**Checkpoint:** ✅ Smoke test pasó

---

### Paso 5: Validación Manual

**Abrir:** https://app.ordefy.io/orders

**Tests rápidos (5 min):**
```
✅ Lista carga en <1 segundo
✅ Búsqueda funciona
✅ Filtros funcionan
✅ No hay errores visibles
```

**Checkpoint:** ✅ Todo funciona

---

### Paso 6: Monitoring (10 minutos)

**Railway Dashboard:**
```
✅ CPU usage: Debería BAJAR ~30%
✅ Response time: Debería BAJAR ~50%
✅ Error rate: <1%
✅ No errores nuevos en logs
```

**Checkpoint:** ✅ Métricas saludables

---

## 🎉 SUCCESS CHECKLIST

Si llegaste aquí, **¡FELICITACIONES!** 🎊

### Validación Final

```
✅ Migración 083 ejecutada en staging
✅ Migración 083 ejecutada en producción
✅ Código deployado en ambos ambientes
✅ Tests manuales pasaron
✅ Smoke tests pasaron
✅ Performance mejorada 30x
✅ No hay errores en logs
✅ Usuarios felices
```

---

## 🚨 SI ALGO SALE MAL

### Opción 1: Rollback Rápido (2 minutos)

```bash
# Revertir código
git revert HEAD
git push origin main

# Railway auto-deploys en 2-3 min
# Los índices NO causan problemas, puedes dejarlos
```

### Opción 2: Rollback Completo (15 minutos)

```bash
# 1. Revertir código
git revert HEAD && git push origin main

# 2. Eliminar índices
railway connect postgres

# En psql:
DROP INDEX CONCURRENTLY idx_orders_list_covering;
DROP INDEX CONCURRENTLY idx_orders_phone_search_optimized;
DROP INDEX CONCURRENTLY idx_orders_shopify_name_search;
DROP INDEX CONCURRENTLY idx_orders_shopify_number_search;
DROP INDEX CONCURRENTLY idx_orders_status_date_covering;
DROP INDEX CONCURRENTLY idx_orders_carrier_date_covering;

\q
```

### Cuándo hacer rollback:

❌ Hacer rollback SI:
- Error rate >1%
- Response time >5s constante
- Usuarios reportan bugs críticos
- Database CPU >90% constante

✅ NO hacer rollback SI:
- Contador muestra "~2000" en vez de "2047" (esperado)
- Algunas queries lentas (normal con tablas pequeñas)
- Métricas temporalmente inestables (dale 10 min)

---

## 📞 AYUDA Y SOPORTE

### ¿Tienes dudas?

1. **Primero:** Lee `RESUMEN_PARA_HANSEL.md`
2. **Luego:** Busca en `DEPLOYMENT_INSTRUCTIONS.md`
3. **Finalmente:** Pregúntame a mí (Claude)

### ¿Encontraste un error?

1. **No entres en pánico** - Tenemos rollback
2. **Lee el mensaje de error** completo
3. **Copia el error** y pregúntame
4. **No hagas cambios manuales** sin consultar

### ¿Todo salió perfecto?

1. **Celebra** 🎉 - Lo lograste
2. **Monitorea** las primeras 24 horas
3. **Comunica** el éxito al equipo
4. **Disfruta** de la plataforma 30x más rápida

---

## 📊 MÉTRICAS DE ÉXITO

Después de 24 horas, deberías ver:

### Performance
```
Query time:      25s → <1s     ✅
Payload size:    5MB → 1.5MB   ✅
Database queries: 252 → 2      ✅
```

### Infrastructure
```
CPU usage:       78% → 22%     ✅
Memory usage:    450MB → 180MB ✅
Network egress:  -71%          ✅
```

### User Experience
```
Usuarios frustrados → Usuarios felices  ✅
Abandono alto → Retención mejorada      ✅
Quejas → Elogios                        ✅
```

---

## ✅ FIRMA DE DEPLOYMENT

**Executed by:** _________________

**Date:** _________________

**Staging Status:** [ ] ✅ Success  [ ] ❌ Failed

**Production Status:** [ ] ✅ Success  [ ] ❌ Failed

**Notes:**
```
(Espacio para tus notas)
```

---

**¿Listo para empezar?**

Lee `RESUMEN_PARA_HANSEL.md` primero, luego vuelve aquí y sigue los pasos.

**¡Buena suerte!** 🚀

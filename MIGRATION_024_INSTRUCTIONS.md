# Migration 024: Webhook Queue System

## Error
```
relation "public.webhook_queue" does not exist
```

## Problema
El sistema de cola de webhooks (`WebhookQueueService`) está intentando usar la tabla `webhook_queue` que no existe en la base de datos. Esta tabla es crítica para manejar picos de tráfico de webhooks de Shopify durante eventos como Black Friday o flash sales.

## Solución

### Opción 1: Aplicar desde Supabase Dashboard (RECOMENDADO)

1. Ve a tu panel de Supabase: https://ecommerce-software-supabase.aqiebe.easypanel.host
2. Navega a: **SQL Editor**
3. Crea un nuevo query
4. Copia y pega el contenido del archivo: `db/migrations/024_webhook_queue_system.sql`
5. Ejecuta el query
6. Verifica que la tabla fue creada: `SELECT * FROM webhook_queue LIMIT 1;`

### Opción 2: Desde línea de comandos (si tienes acceso)

```bash
# Conéctate a la base de datos
psql "postgresql://postgres:[PASSWORD]@ecommerce-software-supabase.aqiebe.easypanel.host:5432/postgres"

# Aplica la migración
\i db/migrations/024_webhook_queue_system.sql
```

### Opción 3: Via Supabase CLI

```bash
supabase db push --db-url "postgresql://postgres:[PASSWORD]@ecommerce-software-supabase.aqiebe.easypanel.host:5432/postgres"
```

## Después de aplicar la migración

1. Abre el archivo: `api/routes/shopify.ts`
2. Busca la línea ~28 que dice: `/* // Start processing webhooks in background`
3. Descomenta las líneas 28-38 para habilitar el procesamiento automático
4. Reinicia el servidor API

## ¿Qué hace esta migración?

Crea el sistema de cola de webhooks que incluye:
- **Tabla `webhook_queue`**: Cola persistente para procesar webhooks asincrónicamente
- **Índices de rendimiento**: Para búsqueda rápida y procesamiento eficiente
- **Vista `webhook_queue_stats`**: Estadísticas en tiempo real de la cola
- **Función `cleanup_old_webhook_queue()`**: Limpieza automática de webhooks procesados > 7 días

## Beneficios

✅ Respuesta a Shopify < 1 segundo (requisito: < 5 segundos)
✅ Maneja picos de tráfico sin timeouts
✅ Reintentos automáticos con exponential backoff
✅ Monitoreo de estadísticas de rendimiento
✅ Limpieza automática de datos antiguos

## Cron Jobs Recomendados

Después de aplicar la migración, configura estos cron jobs:

```bash
# Limpiar webhooks antiguos (diario a las 3 AM)
0 3 * * * curl -X POST https://api.ordefy.io/api/shopify/webhook-cleanup

# Ver estadísticas (opcional, para monitoreo)
*/30 * * * * curl -X GET https://api.ordefy.io/api/shopify/queue/stats
```

## Estado Actual

- ❌ Tabla `webhook_queue` no existe
- ❌ Procesamiento automático de cola: DESACTIVADO
- ⚠️ Los webhooks se procesan sincrónicamente (puede causar timeouts en picos de tráfico)
- ✅ Funcionalidad básica de webhooks: FUNCIONANDO

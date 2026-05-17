# SIFEN async rollout (migration 189 + worker)

## Contexto

SIFEN produccion rechazo todas las emisiones sync por politica de seguridad (Manual Tecnico v150 seccion 7.10). Migracion al WS asincrono `siRecepLoteDE` + worker dedicado para dispatch y polling. Identidades migran via feature flag `fiscal_identities.sifen_async_enabled` para rollout quirurgico con rollback per-tenant.

## Cambios incluidos

| Archivo | Tipo | Descripcion |
|---|---|---|
| `db/migrations/189_sifen_async.sql` | Nuevo | Columnas async en invoices, indices parciales, triggers pg_notify, feature flag, RPC actualizado |
| `api/services/sifen/sifen-client.ts` | Modificado | `sendDELote`, `consultLote`, `https.Agent` keep-alive compartido, soporte AbortSignal |
| `api/services/invoicing.service.ts` | Modificado | Branch async en `signInjectSend`, status `queued`, retry async, `loadCertificateMaterial`/`emitOwnerAlert`/`logInvoiceEvent` exportados |
| `api/workers/sifen-worker.ts` | Nuevo | Bootstrap, Sentry, graceful shutdown SIGTERM |
| `api/workers/sifen-dispatcher.ts` | Nuevo | LISTEN + batch 50 + idempotencia via SHA256 + reserva atomica |
| `api/workers/sifen-poller.ts` | Nuevo | LISTEN + cron fallback + backoff exponencial + per-CDC dispatch |
| `api/workers/instrument-worker.ts` | Nuevo | Init Sentry para el proceso worker |
| `api/workers/shared/pg-listener.ts` | Nuevo | Wrapper LISTEN/NOTIFY con reconexion |
| `api/workers/shared/key-cache.ts` | Nuevo | LRU para cert PEMs descifrados, TTL 5min |
| `package.json` | Modificado | `jszip` dep + scripts `worker:sifen:dev` / `worker:sifen:start` |

## Variables de entorno requeridas en el worker Railway

```bash
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
SIFEN_ENCRYPTION_KEY=...                 # mismo que el web
SENTRY_DSN=...                            # opcional pero recomendado
NODE_ENV=production

# Conexion Postgres directa para LISTEN/NOTIFY. Una de las tres:
SIFEN_WORKER_PG_URL=postgres://postgres:<pwd>@db.<ref>.supabase.co:5432/postgres
# O bien:
DATABASE_URL=postgres://postgres:<pwd>@db.<ref>.supabase.co:5432/postgres
# O bien:
SUPABASE_DB_PASSWORD=<pwd>   # combinado con SUPABASE_URL para derivar el host

# Opcional: limitar a dispatcher o poller (default 'all')
SIFEN_WORKER_ROLE=all|dispatcher|poller
```

## Rollout paso a paso

### 1. Correr migration (idempotente)

```bash
psql "$DATABASE_URL" -f db/migrations/189_sifen_async.sql
```

Verifica que no rompe constraints:

```sql
SELECT pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.invoices'::regclass
  AND conname = 'invoices_sifen_status_check';
```

Debe incluir `'queued'`.

### 2. Verificar payload del RPC

```sql
SELECT (get_fiscal_context_for_store('<store_id>')->'identity'->>'sifen_async_enabled')::boolean;
```

Debe devolver `false` para todas las identidades existentes (default).

### 3. Deploy web sin tocar nada mas

Deployar el web service como siempre. Comportamiento prod: identico al actual (todas las identidades arrancan con `sifen_async_enabled = false`). Cero riesgo, cero downtime, cero codigo a revertir si algo falla.

### 4. Levantar el worker en Railway

Nuevo servicio Railway "ordefy-sifen-worker":

- Start command: `npm run worker:sifen:start`
- Env vars: las listadas arriba
- Replicas: 1 al principio. `SELECT FOR UPDATE SKIP LOCKED` permite escalar a 3+ cuando volumen lo justifique sin tocar codigo.
- Health: Railway no chequea HTTP, mira que el proceso este vivo. Log de `[sifen-worker] ready (role=all)` confirma start.

### 5. Smoke test en SIFEN test

```sql
-- Habilita async en una identidad de prueba (sifen_environment='test')
UPDATE fiscal_identities
SET sifen_async_enabled = true
WHERE id = '<identity_test_id>'
  AND sifen_environment = 'test';
```

Emitir una factura desde el UI de esa tienda. Observar logs del worker:

1. `[SifenDispatcher] lote sent dispatch=<hash> count=1 protocol=<n> firstPoll=<segs>s`
2. Esperar ~60-120 segundos
3. `[SifenPoller] lote processed protocol=<n> entries=1 approved=1`

Verificar en DB:

```sql
SELECT id, sifen_status, sifen_protocol_number, sifen_lote_submitted_at,
       approved_at, sifen_lote_poll_attempts, sifen_response_code
FROM invoices
WHERE identity_id = '<identity_test_id>'
ORDER BY created_at DESC LIMIT 5;
```

Resultado esperado: `sifen_status='approved'`, `sifen_lote_poll_attempts<=2`, `sifen_response_code` en banda 0260-0299.

### 6. Activar una identidad piloto en prod

Pickear UNA identidad prod no critica y activar:

```sql
UPDATE fiscal_identities
SET sifen_async_enabled = true
WHERE id = '<identity_prod_piloto_id>';
```

Emitir 1 factura real. Esperar 5-15 min para approved.

### 7. Rollout gradual

Si la piloto aprueba sin issues por 24hs, escalar:

```sql
-- Ramp: 5 identidades por dia, ordenadas por menor volumen.
UPDATE fiscal_identities
SET sifen_async_enabled = true
WHERE id IN (
  SELECT fi.id
  FROM fiscal_identities fi
  WHERE fi.sifen_environment = 'prod'
    AND fi.sifen_async_enabled = false
  ORDER BY fi.created_at
  LIMIT 5
);
```

Monitorear daily:

```sql
SELECT sifen_status,
       COUNT(*) AS qty,
       ROUND(AVG(EXTRACT(EPOCH FROM (approved_at - sifen_lote_submitted_at))/60)::numeric, 1) AS avg_min_to_approve,
       MAX(sifen_lote_poll_attempts) AS max_polls
FROM invoices
WHERE created_at > NOW() - INTERVAL '24 hours'
  AND sifen_status NOT IN ('demo', 'pending')
GROUP BY sifen_status
ORDER BY 1;
```

Target: `0 rejected estructurales`, `avg_min_to_approve` 1-10 min, `max_polls < 5` en P95.

## Rollback

Per-tenant inmediato sin redeploy:

```sql
UPDATE fiscal_identities
SET sifen_async_enabled = false
WHERE id = '<identity_id>';
```

La identidad vuelve al path sync legacy. Las invoices en flight ('queued' o 'sent') terminan su ciclo async normal. Nuevas invoices van por sync.

Si necesitas rollback global del worker (no es esperado): apaga el servicio Railway. Las invoices 'queued' quedan colgadas hasta que vuelva. Para drenarlas manualmente:

```sql
-- Volver a pending para que el path sync legacy las tome cuando re-emita.
UPDATE invoices
SET sifen_status = 'pending',
    sifen_lote_dispatch_key = NULL,
    sifen_protocol_number = NULL,
    sifen_lote_submitted_at = NULL,
    sifen_lote_next_poll_at = NULL,
    sifen_lote_poll_attempts = 0
WHERE sifen_status = 'queued';
```

## Monitoreo continuo

### Owner alerts emitidos por el worker

- `invoice_approved_async` (severity low): cada DE aprobado
- `invoice_rejected_async` (severity high): DE rechazado individual (banda fuera de aprobacion)
- `invoice_polling_stuck` (severity critical): >24 polls sin respuesta, revisar manualmente en e-Kuatia
- `invoice_lote_not_found` (severity high): SIFEN reporta 0360, lote no existe

### Query de salud (correr en Supabase cada hora si querer alertas custom)

```sql
SELECT
  COUNT(*) FILTER (WHERE sifen_status = 'queued' AND created_at < NOW() - INTERVAL '5 min') AS queued_stuck,
  COUNT(*) FILTER (WHERE sifen_status = 'sent' AND sifen_lote_submitted_at < NOW() - INTERVAL '1 hour') AS sent_long,
  COUNT(*) FILTER (WHERE sifen_status = 'rejected' AND created_at > NOW() - INTERVAL '1 hour') AS rejected_recent
FROM invoices
WHERE sifen_environment != 'demo';
```

- `queued_stuck > 0`: dispatcher caido o stuck. Revisar logs worker.
- `sent_long > 0`: poller caido o stuck. Revisar logs worker.
- `rejected_recent > 5`: anomalia, escalation.

## Decisiones de diseno (resumen)

- **Idempotencia**: `sifen_lote_dispatch_key` UNIQUE deriva de SHA256(xml_signed concat). Worker restart no duplica lote en SIFEN.
- **Sin polling fijo sobre invoices**: triggers `pg_notify` despiertan dispatcher y poller. Sweep cada 60s solo por seguridad.
- **Cache LRU de cert PEMs**: 100 entries x TTL 5 min, reduce ~98% AES-GCM decryption. Si rota cert, max delay 5 min.
- **Connection pooling SIFEN**: `https.Agent` con keepAlive 30s + 8 sockets max. Evita handshake TLS por cada request.
- **AbortController end-to-end**: SIGTERM aborta requests HTTPS en curso. Cero requests huerfanos.
- **Lote homogeneo**: dispatcher agrupa por `(identity_id, tipo_documento, env)`. SIFEN rechaza mezclar tipos.
- **Backoff polling**: 5min -> 10 -> 20 -> 40, cap 60min, max 24 attempts (~24 hs). Despues critical alert.
- **Feature flag per-tenant**: rollout y rollback sin redeploy ni reinicio. Bullet-proof contra incidentes en una sola identidad.

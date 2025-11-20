# Guía de Integración con Shopify - Ordefy

## Tabla de Contenidos

1. [Resumen General](#resumen-general)
2. [Variables de Entorno](#variables-de-entorno)
3. [Arquitectura](#arquitectura)
4. [Flujo OAuth 2.0](#flujo-oauth-20)
5. [Webhooks](#webhooks)
6. [Permisos (Scopes)](#permisos-scopes)
7. [Endpoints API](#endpoints-api)
8. [Base de Datos](#base-de-datos)
9. [Seguridad](#seguridad)
10. [Sincronización de Datos](#sincronización-de-datos)
11. [Sistema de Confiabilidad de Webhooks](#sistema-de-confiabilidad-de-webhooks)
12. [Mantenimiento](#mantenimiento)

---

## Resumen General

La integración con Shopify en Ordefy permite conectar tiendas de Shopify para sincronizar productos, clientes y órdenes. La integración utiliza OAuth 2.0 para autenticación segura y webhooks para recibir actualizaciones en tiempo real.

### Características Principales

✅ **OAuth 2.0**: Autenticación segura sin necesidad de compartir contraseñas
✅ **Sincronización bidireccional**: Actualiza productos desde Ordefy hacia Shopify
✅ **Webhooks en tiempo real**: Recibe nuevas órdenes automáticamente
✅ **Sistema de reintentos**: Manejo automático de fallos con exponential backoff
✅ **Deduplicación**: Previene procesamiento duplicado de webhooks
✅ **Monitoreo de salud**: Dashboard de métricas y estado de webhooks

### Flujo de Datos

```
┌─────────────┐         ┌──────────────┐         ┌─────────────┐
│   Shopify   │ ◄─────► │    Ordefy    │ ◄─────► │  PostgreSQL │
│    Store    │  OAuth  │  Backend API │  CRUD   │  (Supabase) │
└─────────────┘         └──────────────┘         └─────────────┘
       │                        │
       │ Webhooks               │ REST API
       ▼                        ▼
┌─────────────┐         ┌──────────────┐
│   Orders    │         │   Frontend   │
│  Products   │         │  Dashboard   │
│  Customers  │         └──────────────┘
└─────────────┘
```

---

## Variables de Entorno

### Backend (.env en /api)

```bash
# ================================================================
# SHOPIFY INTEGRATION - OAuth
# ================================================================

# Shopify App Credentials (obtenidas del Partner Dashboard)
SHOPIFY_API_KEY=your_shopify_api_key
SHOPIFY_API_SECRET=your_shopify_api_secret

# OAuth Scopes (permisos requeridos)
SHOPIFY_SCOPES=read_products,write_products,read_orders,write_orders,read_customers,write_customers

# OAuth Redirect URI (debe coincidir con la configuración en Shopify)
SHOPIFY_REDIRECT_URI=https://api.ordefy.io/api/shopify-oauth/callback

# ================================================================
# SHOPIFY INTEGRATION - API URLs
# ================================================================

# URL del frontend (para redirecciones después de OAuth)
APP_URL=https://ordefy.io

# URL del backend (para webhooks)
API_URL=https://api.ordefy.io

# ================================================================
# N8N INTEGRATION (para confirmación de órdenes vía WhatsApp)
# ================================================================

# Webhook URL de n8n para enviar nuevas órdenes
N8N_WEBHOOK_URL=https://n8n.ordefy.io/webhook/shopify-order-confirmation
```

### Frontend (.env en /src)

```bash
# API Backend URL
VITE_API_URL=https://api.ordefy.io
```

---

## Arquitectura

### Componentes Principales

#### 1. **OAuth Flow** (`api/routes/shopify-oauth.ts`)
- Maneja el flujo de autorización OAuth 2.0
- Valida HMAC signatures
- Almacena access tokens de forma segura
- Registra webhooks automáticamente

#### 2. **Shopify API Client** (`api/services/shopify-client.service.ts`)
- Cliente HTTP para comunicación con Shopify Admin API
- Rate limiting (2 req/seg)
- Manejo de errores y reintentos

#### 3. **Import Service** (`api/services/shopify-import.service.ts`)
- Sincronización inicial de productos y clientes
- Jobs en background con progress tracking
- Paginación con cursors

#### 4. **Webhook Service** (`api/services/shopify-webhook.service.ts`)
- Procesamiento de webhooks entrantes
- Verificación HMAC
- Integración con n8n para confirmación de órdenes

#### 5. **Webhook Manager** (`api/services/shopify-webhook-manager.service.ts`)
- Sistema de idempotencia (previene duplicados)
- Cola de reintentos automáticos
- Métricas y monitoreo de salud

#### 6. **Product Sync Service** (`api/services/shopify-product-sync.service.ts`)
- Sincronización bidireccional de productos
- Update/Delete en Shopify desde Ordefy

---

## Flujo OAuth 2.0

### 1. Inicio de la Integración

**Endpoint**: `GET /api/shopify-oauth/auth` (alias: `/install`)

**Parámetros**:
```
shop: string           - Dominio de la tienda (e.g., "mystore.myshopify.com")
user_id?: string       - ID del usuario (opcional)
store_id?: string      - ID del store en Ordefy (opcional)
```

**Proceso**:
1. Valida el dominio de la tienda (formato `*.myshopify.com`)
2. Genera un `state` aleatorio para CSRF protection
3. Almacena el state en `shopify_oauth_states` (expires en 10 min)
4. Construye la URL de autorización de Shopify
5. Redirige al usuario a Shopify

**URL de Autorización Construida**:
```
https://{shop}/admin/oauth/authorize?
  client_id={SHOPIFY_API_KEY}&
  scope={SHOPIFY_SCOPES}&
  redirect_uri={SHOPIFY_REDIRECT_URI}&
  state={random_state}
```

**Ejemplo de URL**:
```
https://mystore.myshopify.com/admin/oauth/authorize?
  client_id=abc123&
  scope=read_products,write_products,read_orders,write_orders&
  redirect_uri=https://api.ordefy.io/api/shopify-oauth/callback&
  state=e8f2a9c4b1d3f7a6...
```

### 2. Callback de Shopify

**Endpoint**: `GET /api/shopify-oauth/callback`

**Parámetros (enviados por Shopify)**:
```
code: string          - Authorization code
hmac: string          - HMAC-SHA256 signature
shop: string          - Shop domain
state: string         - CSRF token
timestamp: string     - Request timestamp
```

**Proceso**:
1. **Validación HMAC**: Verifica firma de Shopify
2. **Validación State**: Verifica CSRF token (exists, not used, not expired)
3. **Exchange Code**: Intercambia code por access_token
4. **Fetch Shop Info**: Obtiene nombre de la tienda
5. **Save Integration**: Guarda en `shopify_integrations`
6. **Register Webhooks**: Registra webhooks automáticamente (8 topics)
7. **Redirect**: Redirige al frontend con status=success

**Respuesta de Exchange**:
```json
{
  "access_token": "shpat_abc123...",
  "scope": "read_products,write_products,..."
}
```

### 3. Registro Automático de Webhooks

Después del OAuth, se registran automáticamente 8 webhooks:

| Topic | Endpoint | Propósito |
|-------|----------|-----------|
| `orders/create` | `/api/shopify/webhook/orders-create` | Nuevas órdenes |
| `orders/updated` | `/api/shopify/webhook/orders-updated` | Actualizaciones de órdenes |
| `products/create` | `/api/shopify/webhook/products-create` | Nuevos productos |
| `products/update` | `/api/shopify/webhook/products-update` | Actualizaciones de productos |
| `products/delete` | `/api/shopify/webhook/products-delete` | Productos eliminados |
| `customers/create` | `/api/shopify/webhook/customers-create` | Nuevos clientes |
| `customers/update` | `/api/shopify/webhook/customers-update` | Actualizaciones de clientes |
| `app/uninstalled` | `/api/shopify/webhook/app-uninstalled` | App desinstalada |

---

## Webhooks

### Verificación de Seguridad

Todos los webhooks verifican:
1. **HMAC Signature**: Valida firma SHA256
2. **Replay Protection**: Rechaza webhooks > 5 minutos
3. **Idempotency**: Previene procesamiento duplicado

### Webhook: orders/create

**Endpoint**: `POST /api/shopify/webhook/orders-create`

**Headers requeridos**:
```
X-Shopify-Shop-Domain: mystore.myshopify.com
X-Shopify-Hmac-Sha256: base64_encoded_signature
```

**Proceso**:
1. Valida headers y HMAC signature
2. Genera idempotency key: `{order_id}:{topic}:{timestamp_hash}`
3. Verifica duplicado en `shopify_webhook_idempotency`
4. Procesa orden:
   - Crea orden en tabla `orders`
   - Asocia customer si existe
   - Envía a n8n para confirmación WhatsApp
5. Registra métricas en `shopify_webhook_metrics`
6. Si falla, agrega a `shopify_webhook_retry_queue`

**Payload de ejemplo**:
```json
{
  "id": 820982911946154508,
  "email": "jon@example.com",
  "order_number": 1234,
  "financial_status": "pending",
  "fulfillment_status": null,
  "total_price": "199.00",
  "currency": "USD",
  "line_items": [
    {
      "id": 466157049,
      "title": "Product Title",
      "quantity": 1,
      "price": "199.00"
    }
  ],
  "customer": {
    "id": 207119551,
    "email": "jon@example.com",
    "first_name": "Jon",
    "last_name": "Snow"
  }
}
```

### Webhook: products/delete

**Endpoint**: `POST /api/shopify/webhook/products-delete`

**Proceso**:
1. Valida HMAC signature
2. Busca producto por `shopify_product_id`
3. Elimina producto de base de datos local
4. Registra evento en `shopify_webhook_events`

**Payload de ejemplo**:
```json
{
  "id": 788032119674292922
}
```

---

## Permisos (Scopes)

### Scopes Requeridos

```
SHOPIFY_SCOPES=read_products,write_products,read_orders,write_orders,read_customers,write_customers
```

### Detalle de Permisos

| Scope | Propósito |
|-------|-----------|
| `read_products` | Leer catálogo de productos |
| `write_products` | Actualizar/crear productos desde Ordefy |
| `read_orders` | Leer órdenes |
| `write_orders` | Actualizar estado de órdenes (confirmación, cancelación) |
| `read_customers` | Leer clientes |
| `write_customers` | Actualizar información de clientes |

### Scopes Adicionales (opcional)

Si necesitas más funcionalidades:

```
read_inventory        - Gestión de inventario
write_inventory       - Actualizar stock
read_fulfillments     - Estado de envíos
write_fulfillments    - Crear/actualizar envíos
```

---

## Endpoints API

### OAuth & Configuración

#### `GET /api/shopify-oauth/auth`
Inicia el flujo OAuth.

**Query Params**:
- `shop` (required): Shop domain
- `user_id` (optional): User ID
- `store_id` (optional): Store ID

**Respuesta**: Redirect a Shopify

---

#### `GET /api/shopify-oauth/callback`
Callback de OAuth (llamado por Shopify).

**Query Params**:
- `code`, `hmac`, `shop`, `state`, `timestamp`

**Respuesta**: Redirect al frontend

---

#### `GET /api/shopify-oauth/status`
Verifica estado de integración.

**Query Params**:
- `shop` (required)

**Respuesta**:
```json
{
  "connected": true,
  "shop": "mystore.myshopify.com",
  "scope": "read_products,write_products,...",
  "installed_at": "2024-01-15T10:00:00Z",
  "last_sync_at": "2024-01-15T14:30:00Z",
  "status": "active"
}
```

---

#### `DELETE /api/shopify-oauth/disconnect`
Desconecta integración.

**Query Params**:
- `shop` (required)

**Headers**:
- `Authorization: Bearer {token}`
- `X-Store-ID: {store_id}`

**Respuesta**:
```json
{
  "success": true,
  "message": "Shopify integration disconnected"
}
```

---

### Sincronización Manual

#### `POST /api/shopify/manual-sync`
Inicia sincronización manual.

**Headers**:
- `Authorization: Bearer {token}`
- `X-Store-ID: {store_id}`

**Body**:
```json
{
  "sync_type": "products" | "customers" | "all"
}
```

**Respuesta**:
```json
{
  "success": true,
  "job_ids": ["uuid-1", "uuid-2"],
  "message": "Sincronizacion manual iniciada",
  "note": "Las nuevas ordenes se cargan automaticamente via webhooks"
}
```

**Nota**: NO se sincronizan órdenes históricas para mantener precisión en analíticas.

---

#### `GET /api/shopify/import-status/:integration_id`
Obtiene progreso de importación.

**Headers**: Auth + Store-ID

**Respuesta**:
```json
{
  "success": true,
  "jobs": [
    {
      "id": "uuid",
      "job_type": "manual",
      "import_type": "products",
      "status": "processing",
      "total_items": 150,
      "processed_items": 75,
      "success_items": 73,
      "failed_items": 2,
      "progress_percentage": 50
    }
  ]
}
```

---

### Webhooks de Shopify

#### `POST /api/shopify/webhook/orders-create`
Recibe nuevas órdenes de Shopify.

**Headers**:
- `X-Shopify-Shop-Domain`
- `X-Shopify-Hmac-Sha256`

**Respuesta**:
```json
{
  "success": true,
  "order_id": "uuid",
  "processing_time_ms": 234
}
```

---

#### `POST /api/shopify/webhook/products-delete`
Recibe notificación de producto eliminado.

**Headers**: Same as above

**Respuesta**:
```json
{
  "success": true,
  "message": "Product deleted"
}
```

---

### Gestión de Webhooks

#### `POST /api/shopify/webhooks/setup`
Registra webhooks manualmente.

**Respuesta**:
```json
{
  "success": true,
  "registered": ["orders/create", "products/delete"],
  "skipped": ["orders/updated"],
  "errors": []
}
```

---

#### `GET /api/shopify/webhooks/verify`
Verifica configuración de webhooks.

**Respuesta**:
```json
{
  "success": true,
  "valid": true,
  "missing": [],
  "misconfigured": []
}
```

---

#### `GET /api/shopify/webhooks/list`
Lista webhooks registrados en Shopify.

**Respuesta**:
```json
{
  "success": true,
  "webhooks": [
    {
      "id": "1234567",
      "topic": "orders/create",
      "address": "https://api.ordefy.io/api/shopify/webhook/orders-create",
      "format": "json",
      "created_at": "2024-01-15T10:00:00Z"
    }
  ],
  "count": 8
}
```

---

#### `DELETE /api/shopify/webhooks/remove-all`
Elimina todos los webhooks.

**Respuesta**:
```json
{
  "success": true,
  "removed": 8,
  "errors": []
}
```

---

### Monitoreo de Salud

#### `GET /api/shopify/webhook-health?hours=24`
Obtiene métricas de salud de webhooks.

**Query Params**:
- `hours` (default: 24): Ventana de tiempo

**Respuesta**:
```json
{
  "success": true,
  "status": "healthy",
  "issues": [],
  "metrics": {
    "total_received": 245,
    "total_processed": 242,
    "total_failed": 3,
    "total_duplicates": 12,
    "success_rate": 98.77,
    "avg_processing_time_ms": 456,
    "pending_retries": 2,
    "error_breakdown": {
      "401_unauthorized": 0,
      "404_not_found": 1,
      "500_server_error": 2,
      "timeout": 0,
      "other": 0
    }
  },
  "period_hours": 24,
  "timestamp": "2024-01-15T14:30:00Z"
}
```

---

#### `POST /api/shopify/webhook-retry/process`
Procesa cola de reintentos manualmente.

**Respuesta**:
```json
{
  "success": true,
  "processed": 5,
  "succeeded": 3,
  "failed": 1,
  "still_pending": 1,
  "message": "Processed 5 retries..."
}
```

---

#### `POST /api/shopify/webhook-cleanup`
Limpia idempotency keys expirados.

**Respuesta**:
```json
{
  "success": true,
  "deleted_keys": 156,
  "message": "Cleaned up 156 expired idempotency keys"
}
```

---

## Base de Datos

### Tablas Principales

#### `shopify_integrations`
Almacena configuración de integración.

```sql
CREATE TABLE shopify_integrations (
    id UUID PRIMARY KEY,
    store_id UUID REFERENCES stores(id),

    -- Credentials
    shop_domain VARCHAR(255) NOT NULL,
    api_key VARCHAR(255),
    api_secret_key VARCHAR(255),
    access_token TEXT NOT NULL,  -- OAuth token
    webhook_signature VARCHAR(255),

    -- Import config
    import_products BOOLEAN DEFAULT FALSE,
    import_customers BOOLEAN DEFAULT FALSE,
    import_orders BOOLEAN DEFAULT FALSE,
    import_historical_orders BOOLEAN DEFAULT FALSE,

    -- Status
    status VARCHAR(50) DEFAULT 'active',
    last_sync_at TIMESTAMP,
    sync_error TEXT,

    -- Metadata
    shopify_shop_id VARCHAR(255),
    shop_name VARCHAR(255),
    shop_email VARCHAR(255),
    shop_currency VARCHAR(10),
    shop_timezone VARCHAR(100),
    shop_data JSONB,

    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),

    UNIQUE(store_id, shop_domain)
);
```

---

#### `shopify_import_jobs`
Rastrea jobs de importación.

```sql
CREATE TABLE shopify_import_jobs (
    id UUID PRIMARY KEY,
    integration_id UUID REFERENCES shopify_integrations(id),
    store_id UUID REFERENCES stores(id),

    -- Job config
    job_type VARCHAR(50) NOT NULL,  -- 'initial', 'manual'
    import_type VARCHAR(50) NOT NULL,  -- 'products', 'customers'

    -- Progress
    status VARCHAR(50) DEFAULT 'pending',
    total_items INTEGER DEFAULT 0,
    processed_items INTEGER DEFAULT 0,
    failed_items INTEGER DEFAULT 0,
    success_items INTEGER DEFAULT 0,

    -- Pagination
    current_page INTEGER DEFAULT 1,
    page_size INTEGER DEFAULT 50,
    has_more BOOLEAN DEFAULT TRUE,
    last_cursor VARCHAR(255),

    -- Error handling
    error_message TEXT,
    error_details JSONB,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,

    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);
```

---

#### `shopify_webhook_idempotency`
Previene procesamiento duplicado de webhooks.

```sql
CREATE TABLE shopify_webhook_idempotency (
    id UUID PRIMARY KEY,
    integration_id UUID REFERENCES shopify_integrations(id),
    idempotency_key VARCHAR(255) UNIQUE NOT NULL,

    -- Webhook info
    webhook_topic VARCHAR(100) NOT NULL,
    shopify_event_id VARCHAR(255),

    -- Processing result
    processed_successfully BOOLEAN DEFAULT FALSE,
    response_code INTEGER,
    error_message TEXT,

    -- TTL: 24 hours
    created_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP DEFAULT NOW() + INTERVAL '24 hours'
);
```

---

#### `shopify_webhook_retry_queue`
Cola de reintentos para webhooks fallidos.

```sql
CREATE TABLE shopify_webhook_retry_queue (
    id UUID PRIMARY KEY,
    integration_id UUID REFERENCES shopify_integrations(id),
    store_id UUID NOT NULL,
    webhook_event_id UUID REFERENCES shopify_webhook_events(id),

    -- Webhook info
    webhook_topic VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,

    -- Retry state
    status VARCHAR(50) DEFAULT 'pending',  -- pending, processing, success, failed
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 5,
    next_retry_at TIMESTAMP,

    -- Error tracking
    last_error TEXT,
    error_code VARCHAR(50),
    error_history JSONB DEFAULT '[]',

    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

**Backoff Schedule**:
- Retry 1: 60s
- Retry 2: 120s (2 min)
- Retry 3: 240s (4 min)
- Retry 4: 480s (8 min)
- Retry 5: 960s (16 min)

---

#### `shopify_webhook_metrics`
Métricas agregadas por hora.

```sql
CREATE TABLE shopify_webhook_metrics (
    id UUID PRIMARY KEY,
    integration_id UUID REFERENCES shopify_integrations(id),
    store_id UUID NOT NULL,

    -- Time bucket (hourly)
    hour_bucket TIMESTAMP NOT NULL,

    -- Metrics
    total_received INTEGER DEFAULT 0,
    total_processed INTEGER DEFAULT 0,
    total_failed INTEGER DEFAULT 0,
    total_duplicates INTEGER DEFAULT 0,
    success_rate DECIMAL(5,2) DEFAULT 0,
    avg_processing_time_ms INTEGER DEFAULT 0,

    -- Error breakdown
    error_401_count INTEGER DEFAULT 0,
    error_404_count INTEGER DEFAULT 0,
    error_500_count INTEGER DEFAULT 0,
    error_timeout_count INTEGER DEFAULT 0,
    error_other_count INTEGER DEFAULT 0,

    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),

    UNIQUE(integration_id, hour_bucket)
);
```

---

#### `shopify_oauth_states`
Almacena estados OAuth para CSRF protection.

```sql
CREATE TABLE shopify_oauth_states (
    id UUID PRIMARY KEY,
    state VARCHAR(255) UNIQUE NOT NULL,

    user_id UUID REFERENCES users(id),
    store_id UUID REFERENCES stores(id),
    shop_domain VARCHAR(255) NOT NULL,

    used BOOLEAN DEFAULT FALSE,
    expires_at TIMESTAMP NOT NULL,  -- 10 minutes

    created_at TIMESTAMP DEFAULT NOW()
);
```

---

#### `shopify_webhooks`
Registro de webhooks creados en Shopify.

```sql
CREATE TABLE shopify_webhooks (
    id UUID PRIMARY KEY,
    integration_id UUID REFERENCES shopify_integrations(id),

    webhook_id VARCHAR(255) NOT NULL,  -- Shopify webhook ID
    topic VARCHAR(100) NOT NULL,
    shop_domain VARCHAR(255) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,

    created_at TIMESTAMP DEFAULT NOW(),

    UNIQUE(integration_id, webhook_id)
);
```

---

### Campos Agregados a Tablas Existentes

#### Tabla `products`
```sql
ALTER TABLE products ADD COLUMN shopify_product_id VARCHAR(255);
ALTER TABLE products ADD COLUMN shopify_variant_id VARCHAR(255);
ALTER TABLE products ADD COLUMN shopify_data JSONB;
ALTER TABLE products ADD COLUMN last_synced_at TIMESTAMP;
ALTER TABLE products ADD COLUMN sync_status VARCHAR(50) DEFAULT 'synced';
```

#### Tabla `customers`
```sql
ALTER TABLE customers ADD COLUMN shopify_customer_id VARCHAR(255);
ALTER TABLE customers ADD COLUMN shopify_data JSONB;
ALTER TABLE customers ADD COLUMN last_synced_at TIMESTAMP;
ALTER TABLE customers ADD COLUMN sync_status VARCHAR(50) DEFAULT 'synced';
```

#### Tabla `orders`
```sql
ALTER TABLE orders ADD COLUMN shopify_order_id VARCHAR(255);
ALTER TABLE orders ADD COLUMN shopify_order_number VARCHAR(100);
ALTER TABLE orders ADD COLUMN shopify_data JSONB;
ALTER TABLE orders ADD COLUMN last_synced_at TIMESTAMP;
ALTER TABLE orders ADD COLUMN sync_status VARCHAR(50) DEFAULT 'synced';
ALTER TABLE orders ADD COLUMN n8n_sent BOOLEAN DEFAULT FALSE;
ALTER TABLE orders ADD COLUMN n8n_sent_at TIMESTAMP;
ALTER TABLE orders ADD COLUMN n8n_error TEXT;
ALTER TABLE orders ADD COLUMN n8n_retry_count INTEGER DEFAULT 0;
```

---

## Seguridad

### 1. OAuth 2.0

- **CSRF Protection**: State parameter aleatorio de 64 caracteres
- **State Expiration**: 10 minutos de validez
- **One-time Use**: State se marca como `used` después de validación
- **Secure Storage**: Access tokens encriptados en PostgreSQL

### 2. HMAC Verification

Todos los webhooks verifican firma HMAC-SHA256:

```typescript
const validateHmac = (rawBody: string, hmacHeader: string, secret: string): boolean => {
  const hash = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('base64');

  return crypto.timingSafeEqual(
    Buffer.from(hash),
    Buffer.from(hmacHeader)
  );
};
```

### 3. Replay Protection

- Rechaza webhooks con timestamps > 5 minutos de antigüedad
- Previene ataques de replay

### 4. Idempotency

- Idempotency keys: `{order_id}:{topic}:{timestamp_hash}`
- TTL de 24 horas
- Previene procesamiento duplicado

### 5. Rate Limiting

- **Shopify API**: 2 requests/segundo (40/minuto)
- **General API**: 500 requests/15 min
- **Webhooks**: 60 requests/min

### 6. Authentication

- **JWT tokens** para todos los endpoints (excepto webhooks)
- **X-Store-ID header** para multi-tenancy
- **Bearer token** en Authorization header

---

## Sincronización de Datos

### Flujo de Sincronización Inicial

1. **Configuración**: Usuario configura integración con OAuth
2. **Registro de Webhooks**: Se registran 8 webhooks automáticamente
3. **Importación Inicial**:
   - ✅ Productos (si `import_products = true`)
   - ✅ Clientes (si `import_customers = true`)
   - ❌ Órdenes históricas (NO se importan)

**Razón**: Las órdenes históricas pueden distorsionar las analíticas. Solo se procesan órdenes nuevas desde el momento de la integración.

### Sincronización Manual

**Endpoint**: `POST /api/shopify/manual-sync`

**Tipos permitidos**:
- `products`: Solo productos
- `customers`: Solo clientes
- `all`: Productos + clientes (NO órdenes)

### Sincronización Automática (Webhooks)

| Evento | Acción en Ordefy |
|--------|------------------|
| `orders/create` | Crea orden + envía a n8n para confirmación WhatsApp |
| `orders/updated` | Actualiza estado de orden |
| `products/create` | Crea producto |
| `products/update` | Actualiza producto |
| `products/delete` | Elimina producto |
| `customers/create` | Crea cliente |
| `customers/update` | Actualiza cliente |
| `app/uninstalled` | Marca integración como desconectada |

### Sincronización Bidireccional

**Ordefy → Shopify**:

- **Actualizar producto**: `PATCH /api/shopify/products/:id`
- **Eliminar producto**: `DELETE /api/shopify/products/:id`

**Shopify → Ordefy**:

- Vía webhooks (automático)

---

## Sistema de Confiabilidad de Webhooks

### Arquitectura de 3 Capas

#### 1. Idempotencia
- Previene procesamiento duplicado
- TTL de 24 horas
- Clave: `{order_id}:{topic}:{timestamp_hash}`

#### 2. Reintentos Automáticos
- Exponential backoff: 60s → 960s
- Máximo 5 intentos
- Estado: pending → processing → success/failed

#### 3. Monitoreo
- Métricas agregadas por hora
- Success rate, processing time, error breakdown
- Dashboard en tiempo real

### Health Status

| Status | Condiciones |
|--------|-------------|
| **healthy** | Success rate ≥ 95%, Pending retries < 50 |
| **degraded** | Success rate 80-95% o Pending retries 50-100 |
| **unhealthy** | Success rate < 80% o Error 401 > 5 |

### Alertas Recomendadas

- 🚨 Success rate < 95% (últimas 24h)
- 🚨 Pending retries > 50
- 🚨 Error 401 > 5 (1h) - Verificar credenciales
- 🚨 Processing time > 2000ms (1h avg)

---

## Mantenimiento

### Cron Jobs Recomendados

#### 1. Procesamiento de Reintentos
```bash
# Cada 5 minutos
*/5 * * * * curl -X POST https://api.ordefy.io/api/shopify/webhook-retry/process \
  -H "Authorization: Bearer {token}" \
  -H "X-Store-ID: {store_id}"
```

#### 2. Limpieza de Idempotency Keys
```bash
# Diario a las 3 AM
0 3 * * * curl -X POST https://api.ordefy.io/api/shopify/webhook-cleanup \
  -H "Authorization: Bearer {token}" \
  -H "X-Store-ID: {store_id}"
```

#### 3. Verificación de Salud de Webhooks
```bash
# Cada hora
0 * * * * curl https://api.ordefy.io/api/shopify/webhook-health?hours=1 \
  -H "Authorization: Bearer {token}" \
  -H "X-Store-ID: {store_id}" | jq .
```

### Limpieza de Datos Antiguos

```sql
-- Limpiar estados OAuth expirados (> 24h)
DELETE FROM shopify_oauth_states
WHERE expires_at < NOW() - INTERVAL '24 hours';

-- Limpiar webhook events antiguos (> 30 días)
DELETE FROM shopify_webhook_events
WHERE created_at < NOW() - INTERVAL '30 days'
AND processed = true;

-- Limpiar reintentos completados (> 7 días)
DELETE FROM shopify_webhook_retry_queue
WHERE status IN ('success', 'failed')
AND updated_at < NOW() - INTERVAL '7 days';

-- Limpiar métricas antiguas (> 90 días)
DELETE FROM shopify_webhook_metrics
WHERE hour_bucket < NOW() - INTERVAL '90 days';
```

### Verificación de Webhooks

```bash
# Listar webhooks registrados
curl https://api.ordefy.io/api/shopify/webhooks/list \
  -H "Authorization: Bearer {token}" \
  -H "X-Store-ID: {store_id}"

# Verificar configuración
curl https://api.ordefy.io/api/shopify/webhooks/verify \
  -H "Authorization: Bearer {token}" \
  -H "X-Store-ID: {store_id}"

# Re-registrar webhooks si hay problemas
curl -X POST https://api.ordefy.io/api/shopify/webhooks/setup \
  -H "Authorization: Bearer {token}" \
  -H "X-Store-ID: {store_id}"
```

### Debugging

#### Ver logs de webhooks
```bash
# Logs de eventos recientes
SELECT
  event_type,
  shopify_topic,
  processed,
  processing_error,
  created_at
FROM shopify_webhook_events
WHERE integration_id = '{integration_id}'
ORDER BY created_at DESC
LIMIT 50;
```

#### Ver reintentos pendientes
```bash
SELECT
  webhook_topic,
  retry_count,
  next_retry_at,
  last_error,
  created_at
FROM shopify_webhook_retry_queue
WHERE status = 'pending'
AND integration_id = '{integration_id}'
ORDER BY next_retry_at ASC;
```

#### Ver métricas agregadas
```bash
SELECT
  hour_bucket,
  total_received,
  total_processed,
  total_failed,
  success_rate,
  avg_processing_time_ms,
  error_401_count + error_404_count + error_500_count as total_errors
FROM shopify_webhook_metrics
WHERE integration_id = '{integration_id}'
ORDER BY hour_bucket DESC
LIMIT 24;
```

---

## Troubleshooting

### Error 401 en webhooks

**Causa**: Credenciales inválidas o token expirado

**Solución**:
1. Verificar `access_token` en `shopify_integrations`
2. Reconectar integración vía OAuth
3. Verificar permisos (scopes) en Shopify Partner Dashboard

### Webhooks no llegan

**Causa**: Webhooks no registrados o URL incorrecta

**Solución**:
1. Verificar webhooks: `GET /api/shopify/webhooks/list`
2. Re-registrar: `POST /api/shopify/webhooks/setup`
3. Verificar `API_URL` en variables de entorno
4. Verificar firewall/CORS

### Alta tasa de duplicados

**Causa**: Shopify reenvía webhooks por timeouts

**Solución**:
1. Verificar processing time (debe ser < 1s)
2. Optimizar queries de base de datos
3. Retornar 200 OK rápidamente
4. Sistema de idempotencia ya previene duplicados

### Reintentos atascados

**Causa**: Cron job no está corriendo

**Solución**:
1. Verificar cron job está activo
2. Ejecutar manualmente: `POST /api/shopify/webhook-retry/process`
3. Verificar logs de errores en `shopify_webhook_retry_queue`

---

## Links Útiles

- **Shopify Partner Dashboard**: https://partners.shopify.com/
- **Shopify Admin API Docs**: https://shopify.dev/docs/api/admin-rest
- **Shopify Webhooks Docs**: https://shopify.dev/docs/api/admin-rest/2024-10/resources/webhook
- **OAuth Flow**: https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/authorization-code-grant
- **HMAC Verification**: https://shopify.dev/docs/apps/build/webhooks/subscribe/https#step-5-verify-the-webhook

---

## Resumen de Comandos

```bash
# ============================================================
# OAUTH
# ============================================================

# Iniciar OAuth
https://api.ordefy.io/api/shopify-oauth/auth?shop=mystore.myshopify.com&store_id=uuid

# Verificar estado
GET /api/shopify-oauth/status?shop=mystore.myshopify.com

# Desconectar
DELETE /api/shopify-oauth/disconnect?shop=mystore.myshopify.com

# ============================================================
# SINCRONIZACIÓN
# ============================================================

# Sincronización manual
POST /api/shopify/manual-sync
Body: { "sync_type": "all" }

# Ver progreso
GET /api/shopify/import-status/:integration_id

# ============================================================
# WEBHOOKS
# ============================================================

# Listar webhooks
GET /api/shopify/webhooks/list

# Verificar configuración
GET /api/shopify/webhooks/verify

# Re-registrar
POST /api/shopify/webhooks/setup

# Eliminar todos
DELETE /api/shopify/webhooks/remove-all

# ============================================================
# MONITOREO
# ============================================================

# Salud de webhooks
GET /api/shopify/webhook-health?hours=24

# Procesar reintentos
POST /api/shopify/webhook-retry/process

# Limpiar keys expirados
POST /api/shopify/webhook-cleanup
```

---

## Conclusión

Esta integración proporciona una conexión robusta y confiable entre Shopify y Ordefy, con:

✅ Autenticación segura vía OAuth 2.0
✅ Sincronización bidireccional de productos
✅ Webhooks en tiempo real para órdenes nuevas
✅ Sistema de reintentos automáticos
✅ Deduplicación de eventos
✅ Monitoreo de salud en tiempo real
✅ Integración con n8n para confirmación por WhatsApp

Para soporte o consultas, revisar documentación oficial de Shopify o contactar al equipo de desarrollo de Ordefy.

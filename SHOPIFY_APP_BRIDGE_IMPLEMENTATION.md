# Shopify App Bridge Implementation - Ordefy

Este documento describe la implementación completa de Shopify App Bridge para cumplir con los requisitos de aprobación de Shopify.

## 📋 Requisitos de Shopify

Para que Shopify apruebe una aplicación embebida, debe cumplir con:

1. ✅ **Embedding habilitado**: `embedded = true` en configuración
2. ✅ **App Bridge library**: Usar la última versión de App Bridge (CDN)
3. ✅ **Session Tokens**: Implementar autenticación con session tokens
4. ✅ **Frame Ancestors**: Configurar CSP para permitir embedding de Shopify
5. ✅ **HTTPS**: Servir la app sobre HTTPS en producción
6. ✅ **OAuth Flow**: Implementar flujo de OAuth correcto

## 🏗️ Arquitectura de Implementación

### Frontend Components

#### 1. App Bridge Script y Meta Tags (index.html)
```html
<!-- Líneas 11-14 de index.html -->
<!-- CRÍTICO: Meta tag con API key DEBE estar ANTES del script -->
<meta name="shopify-api-key" content="75123c29296179fbd8f253db4196c83b" />
<script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
```

**Importante**:
- La meta tag `shopify-api-key` es **REQUERIDA** por App Bridge CDN (2025)
- Este script debe cargarse **antes** que cualquier otro script de la aplicación

#### 2. ShopifyInitializer Component
**Ubicación**: `src/components/ShopifyInitializer.tsx`

Este componente:
- Envuelve toda la aplicación
- Inicializa App Bridge cuando detecta contexto de Shopify
- Obtiene y renueva session tokens automáticamente
- No bloquea la UI durante inicialización

```tsx
<ShopifyInitializer>
  <AuthProvider>
    <App />
  </AuthProvider>
</ShopifyInitializer>
```

#### 3. useShopifyAppBridge Hook
**Ubicación**: `src/hooks/useShopifyAppBridge.ts`

**Configuración**:
- CLIENT_ID: `75123c29296179fbd8f253db4196c83b` (del shopify.app.toml)
- Token refresh: Cada 50 segundos (tokens duran 60s)
- Retry logic: Máximo 20 intentos con 100ms de delay

**Detección de contexto embebido**:
```typescript
const urlParams = new URLSearchParams(window.location.search);
const host = urlParams.get('host');
const embedded = urlParams.get('embedded');
const shop = urlParams.get('shop');

// Extraer shop domain desde host si no está en parámetros directos
let shopDomain = shop;
if (!shopDomain && host) {
  const decodedHost = atob(host);
  shopDomain = decodedHost.split('/')[0]; // shop.myshopify.com
}

// Solo inicializa si estamos embebidos
if (host && embedded === '1') {
  // Inicializar App Bridge
}
```

**Inicialización de App Bridge CDN (2025)**:
```typescript
const shopifyApp = window.shopify.createApp({
  apiKey: CLIENT_ID,
  shop: shopDomain,  // REQUERIDO: Shop domain (shop.myshopify.com)
  host: host,        // Host parameter from Shopify
  forceRedirect: true, // Redirige automáticamente si no está embebido
});
```

**Campos requeridos**:
- `apiKey`: Client ID de la app (también en meta tag)
- `shop`: Dominio de la tienda (shop.myshopify.com) - **NUEVO REQUERIMIENTO 2025**
- `host`: Host codificado en base64 de Shopify

**Obtención de Session Token**:
```typescript
const token = await shopifyApp.idToken();
localStorage.setItem('shopify_session_token', token);
```

#### 4. API Client (src/services/api.client.ts)

El cliente Axios detecta automáticamente si hay un session token de Shopify y lo envía correctamente:

```typescript
const shopifySessionToken = localStorage.getItem('shopify_session_token');
const authToken = localStorage.getItem('auth_token');

if (shopifySessionToken) {
  config.headers.Authorization = `Bearer ${shopifySessionToken}`;
  config.headers['X-Shopify-Session'] = 'true'; // Flag para backend
} else if (authToken) {
  config.headers.Authorization = `Bearer ${authToken}`;
}
```

### Backend Components

#### 1. CSP Frame Ancestors (api/index.ts)
**Líneas 132-155**

```typescript
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://cdn.shopify.com"],
      frameAncestors: [
        "'self'",
        "https://*.myshopify.com",
        "https://admin.shopify.com",
        "https://*.shopify.com"
      ],
    },
  },
}));
```

**CRÍTICO**: `frameAncestors` permite que Shopify embeba la app mientras previene clickjacking.

#### 2. Session Token Validation (api/middleware/auth.ts)

##### Verificación de Session Token de Shopify
```typescript
function verifyShopifySessionToken(token: string): any {
  const decoded = jwt.verify(token, SHOPIFY_API_SECRET, {
    algorithms: ['HS256'],
    audience: SHOPIFY_API_KEY,
  }) as any;

  // Validar claims obligatorios
  if (!decoded.dest || !decoded.sub || !decoded.aud) {
    throw new Error('Invalid Shopify session token claims');
  }

  return decoded;
}
```

**Anatomía de un Session Token**:
```json
{
  "iss": "https://shop-name.myshopify.com/admin",
  "dest": "shop-name.myshopify.com",
  "aud": "75123c29296179fbd8f253db4196c83b",
  "sub": "user-id",
  "exp": 1234567890,
  "nbf": 1234567830,
  "iat": 1234567830,
  "jti": "unique-id",
  "sid": "session-id"
}
```

##### Middleware verifyToken
Soporta dos modos de autenticación:

1. **Session Token de Shopify** (cuando `X-Shopify-Session: true`):
   ```typescript
   const decoded = verifyShopifySessionToken(token);
   req.shopifySession = decoded;
   ```

2. **JWT Token Normal** (autenticación propia):
   ```typescript
   const decoded = jwt.verify(token, JWT_SECRET);
   req.userId = decoded.userId;
   ```

##### Middleware extractStoreId (MEJORADO)

**Nueva funcionalidad**: Extrae automáticamente `store_id` desde Shopify session:

```typescript
if (!storeId && req.shopifySession) {
  const shopDomain = req.shopifySession.dest;

  // Buscar integración activa en DB
  const { data: integration } = await supabaseAdmin
    .from('shopify_integrations')
    .select('store_id')
    .eq('shop_domain', shopDomain)
    .eq('status', 'active')
    .single();

  storeId = integration.store_id;
}
```

**Beneficio**: Los usuarios de Shopify no necesitan enviar `X-Store-ID` header, se obtiene automáticamente del shop domain.

### Configuración (shopify.app.toml)

```toml
name = "Ordefy"
client_id = "75123c29296179fbd8f253db4196c83b"
handle = "ordefy"

application_url = "https://app.ordefy.io"
embedded = true  # ✅ CRÍTICO: Debe ser true

[access_scopes]
scopes = "read_products, write_products, read_orders, write_orders, read_customers, write_customers"

[auth]
redirect_urls = [
  "https://app.ordefy.io/auth/callback",
  "https://api.ordefy.io/api/shopify-oauth/callback"
]
```

## 🔄 Flujo de Autenticación

### Modo Embebido (Shopify Admin)

```
1. User abre la app en Shopify admin
   ↓
2. Shopify carga app con parámetros: ?host=...&embedded=1
   ↓
3. useShopifyAppBridge detecta contexto embebido
   ↓
4. Inicializa App Bridge 3.0 con createApp()
   ↓
5. Obtiene session token con app.idToken()
   ↓
6. Guarda token en localStorage: 'shopify_session_token'
   ↓
7. API client detecta token y lo envía en requests:
   - Authorization: Bearer <session-token>
   - X-Shopify-Session: true
   ↓
8. Backend valida token con SHOPIFY_API_SECRET
   ↓
9. extractStoreId busca store_id por shop domain
   ↓
10. Request procede normalmente
```

### Modo Standalone (Sin Shopify)

```
1. User accede directamente a app.ordefy.io
   ↓
2. No hay parámetros ?host o ?embedded=1
   ↓
3. useShopifyAppBridge no inicializa (standalone mode)
   ↓
4. User hace login normal (/login)
   ↓
5. Backend genera JWT token propio
   ↓
6. Token guardado en localStorage: 'auth_token'
   ↓
7. API client envía JWT normal
   ↓
8. Backend valida con JWT_SECRET
   ↓
9. User debe enviar X-Store-ID header
   ↓
10. Request procede normalmente
```

## 🔐 Seguridad

### Session Token Security

1. **Firma criptográfica**: Tokens firmados con `SHOPIFY_API_SECRET` (HMAC-SHA256)
2. **Expiración**: Tokens duran 60 segundos, renovados cada 50s
3. **Validación de claims**: `dest`, `sub`, `aud` son obligatorios
4. **Audience check**: `aud` debe coincidir con `SHOPIFY_API_KEY`
5. **No reutilización**: Tokens frescos en cada request

### Frame Ancestors Security

```
✅ PERMITIDO:
- https://admin.shopify.com
- https://*.myshopify.com
- https://*.shopify.com

❌ BLOQUEADO:
- Cualquier otro dominio (clickjacking protection)
```

### HTTPS Requirement

- ✅ Producción: `https://app.ordefy.io` y `https://api.ordefy.io`
- ⚠️ Desarrollo: Usar ngrok o Shopify CLI dev server

## 📝 Variables de Entorno

### Frontend (.env)
```bash
VITE_API_URL=https://api.ordefy.io
```

### Backend (.env)
```bash
# Shopify App
SHOPIFY_API_KEY=75123c29296179fbd8f253db4196c83b
SHOPIFY_API_SECRET=<tu-secret-aqui>

# JWT (autenticación propia)
JWT_SECRET=<tu-jwt-secret-aqui>

# Database
SUPABASE_URL=<tu-supabase-url>
SUPABASE_ANON_KEY=<tu-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<tu-service-role-key>

# CORS
CORS_ORIGIN=https://app.ordefy.io,https://admin.shopify.com
```

## 🧪 Testing

### 1. Verificar Embedding
```bash
# La app debe abrir embebida en Shopify admin:
https://admin.shopify.com/store/<shop-name>/apps/<app-handle>
```

### 2. Verificar Session Token
Abrir DevTools Console, buscar:
```
[Shopify] Initializing App Bridge 3.0...
[Shopify] App Bridge 3.0 initialized successfully
[Shopify] Fetching session token...
[Shopify] Session token obtained successfully
```

### 3. Verificar Headers en Network Tab
Request headers deben incluir:
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
X-Shopify-Session: true
```

### 4. Verificar Backend
Logs del backend deben mostrar:
```
[Auth] Verifying Shopify session token
[Auth] Shopify session validated: { shop: 'shop.myshopify.com', userId: '...' }
[Auth] Looking up store_id for Shopify shop: shop.myshopify.com
[Auth] Found store_id from Shopify integration: <uuid>
```

## 🚨 Problemas Comunes

### 1. "App Bridge Next: missing required configuration fields: shop"
**Causa**: Falta meta tag `shopify-api-key` o parámetro `shop` en createApp (Nuevo requerimiento 2025)

**Solución**:
- ✅ Agregar `<meta name="shopify-api-key" content="CLIENT_ID">` ANTES del script
- ✅ Incluir parámetro `shop: shopDomain` en configuración de createApp
- ✅ Extraer shop domain desde parámetro URL `shop` o decodificar `host`

### 2. "Failed to get session token"
**Causa**: App Bridge no está cargado o CLIENT_ID incorrecto

**Solución**:
- Verificar que script CDN esté en `<head>` de index.html
- Verificar CLIENT_ID en useShopifyAppBridge.ts coincide con shopify.app.toml
- Verificar meta tag `shopify-api-key` esté presente

### 2. "401 Unauthorized" en requests
**Causa**: Token expirado o SHOPIFY_API_SECRET incorrecto

**Solución**:
- Verificar que SHOPIFY_API_SECRET en .env sea correcto
- Verificar que token se esté renovando cada 50s
- Revisar logs del backend para detalles

### 3. "Access denied to this store"
**Causa**: No hay integración activa en shopify_integrations table

**Solución**:
```sql
-- Verificar integración
SELECT * FROM shopify_integrations
WHERE shop_domain = 'shop.myshopify.com'
AND status = 'active';

-- Si no existe, crear integración primero
```

### 4. "X-Frame-Options deny"
**Causa**: CSP frame-ancestors no configurado

**Solución**:
- Verificar helmet config en api/index.ts incluye frameAncestors
- Reiniciar servidor API después de cambios

### 5. App se abre fuera del admin
**Causa**: `forceRedirect: false` o `embedded: false`

**Solución**:
- Cambiar `forceRedirect: true` en useShopifyAppBridge.ts
- Cambiar `embedded = true` en shopify.app.toml
- Ejecutar `shopify app deploy`

## 📚 Referencias

- [Shopify App Bridge Documentation](https://shopify.dev/docs/api/app-bridge)
- [Session Tokens Guide](https://shopify.dev/docs/apps/build/authentication-authorization/session-tokens)
- [Built for Shopify Requirements](https://shopify.dev/docs/apps/launch/built-for-shopify/requirements)
- [Embedding Apps Guide](https://shopify.dev/docs/apps/build/integrating-with-shopify)

## ✅ Checklist para Aprobación de Shopify

- [x] App embebida (`embedded = true`)
- [x] App Bridge CDN script cargado
- [x] Session tokens implementados y renovados automáticamente
- [x] CSP frame-ancestors configurado para Shopify domains
- [x] HTTPS en producción
- [x] OAuth flow correcto
- [x] Session token validation en backend
- [x] Store ID auto-detection desde Shopify session
- [x] Manejo de errores y fallback a modo standalone
- [x] Testing exitoso en Shopify admin

## 🎯 Próximos Pasos

1. **Deploy a Producción**:
   ```bash
   shopify app deploy
   ```

2. **Verificar en Shopify Admin**:
   - Instalar app en tienda de desarrollo
   - Verificar embedding funciona correctamente
   - Probar todas las funcionalidades principales

3. **Solicitar Revisión**:
   - Ir a Partner Dashboard
   - Submit app for review
   - Incluir credenciales de prueba y video demo

---

**Desarrollado por Bright Idea**
**Última actualización**: 2025-01-29

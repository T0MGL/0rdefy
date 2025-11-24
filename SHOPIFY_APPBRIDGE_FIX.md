# Shopify App Bridge - Corrección Completa

## 🎯 Problema Resuelto

El error de consola:
```
Error: Shopify's App Bridge must be included as the first <script> tag and must link to Shopify's CDN. Do not use async, defer or type=module. Aborting.
```

## ✅ Cambios Realizados

### 1. **index.html** - Carga Correcta del Script

**Antes:**
```html
<!-- Tenía un script inline de dark mode ANTES de App Bridge -->
<script>
  (function() { /* dark mode logic */ })();
</script>

<!-- Script con atributo 'defer' (INCORRECTO) -->
<script src="https://cdn.shopify.com/shopifycloud/app-bridge.js" defer></script>
```

**Después:**
```html
<!-- App Bridge es el PRIMER script, SIN defer/async/type=module -->
<script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>

<!-- Script de dark mode movido DESPUÉS -->
<script>
  (function() { /* dark mode logic */ })();
</script>
```

### 2. **src/hooks/useShopifyAppBridge.ts** - API Correcta de App Bridge 3.0

**Cambios en la declaración de tipos:**
```typescript
// ❌ ANTES (API incorrecta)
declare global {
  interface Window {
    createApp?: (config: any) => any;
    getSessionToken?: (app: any) => Promise<string>;
  }
}

// ✅ DESPUÉS (API correcta de App Bridge 3.0)
declare global {
  interface Window {
    shopify?: {
      createApp?: (config: {
        apiKey: string;
        host: string;
        forceRedirect?: boolean;
      }) => {
        idToken: () => Promise<string>;
        dispatch: (action: any) => void;
        subscribe: (callback: (data: any) => void) => () => void;
      };
    };
  }
}
```

**Cambios en la inicialización:**
```typescript
// ❌ ANTES
if (!window.createApp) { ... }
const shopifyApp = window.createApp({ ... });
const token = await window.getSessionToken(shopifyApp);

// ✅ DESPUÉS
if (!window.shopify?.createApp) { ... }
const shopifyApp = window.shopify.createApp({ ... });
const token = await shopifyApp.idToken();
```

### 3. **src/services/api.client.ts** - Ya Configurado ✅

El API client ya estaba correctamente configurado para usar el token de Shopify:
```typescript
apiClient.interceptors.request.use((config) => {
  const shopifySessionToken = localStorage.getItem('shopify_session_token');
  const authToken = localStorage.getItem('auth_token');
  const storeId = localStorage.getItem('current_store_id');

  // Prioridad al token de Shopify si está disponible
  if (shopifySessionToken) {
    config.headers.Authorization = `Bearer ${shopifySessionToken}`;
    config.headers['X-Shopify-Session'] = 'true';
  } else if (authToken) {
    config.headers.Authorization = `Bearer ${authToken}`;
  }

  if (storeId) {
    config.headers['X-Store-ID'] = storeId;
  }

  return config;
});
```

## 🧪 Archivo de Demostración

Se creó `shopify-appbridge-demo.html` con:
- ✅ Carga correcta del script de App Bridge (primer script, sin defer)
- ✅ Inicialización con `window.shopify.createApp()`
- ✅ Obtención de token con `app.idToken()`
- ✅ Auto-refresh del token cada 50 segundos
- ✅ Ejemplo de llamada a API con el token
- ✅ Logger visual en tiempo real
- ✅ Manejo de errores completo

## 🚀 Cómo Probar

### 1. Probar el Demo HTML (Standalone)

```bash
# Abrir el archivo directamente en el navegador
open shopify-appbridge-demo.html

# O servir con un servidor local
npx serve .
# Navegar a: http://localhost:3000/shopify-appbridge-demo.html?host=xxx&embedded=1
```

Para simular el contexto de Shopify, agrega parámetros a la URL:
```
shopify-appbridge-demo.html?host=dGVzdC1zdG9yZS5teXNob3BpZnkuY29tL2FkbWlu&embedded=1
```

### 2. Probar en la Aplicación React

```bash
# Iniciar el servidor de desarrollo
npm run dev

# Abrir en el navegador (normalmente http://localhost:8080)
```

Para probar en contexto de Shopify embedded app:
```
http://localhost:8080?host=dGVzdC1zdG9yZS5teXNob3BpZnkuY29tL2FkbWlu&embedded=1
```

### 3. Verificar en la Consola del Navegador

Deberías ver estos logs:
```
[Shopify] Initializing App Bridge 3.0...
[Shopify] App Bridge 3.0 initialized successfully
[Shopify] Fetching session token...
[Shopify] Session token obtained successfully
[Shopify] Session token is ready for API calls
```

Y NO deberías ver:
```
❌ Error: Shopify's App Bridge must be included as the first <script> tag...
```

### 4. Verificar en Shopify Partner Dashboard

1. Ve a tu app en [partners.shopify.com](https://partners.shopify.com)
2. Navega a "Test your app" → "Session tokens"
3. Instala la app en una tienda de desarrollo
4. Verifica que los checks de "Session token" pasen

## 📋 Checklist de Validación

- [ ] El script de App Bridge es el **primer** `<script>` en `index.html`
- [ ] El script NO tiene atributos `defer`, `async` o `type="module"`
- [ ] La inicialización usa `window.shopify.createApp()`
- [ ] La obtención de token usa `app.idToken()`
- [ ] El token se guarda en `localStorage` como `shopify_session_token`
- [ ] El token se auto-refresca cada 50 segundos
- [ ] Las llamadas a API usan el token en el header `Authorization: Bearer {token}`
- [ ] Las llamadas a API incluyen el header `X-Shopify-Session: true`
- [ ] No hay errores de App Bridge en la consola del navegador
- [ ] Los checks de Session Token pasan en Shopify Partner Dashboard

## 🔍 Debugging

### Si ves "App Bridge script not loaded yet"
- Verifica que el script esté en el `<head>` del HTML
- Asegúrate de que NO tenga `defer`, `async` o `type="module"`
- Revisa la consola de red para ver si el script se descargó correctamente

### Si ves "idToken method not available"
- El script de App Bridge está usando una API antigua
- Verifica que el URL del script sea: `https://cdn.shopify.com/shopifycloud/app-bridge.js`
- NO uses `@shopify/app-bridge-react` o `@shopify/app-bridge` npm packages en modo embedded

### Si ves "Not running in Shopify embedded context"
- Es normal si no estás en un iframe de Shopify
- Agrega `?host=xxx&embedded=1` a la URL para simular el contexto
- O instala la app en una tienda de desarrollo de Shopify

### Si el token expira muy rápido
- Los tokens de Shopify duran 60 segundos
- El auto-refresh está configurado para 50 segundos (safe margin)
- Verifica que el intervalo no se haya detenido

## 📚 Recursos

- [Shopify App Bridge Documentation](https://shopify.dev/docs/api/app-bridge)
- [Session Tokens Guide](https://shopify.dev/docs/apps/auth/oauth/session-tokens)
- [App Bridge CDN](https://cdn.shopify.com/shopifycloud/app-bridge.js)

## 🎓 Conceptos Clave

### ¿Por qué el script debe ser el primero?
Shopify valida que App Bridge se cargue ANTES que cualquier otro código JavaScript para asegurar que la comunicación segura con el admin de Shopify esté lista desde el inicio.

### ¿Por qué NO usar defer/async?
- `defer`: El script se ejecuta después de que el DOM esté listo → Puede causar timing issues
- `async`: El script se ejecuta en paralelo → Puede causar race conditions
- `type="module"`: Carga el script como módulo ES6 → Shopify no lo soporta

### ¿Cuál es la diferencia entre App Bridge 2.0 y 3.0?

**App Bridge 2.0 (deprecated):**
```javascript
// Instalación vía npm
import createApp from '@shopify/app-bridge';
const app = createApp({ apiKey, host });
```

**App Bridge 3.0 (actual):**
```javascript
// Carga vía CDN
<script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>

// Uso global
const app = window.shopify.createApp({ apiKey, host });
const token = await app.idToken();
```

## ✨ Próximos Pasos

1. **Deployment**: Al hacer deploy, asegúrate de que el `index.html` mantenga el script de App Bridge como el primero
2. **Backend Validation**: Configura tu backend para validar los tokens de sesión de Shopify
3. **Error Handling**: Implementa manejo de errores para tokens expirados (401 responses)
4. **Testing**: Prueba en múltiples tiendas de desarrollo de Shopify

## 🆘 Soporte

Si tienes problemas:
1. Revisa la consola del navegador (F12 → Console)
2. Verifica los logs de `[Shopify]` en la consola
3. Usa el archivo `shopify-appbridge-demo.html` para debugging aislado
4. Consulta la documentación oficial de Shopify App Bridge

---

**Desarrollado por:** Bright Idea
**Aplicación:** Ordefy
**Fecha:** $(date +%Y-%m-%d)

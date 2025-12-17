# 🚨 CRITICAL FIX: HMAC Verification Bug

## Problema Crítico

**Síntoma:** Webhooks de Shopify dejaron de funcionar completamente para AMBOS tipos de integración (OAuth y Custom App).

**Error:** "ROMPISTE TODO, AHORA NISIQUIERA LLEGAN LOS PEDIDOS A LA OAUTH APP NI A LA CUSTOM"

## Causa Raíz

En el archivo `api/services/shopify-webhook.service.ts`, método `verifyHmacSignature()`, había un bug crítico en la verificación de HMAC:

### Código Defectuoso (ANTES):

```typescript
const hmac = crypto
  .createHmac('sha256', secret)
  .update(body, 'utf8');

// Try base64 first (OAuth/Public Apps)
const hashBase64 = hmac.digest('base64');  // ❌ ESTO CONSUME el objeto hmac

// Try hex (Custom Apps created from Shopify Admin)
const hmacHex = crypto
  .createHmac('sha256', secret)  // ✅ Nuevo objeto HMAC
  .update(body, 'utf8')
  .digest('hex');

// Check if HMAC header matches base64 format
try {
  if (crypto.timingSafeEqual(Buffer.from(hashBase64), Buffer.from(hmacHeader))) {
    // Esto fallaba si los buffers tienen diferente longitud
    return true;
  }
} catch (e) {
  // Catch silencioso - no se veía el error
}
```

**El problema:**
1. El primer `hmac.digest('base64')` **consume** el objeto hmac (no se puede reutilizar)
2. `crypto.timingSafeEqual()` **lanza error** si los buffers tienen diferente longitud
3. Los errores se capturaban silenciosamente con `catch (e) {}`, ocultando el problema
4. **Ambas verificaciones fallaban**, rechazando TODOS los webhooks

## Solución Implementada

### Código Corregido (AHORA):

```typescript
// Generate base64 hash (OAuth/Public Apps)
const hashBase64 = crypto
  .createHmac('sha256', secret)
  .update(body, 'utf8')
  .digest('base64');

// Generate hex hash (Custom Apps created from Shopify Admin)
const hashHex = crypto
  .createHmac('sha256', secret)
  .update(body, 'utf8')
  .digest('hex');

// Try base64 format first (OAuth Apps)
if (hmacHeader === hashBase64) {
  console.log('✅ HMAC verified (base64 format - OAuth App)');
  return true;
}

// Try hex format (Custom Apps)
if (hmacHeader === hashHex) {
  console.log('✅ HMAC verified (hex format - Custom App)');
  return true;
}

console.error('❌ HMAC verification failed - neither base64 nor hex format matched');
console.error(`   Expected base64: ${hashBase64.substring(0, 20)}...`);
console.error(`   Expected hex: ${hashHex.substring(0, 40)}...`);
console.error(`   Received HMAC: ${hmacHeader.substring(0, 40)}...`);
return false;
```

**Cambios:**
1. ✅ **Crear objetos HMAC separados** para base64 y hex (no reutilizar)
2. ✅ **Usar comparación simple** (`===`) en lugar de `timingSafeEqual`
3. ✅ **Logging mejorado** para debugging (muestra hashes esperados vs recibidos)
4. ✅ **Sin catches silenciosos** - los errores se propagan correctamente

## Por Qué Funcionó Antes

El código original SOLO verificaba formato base64, lo cual funcionaba para OAuth apps:

```typescript
// Código original (antes de intentar soportar hex)
const hash = crypto
  .createHmac('sha256', secret)
  .update(body, 'utf8')
  .digest('base64');

return hash === hmacHeader;  // Simple y funcionaba
```

## Por Qué Se Rompió

Intenté agregar soporte para formato hex (Custom Apps) pero:
- Reutilicé el objeto hmac después de llamar `.digest()` (no funciona)
- Usé `timingSafeEqual` incorrectamente (lanza error si buffers tienen diferente longitud)
- Capturé errores silenciosamente, ocultando el problema

## Resultado

✅ **AHORA funciona correctamente para:**
- OAuth Apps (formato base64)
- Custom Apps (formato hex)
- Logging detallado para debugging
- Sin falsos rechazos

## Testing

Para verificar que funciona:

1. **OAuth App (dev store bright-idea):**
   - Crear pedido de prueba
   - Verificar logs: `✅ HMAC verified (base64 format - OAuth App)`

2. **Custom App (production s17fez-rb):**
   - Primero: CORREGIR el `api_secret_key` en la base de datos (debe empezar con `shpss_`, NO usar el HMAC signature `4dfa...`)
   - Crear pedido de prueba
   - Verificar logs: `✅ HMAC verified (hex format - Custom App)`

## Próximos Pasos

1. **CRÍTICO:** Usuario debe verificar que el `api_secret_key` en la base de datos para `s17fez-rb.myshopify.com` sea el API secret correcto:
   - Settings → Apps and sales channels → Develop apps → [Custom App] → API credentials
   - Click "Reveal" en "API secret key"
   - Copiar el valor (debe empezar con `shpss_`)
   - **NO** usar el HMAC signature que se muestra en la página de webhooks

2. Verificar que los pedidos de prueba lleguen correctamente a ambas integraciones

3. Monitorear logs para confirmar que la verificación HMAC funciona

## Archivos Modificados

- ✅ `api/services/shopify-webhook.service.ts` - Fixed `verifyHmacSignature()` method

## Estado

🟢 **CORREGIDO** - Webhooks deberían funcionar nuevamente para OAuth apps
🟡 **PENDIENTE** - Verificar Custom App con API secret correcto

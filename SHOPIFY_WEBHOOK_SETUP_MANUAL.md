# Configuración Manual de Webhooks en Shopify Custom App

**Problema Detectado:** Los webhooks están inactivos (`Address: undefined`, `Active: ❌`)

**Solución:** Configurar webhooks manualmente en Shopify Admin

---

## 🚨 **Paso Crítico: Configurar Webhooks en Shopify**

### **Opción 1: Configurar en la Custom App (RECOMENDADO)**

1. **Ve a Shopify Admin:**
   ```
   https://admin.shopify.com/store/bright-idea-6816
   Settings > Apps and sales channels > Develop apps
   ```

2. **Abre tu Custom App** (la que creaste para Ordefy)

3. **Ve a la pestaña "Configuration"**

4. **Scroll hasta "Webhooks"**

5. **Agrega estos webhooks:**

   **Webhook 1: Orders Create**
   - Event: `Order creation`
   - Format: `JSON`
   - URL: `https://api.ordefy.io/api/webhook/orders-create`
   - API Version: `2024-10` (o la más reciente)

   **Webhook 2: Orders Updated**
   - Event: `Order updated`
   - Format: `JSON`
   - URL: `https://api.ordefy.io/api/webhook/orders-updated`
   - API Version: `2024-10`

   **Webhook 3: Products Delete** (Opcional)
   - Event: `Product deletion`
   - Format: `JSON`
   - URL: `https://api.ordefy.io/api/webhook/products-delete`
   - API Version: `2024-10`

6. **Guarda los cambios**

---

### **Opción 2: Configurar vía API (Automático)**

Si prefieres configurar webhooks programáticamente, ejecuta este script:

```bash
npm run setup-webhooks
```

O manualmente:

```bash
node scripts/setup-shopify-webhooks.cjs
```

---

## ✅ **Verificación**

Después de configurar los webhooks:

### **1. Verifica en Shopify Admin:**

Ve a: `Settings > Notifications > Webhooks`

Deberías ver:
```
✅ Order creation → https://api.ordefy.io/api/webhook/orders-create
✅ Order updated → https://api.ordefy.io/api/webhook/orders-updated
```

### **2. Prueba con un Pedido de Prueba:**

1. **Reinicia el servidor de Ordefy:**
   ```bash
   npm run dev
   ```

2. **Crea un pedido de prueba en Shopify**

3. **Monitorea los logs del servidor** - Deberías ver:
   ```
   ✅ [WEBHOOK] HMAC validated successfully for bright-idea-6816.myshopify.com
   📥 [ORDER-CREATE] New order from bright-idea-6816.myshopify.com: #1001
   ✅ [ORDER-CREATE] Order saved: #1001
   📤 [ORDER-CREATE] Sent to n8n for WhatsApp confirmation
   ```

4. **Verifica en Ordefy Dashboard:**
   - El pedido debería aparecer en la página de Orders
   - Estado inicial: `pending`

### **3. Ejecuta diagnósticos nuevamente:**

```bash
node scripts/test-webhook-diagnostics.cjs
```

Ahora deberías ver:
```
2️⃣ Checking Recent Webhook Logs (last 10)...
   Found 1 recent webhook log(s):

   1. Topic: orders/create
      Shop: bright-idea-6816.myshopify.com
      Status: processed
      Time: 2025-12-16T...
```

---

## 🔧 **Script Automático de Configuración**

Voy a crear un script para configurar webhooks automáticamente vía API de Shopify:

**Archivo:** `scripts/setup-shopify-webhooks.cjs`

Este script:
1. Lee las integraciones de la base de datos
2. Usa la API de Shopify para crear webhooks
3. Actualiza la tabla `shopify_webhooks` en Ordefy
4. Verifica que los webhooks estén activos

---

## 🐛 **Troubleshooting**

### **Si los webhooks siguen sin funcionar:**

1. **Verifica que tu servidor esté accesible públicamente:**
   ```bash
   curl https://api.ordefy.io/api/health
   ```
   Debería retornar: `{"status": "healthy"}`

2. **Verifica los logs en tiempo real:**
   ```bash
   npm run dev
   # Luego crea pedido en Shopify
   ```

3. **Prueba el webhook manualmente:**
   ```bash
   curl -X POST https://api.ordefy.io/api/webhook/orders-create \
     -H "Content-Type: application/json" \
     -H "X-Shopify-Shop-Domain: bright-idea-6816.myshopify.com" \
     -H "X-Shopify-Hmac-Sha256: test" \
     -d '{"test": true}'
   ```

4. **Revisa los logs de webhooks en Shopify:**
   - Ve a la configuración del webhook en Shopify Admin
   - Click en "View details" para ver los intentos de entrega
   - Verifica si hay errores (timeout, 401, 500, etc.)

---

## 📊 **URLs de Webhooks para Custom Apps**

Para **bright-idea-6816.myshopify.com:**
```
https://api.ordefy.io/api/webhook/orders-create
https://api.ordefy.io/api/webhook/orders-updated
https://api.ordefy.io/api/webhook/products-create
https://api.ordefy.io/api/webhook/products-update
https://api.ordefy.io/api/webhook/products-delete
```

Para **s17fez-rb.myshopify.com:**
```
(Las mismas URLs - el sistema identifica la tienda por el header X-Shopify-Shop-Domain)
```

---

## ⚡ **Próximos Pasos**

1. ✅ Configura webhooks en Shopify Admin (Opción 1) o vía script (Opción 2)
2. ✅ Reinicia el servidor de Ordefy
3. ✅ Crea un pedido de prueba en Shopify
4. ✅ Verifica que aparece en Ordefy Dashboard
5. ✅ Ejecuta diagnósticos para confirmar

---

## 💡 **Nota Importante**

Los webhooks de Shopify **NO se crean automáticamente** cuando configuras una Custom App. Debes:
- Configurarlos manualmente en el Admin de Shopify, O
- Usar la API de Shopify para crearlos programáticamente

El código de Ordefy está listo para recibirlos, solo falta activarlos en Shopify.

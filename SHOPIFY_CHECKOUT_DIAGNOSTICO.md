# Diagnóstico: Webhooks de Shopify Sin Datos del Cliente

## 🎯 Problema

Los webhooks `orders/create` y `orders/updated` de Shopify NO están enviando:
- `contact_email`
- `email`
- `phone`
- `billing_address` (solo trae country/country_code)
- `shipping_address` (solo trae country/country_code)

A pesar de que **SÍ capturas estos datos en el checkout** para hacer envíos.

---

## 📋 Checklist de Diagnóstico

### ✅ Paso 1: Verificar Configuración de Checkout

**Ir a:** `Settings → Checkout` en Shopify Admin de **s17fez-rb.myshopify.com**

#### 1.1 Customer contact method
```
[ ] Customers can only check out using email (RECOMENDADO)
[ ] Customers can check out using email or phone
```

**Acción:** Selecciona la opción que uses y verifica que el campo sea **obligatorio**.

#### 1.2 Customer information
```
[ ] Full name - Required
[ ] Phone number - Required (⚠️ IMPORTANTE)
[ ] Company name - Optional
```

**Acción:** Marca "Phone number" como **REQUIRED**.

#### 1.3 Shipping address
```
[ ] Don't require a shipping address (❌ NO USAR)
[ ] Require a shipping address (✅ USAR ESTA)
```

**⚠️ CRÍTICO:** Si está en "Don't require", Shopify NO enviará:
- first_name, last_name
- address1, city, province, zip
- phone (en la dirección)

**Acción:** Cambia a "**Require a shipping address**".

#### 1.4 Form options
```
[ ] Show "Company name" field
[ ] Show "Address line 2" field
```

**Acción:** Configura según necesites.

---

### ✅ Paso 2: Verificar Apps de Checkout

**Ir a:** `Settings → Apps and sales channels`

**Buscar apps de:**
- Checkout Builder
- Checkout Customizer
- PageFly
- Zipify Pages
- ReConvert
- Post Purchase Upsells
- Checkout Extensions

**⚠️ PROBLEMA COMÚN:**
Estas apps pueden:
- Modificar el checkout
- Guardar datos en `note_attributes` o `metafields`
- Interceptar el flujo de checkout
- NO pasar datos a los webhooks correctamente

**Acción:**
1. Anota qué apps tienes instaladas
2. Verifica su configuración
3. Temporalmente **desactiva** apps de checkout para probar

---

### ✅ Paso 3: Verificar Tema (Theme)

**Ir a:** `Online Store → Themes`

**Verificar:**
1. **Tema actual:** ¿Es un tema personalizado o de Shopify Theme Store?
2. **Customizaciones:** `Actions → Edit code`
   - Busca `checkout.liquid` (temas antiguos)
   - Busca `theme.liquid` con scripts de checkout
   - Busca archivos en `assets/` que modifiquen checkout

**⚠️ PROBLEMA COMÚN:**
Temas muy personalizados pueden usar checkouts alternativos que no pasan datos correctamente a webhooks.

**Acción:** Si usas tema personalizado, verifica con el desarrollador del tema.

---

### ✅ Paso 4: Probar con Pedido de Prueba

**Crear un pedido completo:**

1. **Ir a tu tienda:** https://s17fez-rb.myshopify.com
2. **Agregar un producto** al carrito
3. **Ir a checkout**
4. **Completar TODOS los campos:**
   - Email: `tu-email@example.com`
   - Teléfono: `+595123456789`
   - Nombre: `Prueba`
   - Apellido: `Test`
   - Dirección completa
   - Ciudad, código postal

5. **NO marcar** "Create an account" (para probar guest checkout)
6. **Completar el pedido**

**Inmediatamente después:**

1. **Ver logs del backend de Ordefy**
2. **Buscar estos mensajes:**

```bash
# Terminal donde corre el backend (npm run dev)
🔍 [CUSTOMER DATA] Order 6915371172033:
  phone: 'NONE' o '+595...'
  email: 'NONE' o 'email@example.com'
  firstName: 'NONE' o 'Prueba'
  lastName: 'NONE' o 'Test'
  sources: {
    'order.phone': 'null' o '+595...',
    'order.contact_email': 'null' o 'email@...',
    'order.email': 'null' o 'email@...',
    'billing_address': 'null' o 'exists',
    'shipping_address': 'null' o 'exists',
    'note_attributes': 0 o cantidad,
    'tags': 'null' o 'nombre'
  }
```

3. **Si ves:**
   - `⚠️ Webhook data incomplete for order...` → El webhook NO trae datos
   - `📥 Fetching complete order from Shopify API...` → Estamos fetcheando desde API
   - `✅ Using complete order data from Shopify API` → Datos recuperados OK

---

### ✅ Paso 5: Verificar Payload del Webhook en Shopify

**Ir a:** `Settings → Notifications → Webhooks`

1. **Encuentra** el webhook `orders/create`
   - URL: `https://api.ordefy.io/api/shopify/webhook/orders-create`

2. **Scroll down** → "Recent deliveries"

3. **Click** en "View details" de la última entrega

4. **Copiar el JSON del payload**

5. **Verificar campos:**
   ```json
   {
     "contact_email": "??",     // ¿Tiene valor?
     "email": "??",             // ¿Tiene valor?
     "phone": "??",             // ¿Tiene valor?
     "billing_address": {
       "first_name": "??",      // ¿Tiene valor?
       "last_name": "??",       // ¿Tiene valor?
       "address1": "??",        // ¿Tiene valor?
       "phone": "??",           // ¿Tiene valor?
       "city": "??",            // ¿Tiene valor?
       "zip": "??"              // ¿Tiene valor?
     },
     "shipping_address": { ... }
   }
   ```

**Si ves `null` en todos estos campos:**
→ El problema está en la **configuración de checkout de Shopify** o en una **app de terceros**.

**Si ves valores:**
→ El problema podría estar en cómo estamos procesando el webhook (poco probable con los cambios actuales).

---

### ✅ Paso 6: Verificar en Base de Datos de Ordefy

Después del pedido de prueba:

1. **Ver el pedido en el dashboard de Ordefy**
2. **Verificar:**
   - ¿Se creó el cliente?
   - ¿Tiene email y/o teléfono?
   - ¿Tiene nombre completo?
   - ¿Tiene dirección de envío?

---

## 🔧 Soluciones Según Diagnóstico

### Caso 1: "Don't require shipping address" está activado

**Solución:**
```
Settings → Checkout → Shipping address
→ Cambiar a "Require a shipping address"
```

### Caso 2: Phone no es obligatorio

**Solución:**
```
Settings → Checkout → Customer information
→ Marcar "Phone number" como Required
```

### Caso 3: App de checkout de terceros

**Solución:**
1. Identificar la app
2. Verificar su configuración
3. Contactar soporte de la app
4. Temporalmente desactivar para probar

### Caso 4: Tema personalizado

**Solución:**
1. Contactar desarrollador del tema
2. Verificar que use checkout estándar de Shopify
3. Probar con tema default de Shopify (Dawn) temporalmente

### Caso 5: Webhooks NO traen datos pero API SÍ tiene datos

**Solución:**
✅ Ya implementada - El código automáticamente fetchea desde la API cuando detecta datos incompletos:

```typescript
// Ya está en el código
if (!hasCompleteData && integration) {
  const completeOrder = await fetchCompleteOrderData(...);
  enrichedOrder = completeOrder;
}
```

---

## 📊 Comparación: Webhook vs API

| Campo | Webhook (actual) | API Orders (fetch) | Customer API |
|-------|-----------------|-------------------|--------------|
| contact_email | ❓ | ✅ | N/A |
| email | ❓ | ✅ | ✅ (si enabled) |
| phone | ❓ | ✅ | ✅ (si enabled) |
| billing_address | ❓ (solo country) | ✅ | ❌ |
| shipping_address | ❓ (solo country) | ✅ | ❌ |
| first_name | ❓ | ✅ | ✅ (si enabled) |
| last_name | ❓ | ✅ | ✅ (si enabled) |

**Conclusión:**
- ✅ Orders API tiene TODOS los datos (incluso para disabled customers)
- ✅ Webhooks DEBERÍAN tener los datos pero a veces no
- ❌ Customer API NO funciona con disabled customers

---

## 🎯 Próximos Pasos

1. [ ] Ejecutar Paso 1: Verificar configuración de checkout
2. [ ] Ejecutar Paso 2: Verificar apps instaladas
3. [ ] Ejecutar Paso 3: Verificar tema
4. [ ] Ejecutar Paso 4: Crear pedido de prueba
5. [ ] Ejecutar Paso 5: Verificar payload en Shopify
6. [ ] Ejecutar Paso 6: Verificar en dashboard de Ordefy
7. [ ] Reportar hallazgos

---

## 📞 Soporte

Si después de seguir todos los pasos el problema persiste:

1. **Compartir:**
   - Screenshots de Settings → Checkout
   - Lista de apps instaladas
   - Payload del webhook (desde Shopify Admin)
   - Logs del backend de Ordefy

2. **Verificar:**
   - ¿El código automáticamente fetchea desde API cuando detecta datos incompletos?
   - ¿Los logs muestran `✅ Using complete order data from Shopify API`?

3. **Considerar:**
   - Contactar soporte de Shopify si es problema de configuración
   - Contactar soporte de la app de checkout si usas una

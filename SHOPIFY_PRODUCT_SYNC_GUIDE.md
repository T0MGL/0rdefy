# Guía de Sincronización de Productos con Shopify

**Fecha:** 2025-01-06
**Versión:** 2.0

## Resumen

El sistema ahora soporta **sincronización bidireccional completa** entre Ordefy y Shopify:
- ✅ **Shopify → Ordefy:** Productos, pedidos, clientes (webhooks + importación)
- ✅ **Ordefy → Shopify:** Productos, inventario (automático al actualizar)

## Cambios Implementados

### 1. ✅ Formulario de Productos Mejorado

**Campos Nuevos:**
- **SKU*** (Obligatorio) - Código único para mapeo con Shopify
- **Descripción** - Descripción detallada del producto
- **Categoría** - Clasificación del producto

**Sección de Integración con Shopify (Opcional):**
- **Shopify Product ID** - ID numérica del producto en Shopify
- **Shopify Variant ID** - ID de la variante específica

**Captura de Pantalla del Formulario:**
```
┌─────────────────────────────────────────────┐
│ Nombre del Producto *                      │
│ [Zapatillas Deportivas Nike Air Max      ] │
│                                             │
│ Descripción                                 │
│ [Zapatillas deportivas premium con...    ] │
│                                             │
│ SKU *                    Categoría          │
│ [ZAPNIKE-001]           [Calzado         ] │
│                                             │
│ URL de Imagen                               │
│ [https://...                              ] │
│                                             │
│ Precio (Gs.)            Costo (Gs.)         │
│ [250,000]               [150,000         ] │
│                                             │
│ Stock Actual                                │
│ [45                                       ] │
│                                             │
│ ─────────────────────────────────────────  │
│ Integración con Shopify (Opcional)         │
│ Si este producto ya existe en Shopify...   │
│                                             │
│ Shopify Product ID    Shopify Variant ID   │
│ [7234567890123]       [4234567890123    ] │
│                                             │
│ 💡 Tip: Puedes encontrar estos IDs en...  │
└─────────────────────────────────────────────┘
```

### 2. ✅ Sincronización Automática Ordefy → Shopify

**Qué se sincroniza automáticamente:**
Cuando actualizas un producto en Ordefy que está vinculado a Shopify:
- ✅ Nombre del producto
- ✅ Descripción
- ✅ Categoría
- ✅ Precio
- ✅ Stock/Inventario
- ✅ SKU
- ✅ Estado (activo/inactivo)

**Cuándo se sincroniza:**
- Al crear un producto con `shopify_product_id`
- Al actualizar cualquier campo de un producto vinculado
- Al actualizar solo el stock (más rápido)

**Ejemplo de flujo:**
```typescript
// Usuario actualiza stock en el dashboard
PUT /api/products/abc-123
{
  "stock": 50
}

// Backend automáticamente:
1. Actualiza en base de datos local
2. Verifica si tiene shopify_product_id
3. Obtiene integración activa de Shopify
4. Actualiza inventario en Shopify
5. Marca como "synced"

// Respuesta
{
  "message": "Product actualizado exitosamente",
  "data": { ...producto actualizado },
  "sync_status": "synced"
}
```

### 3. ✅ Manejo de Errores de Sincronización

Si la sincronización falla:
- El producto se actualiza localmente (no bloquea la operación)
- Se marca con `sync_status: 'error'`
- Se muestra warning en la respuesta
- Se registra en logs para debugging

```json
{
  "message": "Producto actualizado exitosamente",
  "data": { ...producto },
  "sync_warning": "Failed to sync to Shopify: API rate limit exceeded"
}
```

## Flujos de Trabajo

### Caso 1: Crear Producto Local y Subirlo a Shopify

**No implementado aún.** Actualmente solo se sincronizan productos que **ya existen en Shopify**.

**Workaround:**
1. Crear producto en Shopify primero
2. Copiar Product ID y Variant ID
3. Crear producto en Ordefy con esos IDs
4. Ahora se sincronizará automáticamente

### Caso 2: Importar Producto de Shopify

✅ **Recomendado:** Usa la importación automática

1. Ve a **Integraciones → Shopify**
2. Click en "Importar Productos"
3. Selecciona los productos a importar
4. Se importan con `shopify_product_id` y `shopify_variant_id`
5. ✅ Ya están vinculados automáticamente

### Caso 3: Vincular Producto Existente Manualmente

Si ya tienes un producto local que existe en Shopify:

1. Encuentra el producto en Shopify Admin
2. Copia el Product ID de la URL:
   ```
   https://admin.shopify.com/store/tu-tienda/products/7234567890123
                                                      ^^^^^^^^^^^^^^
                                                      Product ID
   ```
3. Edita el producto en Ordefy
4. Scroll hasta "Integración con Shopify"
5. Pega el Product ID y Variant ID
6. Guarda
7. ✅ Ahora se sincronizará automáticamente

### Caso 4: Actualizar Stock Masivamente

Cuando actualizas stock desde el sistema de inventario:

```typescript
// El trigger de PostgreSQL actualiza stock
UPDATE products
SET stock = stock - 10
WHERE id = 'abc-123';

// El trigger llama a la función de sincronización
// (Ver triggers en 024_order_line_items.sql)

// O manualmente vía API:
PUT /api/products/abc-123
{
  "stock": 35
}
```

✅ Se sincroniza automáticamente a Shopify

## Mapeo de Productos con Pedidos

**Problema resuelto:** Ahora los pedidos de Shopify se mapean correctamente con productos locales.

### Antes (❌)
```
Shopify Order → orders.line_items (JSONB)
                └── No relación con products
```

### Ahora (✅)
```
Shopify Order → orders → order_line_items
                          ├── product_id (FK products)
                          ├── shopify_product_id
                          ├── shopify_variant_id
                          └── Mapeo automático por IDs
```

**Cómo funciona:**
1. Webhook de pedido llega de Shopify
2. Para cada `line_item`:
   - Busca producto local por `shopify_variant_id`
   - Si no encuentra, busca por `shopify_product_id`
   - Si no encuentra, busca por `sku`
   - Crea registro en `order_line_items` con o sin `product_id`
3. Si encuentra el producto:
   - ✅ Vincula con `product_id`
   - ✅ El inventario se decrementa correctamente
   - ✅ Analytics funcionan correctamente
4. Si NO encuentra el producto:
   - ⚠️ Crea line item sin `product_id`
   - ⚠️ Muestra advertencia en logs
   - ✅ El pedido funciona igual
   - **Solución:** Importar ese producto desde Shopify

## Verificación de Mapeo

### Ver productos sin mapear en pedidos

```sql
SELECT
    oli.shopify_product_id,
    oli.shopify_variant_id,
    oli.sku,
    oli.product_name,
    COUNT(*) as veces_ordenado
FROM order_line_items oli
WHERE oli.product_id IS NULL
  AND oli.shopify_product_id IS NOT NULL
GROUP BY
    oli.shopify_product_id,
    oli.shopify_variant_id,
    oli.sku,
    oli.product_name
ORDER BY veces_ordenado DESC;
```

**Resultado ejemplo:**
```
shopify_product_id | shopify_variant_id | sku        | product_name           | veces_ordenado
-------------------+--------------------+------------+------------------------+----------------
7234567890123      | 4234567890123      | PROD-001   | Zapatillas Nike Air    | 12
7234567890456      | 4234567890456      | PROD-002   | Remera Adidas          | 8
```

**Solución:** Importar esos productos desde Shopify o crearlos manualmente con esos IDs.

## Estado de Sincronización

Cada producto tiene un campo `sync_status`:

- **`synced`** - ✅ Sincronizado correctamente
- **`pending`** - ⏳ Pendiente de sincronizar
- **`error`** - ❌ Error en última sincronización

### Ver productos con errores

```sql
SELECT
    id,
    name,
    sku,
    shopify_product_id,
    sync_status,
    last_synced_at
FROM products
WHERE sync_status = 'error'
ORDER BY last_synced_at DESC;
```

### Reintentar sincronización

```bash
# Via API (endpoint manual)
PUT /api/products/{product_id}
{
  "stock": 45  # Actualizar cualquier campo fuerza re-sync
}
```

## Troubleshooting

### ❌ Producto no se sincroniza a Shopify

**Causas posibles:**
1. No tiene `shopify_product_id` o `shopify_variant_id`
   - **Solución:** Agregar IDs manualmente o importar desde Shopify

2. No hay integración activa de Shopify
   - **Solución:** Verificar en Integraciones → Shopify

3. Token de Shopify expiró
   - **Solución:** Reconectar integración

4. Rate limit de Shopify API
   - **Solución:** Esperar unos minutos, se reintentará automáticamente

### ❌ Pedido de Shopify no tiene productos mapeados

**Síntoma:**
```
⚠️  Product not found for line item: Shopify Product ID 789
```

**Causa:** El producto existe en Shopify pero no en tu base de datos local

**Soluciones:**
1. **Importar desde Shopify:** Integraciones → Shopify → Importar Productos
2. **Crear manualmente:** Crear producto con mismo `shopify_product_id`
3. **Esperar:** Los próximos pedidos se mapearán automáticamente después de importar

### ❌ Stock no se actualiza en Shopify

**Verificar:**
1. ¿El producto tiene `shopify_variant_id`?
   ```sql
   SELECT shopify_variant_id FROM products WHERE id = 'product-id';
   ```

2. ¿La integración está activa?
   ```sql
   SELECT status FROM shopify_integrations WHERE store_id = 'store-id';
   ```

3. ¿Hay errores en logs?
   ```bash
   # Ver logs del backend
   tail -f logs/application.log | grep INVENTORY-SYNC
   ```

### ❌ SKU duplicado al crear producto

```
Error: A product with this SKU already exists in this store
```

**Solución:** Usar un SKU único para cada producto en la tienda.

## Mejores Prácticas

### 1. Importar antes de crear pedidos

✅ **SIEMPRE importa productos de Shopify ANTES de que lleguen pedidos**

Esto asegura que:
- Los line items se mapeen correctamente
- El inventario se maneje correctamente
- Los analytics sean precisos

### 2. Usar SKUs consistentes

✅ **Usa el mismo SKU en Shopify y Ordefy**

Permite mapeo automático incluso si faltan los IDs

### 3. Verificar sincronización regularmente

```sql
-- Productos con errores de sincronización
SELECT COUNT(*) FROM products WHERE sync_status = 'error';

-- Productos no vinculados
SELECT COUNT(*) FROM products WHERE shopify_product_id IS NULL;

-- Line items sin mapeo
SELECT COUNT(*) FROM order_line_items WHERE product_id IS NULL;
```

### 4. Monitorear logs

```bash
# Ver sincronizaciones exitosas
grep "✅" logs/application.log | grep SYNC

# Ver errores de sincronización
grep "❌" logs/application.log | grep SYNC

# Ver productos no encontrados
grep "⚠️.*Product not found" logs/application.log
```

## Flujo Completo Recomendado

### Setup Inicial

1. ✅ Conectar Shopify (Integraciones → Shopify → Conectar)
2. ✅ Importar Productos (Importar todos los productos activos)
3. ✅ Importar Clientes (Opcional)
4. ✅ Importar Pedidos Históricos (Opcional)
5. ✅ Verificar mapeo (SQL query de productos sin mapear)

### Operación Diaria

1. **Nuevos productos en Shopify:**
   - Se importan automáticamente via webhooks
   - O importar manualmente cuando quieras

2. **Actualizar stock local:**
   - Editar producto en Ordefy
   - Se sincroniza automáticamente a Shopify

3. **Pedidos desde Shopify:**
   - Llegan via webhook
   - Se mapean automáticamente con productos locales
   - Stock se decrementa al marcar como `ready_to_ship`

4. **Crear productos localmente:**
   - **Opción A:** Crear primero en Shopify, luego importar
   - **Opción B:** Crear en Ordefy, agregar IDs de Shopify manualmente

## API Reference

### Actualizar Producto

```http
PUT /api/products/:id
Authorization: Bearer {token}
X-Store-ID: {store-id}
Content-Type: application/json

{
  "name": "Producto Actualizado",
  "description": "Nueva descripción",
  "sku": "PROD-001",
  "category": "Calzado",
  "price": 250000,
  "cost": 150000,
  "stock": 45,
  "shopify_product_id": "7234567890123",
  "shopify_variant_id": "4234567890123"
}
```

**Respuesta Exitosa:**
```json
{
  "message": "Product updated successfully",
  "data": {
    "id": "abc-123",
    "name": "Producto Actualizado",
    "stock": 45,
    "sync_status": "synced",
    "last_synced_at": "2025-01-06T10:30:00Z"
  }
}
```

**Respuesta con Warning:**
```json
{
  "message": "Product updated successfully",
  "data": { ...producto },
  "sync_warning": "Failed to sync to Shopify: API rate limit"
}
```

### Crear Producto

```http
POST /api/products
Authorization: Bearer {token}
X-Store-ID: {store-id}
Content-Type: application/json

{
  "name": "Nuevo Producto",
  "description": "Descripción del producto",
  "sku": "PROD-002",
  "category": "Ropa",
  "price": 150000,
  "cost": 80000,
  "stock": 100,
  "image_url": "https://...",
  "shopify_product_id": "7234567890456",
  "shopify_variant_id": "4234567890789"
}
```

## Próximas Mejoras

- [ ] **Crear productos en Shopify desde Ordefy** - Push completo de nuevos productos
- [ ] **Sincronización de imágenes** - Subir imágenes desde Ordefy a Shopify
- [ ] **Sincronización de variantes** - Soporte para múltiples variantes por producto
- [ ] **Webhook de inventory_levels** - Actualización en tiempo real desde Shopify
- [ ] **Dashboard de sincronización** - Vista de estado de sincronización

## Soporte

**Logs importantes:**
- `✅ [INVENTORY-SYNC]` - Sincronización exitosa
- `❌ [INVENTORY-SYNC]` - Error de sincronización
- `⚠️  Product not found` - Producto no mapeado en pedido

**Archivos clave:**
- `src/components/forms/ProductForm.tsx` - Formulario mejorado
- `api/services/shopify-product-sync.service.ts` - Sincronización bidireccional
- `api/services/shopify-inventory-sync.service.ts` - Sincronización solo inventario
- `api/routes/products.ts` - Endpoints de productos
- `db/migrations/024_order_line_items.sql` - Mapeo de productos

---

**¿Preguntas o problemas?** Revisa troubleshooting o consulta los logs del sistema.

# Pending Fixes - Prompts para Claude Code

## CRÍTICOS (Ejecutar antes del lanzamiento)

### Prompt 1: Race Condition en findOrCreateCustomer

```
Necesito corregir la race condition en findOrCreateCustomer del servicio de webhooks de Shopify.

PROBLEMA:
- Archivo: api/services/shopify-webhook.service.ts, función findOrCreateCustomer (líneas ~1091-1273)
- La búsqueda por teléfono/email y la inserción NO son atómicas
- Dos webhooks concurrentes pueden crear clientes duplicados

SOLUCIÓN:
1. Crear RPC en nueva migración db/migrations/074_customer_upsert_atomic.sql:

CREATE OR REPLACE FUNCTION upsert_customer_atomic(
  p_store_id UUID,
  p_phone VARCHAR(50),
  p_email VARCHAR(255) DEFAULT NULL,
  p_name VARCHAR(255) DEFAULT NULL,
  p_address TEXT DEFAULT NULL,
  p_city VARCHAR(100) DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_shopify_customer_id BIGINT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_customer_id UUID;
BEGIN
  -- Try to find existing by phone first (most reliable)
  IF p_phone IS NOT NULL AND p_phone != '' THEN
    SELECT id INTO v_customer_id
    FROM customers
    WHERE store_id = p_store_id AND phone = p_phone
    FOR UPDATE;
  END IF;

  -- If not found by phone, try email
  IF v_customer_id IS NULL AND p_email IS NOT NULL AND p_email != '' THEN
    SELECT id INTO v_customer_id
    FROM customers
    WHERE store_id = p_store_id AND email = p_email
    FOR UPDATE;
  END IF;

  -- Insert or update
  IF v_customer_id IS NULL THEN
    INSERT INTO customers (store_id, phone, email, name, address, city, notes, shopify_customer_id)
    VALUES (p_store_id, p_phone, p_email, p_name, p_address, p_city, p_notes, p_shopify_customer_id)
    RETURNING id INTO v_customer_id;
  ELSE
    UPDATE customers SET
      email = COALESCE(p_email, email),
      name = COALESCE(p_name, name),
      address = COALESCE(p_address, address),
      city = COALESCE(p_city, city),
      shopify_customer_id = COALESCE(p_shopify_customer_id, shopify_customer_id),
      updated_at = NOW()
    WHERE id = v_customer_id;
  END IF;

  RETURN v_customer_id;
END;
$$ LANGUAGE plpgsql;

2. Actualizar findOrCreateCustomer en shopify-webhook.service.ts para usar el RPC
3. Manejar errores del RPC apropiadamente

NO cambiar la firma del método, solo la implementación interna.
```

---

### Prompt 2: N+1 Queries en createLineItemsForOrder

```
Necesito optimizar createLineItemsForOrder que hace 3 queries por cada line item.

PROBLEMA:
- Archivo: api/services/shopify-webhook.service.ts, función createLineItemsForOrder (líneas ~967-1088)
- Por cada item hace: query por variant_id, query por product_id, query por SKU
- Una orden con 50 items = 150 queries = timeout

SOLUCIÓN:
1. Al inicio de la función, extraer todos los IDs únicos del array de items
2. Hacer UN batch query para todos los productos de una vez
3. Construir un Map para lookup O(1)

Cambiar de:
```typescript
for (const item of lineItems) {
  // 3 queries por item...
}
```

A:
```typescript
// Extraer IDs únicos
const variantIds = [...new Set(lineItems.map(i => i.variant_id).filter(Boolean))];
const productIds = [...new Set(lineItems.map(i => i.product_id).filter(Boolean))];
const skus = [...new Set(lineItems.map(i => i.sku).filter(Boolean))];

// UN query para todos los productos
const { data: products } = await supabaseAdmin
  .from('products')
  .select('id, shopify_variant_id, shopify_product_id, sku')
  .eq('store_id', storeId)
  .or(`shopify_variant_id.in.(${variantIds.join(',')}),shopify_product_id.in.(${productIds.join(',')}),sku.in.(${skus.join(',')})`);

// Construir maps para lookup O(1)
const byVariant = new Map(products?.filter(p => p.shopify_variant_id).map(p => [p.shopify_variant_id, p.id]));
const byProduct = new Map(products?.filter(p => p.shopify_product_id).map(p => [p.shopify_product_id, p.id]));
const bySku = new Map(products?.filter(p => p.sku).map(p => [p.sku.toUpperCase(), p.id]));

// Ahora el loop solo hace lookups en memoria
for (const item of lineItems) {
  const productId = byVariant.get(item.variant_id)
    || byProduct.get(item.product_id)
    || bySku.get(item.sku?.toUpperCase());
  // ...
}
```

Mantener la lógica de fallback (variant → product → SKU) pero usando Maps.
```

---

### Prompt 3: Timeout Insuficiente en Discount Code

```
Necesito aumentar el timeout en la función de redención de discount codes.

PROBLEMA:
- Archivo: db/migrations/073_discount_code_atomic_redemption.sql, línea 57
- SET LOCAL statement_timeout = '5s' es muy corto para Supabase en producción
- En carga alta, queries pueden tardar más y fallar innecesariamente

SOLUCIÓN:
Crear migración db/migrations/075_discount_timeout_fix.sql:

-- Aumentar timeout de 5s a 30s para dar margen en carga alta
CREATE OR REPLACE FUNCTION redeem_discount_code_atomic(
  p_code VARCHAR(50),
  p_user_id UUID,
  p_store_id UUID DEFAULT NULL,
  p_stripe_subscription_id TEXT DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
  v_discount RECORD;
BEGIN
  -- Aumentar timeout a 30 segundos
  SET LOCAL statement_timeout = '30s';

  -- Resto de la función igual...
  -- (copiar el contenido completo de la función existente en 073)

END;
$$ LANGUAGE plpgsql;

IMPORTANTE: Copiar TODO el cuerpo de la función de 073, solo cambiar el timeout de '5s' a '30s'.
```

---

## ALTOS (Ejecutar en primera semana)

### Prompt 4: CRON_SECRET Information Disclosure

```
Corregir el endpoint de cleanup que retorna 500 si CRON_SECRET no está configurado.

Archivo: api/routes/collaborators.ts, líneas ~967-976

Cambiar de:
if (!process.env.CRON_SECRET) {
  return res.status(500).json({ error: 'Server misconfigured' });
}

A:
if (!process.env.CRON_SECRET || req.headers['x-cron-secret'] !== process.env.CRON_SECRET) {
  return res.status(401).json({ error: 'Unauthorized' });
}

Aplicar el mismo fix en todos los endpoints de cron en:
- api/routes/billing.ts (cron endpoints)
- api/routes/collaborators.ts
```

---

### Prompt 5: GraphQL Retry Logic

```
Agregar retry con exponential backoff a las llamadas GraphQL de Shopify.

Archivo: api/services/shopify-webhook.service.ts

Crear helper function:
async function fetchWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise(r => setTimeout(r, baseDelay * Math.pow(2, i)));
    }
  }
  throw new Error('Max retries exceeded');
}

Aplicar a:
- fetchShopifyCustomerDataGraphQL (~línea 81)
- fetchCompleteOrderDataGraphQL (~línea 321)
```

---

### Prompt 6: Payment Double-Count Fix

```
Corregir race condition en markSettlementPaid del servicio de settlements.

Archivo: api/services/settlements.service.ts, función markSettlementPaid

PROBLEMA: Dos requests concurrentes pueden leer el mismo amount_paid y ambos sumar, perdiendo un pago.

SOLUCIÓN: Usar increment atómico en la query:

Cambiar de:
const newAmountPaid = settlement.amount_paid + amount;
await supabaseAdmin.from('daily_settlements').update({ amount_paid: newAmountPaid })...

A usar RPC con increment atómico:
CREATE OR REPLACE FUNCTION record_settlement_payment(
  p_settlement_id UUID,
  p_amount DECIMAL,
  p_store_id UUID
) RETURNS JSON AS $$
BEGIN
  UPDATE daily_settlements
  SET amount_paid = amount_paid + p_amount,
      balance_due = balance_due - p_amount,
      updated_at = NOW()
  WHERE id = p_settlement_id AND store_id = p_store_id;

  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql;

Crear migración db/migrations/076_settlement_payment_atomic.sql
```

---

## MEDIOS (Backlog)

### Prompt 7: Consolidar Console.log al Logger

```
Reemplazar console.log/error/warn con el logger estructurado en los archivos más críticos.

El logger ya existe en api/utils/logger.ts.

Archivos prioritarios (hacer uno a la vez):
1. api/routes/billing.ts
2. api/routes/shopify.ts
3. api/services/settlements.service.ts
4. api/services/shopify-webhook.service.ts

Patrón de reemplazo:
- console.log('mensaje', data) → logger.info('MODULE', 'mensaje', data)
- console.error('mensaje', error) → logger.error('MODULE', 'mensaje', error)
- console.warn('mensaje') → logger.warn('MODULE', 'mensaje')

Donde MODULE es el nombre del archivo en mayúsculas (BILLING, SHOPIFY, SETTLEMENTS, etc.)
```

---

### Prompt 8: Memory Leak useSmartPolling

```
Corregir memory leak en useSmartPolling de Orders.tsx.

Archivo: src/pages/Orders.tsx, líneas ~221-249

PROBLEMA: El useCallback para queryFn recrea en cada render por dependencias inestables.

SOLUCIÓN:
1. Mover dateParams a un useRef para evitar recreaciones
2. Agregar cleanup en useEffect del polling
3. Usar AbortController para cancelar requests pendientes al desmontar

const dateParamsRef = useRef(dateParams);
useEffect(() => { dateParamsRef.current = dateParams; }, [dateParams]);

const queryFn = useCallback(async (signal?: AbortSignal) => {
  // usar dateParamsRef.current en lugar de dateParams
}, []); // sin dependencias, siempre estable
```

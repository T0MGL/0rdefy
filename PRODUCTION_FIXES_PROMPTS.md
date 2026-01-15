# Production Fixes - Claude Code Prompts

Este documento contiene prompts optimizados para resolver los issues de producción identificados en la auditoría. Cada prompt está diseñado para ejecutarse en una ventana separada de Claude Code para máxima paralelización.

---

## Instrucciones de Uso

1. Abre múltiples ventanas/tabs de Claude Code
2. Copia y pega cada prompt en una ventana diferente
3. Los prompts están organizados por prioridad y dependencias
4. Algunos prompts pueden ejecutarse en paralelo (marcados con 🔀)
5. Otros requieren que se complete un paso previo (marcados con ⏳)

---

## FASE 1: CRITICAL BLOCKERS (Ejecutar Primero)

### 🔀 Prompt 1.1: Rate Limiting para Auth Endpoints

```
Necesito implementar rate limiting en los endpoints de autenticación para prevenir ataques de fuerza bruta.

CONTEXTO:
- Archivo: api/routes/auth.ts
- Los endpoints /login, /register, /change-password NO tienen rate limiting
- Un atacante puede hacer miles de intentos por segundo

REQUISITOS:
1. Agregar rate limiting usando express-rate-limit (ya está instalado en el proyecto)
2. Configuración específica por endpoint:
   - /login: 5 intentos por 15 minutos por IP
   - /register: 10 intentos por hora por IP
   - /change-password: 3 intentos por 15 minutos por IP
   - /forgot-password (cuando exista): 3 intentos por hora por IP
3. En development (NODE_ENV=development), el rate limiting debe ser más permisivo o deshabilitado
4. Retornar error 429 con mensaje claro: "Too many attempts. Please try again in X minutes."
5. Agregar headers de rate limit info (X-RateLimit-Limit, X-RateLimit-Remaining)

ARCHIVOS A MODIFICAR:
- api/routes/auth.ts

NO crear archivos nuevos. NO modificar otros archivos. Solo implementar rate limiting.
```

---

### 🔀 Prompt 1.2: Password Reset Flow Completo

```
Necesito implementar el flujo completo de recuperación de contraseña que actualmente NO existe.

CONTEXTO:
- Actualmente NO hay endpoint para recuperar contraseñas olvidadas
- Los usuarios bloqueados no tienen forma de recuperar acceso
- Necesitamos un flujo seguro con tokens temporales

REQUISITOS:

1. Crear endpoint POST /api/auth/forgot-password:
   - Recibe { email }
   - Genera token seguro (crypto.randomBytes(32).toString('hex'))
   - Guarda en tabla password_reset_tokens (crear si no existe)
   - Token expira en 1 hora
   - Retorna siempre success (no revelar si email existe)
   - Por ahora, loguear el link de reset en consola (integración email después)

2. Crear endpoint POST /api/auth/reset-password:
   - Recibe { token, new_password }
   - Valida token existe y no expiró
   - Actualiza password_hash del usuario
   - Invalida el token (one-time use)
   - Invalida TODAS las sesiones del usuario (logout everywhere)
   - Retorna success

3. Crear migración para tabla password_reset_tokens:
   - id UUID PRIMARY KEY
   - user_id UUID REFERENCES users(id) ON DELETE CASCADE
   - token VARCHAR(255) UNIQUE NOT NULL
   - expires_at TIMESTAMP NOT NULL
   - used_at TIMESTAMP (null si no usado)
   - created_at TIMESTAMP DEFAULT NOW()

4. Rate limiting: 3 intentos por hora para forgot-password

ARCHIVOS A CREAR:
- db/migrations/065_password_reset_tokens.sql

ARCHIVOS A MODIFICAR:
- api/routes/auth.ts

Seguir el patrón existente de auth.ts para consistencia.
```

---

### 🔀 Prompt 1.3: Shopify Webhooks - rawBody Validation

```
Necesito corregir la validación de rawBody en los webhooks de Shopify que actualmente fallan silenciosamente.

CONTEXTO:
- Archivo: api/routes/shopify.ts
- ordersCreateHandler (line 461-468) valida rawBody correctamente
- orders/updated (line 675), products/update (line 750), products/delete (line 819) NO validan rawBody
- Si rawBody es undefined, HMAC verification usa undefined y falla silenciosamente

REQUISITOS:

1. Agregar validación de rawBody en orders/updated webhook (line 675):
```typescript
const rawBody = (req as any).rawBody;
if (!rawBody) {
  console.error('❌ CRITICAL: rawBody not available for orders/updated webhook');
  return res.status(500).json({ error: 'Server configuration error - rawBody middleware not working' });
}
```

2. Agregar la misma validación en products/update webhook (line 750)

3. Agregar la misma validación en products/delete webhook (line 819)

4. Agregar metrics recording en HMAC failures (como ordersCreateHandler lines 514-524):
   - Llamar webhookManager.recordMetric() con status 'failed' y code '401'

5. Agregar replay attack detection a orders/updated, products/update, products/delete:
   - Copiar lógica de ordersCreateHandler lines 527-536
   - Rechazar webhooks más viejos de 5 minutos

ARCHIVOS A MODIFICAR:
- api/routes/shopify.ts

Seguir EXACTAMENTE el patrón de ordersCreateHandler para consistencia.
```

---

### 🔀 Prompt 1.4: Settlement & Dispatch Code Race Conditions

```
Necesito corregir las race conditions en la generación de códigos de settlements y dispatch sessions.

CONTEXTO:
- Archivo: api/services/settlements.service.ts
- Settlement code generation (lines 2103-2127) tiene race condition
- Dispatch session code generation (lines 320-335) tiene race condition
- Dos requests concurrentes pueden generar el mismo código

REQUISITOS:

1. Crear migración con:
   a. UNIQUE constraint en daily_settlements(store_id, settlement_code)
   b. UNIQUE constraint en dispatch_sessions(store_id, session_code)
   c. Función RPC generate_settlement_code_atomic(p_store_id UUID) que use pg_advisory_xact_lock
   d. Función RPC generate_dispatch_code_atomic(p_store_id UUID) que use pg_advisory_xact_lock

2. El patrón a seguir es el de merchandise (migration 062):
```sql
CREATE OR REPLACE FUNCTION generate_settlement_code_atomic(p_store_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_lock_key BIGINT;
  v_today DATE := CURRENT_DATE;
  v_date_str TEXT;
  v_sequence INTEGER;
  v_code TEXT;
BEGIN
  -- Generate lock key from store_id + date
  v_lock_key := hashtext(p_store_id::TEXT || v_today::TEXT);

  -- Acquire advisory lock (transaction-scoped)
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- Format date as DDMMYYYY
  v_date_str := TO_CHAR(v_today, 'DDMMYYYY');

  -- Get next sequence number
  SELECT COALESCE(MAX(...), 0) + 1 INTO v_sequence
  FROM daily_settlements
  WHERE store_id = p_store_id
  AND settlement_date = v_today;

  -- Generate code
  v_code := 'LIQ-' || v_date_str || '-' || LPAD(v_sequence::TEXT, 3, '0');

  RETURN v_code;
END;
$$ LANGUAGE plpgsql;
```

3. Actualizar settlements.service.ts:
   - processManualReconciliation: usar generate_settlement_code_atomic RPC
   - processSettlement: usar generate_settlement_code_atomic RPC
   - createDispatchSession: usar generate_dispatch_code_atomic RPC

4. Manejar constraint violations gracefully con retry (max 3 intentos)

ARCHIVOS A CREAR:
- db/migrations/066_settlement_code_race_fix.sql

ARCHIVOS A MODIFICAR:
- api/services/settlements.service.ts

Probar con múltiples requests concurrentes después de implementar.
```

---

### 🔀 Prompt 1.5: Warehouse - Usar Función Atómica de Packing

```
Necesito corregir el warehouse para usar la función atómica de packing que ya existe pero no se está usando.

CONTEXTO:
- Archivo: api/routes/warehouse.ts y api/services/warehouse.service.ts
- La función updatePackingProgressAtomic() existe (line 1541 del service)
- Pero el route (line 237) llama a updatePackingProgress() que NO es atómica
- Esto causa lost updates cuando dos usuarios empacan el mismo producto

REQUISITOS:

1. En api/routes/warehouse.ts, cambiar la llamada en line ~237:
   ANTES:
   ```typescript
   await warehouseService.updatePackingProgress(sessionId, orderId, productId, storeId!);
   ```
   DESPUÉS:
   ```typescript
   await warehouseService.updatePackingProgressAtomic(sessionId, orderId, productId, 1, storeId!);
   ```

2. Verificar que updatePackingProgressAtomic use el RPC update_packing_progress_atomic

3. Si el RPC no existe, crear migración para agregarlo:
```sql
CREATE OR REPLACE FUNCTION update_packing_progress_atomic(
  p_session_id UUID,
  p_order_id UUID,
  p_product_id UUID,
  p_increment INTEGER,
  p_store_id UUID
) RETURNS JSON AS $$
DECLARE
  v_result JSON;
  v_current RECORD;
BEGIN
  -- Lock the row for update
  SELECT * INTO v_current
  FROM packing_progress
  WHERE session_id = p_session_id
  AND order_id = p_order_id
  AND product_id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Packing progress not found';
  END IF;

  -- Check bounds
  IF v_current.quantity_packed + p_increment > v_current.quantity_expected THEN
    RAISE EXCEPTION 'Cannot pack more than expected quantity';
  END IF;

  IF v_current.quantity_packed + p_increment < 0 THEN
    RAISE EXCEPTION 'Cannot have negative packed quantity';
  END IF;

  -- Update atomically
  UPDATE packing_progress
  SET quantity_packed = quantity_packed + p_increment,
      updated_at = NOW()
  WHERE session_id = p_session_id
  AND order_id = p_order_id
  AND product_id = p_product_id
  RETURNING * INTO v_current;

  RETURN row_to_json(v_current);
END;
$$ LANGUAGE plpgsql;
```

4. Agregar manejo de errores apropiado en el route

ARCHIVOS A MODIFICAR:
- api/routes/warehouse.ts
- api/services/warehouse.service.ts (si es necesario)

ARCHIVOS A CREAR (si el RPC no existe):
- db/migrations/067_warehouse_atomic_packing.sql
```

---

## FASE 2: HIGH PRIORITY (Después de Fase 1)

### 🔀 Prompt 2.1: Orders - Transacción en Confirm Endpoint

```
Necesito envolver el endpoint /confirm de orders en una transacción para evitar estados inconsistentes.

CONTEXTO:
- Archivo: api/routes/orders.ts
- El endpoint POST /:id/confirm (lines 2414-2644) hace 6+ database calls separados
- Si uno falla a mitad, el order queda en estado inconsistente
- Ejemplo: order confirmado pero QR no generado, o upsell agregado pero total no actualizado

REQUISITOS:

1. Crear una función RPC confirm_order_atomic que encapsule todas las operaciones:
```sql
CREATE OR REPLACE FUNCTION confirm_order_atomic(
  p_order_id UUID,
  p_store_id UUID,
  p_confirmed_by UUID,
  p_upsell_products JSONB DEFAULT NULL,  -- [{product_id, quantity}]
  p_discount_amount DECIMAL DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
  v_order RECORD;
  v_result JSON;
BEGIN
  -- Lock the order row
  SELECT * INTO v_order
  FROM orders
  WHERE id = p_order_id AND store_id = p_store_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF v_order.sleeves_status != 'pending' THEN
    RAISE EXCEPTION 'Order already confirmed or in different status';
  END IF;

  -- Update order status
  UPDATE orders SET
    sleeves_status = 'confirmed',
    confirmed_at = NOW(),
    confirmed_by = p_confirmed_by
  WHERE id = p_order_id;

  -- Handle upsells if provided
  IF p_upsell_products IS NOT NULL THEN
    -- Process upsells atomically...
  END IF;

  -- Handle discount if provided
  IF p_discount_amount IS NOT NULL THEN
    -- Apply discount atomically...
  END IF;

  -- Return updated order
  SELECT row_to_json(o) INTO v_result
  FROM orders o WHERE o.id = p_order_id;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql;
```

2. Modificar el route handler para usar el RPC:
   - Preparar los parámetros (upsells, discount)
   - Llamar al RPC
   - Manejar el resultado/errores

3. Mantener la lógica de QR code y n8n webhook DESPUÉS del RPC (no críticos)

4. Agregar manejo de errores que informe al usuario qué falló

ARCHIVOS A CREAR:
- db/migrations/068_confirm_order_atomic.sql

ARCHIVOS A MODIFICAR:
- api/routes/orders.ts (POST /:id/confirm handler)

La migración debe ser idempotente (CREATE OR REPLACE).
```

---

### 🔀 Prompt 2.2: Shopify - Idempotency para orders/updated

```
Necesito agregar idempotency check al webhook orders/updated de Shopify.

CONTEXTO:
- Archivo: api/routes/shopify.ts
- ordersCreateHandler (lines 545-568) tiene idempotency check correcto
- ordersUpdatedHandler (lines 669-731) NO tiene idempotency check
- Shopify puede enviar el mismo webhook múltiples veces (retries)

REQUISITOS:

1. Agregar idempotency check a ordersUpdatedHandler siguiendo el patrón de ordersCreateHandler:

```typescript
// Generate idempotency key
const webhookTimestamp = req.body.updated_at || new Date().toISOString();
const orderId = req.body.id?.toString();
const idempotencyKey = webhookManager.generateIdempotencyKey(
  orderId,
  'orders/updated',
  webhookTimestamp
);

// Try to acquire lock
const lockResult = await webhookManager.tryAcquireIdempotencyLock(
  integrationId!,
  idempotencyKey,
  orderId,
  'orders/updated'
);

if (lockResult.is_duplicate) {
  console.warn(`⚠️ Duplicate orders/updated webhook: ${idempotencyKey}`);
  await webhookManager.recordMetric(integrationId!, storeId!, 'duplicate');
  return res.status(200).json({ success: true, message: 'Already processed' });
}
```

2. Agregar el mismo pattern a products/update y products/delete webhooks

3. Asegurar que el idempotencyKey incluya el timestamp para distinguir updates del mismo order

4. Agregar complete del idempotency record después del procesamiento exitoso

ARCHIVOS A MODIFICAR:
- api/routes/shopify.ts

Seguir EXACTAMENTE el patrón de ordersCreateHandler.
```

---

### 🔀 Prompt 2.3: Settlements - Transacciones en Processing

```
Necesito hacer el procesamiento de settlements atómico para evitar estados inconsistentes.

CONTEXTO:
- Archivo: api/services/settlements.service.ts
- processSettlement (lines 1191-1246) hace múltiples DB calls separados
- importDispatchResults (lines 969-997) también hace calls separados
- Si falla a mitad, los datos quedan inconsistentes

REQUISITOS:

1. Crear RPC process_settlement_atomic:
```sql
CREATE OR REPLACE FUNCTION process_settlement_atomic(
  p_session_id UUID,
  p_store_id UUID
) RETURNS JSON AS $$
DECLARE
  v_session RECORD;
  v_settlement RECORD;
  v_settlement_code TEXT;
BEGIN
  -- Lock dispatch session
  SELECT * INTO v_session
  FROM dispatch_sessions
  WHERE id = p_session_id AND store_id = p_store_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dispatch session not found';
  END IF;

  IF v_session.status != 'processing' THEN
    RAISE EXCEPTION 'Session must be in processing status';
  END IF;

  -- Generate settlement code atomically
  v_settlement_code := generate_settlement_code_atomic(p_store_id);

  -- Create settlement
  INSERT INTO daily_settlements (...)
  VALUES (...)
  RETURNING * INTO v_settlement;

  -- Update dispatch session
  UPDATE dispatch_sessions
  SET status = 'settled',
      daily_settlement_id = v_settlement.id,
      settled_at = NOW()
  WHERE id = p_session_id;

  -- Link carrier movements
  UPDATE carrier_account_movements
  SET settlement_id = v_settlement.id
  WHERE dispatch_session_id = p_session_id
  AND settlement_id IS NULL;

  -- Update orders in batch
  UPDATE orders
  SET sleeves_status = CASE ... END,
      delivered_at = CASE ... END
  WHERE id IN (SELECT order_id FROM dispatch_session_orders WHERE session_id = p_session_id);

  RETURN row_to_json(v_settlement);
END;
$$ LANGUAGE plpgsql;
```

2. Crear RPC import_dispatch_results_atomic para CSV import

3. Actualizar settlements.service.ts para usar los RPCs

4. Batch los order updates en lugar de loop individual

ARCHIVOS A CREAR:
- db/migrations/069_settlement_atomic_processing.sql

ARCHIVOS A MODIFICAR:
- api/services/settlements.service.ts
```

---

### 🔀 Prompt 2.4: Merchandise - Reference Linking en Inventory Movements

```
Necesito corregir el audit trail de inventory_movements para merchandise receptions.

CONTEXTO:
- Archivo: db/migrations/062_merchandise_system_production_fixes.sql
- La función receive_shipment_items crea inventory_movements (lines 174-205)
- PERO no popula reference_type, reference_id, created_by
- Esto rompe el audit trail - no se puede rastrear de dónde vino el movimiento

REQUISITOS:

1. Crear migración que actualice la función receive_shipment_items:

```sql
CREATE OR REPLACE FUNCTION receive_shipment_items(
  p_shipment_id UUID,
  p_items JSONB,
  p_received_by UUID DEFAULT NULL
) RETURNS JSON AS $$
-- ... existing code ...

-- MODIFY the INSERT INTO inventory_movements to include:
INSERT INTO inventory_movements (
  store_id,
  product_id,
  order_id,
  quantity_change,
  stock_before,
  stock_after,
  movement_type,
  notes,
  reference_type,      -- ADD
  reference_id,        -- ADD
  created_by,          -- ADD
  created_at
) VALUES (
  v_store_id,
  v_item.product_id,
  NULL,
  v_delta_received,
  v_stock_before,
  v_stock_after,
  'inbound_receipt',
  'Recepción de mercadería - Envío: ' || v_shipment_reference,
  'inbound_shipment',  -- ADD
  p_shipment_id,       -- ADD
  p_received_by,       -- ADD
  CURRENT_TIMESTAMP
);
```

2. Verificar que las columnas reference_type, reference_id, created_by existen en inventory_movements
   - Si no existen, agregarlas en la migración

3. Actualizar también los movements de rejected items

4. Agregar índice para queries por reference:
```sql
CREATE INDEX IF NOT EXISTS idx_inventory_movements_reference
ON inventory_movements(reference_type, reference_id);
```

ARCHIVOS A CREAR:
- db/migrations/070_inventory_movements_reference_fix.sql

La migración debe ser idempotente (CREATE OR REPLACE, IF NOT EXISTS).
```

---

### 🔀 Prompt 2.5: Returns - Constraint de Unicidad de Order

```
Necesito agregar constraint para prevenir que el mismo order esté en múltiples return sessions.

CONTEXTO:
- Archivo: db/migrations/022_returns_system.sql
- return_session_orders tiene UNIQUE(session_id, order_id)
- Esto solo previene duplicados en la MISMA session
- Un order puede estar en MÚLTIPLES sessions (violación de regla de negocio)

REQUISITOS:

1. Crear migración con:

a. Partial unique index que previene order en múltiples sessions activas:
```sql
-- An order can only be in ONE active return session
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_return_per_order
ON return_session_orders(order_id)
WHERE session_id IN (
  SELECT id FROM return_sessions WHERE status IN ('in_progress', 'completed')
);
```

NOTA: El approach anterior no funciona directamente. Mejor usar:

```sql
-- Add a trigger to validate
CREATE OR REPLACE FUNCTION prevent_duplicate_return_orders()
RETURNS TRIGGER AS $$
DECLARE
  v_session_status TEXT;
  v_existing_count INTEGER;
BEGIN
  -- Get the status of the session being inserted into
  SELECT status INTO v_session_status
  FROM return_sessions
  WHERE id = NEW.session_id;

  -- Check if order is already in an active session
  SELECT COUNT(*) INTO v_existing_count
  FROM return_session_orders rso
  JOIN return_sessions rs ON rs.id = rso.session_id
  WHERE rso.order_id = NEW.order_id
  AND rs.status IN ('in_progress', 'completed')
  AND rso.id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::UUID);

  IF v_existing_count > 0 THEN
    RAISE EXCEPTION 'Order % is already in an active return session', NEW.order_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_prevent_duplicate_return_orders
BEFORE INSERT OR UPDATE ON return_session_orders
FOR EACH ROW
EXECUTE FUNCTION prevent_duplicate_return_orders();
```

b. Función para limpiar orders de sessions canceladas:
```sql
CREATE OR REPLACE FUNCTION cleanup_cancelled_return_session_orders()
RETURNS TRIGGER AS $$
BEGIN
  -- When a session is cancelled, delete its order links
  -- so the orders can be added to a new session
  IF NEW.status = 'cancelled' AND OLD.status != 'cancelled' THEN
    DELETE FROM return_session_orders WHERE session_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_cleanup_cancelled_returns
AFTER UPDATE ON return_sessions
FOR EACH ROW
EXECUTE FUNCTION cleanup_cancelled_return_session_orders();
```

2. Actualizar returns.service.ts para manejar el nuevo error de constraint

ARCHIVOS A CREAR:
- db/migrations/071_returns_order_uniqueness.sql

ARCHIVOS A MODIFICAR:
- api/services/returns.service.ts (error handling)
```

---

## FASE 3: MEDIUM PRIORITY (Después de Fase 2)

### 🔀 Prompt 3.1: Auth - Invalidar Sessions al Cambiar Password

```
Necesito que al cambiar la contraseña se invaliden todas las sesiones existentes del usuario.

CONTEXTO:
- Archivo: api/routes/auth.ts
- Endpoint POST /change-password (lines 723-823)
- Actualmente cambia la contraseña pero NO invalida tokens existentes
- Un atacante con un token robado puede seguir usándolo

REQUISITOS:

1. Crear tabla user_sessions si no existe (para tracking de sesiones):
```sql
CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) NOT NULL, -- hash del JWT para identificar
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL,
  invalidated_at TIMESTAMP, -- null si válido
  invalidated_reason VARCHAR(50), -- 'password_change', 'logout', 'admin_revoke'
  ip_address VARCHAR(45),
  user_agent TEXT
);

CREATE INDEX idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_token_hash ON user_sessions(token_hash);
```

2. Crear función para invalidar todas las sesiones:
```sql
CREATE OR REPLACE FUNCTION invalidate_user_sessions(
  p_user_id UUID,
  p_reason VARCHAR(50),
  p_except_token_hash VARCHAR(255) DEFAULT NULL
) RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE user_sessions
  SET invalidated_at = NOW(),
      invalidated_reason = p_reason
  WHERE user_id = p_user_id
  AND invalidated_at IS NULL
  AND (p_except_token_hash IS NULL OR token_hash != p_except_token_hash);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;
```

3. Modificar /change-password para:
   - Obtener hash del token actual
   - Llamar invalidate_user_sessions(userId, 'password_change', currentTokenHash)
   - Esto invalida todas las sesiones EXCEPTO la actual

4. Modificar middleware verifyToken para:
   - Verificar que la sesión no esté invalidada
   - Si está invalidada, retornar 401

5. Modificar /login para crear registro en user_sessions

ARCHIVOS A CREAR:
- db/migrations/072_user_sessions_tracking.sql

ARCHIVOS A MODIFICAR:
- api/routes/auth.ts
- api/middleware/auth.ts
```

---

### 🔀 Prompt 3.2: Billing - Discount Code Race Condition Fix

```
Necesito corregir la race condition en la redención de discount codes.

CONTEXTO:
- Archivo: api/routes/billing.ts
- Lines 616-621 usan "optimistic locking" que NO es verdaderamente atómico
- Dos requests concurrentes pueden ambos redimir el mismo código excediendo max_uses

REQUISITOS:

1. Crear RPC para redención atómica:
```sql
CREATE OR REPLACE FUNCTION redeem_discount_code_atomic(
  p_code VARCHAR(50),
  p_user_id UUID,
  p_store_id UUID
) RETURNS JSON AS $$
DECLARE
  v_discount RECORD;
  v_result JSON;
BEGIN
  -- Lock the discount code row
  SELECT * INTO v_discount
  FROM discount_codes
  WHERE code = UPPER(p_code)
  AND is_active = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Discount code not found or inactive');
  END IF;

  -- Check expiration
  IF v_discount.valid_until IS NOT NULL AND v_discount.valid_until < NOW() THEN
    RETURN json_build_object('success', false, 'error', 'Discount code has expired');
  END IF;

  -- Check max uses (with lock held, this is now atomic)
  IF v_discount.max_uses IS NOT NULL AND v_discount.current_uses >= v_discount.max_uses THEN
    RETURN json_build_object('success', false, 'error', 'Discount code has reached maximum uses');
  END IF;

  -- Increment usage
  UPDATE discount_codes
  SET current_uses = current_uses + 1
  WHERE id = v_discount.id;

  -- Record redemption
  INSERT INTO discount_redemptions (discount_code_id, user_id, store_id, redeemed_at)
  VALUES (v_discount.id, p_user_id, p_store_id, NOW());

  RETURN json_build_object(
    'success', true,
    'discount', row_to_json(v_discount),
    'stripe_coupon_id', v_discount.stripe_coupon_id
  );
END;
$$ LANGUAGE plpgsql;
```

2. Actualizar billing.ts checkout endpoint para usar el RPC

3. Manejar el caso donde el RPC retorna success=false

4. Agregar NOT NULL constraint a current_uses con default 0:
```sql
ALTER TABLE discount_codes
ALTER COLUMN current_uses SET DEFAULT 0,
ALTER COLUMN current_uses SET NOT NULL;
```

ARCHIVOS A CREAR:
- db/migrations/073_discount_code_atomic_redemption.sql

ARCHIVOS A MODIFICAR:
- api/routes/billing.ts
```

---

### 🔀 Prompt 3.3: Orders - Optimistic Locking en Status Change

```
Necesito agregar optimistic locking al endpoint PATCH /status de orders.

CONTEXTO:
- Archivo: api/routes/orders.ts
- PUT endpoint (line 1210) usa optimistic locking con campo 'version'
- PATCH /status (lines 1566-1858) NO lo usa
- Cambios de status concurrentes pueden sobrescribirse

REQUISITOS:

1. Verificar que la tabla orders tenga columna 'version':
```sql
ALTER TABLE orders ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;
```

2. Modificar PATCH /status para usar version:

```typescript
// Al inicio del handler, obtener version actual
const { data: currentOrder } = await supabaseAdmin
  .from('orders')
  .select('id, sleeves_status, version')
  .eq('id', id)
  .single();

// ... validaciones ...

// Al hacer update, incluir version check
const { data, error } = await supabaseAdmin
  .from('orders')
  .update({
    ...updateData,
    version: currentOrder.version + 1
  })
  .eq('id', id)
  .eq('store_id', req.storeId)
  .eq('version', currentOrder.version)  // Optimistic lock
  .select()
  .single();

if (!data && !error) {
  // No rows updated = version mismatch = concurrent modification
  return res.status(409).json({
    error: 'Order was modified by another user. Please refresh and try again.',
    code: 'CONCURRENT_MODIFICATION'
  });
}
```

3. Agregar el mismo patrón a otros endpoints que modifican orders:
   - POST /:id/confirm
   - PATCH /:id (si existe)

4. En el frontend, mostrar mensaje amigable cuando ocurra 409

ARCHIVOS A CREAR:
- db/migrations/074_orders_version_column.sql (si no existe)

ARCHIVOS A MODIFICAR:
- api/routes/orders.ts
```

---

### 🔀 Prompt 3.4: Settlements - Batch Order Updates

```
Necesito optimizar los updates de orders en settlements para usar batch en lugar de loop.

CONTEXTO:
- Archivo: api/services/settlements.service.ts
- processManualReconciliation (lines 2022-2055) hace N queries individuales
- Con 100 orders = 300 queries, muy lento

REQUISITOS:

1. Crear RPC para batch update de orders:
```sql
CREATE OR REPLACE FUNCTION batch_update_order_delivery_status(
  p_store_id UUID,
  p_delivered_orders UUID[],  -- array of order IDs
  p_failed_orders UUID[],
  p_delivered_at TIMESTAMP DEFAULT NOW()
) RETURNS JSON AS $$
DECLARE
  v_delivered_count INTEGER;
  v_failed_count INTEGER;
BEGIN
  -- Update delivered orders
  UPDATE orders
  SET sleeves_status = 'delivered',
      delivered_at = p_delivered_at,
      updated_at = NOW()
  WHERE id = ANY(p_delivered_orders)
  AND store_id = p_store_id;

  GET DIAGNOSTICS v_delivered_count = ROW_COUNT;

  -- Update failed orders
  UPDATE orders
  SET sleeves_status = 'shipped',  -- revert to shipped for retry
      updated_at = NOW()
  WHERE id = ANY(p_failed_orders)
  AND store_id = p_store_id;

  GET DIAGNOSTICS v_failed_count = ROW_COUNT;

  RETURN json_build_object(
    'delivered_count', v_delivered_count,
    'failed_count', v_failed_count
  );
END;
$$ LANGUAGE plpgsql;
```

2. Crear RPC para batch update de discrepancies:
```sql
CREATE OR REPLACE FUNCTION batch_update_cod_discrepancies(
  p_store_id UUID,
  p_updates JSONB  -- [{order_id, amount_collected, has_discrepancy}]
) RETURNS INTEGER AS $$
DECLARE
  v_update RECORD;
  v_count INTEGER := 0;
BEGIN
  FOR v_update IN SELECT * FROM jsonb_to_recordset(p_updates)
    AS x(order_id UUID, amount_collected DECIMAL, has_discrepancy BOOLEAN)
  LOOP
    UPDATE orders
    SET amount_collected = v_update.amount_collected,
        has_amount_discrepancy = v_update.has_discrepancy,
        updated_at = NOW()
    WHERE id = v_update.order_id
    AND store_id = p_store_id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql;
```

3. Actualizar processManualReconciliation para usar los RPCs

4. Actualizar importDispatchResults para usar batch updates

ARCHIVOS A CREAR:
- db/migrations/075_settlement_batch_updates.sql

ARCHIVOS A MODIFICAR:
- api/services/settlements.service.ts
```

---

### 🔀 Prompt 3.5: Billing - Validar Trial Eligibility en Webhook

```
Necesito agregar re-verificación de elegibilidad de trial en el webhook de Stripe.

CONTEXTO:
- Archivo: api/routes/billing.ts
- checkout.session.completed handler (lines 639-696)
- Actualmente crea trial record sin verificar elegibilidad
- Usuario podría manipular para obtener múltiples trials

REQUISITOS:

1. Agregar verificación antes de crear trial record:

```typescript
// Before inserting into subscription_trials
if (subscription.trial_end) {
  // Re-verify trial eligibility
  const { data: existingTrials } = await supabaseAdmin
    .from('subscription_trials')
    .select('id, plan_tried')
    .eq('user_id', userId);

  // Check if user already had ANY trial
  if (existingTrials && existingTrials.length > 0) {
    console.warn(`⚠️ User ${userId} attempted trial but already had trial for: ${existingTrials.map(t => t.plan_tried).join(', ')}`);

    // Cancel the subscription's trial in Stripe
    await getStripe().subscriptions.update(subscription.id, {
      trial_end: 'now'  // End trial immediately
    });

    // Don't record the trial
    return;
  }

  // Record legitimate trial
  await supabaseAdmin.from('subscription_trials').insert({...});
}
```

2. Agregar logging/alerting para intentos de trial abuse

3. Considerar agregar webhook para customer.subscription.trial_will_end para enviar reminder

ARCHIVOS A MODIFICAR:
- api/routes/billing.ts

NO crear migraciones nuevas para esto.
```

---

## FASE 4: IMPROVEMENTS (Cuando haya tiempo)

### Prompt 4.1: Email Enumeration Fix

```
Corregir la revelación de emails existentes en el endpoint de registro.

CONTEXTO:
- api/routes/auth.ts, lines 79-87
- Actualmente retorna "Este email ya está registrado"
- Permite enumerar emails válidos

CAMBIAR de:
```typescript
if (existingUser) {
  return res.status(400).json({
    success: false,
    error: 'Este email ya está registrado',
    code: 'EMAIL_EXISTS'
  });
}
```

A:
```typescript
if (existingUser) {
  // Log for security monitoring
  console.warn(`Registration attempt for existing email: ${email}`);

  // Return generic success to prevent enumeration
  // But don't actually create anything
  return res.json({
    success: true,
    message: 'If this email is not registered, you will receive a confirmation email.',
    requiresEmailVerification: true
  });
}
```

NOTA: Esto requiere implementar email verification para ser completo.
Por ahora, al menos cambiar el mensaje de error a algo genérico.
```

---

### Prompt 4.2: Shopify Webhook Queue para orders/updated

```
Agregar soporte de async queue a ordersUpdatedHandler.

CONTEXTO:
- api/routes/shopify.ts
- ordersCreateHandler usa webhookQueue.enqueue() (lines 575-608)
- ordersUpdatedHandler procesa síncronamente (lines 723-731)
- Puede exceder el timeout de 5 segundos de Shopify

Seguir el patrón exacto de ordersCreateHandler para agregar queue support.
```

---

### Prompt 4.3: Settlements Discrepancy Rounding Fix

```
Corregir errores de redondeo en distribución de discrepancias.

CONTEXTO:
- api/services/settlements.service.ts, lines 2058-2079
- Divide discrepancy entre N orders, redondea cada uno
- Suma de redondeados != original

SOLUCIÓN:
Usar algoritmo de largest remainder para distribuir:
1. Calcular parte entera para cada order
2. Calcular remainder total
3. Distribuir remainder a los orders con mayor fracción decimal
```

---

## Checklist de Ejecución

### Fase 1 (Paralelo)
- [ ] 1.1 Rate Limiting Auth
- [ ] 1.2 Password Reset Flow
- [ ] 1.3 Shopify rawBody Validation
- [ ] 1.4 Settlement/Dispatch Codes
- [ ] 1.5 Warehouse Atomic Packing

### Fase 2 (Paralelo, después de Fase 1)
- [ ] 2.1 Orders Confirm Transaction
- [ ] 2.2 Shopify Idempotency
- [ ] 2.3 Settlements Atomic Processing
- [ ] 2.4 Merchandise Reference Linking
- [ ] 2.5 Returns Order Uniqueness

### Fase 3 (Paralelo, después de Fase 2)
- [ ] 3.1 Auth Session Invalidation
- [ ] 3.2 Billing Discount Code Fix
- [ ] 3.3 Orders Optimistic Locking
- [ ] 3.4 Settlements Batch Updates
- [ ] 3.5 Billing Trial Verification

### Fase 4 (Cuando haya tiempo)
- [ ] 4.1 Email Enumeration
- [ ] 4.2 Shopify Queue for updates
- [ ] 4.3 Discrepancy Rounding

---

## Notas para el Equipo

1. **Ejecutar migraciones en orden**: Las migraciones deben aplicarse en orden numérico (065, 066, 067...)

2. **Testing**: Después de cada fix, probar con requests concurrentes usando herramientas como `ab` o `wrk`

3. **Rollback**: Cada migración debe tener su correspondiente rollback documentado

4. **Monitoreo**: Después de deployar, monitorear logs por errores nuevos

5. **Comunicación**: Actualizar CLAUDE.md con los cambios realizados

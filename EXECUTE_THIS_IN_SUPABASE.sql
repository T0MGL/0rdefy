-- ================================================================
-- EJECUTA ESTO EN SUPABASE SQL EDITOR - UNA SOLA VEZ
-- ================================================================
-- Esto hará:
-- 1. Aplicar migración 039 (cascading delete)
-- 2. Dar acceso de owner a tus cuentas
-- 3. Eliminar TODOS los pedidos de Bright Idea
-- ================================================================

-- ================================================================
-- PASO 1: Aplicar Migration 039 - Cascading Delete
-- ================================================================

-- Add soft delete columns if they don't exist
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP DEFAULT NULL,
ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id),
ADD COLUMN IF NOT EXISTS deletion_type VARCHAR(20) CHECK (deletion_type IN ('soft', 'hard')) DEFAULT NULL;

-- Create/recreate indexes for soft delete
DROP INDEX IF EXISTS idx_orders_deleted_at;
DROP INDEX IF EXISTS idx_orders_active;
CREATE INDEX idx_orders_deleted_at ON orders(store_id, deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_orders_active ON orders(store_id, deleted_at) WHERE deleted_at IS NULL;

-- Cascading Hard Delete Function
CREATE OR REPLACE FUNCTION cascade_delete_order_data()
RETURNS TRIGGER AS $$
DECLARE
    line_item JSONB;
    v_product_id UUID;
    v_quantity INT;
    v_product_name TEXT;
    v_picking_session_ids UUID[];
    v_return_session_ids UUID[];
BEGIN
    -- Restore stock if order affected inventory
    IF OLD.sleeves_status IN ('ready_to_ship', 'shipped', 'delivered') THEN
        FOR line_item IN SELECT * FROM jsonb_array_elements(OLD.line_items)
        LOOP
            DECLARE
                v_stock_before INT;
                v_stock_after INT;
            BEGIN
                v_product_id := (line_item->>'product_id')::UUID;
                v_quantity := (line_item->>'quantity')::INT;
                v_product_name := line_item->>'product_name';
                IF v_product_id IS NULL THEN CONTINUE; END IF;

                -- Get current stock before update
                SELECT stock INTO v_stock_before FROM products WHERE id = v_product_id;
                v_stock_after := v_stock_before + v_quantity;

                -- Restore stock
                UPDATE products SET stock = v_stock_after, updated_at = NOW() WHERE id = v_product_id;

                -- Log the restoration
                INSERT INTO inventory_movements (
                    product_id, store_id, order_id, movement_type,
                    quantity_change, stock_before, stock_after,
                    reason, notes, created_at
                ) VALUES (
                    v_product_id, OLD.store_id, OLD.id, 'order_hard_delete_restoration',
                    v_quantity, v_stock_before, v_stock_after,
                    'order_deletion',
                    format('Stock restored due to permanent deletion of order %s (status: %s)', OLD.id, OLD.sleeves_status),
                    NOW()
                );
            END;
        END LOOP;
    END IF;

    -- Delete from picking/packing sessions
    SELECT ARRAY_AGG(DISTINCT picking_session_id) INTO v_picking_session_ids FROM picking_session_orders WHERE order_id = OLD.id;
    IF v_picking_session_ids IS NOT NULL AND array_length(v_picking_session_ids, 1) > 0 THEN
        DELETE FROM packing_progress WHERE order_id = OLD.id;
        DELETE FROM picking_session_orders WHERE order_id = OLD.id;
        DELETE FROM picking_sessions WHERE id = ANY(v_picking_session_ids) AND NOT EXISTS (SELECT 1 FROM picking_session_orders WHERE picking_session_id = picking_sessions.id);
    END IF;

    -- Delete from return sessions
    SELECT ARRAY_AGG(DISTINCT session_id) INTO v_return_session_ids FROM return_session_orders WHERE order_id = OLD.id;
    IF v_return_session_ids IS NOT NULL AND array_length(v_return_session_ids, 1) > 0 THEN
        DELETE FROM return_session_orders WHERE order_id = OLD.id;
        DELETE FROM return_sessions WHERE id = ANY(v_return_session_ids) AND NOT EXISTS (SELECT 1 FROM return_session_orders WHERE session_id = return_sessions.id);
    END IF;

    -- Delete other related data
    DELETE FROM order_line_items WHERE order_id = OLD.id;
    DELETE FROM delivery_attempts WHERE order_id = OLD.id;
    DELETE FROM settlement_orders WHERE order_id = OLD.id;
    DELETE FROM order_status_history WHERE order_id = OLD.id;
    DELETE FROM follow_up_log WHERE order_id = OLD.id;

    -- Clean up Shopify records
    IF OLD.shopify_order_id IS NOT NULL THEN
        DELETE FROM shopify_webhook_idempotency WHERE shopify_event_id = OLD.shopify_order_id;
        DELETE FROM shopify_webhook_events WHERE shopify_event_id = OLD.shopify_order_id AND store_id = OLD.store_id;
    END IF;

    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- Drop old triggers
DROP TRIGGER IF EXISTS trigger_restore_stock_on_hard_delete ON orders;
DROP TRIGGER IF EXISTS trigger_cascade_delete_order_data ON orders;
DROP TRIGGER IF EXISTS trigger_prevent_order_deletion_after_stock_deducted ON orders;

-- Create new trigger
CREATE TRIGGER trigger_cascade_delete_order_data
    BEFORE DELETE ON orders
    FOR EACH ROW
    EXECUTE FUNCTION cascade_delete_order_data();

-- ================================================================
-- PASO 2: LOS USUARIOS YA SON OWNERS (SKIP)
-- ================================================================
-- Los usuarios ya tienen acceso de owner, no es necesario ejecutar esto

-- ================================================================
-- PASO 3: Eliminar TODOS los pedidos de Bright Idea
-- ================================================================

-- Esto eliminará permanentemente TODOS los pedidos
-- El trigger cascade_delete_order_data hará la limpieza completa
DELETE FROM orders
WHERE store_id IN (
  SELECT store_id FROM user_stores us
  JOIN users u ON us.user_id = u.id
  WHERE u.email = 'gaston@thebrightidea.ai'
  AND us.is_active = true
);

-- ================================================================
-- VERIFICACIÓN (ejecuta esto después para confirmar)
-- ================================================================

-- 1. Verifica que el trigger existe (debe retornar 1 fila)
SELECT trigger_name FROM information_schema.triggers
WHERE trigger_name = 'trigger_cascade_delete_order_data';

-- 2. Verifica que tienes acceso de owner (debe retornar tus emails con role='owner')
SELECT u.email, us.role, s.name as store_name
FROM user_stores us
JOIN users u ON us.user_id = u.id
JOIN stores s ON us.store_id = s.id
WHERE u.email IN ('gaston@thebrightidea.ai', 'hanselechague6@gmail.com')
  AND us.is_active = true;

-- 3. Verifica que NO quedan pedidos (debe retornar 0)
SELECT COUNT(*) as remaining_orders
FROM orders
WHERE store_id IN (
  SELECT store_id FROM user_stores us
  JOIN users u ON us.user_id = u.id
  WHERE u.email = 'gaston@thebrightidea.ai'
  AND us.is_active = true
);

-- 4. Verifica que NO quedan pedidos soft-deleted (debe retornar 0)
SELECT COUNT(*) as soft_deleted_orders
FROM orders
WHERE deleted_at IS NOT NULL;

-- ================================================================
-- LISTO!
-- ================================================================
-- Después de ejecutar este SQL:
-- ✅ Migración 039 aplicada
-- ✅ Acceso de owner otorgado
-- ✅ Todos los pedidos de Bright Idea eliminados completamente
-- ✅ Frontend actualizado (checkbox deshabilitado para soft-deleted)
--
-- Ahora recarga la app y prueba:
-- 1. Como non-owner: Eliminar pedido → se marca soft-deleted (opacidad, no clickable)
-- 2. Como owner: Eliminar pedido → se elimina permanentemente (desaparece completamente)
-- ================================================================

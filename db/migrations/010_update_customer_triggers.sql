-- ================================================================
-- ORDEFY - UPDATE CUSTOMER TRIGGERS
-- ================================================================
-- Actualización del trigger de estadísticas de clientes
-- Compatible con la nueva lógica de creación en shopify-webhook.service
-- ================================================================

-- ================================================================
-- TRIGGER: update_customer_stats_v2
-- ================================================================
-- SOLO actualiza estadísticas si el cliente ya existe y está vinculado
-- NO crea clientes automáticamente (eso lo hace el servicio)
-- ================================================================

CREATE OR REPLACE FUNCTION fn_update_customer_stats()
RETURNS TRIGGER AS $$
BEGIN
    -- Solo actualizar si el pedido tiene customer_id vinculado
    IF NEW.customer_id IS NOT NULL THEN
        -- Actualizar estadísticas del cliente existente
        UPDATE customers
        SET
            total_orders = total_orders + 1,
            total_spent = total_spent + COALESCE(NEW.total_price, 0),
            last_order_at = NEW.created_at,
            updated_at = NOW()
        WHERE id = NEW.customer_id
        AND store_id = NEW.store_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recrear trigger
DROP TRIGGER IF EXISTS trigger_update_customer_stats ON orders;

CREATE TRIGGER trigger_update_customer_stats
    AFTER INSERT ON orders
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_customer_stats();

COMMENT ON FUNCTION fn_update_customer_stats IS 'Ordefy: Auto-update customer stats on new orders (v2 - compatible with service layer)';

-- ================================================================
-- TRIGGER: update_customer_stats_on_update
-- ================================================================
-- Actualizar estadísticas cuando cambia el total del pedido
-- ================================================================

CREATE OR REPLACE FUNCTION fn_update_customer_stats_on_update()
RETURNS TRIGGER AS $$
BEGIN
    -- Solo si el customer_id está vinculado y el total cambió
    IF NEW.customer_id IS NOT NULL AND OLD.total_price IS DISTINCT FROM NEW.total_price THEN
        -- Calcular la diferencia
        DECLARE
            v_diff DECIMAL(10,2);
        BEGIN
            v_diff := COALESCE(NEW.total_price, 0) - COALESCE(OLD.total_price, 0);

            -- Actualizar total_spent
            UPDATE customers
            SET
                total_spent = total_spent + v_diff,
                updated_at = NOW()
            WHERE id = NEW.customer_id
            AND store_id = NEW.store_id;
        END;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Crear trigger para actualizaciones
DROP TRIGGER IF EXISTS trigger_update_customer_stats_on_update ON orders;

CREATE TRIGGER trigger_update_customer_stats_on_update
    AFTER UPDATE ON orders
    FOR EACH ROW
    EXECUTE FUNCTION fn_update_customer_stats_on_update();

COMMENT ON FUNCTION fn_update_customer_stats_on_update IS 'Ordefy: Update customer stats when order total changes';

-- ================================================================
-- ÍNDICES ADICIONALES PARA BÚSQUEDA EFICIENTE
-- ================================================================

-- Índice compuesto para búsqueda por teléfono (prioridad)
CREATE INDEX IF NOT EXISTS idx_customers_store_phone
ON customers(store_id, phone)
WHERE phone IS NOT NULL AND phone <> '';

-- Índice compuesto para búsqueda por email (fallback)
CREATE INDEX IF NOT EXISTS idx_customers_store_email
ON customers(store_id, email)
WHERE email IS NOT NULL AND email <> '';

-- ================================================================
-- MIGRATION COMPLETE
-- ================================================================
-- Customer triggers updated for service-layer compatibility
-- Phone is now the primary identifier for customer lookups
-- ================================================================

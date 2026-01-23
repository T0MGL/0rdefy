-- ============================================================================
-- MIGRATION 106: Critical Fixes - Stock Trigger and Delivery Token
-- ============================================================================
--
-- CRITICAL BUGS FIXED:
--
-- BUG 1: find_product_id_by_sku() references 'deleted_at' column that doesn't exist
--        The products table uses 'is_active' NOT 'deleted_at'
--        ERROR: column "deleted_at" does not exist
--
-- BUG 2: delivery_link_token not generated automatically when confirming orders
--        This causes "Imprimir etiqueta" button to not appear
--        Orders need this token to enable printing functionality
--
-- BUG 3: Picking sessions can become corrupted with 0 products
--        Need cleanup function and prevention
--
-- Author: Claude
-- Date: 2026-01-23
-- ============================================================================

BEGIN;

-- ============================================================================
-- FIX 1: Correct find_product_id_by_sku to use is_active instead of deleted_at
-- ============================================================================

CREATE OR REPLACE FUNCTION find_product_id_by_sku(
    p_store_id UUID,
    p_sku TEXT
)
RETURNS UUID AS $$
DECLARE
    v_product_id UUID;
BEGIN
    IF p_sku IS NULL OR TRIM(p_sku) = '' THEN
        RETURN NULL;
    END IF;

    -- Try exact match (case-insensitive, trimmed)
    -- FIX: Use is_active = TRUE instead of deleted_at IS NULL
    SELECT id INTO v_product_id
    FROM products
    WHERE store_id = p_store_id
      AND UPPER(TRIM(sku)) = UPPER(TRIM(p_sku))
      AND is_active = TRUE
    LIMIT 1;

    RETURN v_product_id;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION find_product_id_by_sku(UUID, TEXT) IS
'Helper function to find product ID by SKU within a store.
FIXED in migration 106: Uses is_active = TRUE instead of deleted_at IS NULL (column did not exist)';


-- ============================================================================
-- FIX 2: Trigger to auto-generate delivery_link_token when order is confirmed
-- ============================================================================

-- Function to generate delivery token
CREATE OR REPLACE FUNCTION generate_delivery_link_token()
RETURNS TRIGGER AS $$
BEGIN
    -- Generate token when:
    -- 1. Order is being confirmed (status changing to 'confirmed')
    -- 2. Order doesn't already have a token
    IF NEW.sleeves_status = 'confirmed' AND
       (OLD IS NULL OR OLD.sleeves_status != 'confirmed') AND
       (NEW.delivery_link_token IS NULL OR NEW.delivery_link_token = '') THEN

        -- Generate 10 character alphanumeric token
        NEW.delivery_link_token := UPPER(SUBSTRING(encode(gen_random_bytes(5), 'hex'), 1, 10));

        RAISE NOTICE '[TOKEN] Generated delivery_link_token % for order %',
            NEW.delivery_link_token, NEW.id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION generate_delivery_link_token() IS
'Auto-generates delivery_link_token when order is confirmed. Required for printing labels.';

-- Drop existing trigger if exists and recreate
DROP TRIGGER IF EXISTS trigger_generate_delivery_token ON orders;

CREATE TRIGGER trigger_generate_delivery_token
    BEFORE INSERT OR UPDATE OF sleeves_status
    ON orders
    FOR EACH ROW
    EXECUTE FUNCTION generate_delivery_link_token();


-- ============================================================================
-- FIX 3: Backfill missing delivery_link_token for existing confirmed orders
-- ============================================================================

UPDATE orders
SET delivery_link_token = UPPER(SUBSTRING(encode(gen_random_bytes(5), 'hex'), 1, 10))
WHERE sleeves_status IN ('confirmed', 'in_preparation', 'ready_to_ship', 'shipped', 'in_transit', 'delivered')
  AND (delivery_link_token IS NULL OR delivery_link_token = '');

-- Log how many were updated
DO $$
DECLARE
    v_count INT;
BEGIN
    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count > 0 THEN
        RAISE NOTICE '[BACKFILL] Generated delivery_link_token for % orders', v_count;
    END IF;
END $$;


-- ============================================================================
-- FIX 4: Function to cleanup corrupted picking sessions (0 products)
-- ============================================================================

CREATE OR REPLACE FUNCTION cleanup_corrupted_picking_sessions(p_store_id UUID)
RETURNS TABLE(
    session_id UUID,
    session_code TEXT,
    orders_restored INT
) AS $$
DECLARE
    v_session RECORD;
    v_orders_count INT;
BEGIN
    FOR v_session IN
        SELECT ps.id, ps.code
        FROM picking_sessions ps
        WHERE ps.store_id = p_store_id
          AND ps.status IN ('picking', 'packing')
          -- Session has no items OR all items have 0 quantity
          AND (
              NOT EXISTS (
                  SELECT 1 FROM picking_session_items psi
                  WHERE psi.picking_session_id = ps.id
                  AND psi.quantity_to_pick > 0
              )
          )
    LOOP
        -- Count orders in this session
        SELECT COUNT(*) INTO v_orders_count
        FROM picking_session_orders pso
        WHERE pso.picking_session_id = v_session.id;

        -- Restore orders to confirmed status
        UPDATE orders o
        SET sleeves_status = 'confirmed'
        FROM picking_session_orders pso
        WHERE pso.picking_session_id = v_session.id
          AND pso.order_id = o.id
          AND o.sleeves_status = 'in_preparation';

        -- Mark session as completed (cleanup)
        UPDATE picking_sessions
        SET status = 'completed'
        WHERE id = v_session.id;

        session_id := v_session.id;
        session_code := v_session.code;
        orders_restored := v_orders_count;

        RETURN NEXT;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_corrupted_picking_sessions(UUID) IS
'Cleans up picking sessions that have 0 products (corrupted). Restores orders to confirmed status.';


-- ============================================================================
-- FIX 5: View to identify corrupted sessions
-- ============================================================================

CREATE OR REPLACE VIEW v_corrupted_picking_sessions AS
SELECT
    ps.id,
    ps.code,
    ps.store_id,
    ps.status,
    ps.created_at,
    COUNT(DISTINCT pso.order_id) as order_count,
    COALESCE(SUM(psi.quantity_to_pick), 0) as total_items_to_pick,
    CASE
        WHEN COALESCE(SUM(psi.quantity_to_pick), 0) = 0 THEN 'CORRUPTED - No items'
        ELSE 'OK'
    END as health_status
FROM picking_sessions ps
LEFT JOIN picking_session_orders pso ON pso.picking_session_id = ps.id
LEFT JOIN picking_session_items psi ON psi.picking_session_id = ps.id
WHERE ps.status IN ('picking', 'packing')
GROUP BY ps.id, ps.code, ps.store_id, ps.status, ps.created_at
HAVING COALESCE(SUM(psi.quantity_to_pick), 0) = 0;

COMMENT ON VIEW v_corrupted_picking_sessions IS
'Shows picking sessions that are corrupted (have orders but 0 items to pick)';


-- ============================================================================
-- GRANT PERMISSIONS
-- ============================================================================

GRANT EXECUTE ON FUNCTION find_product_id_by_sku(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION find_product_id_by_sku(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION generate_delivery_link_token() TO authenticated;
GRANT EXECUTE ON FUNCTION generate_delivery_link_token() TO service_role;
GRANT EXECUTE ON FUNCTION cleanup_corrupted_picking_sessions(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION cleanup_corrupted_picking_sessions(UUID) TO service_role;
GRANT SELECT ON v_corrupted_picking_sessions TO authenticated;
GRANT SELECT ON v_corrupted_picking_sessions TO service_role;


-- ============================================================================
-- VERIFICATION
-- ============================================================================

DO $$
DECLARE
    v_token_trigger_exists BOOLEAN;
    v_sku_function_ok BOOLEAN;
BEGIN
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Migration 106 - Critical Fixes';
    RAISE NOTICE '========================================';

    -- Check token trigger exists
    SELECT EXISTS(
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trigger_generate_delivery_token'
    ) INTO v_token_trigger_exists;

    IF v_token_trigger_exists THEN
        RAISE NOTICE 'OK: delivery_link_token trigger created';
    ELSE
        RAISE WARNING 'WARN: delivery_link_token trigger NOT created';
    END IF;

    -- Check find_product_id_by_sku doesn't reference deleted_at
    SELECT NOT EXISTS(
        SELECT 1 FROM pg_proc
        WHERE proname = 'find_product_id_by_sku'
        AND prosrc LIKE '%deleted_at%'
    ) INTO v_sku_function_ok;

    IF v_sku_function_ok THEN
        RAISE NOTICE 'OK: find_product_id_by_sku fixed (no deleted_at)';
    ELSE
        RAISE WARNING 'WARN: find_product_id_by_sku still has deleted_at';
    END IF;

    RAISE NOTICE '========================================';
    RAISE NOTICE 'FIXES APPLIED:';
    RAISE NOTICE '  1. find_product_id_by_sku: is_active instead of deleted_at';
    RAISE NOTICE '  2. Auto-generate delivery_link_token on confirm';
    RAISE NOTICE '  3. Backfilled tokens for existing orders';
    RAISE NOTICE '  4. cleanup_corrupted_picking_sessions() function';
    RAISE NOTICE '  5. v_corrupted_picking_sessions view';
    RAISE NOTICE '========================================';
END $$;

COMMIT;

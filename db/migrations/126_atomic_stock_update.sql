-- Migration 126: Atomic stock update RPC
-- Prevents race conditions in concurrent increment/decrement operations
-- The read-then-write pattern in products.ts can lose updates under concurrent requests
--
-- Safe to re-run: CREATE OR REPLACE is idempotent

BEGIN;

CREATE OR REPLACE FUNCTION atomic_stock_update(
    p_product_id UUID,
    p_store_id UUID,
    p_operation TEXT,
    p_amount INT
)
RETURNS TABLE(id UUID, stock INT) AS $$
BEGIN
    IF p_operation = 'increment' THEN
        RETURN QUERY
        UPDATE products
        SET stock = products.stock + p_amount,
            updated_at = NOW()
        WHERE products.id = p_product_id
          AND products.store_id = p_store_id
        RETURNING products.id, products.stock;
    ELSIF p_operation = 'decrement' THEN
        RETURN QUERY
        UPDATE products
        SET stock = GREATEST(0, products.stock - p_amount),
            updated_at = NOW()
        WHERE products.id = p_product_id
          AND products.store_id = p_store_id
        RETURNING products.id, products.stock;
    ELSE
        RAISE EXCEPTION 'Invalid operation: %. Must be increment or decrement', p_operation;
    END IF;

    -- If no rows returned, product not found
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Product not found: %', p_product_id;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions (consistent with other RPCs like adjust_inventory_atomic)
GRANT EXECUTE ON FUNCTION atomic_stock_update(UUID, UUID, TEXT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION atomic_stock_update(UUID, UUID, TEXT, INT) TO service_role;

COMMENT ON FUNCTION atomic_stock_update IS
    'Atomically increments or decrements product stock to prevent race conditions. '
    'Uses single UPDATE with implicit row locking. Decrement clamps to 0 minimum.';

COMMIT;

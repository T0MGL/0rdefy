-- Migration: Atomic inventory adjustment with row locking
-- Description: Creates an RPC function to adjust inventory atomically with FOR UPDATE
-- Author: Bright Idea
-- Date: 2026-01-11
--
-- FIXES:
-- 1. Prevents race conditions in concurrent inventory adjustments
-- 2. Uses row-level locking with SELECT FOR UPDATE
-- 3. Atomic stock update + movement logging in single transaction

-- Drop existing function if exists
DROP FUNCTION IF EXISTS adjust_inventory_atomic(UUID, UUID, INT, TEXT);

-- Create atomic inventory adjustment function
CREATE OR REPLACE FUNCTION adjust_inventory_atomic(
    p_store_id UUID,
    p_product_id UUID,
    p_quantity_change INT,
    p_notes TEXT DEFAULT 'Ajuste manual de inventario'
)
RETURNS JSON AS $$
DECLARE
    v_product RECORD;
    v_stock_before INT;
    v_stock_after INT;
    v_movement_id UUID;
    v_result JSON;
BEGIN
    -- Validate input
    IF p_quantity_change = 0 THEN
        RAISE EXCEPTION 'Quantity change cannot be zero';
    END IF;

    -- Lock the product row to prevent concurrent modifications
    SELECT id, name, stock INTO v_product
    FROM products
    WHERE id = p_product_id
      AND store_id = p_store_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Product not found or does not belong to store';
    END IF;

    v_stock_before := COALESCE(v_product.stock, 0);
    v_stock_after := GREATEST(0, v_stock_before + p_quantity_change);

    -- Warn if trying to go negative
    IF v_stock_before + p_quantity_change < 0 THEN
        RAISE WARNING 'Stock would go negative (% + % = %), clamping to 0',
            v_stock_before, p_quantity_change, v_stock_before + p_quantity_change;
    END IF;

    -- Update stock atomically
    UPDATE products
    SET stock = v_stock_after,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = p_product_id
      AND store_id = p_store_id;

    -- Log the movement in the same transaction
    INSERT INTO inventory_movements (
        store_id,
        product_id,
        quantity_change,
        stock_before,
        stock_after,
        movement_type,
        notes,
        created_at
    ) VALUES (
        p_store_id,
        p_product_id,
        p_quantity_change,
        v_stock_before,
        v_stock_after,
        'manual_adjustment',
        p_notes,
        CURRENT_TIMESTAMP
    )
    RETURNING id INTO v_movement_id;

    -- Return result
    SELECT json_build_object(
        'success', true,
        'product_id', p_product_id,
        'product_name', v_product.name,
        'stock_before', v_stock_before,
        'stock_after', v_stock_after,
        'quantity_change', p_quantity_change,
        'movement_id', v_movement_id,
        'clamped', (v_stock_before + p_quantity_change < 0)
    ) INTO v_result;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- Add comment
COMMENT ON FUNCTION adjust_inventory_atomic IS 'Atomically adjusts product inventory with row-level locking to prevent race conditions. Logs movement in same transaction.';

-- Grant execute permission
GRANT EXECUTE ON FUNCTION adjust_inventory_atomic TO authenticated;
GRANT EXECUTE ON FUNCTION adjust_inventory_atomic TO service_role;

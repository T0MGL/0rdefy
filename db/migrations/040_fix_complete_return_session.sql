-- Migration: Fix complete_return_session function
-- Description: Fixes column name mismatches between returns system and inventory_movements table
-- Author: Bright Idea
-- Date: 2025-01-07
--
-- BUGS FIXED:
-- 1. Changed 'quantity' to 'quantity_change' (correct column name)
-- 2. Added 'store_id' (required NOT NULL column)
-- 3. Added 'stock_before' and 'stock_after' (required columns)
-- 4. Changed 'reason' to 'notes' (correct column name)
-- 5. Changed 'status' to 'sleeves_status' in orders UPDATE

-- First, drop the existing function
DROP FUNCTION IF EXISTS complete_return_session(UUID);

-- Recreate the function with correct column names
CREATE OR REPLACE FUNCTION complete_return_session(p_session_id UUID)
RETURNS JSON AS $$
DECLARE
  v_session RECORD;
  v_item RECORD;
  v_order_id UUID;
  v_accepted_count INT := 0;
  v_rejected_count INT := 0;
  v_result JSON;
  v_stock_before INT;
  v_stock_after INT;
  v_store_id UUID;
BEGIN
  -- Get session details with row lock to prevent race conditions
  -- FOR UPDATE ensures no other transaction can modify this session until we commit
  SELECT * INTO v_session
  FROM return_sessions
  WHERE id = p_session_id AND status = 'in_progress'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Return session not found or already completed';
  END IF;

  -- Process each item
  FOR v_item IN
    SELECT * FROM return_session_items
    WHERE session_id = p_session_id
  LOOP
    -- Update product stock for accepted items
    IF v_item.quantity_accepted > 0 THEN
      -- Get current stock and store_id with row lock
      SELECT stock, store_id INTO v_stock_before, v_store_id
      FROM products
      WHERE id = v_item.product_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE WARNING 'Product % not found for return item, skipping', v_item.product_id;
        CONTINUE;
      END IF;

      v_stock_after := v_stock_before + v_item.quantity_accepted;

      UPDATE products
      SET stock = v_stock_after,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = v_item.product_id;

      -- Log inventory movement with correct column names
      INSERT INTO inventory_movements (
        store_id,
        product_id,
        order_id,
        movement_type,
        quantity_change,
        stock_before,
        stock_after,
        notes,
        created_at
      ) VALUES (
        v_store_id,
        v_item.product_id,
        v_item.order_id,
        'return_accepted',
        v_item.quantity_accepted,
        v_stock_before,
        v_stock_after,
        'Return session: ' || v_session.session_code,
        CURRENT_TIMESTAMP
      );

      v_accepted_count := v_accepted_count + v_item.quantity_accepted;
    END IF;

    -- Log rejected items (no stock update)
    IF v_item.quantity_rejected > 0 THEN
      -- Get store_id and current stock for logging
      SELECT stock, store_id INTO v_stock_before, v_store_id
      FROM products
      WHERE id = v_item.product_id;

      IF FOUND THEN
        INSERT INTO inventory_movements (
          store_id,
          product_id,
          order_id,
          movement_type,
          quantity_change,
          stock_before,
          stock_after,
          notes,
          created_at
        ) VALUES (
          v_store_id,
          v_item.product_id,
          v_item.order_id,
          'return_rejected',
          0,  -- No stock change for rejected items
          v_stock_before,
          v_stock_before,  -- stock_after = stock_before (no change)
          'Rejected - ' || COALESCE(v_item.rejection_reason, 'unknown') || ': ' || COALESCE(v_item.rejection_notes, ''),
          CURRENT_TIMESTAMP
        );
      END IF;

      v_rejected_count := v_rejected_count + v_item.quantity_rejected;
    END IF;

    -- Mark item as processed
    UPDATE return_session_items
    SET processed_at = CURRENT_TIMESTAMP
    WHERE id = v_item.id;
  END LOOP;

  -- Update order statuses to 'returned' (using sleeves_status, not status)
  FOR v_order_id IN
    SELECT DISTINCT order_id
    FROM return_session_items
    WHERE session_id = p_session_id
  LOOP
    UPDATE orders
    SET sleeves_status = 'returned',
        updated_at = CURRENT_TIMESTAMP
    WHERE id = v_order_id;

    -- Mark order as processed in session
    UPDATE return_session_orders
    SET processed = TRUE,
        processed_at = CURRENT_TIMESTAMP
    WHERE session_id = p_session_id AND order_id = v_order_id;
  END LOOP;

  -- Update session status
  UPDATE return_sessions
  SET status = 'completed',
      completed_at = CURRENT_TIMESTAMP,
      accepted_items = v_accepted_count,
      rejected_items = v_rejected_count,
      processed_orders = (
        SELECT COUNT(DISTINCT order_id)
        FROM return_session_items
        WHERE session_id = p_session_id
      )
  WHERE id = p_session_id;

  -- Return summary
  SELECT json_build_object(
    'session_id', p_session_id,
    'session_code', v_session.session_code,
    'orders_processed', (SELECT processed_orders FROM return_sessions WHERE id = p_session_id),
    'items_accepted', v_accepted_count,
    'items_rejected', v_rejected_count,
    'completed_at', CURRENT_TIMESTAMP
  ) INTO v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- Add comment
COMMENT ON FUNCTION complete_return_session IS 'Processes completed return session, updates inventory and order statuses. Fixed in migration 040 to use correct column names.';

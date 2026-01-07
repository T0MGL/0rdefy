-- Migration: Returns System
-- Description: Complete return/refund system with batch processing and inventory integration
-- Author: Bright Idea
-- Date: 2025-12-02

-- Add 'returned' status to order_status enum
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'order_status' AND e.enumlabel = 'returned'
  ) THEN
    ALTER TYPE order_status ADD VALUE 'returned';
  END IF;
END $$;

-- Create return_sessions table (similar to picking_sessions)
CREATE TABLE IF NOT EXISTS return_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  session_code VARCHAR(50) NOT NULL UNIQUE,
  status VARCHAR(20) DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'cancelled')),
  total_orders INT DEFAULT 0,
  processed_orders INT DEFAULT 0,
  total_items INT DEFAULT 0,
  accepted_items INT DEFAULT 0,
  rejected_items INT DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  created_by UUID REFERENCES users(id)
);

-- Create return_session_orders table (links orders to return sessions)
CREATE TABLE IF NOT EXISTS return_session_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES return_sessions(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  original_status order_status NOT NULL, -- Store original status before return
  processed BOOLEAN DEFAULT FALSE,
  processed_at TIMESTAMP,
  UNIQUE(session_id, order_id)
);

-- Create return_session_items table (individual items with accept/reject decision)
CREATE TABLE IF NOT EXISTS return_session_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES return_sessions(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity_expected INT NOT NULL, -- Original quantity from order
  quantity_received INT DEFAULT 0, -- Actual quantity received
  quantity_accepted INT DEFAULT 0, -- Quantity accepted (return to stock)
  quantity_rejected INT DEFAULT 0, -- Quantity rejected (damaged/defective)
  rejection_reason VARCHAR(50), -- damaged, defective, incomplete, wrong_item, other
  rejection_notes TEXT,
  unit_cost DECIMAL(10,2), -- Product cost at time of return
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMP
);

-- Function to generate return session codes (RET-DDMMYYYY-NN format)
CREATE OR REPLACE FUNCTION generate_return_session_code(p_store_id UUID)
RETURNS VARCHAR(50) AS $$
DECLARE
  v_date_part VARCHAR(8);
  v_sequence INT;
  v_code VARCHAR(50);
BEGIN
  -- Get date in DDMMYYYY format (Latin American standard)
  v_date_part := TO_CHAR(CURRENT_DATE, 'DDMMYYYY');

  -- Get next sequence number for today
  SELECT COALESCE(MAX(
    CAST(
      SUBSTRING(session_code FROM 'RET-[0-9]{8}-([0-9]+)') AS INT
    )
  ), 0) + 1
  INTO v_sequence
  FROM return_sessions
  WHERE store_id = p_store_id
    AND session_code LIKE 'RET-' || v_date_part || '-%';

  -- Generate code: RET-DDMMYYYY-NN (e.g., RET-02122025-01)
  v_code := 'RET-' || v_date_part || '-' || LPAD(v_sequence::TEXT, 2, '0');

  RETURN v_code;
END;
$$ LANGUAGE plpgsql;

-- Function to process return session (update inventory and order statuses)
CREATE OR REPLACE FUNCTION complete_return_session(p_session_id UUID)
RETURNS JSON AS $$
DECLARE
  v_session RECORD;
  v_item RECORD;
  v_order_id UUID;
  v_accepted_count INT := 0;
  v_rejected_count INT := 0;
  v_result JSON;
BEGIN
  -- Get session details
  SELECT * INTO v_session
  FROM return_sessions
  WHERE id = p_session_id AND status = 'in_progress';

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
      DECLARE
        v_stock_before INT;
        v_stock_after INT;
        v_store_id UUID;
      BEGIN
        -- Get current stock and store_id
        SELECT stock, store_id INTO v_stock_before, v_store_id
        FROM products
        WHERE id = v_item.product_id
        FOR UPDATE;

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
      END;

      v_accepted_count := v_accepted_count + v_item.quantity_accepted;
    END IF;

    -- Log rejected items (no stock update)
    IF v_item.quantity_rejected > 0 THEN
      DECLARE
        v_current_stock INT;
        v_store_id UUID;
      BEGIN
        -- Get store_id and current stock for logging
        SELECT stock, store_id INTO v_current_stock, v_store_id
        FROM products
        WHERE id = v_item.product_id;

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
          v_current_stock,
          v_current_stock,
          'Rejected - ' || COALESCE(v_item.rejection_reason, 'unknown') || ': ' || COALESCE(v_item.rejection_notes, ''),
          CURRENT_TIMESTAMP
        );
      END;

      v_rejected_count := v_rejected_count + v_item.quantity_rejected;
    END IF;

    -- Mark item as processed
    UPDATE return_session_items
    SET processed_at = CURRENT_TIMESTAMP
    WHERE id = v_item.id;
  END LOOP;

  -- Update order statuses to 'returned'
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

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_return_sessions_store_status
  ON return_sessions(store_id, status);
CREATE INDEX IF NOT EXISTS idx_return_session_orders_session
  ON return_session_orders(session_id);
CREATE INDEX IF NOT EXISTS idx_return_session_items_session
  ON return_session_items(session_id);
CREATE INDEX IF NOT EXISTS idx_return_session_items_product
  ON return_session_items(product_id);

-- Add comments
COMMENT ON TABLE return_sessions IS 'Batch return processing sessions';
COMMENT ON TABLE return_session_orders IS 'Orders included in return sessions';
COMMENT ON TABLE return_session_items IS 'Individual items with accept/reject decisions';
COMMENT ON FUNCTION generate_return_session_code IS 'Generates unique return session codes in RET-DDMMYYYY-NN format';
COMMENT ON FUNCTION complete_return_session IS 'Processes completed return session, updates inventory and order statuses';

-- Grant permissions (adjust as needed)
GRANT SELECT, INSERT, UPDATE ON return_sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON return_session_orders TO authenticated;
GRANT SELECT, INSERT, UPDATE ON return_session_items TO authenticated;

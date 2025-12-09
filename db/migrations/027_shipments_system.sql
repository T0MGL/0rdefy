-- Migration 027: Shipments System
-- Adds tracking for when orders are dispatched to couriers/deliveries
-- Enables transition from ready_to_ship → shipped status

-- ============================================================================
-- SHIPMENTS TABLE
-- ============================================================================
-- Tracks when orders are handed over to couriers for delivery
-- Supports multiple shipment attempts (returns, re-shipments, etc.)
CREATE TABLE IF NOT EXISTS shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  courier_id UUID REFERENCES carriers(id) ON DELETE SET NULL,

  -- Tracking info
  shipped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  shipped_by UUID REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Constraints
  CONSTRAINT shipments_store_check CHECK (store_id IS NOT NULL),
  CONSTRAINT shipments_order_check CHECK (order_id IS NOT NULL)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_shipments_store_id ON shipments(store_id);
CREATE INDEX IF NOT EXISTS idx_shipments_order_id ON shipments(order_id);
CREATE INDEX IF NOT EXISTS idx_shipments_courier_id ON shipments(courier_id);
CREATE INDEX IF NOT EXISTS idx_shipments_shipped_at ON shipments(shipped_at DESC);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_shipments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_shipments_updated_at
  BEFORE UPDATE ON shipments
  FOR EACH ROW
  EXECUTE FUNCTION update_shipments_updated_at();

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to create a shipment and update order status to 'shipped'
CREATE OR REPLACE FUNCTION create_shipment(
  p_store_id UUID,
  p_order_id UUID,
  p_shipped_by UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS shipments AS $$
DECLARE
  v_order_status TEXT;
  v_courier_id UUID;
  v_shipment shipments;
BEGIN
  -- Get order status and courier
  SELECT sleeves_status, courier_id
  INTO v_order_status, v_courier_id
  FROM orders
  WHERE id = p_order_id AND store_id = p_store_id;

  -- Validate order exists
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found or does not belong to this store';
  END IF;

  -- Validate order is ready to ship
  IF v_order_status != 'ready_to_ship' THEN
    RAISE EXCEPTION 'Order must be in ready_to_ship status. Current status: %', v_order_status;
  END IF;

  -- Create shipment record
  INSERT INTO shipments (
    store_id,
    order_id,
    courier_id,
    shipped_by,
    notes
  ) VALUES (
    p_store_id,
    p_order_id,
    v_courier_id,
    p_shipped_by,
    p_notes
  )
  RETURNING * INTO v_shipment;

  -- Update order status to shipped
  UPDATE orders
  SET sleeves_status = 'shipped'
  WHERE id = p_order_id;

  RETURN v_shipment;
END;
$$ LANGUAGE plpgsql;

-- Function to create multiple shipments at once (batch dispatch)
CREATE OR REPLACE FUNCTION create_shipments_batch(
  p_store_id UUID,
  p_order_ids UUID[],
  p_shipped_by UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS TABLE (
  shipment_id UUID,
  order_id UUID,
  order_number TEXT,
  success BOOLEAN,
  error_message TEXT
) AS $$
DECLARE
  v_order_id UUID;
  v_shipment shipments;
BEGIN
  -- Process each order
  FOREACH v_order_id IN ARRAY p_order_ids
  LOOP
    BEGIN
      -- Create shipment for this order
      v_shipment := create_shipment(
        p_store_id,
        v_order_id,
        p_shipped_by,
        p_notes
      );

      -- Return success
      RETURN QUERY
      SELECT
        v_shipment.id,
        v_order_id,
        COALESCE(o.shopify_order_number, 'ORD-' || SUBSTRING(o.id::TEXT, 1, 8)),
        TRUE,
        NULL::TEXT
      FROM orders o
      WHERE o.id = v_order_id;

    EXCEPTION WHEN OTHERS THEN
      -- Return error for this order
      RETURN QUERY
      SELECT
        NULL::UUID,
        v_order_id,
        COALESCE(o.shopify_order_number, 'ORD-' || SUBSTRING(o.id::TEXT, 1, 8)),
        FALSE,
        SQLERRM
      FROM orders o
      WHERE o.id = v_order_id;
    END;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- COMMENTS
-- ============================================================================
COMMENT ON TABLE shipments IS 'Tracks when orders are dispatched to couriers for delivery';
COMMENT ON COLUMN shipments.shipped_at IS 'When the order was handed to the courier';
COMMENT ON COLUMN shipments.shipped_by IS 'User who processed the shipment';
COMMENT ON COLUMN shipments.notes IS 'Optional notes (e.g., courier name, vehicle info)';

COMMENT ON FUNCTION create_shipment IS 'Creates a shipment record and updates order to shipped status';
COMMENT ON FUNCTION create_shipments_batch IS 'Batch creates shipments for multiple orders with error handling';

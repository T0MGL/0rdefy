-- ============================================================================
-- Migration 041: Fix create_shipments_batch function
-- Description: Fixes the "structure of query does not match function result type" error
-- Author: Bright Idea
-- Date: 2026-01-07
-- ============================================================================

-- Drop existing function
DROP FUNCTION IF EXISTS create_shipments_batch(UUID, UUID[], UUID, TEXT);

-- Recreate function with fixed return structure
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
  v_order_number TEXT;
BEGIN
  -- Process each order
  FOREACH v_order_id IN ARRAY p_order_ids
  LOOP
    BEGIN
      -- Get order number first (before creating shipment)
      SELECT COALESCE(o.shopify_order_number, 'ORD-' || SUBSTRING(o.id::TEXT, 1, 8))
      INTO v_order_number
      FROM orders o
      WHERE o.id = v_order_id AND o.store_id = p_store_id;

      -- If order not found, set a default order number
      IF v_order_number IS NULL THEN
        v_order_number := 'ORD-' || SUBSTRING(v_order_id::TEXT, 1, 8);
      END IF;

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
        v_order_number,
        TRUE,
        NULL::TEXT;

    EXCEPTION WHEN OTHERS THEN
      -- Return error for this order
      RETURN QUERY
      SELECT
        NULL::UUID,
        v_order_id,
        v_order_number,
        FALSE,
        SQLERRM;
    END;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION create_shipments_batch IS 'Batch creates shipments for multiple orders with error handling';

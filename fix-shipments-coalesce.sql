-- Fix for COALESCE type mismatch in create_shipments_batch function
-- The issue: shopify_order_number is INTEGER but we're using it with TEXT

-- Drop and recreate the function with proper type casting
DROP FUNCTION IF EXISTS create_shipments_batch(UUID, UUID[], UUID, TEXT);

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

      -- Return success with proper type casting
      RETURN QUERY
      SELECT
        v_shipment.id,
        v_order_id,
        COALESCE(o.shopify_order_number::TEXT, 'ORD-' || SUBSTRING(o.id::TEXT, 1, 8)),
        TRUE,
        NULL::TEXT
      FROM orders o
      WHERE o.id = v_order_id;

    EXCEPTION WHEN OTHERS THEN
      -- Return error for this order with proper type casting
      RETURN QUERY
      SELECT
        NULL::UUID,
        v_order_id,
        COALESCE(o.shopify_order_number::TEXT, 'ORD-' || SUBSTRING(o.id::TEXT, 1, 8)),
        FALSE,
        SQLERRM
      FROM orders o
      WHERE o.id = v_order_id;
    END;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION create_shipments_batch IS 'Batch creates shipments for multiple orders with error handling (FIXED: type casting for shopify_order_number)';

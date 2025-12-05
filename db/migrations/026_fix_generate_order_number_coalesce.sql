-- ================================================================
-- FIX: generate_order_number COALESCE Type Mismatch (CRITICAL)
-- ================================================================
-- Problem: COALESCE(NEW.shopify_order_number, 'ORD-...') mixes INT and TEXT
--   "COALESCE types integer and text cannot be matched"
-- Solution: Cast shopify_order_number to TEXT before COALESCE
-- Date: 2025-12-04
-- ================================================================

CREATE OR REPLACE FUNCTION generate_order_number()
RETURNS TRIGGER AS $$
BEGIN
  -- If order_number is not set, generate one
  IF NEW.order_number IS NULL THEN
    NEW.order_number := COALESCE(
      NEW.shopify_order_number::TEXT, -- FIXED: Cast INT to TEXT
      'ORD-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || SUBSTRING(NEW.id::text, 1, 6)
    );
  END IF;

  -- If customer_name is not set, generate from customer info
  IF NEW.customer_name IS NULL THEN
    NEW.customer_name := COALESCE(
      NULLIF(TRIM(NEW.customer_first_name || ' ' || NEW.customer_last_name), ''),
      NEW.customer_email,
      'Unknown Customer'
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- MIGRATION COMPLETE
-- ================================================================

COMMENT ON FUNCTION generate_order_number IS 'Ordefy: Auto-generate order_number and customer_name (FIXED: COALESCE type mismatch)';

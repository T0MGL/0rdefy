-- ================================================================
-- FIX: COD Amount Type Mismatch (CRITICAL)
-- ================================================================
-- Problem: COALESCE(NEW.total_price, 0) causes PostgreSQL error:
--   "COALESCE types integer and text cannot be matched"
-- Solution: Use 0.0 (DECIMAL) instead of 0 (INTEGER)
-- Date: 2025-12-04
-- ================================================================

CREATE OR REPLACE FUNCTION calculate_cod_amount()
RETURNS TRIGGER AS $$
BEGIN
  -- Si el método de pago es efectivo/cash, el COD amount es igual al total_price
  IF NEW.payment_method IN ('cash', 'efectivo') THEN
    NEW.cod_amount = COALESCE(NEW.total_price, 0.0);
  ELSE
    -- Si no es efectivo, el COD amount es 0
    NEW.cod_amount = 0.0;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function already has trigger, no need to recreate
-- Just updating the function will fix the issue for new inserts

-- ================================================================
-- MIGRATION COMPLETE
-- ================================================================

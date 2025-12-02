-- ================================================================
-- Fix: COD Amount Calculation Type Mismatch
-- ================================================================
-- Problem: COALESCE(NEW.total_price, 0) causes type mismatch error
-- Solution: Cast 0 to DECIMAL to match total_price type
-- Date: 2025-01-02
-- ================================================================

CREATE OR REPLACE FUNCTION calculate_cod_amount()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.payment_method IN ('cash', 'efectivo') THEN
        -- Cast 0 to DECIMAL to match total_price type
        NEW.cod_amount = COALESCE(NEW.total_price, 0.0);
    ELSE
        -- Cast 0 to DECIMAL to match cod_amount type
        NEW.cod_amount = 0.0;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recreate trigger (in case it doesn't exist)
DROP TRIGGER IF EXISTS trg_calculate_cod_amount ON orders;
CREATE TRIGGER trg_calculate_cod_amount
BEFORE INSERT OR UPDATE ON orders
FOR EACH ROW
EXECUTE FUNCTION calculate_cod_amount();

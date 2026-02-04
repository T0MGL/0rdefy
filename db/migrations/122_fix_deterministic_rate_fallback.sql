-- ============================================================
-- Migration 122: Fix non-deterministic rate fallback in reconciliation RPC
--
-- Date: 2026-02-04
--
-- PROBLEM: In process_delivery_reconciliation(), the Priority 3 fallback
-- (when no city coverage or zone match) uses LIMIT 1 without ORDER BY.
-- PostgreSQL returns an arbitrary row, so carriers with multiple zones
-- (e.g., Asuncion=25000, Interior=45000) get unpredictable rates.
--
-- FIX: Add deterministic ORDER BY with priority:
--   1. Zone named 'default' or 'otros' (common fallback names)
--   2. Zone named 'interior' or 'general' (secondary fallbacks)
--   3. Lowest rate (most conservative for the store)
-- ============================================================

-- Update the Priority 3 fallback inside process_delivery_reconciliation()
-- We need to replace the entire function to update the inner query.
-- This is safe because CREATE OR REPLACE preserves existing grants.

CREATE OR REPLACE FUNCTION process_delivery_reconciliation(
  p_store_id UUID,
  p_user_id UUID,
  p_carrier_id UUID,
  p_delivery_date DATE,
  p_total_amount_collected NUMERIC,
  p_discrepancy_notes TEXT DEFAULT NULL,
  p_orders JSONB DEFAULT '[]'::JSONB
)
RETURNS TABLE (
  settlement_id UUID,
  settlement_code TEXT,
  total_orders INT,
  total_delivered INT,
  total_not_delivered INT,
  total_cod_expected NUMERIC,
  total_cod_collected NUMERIC,
  total_carrier_fees NUMERIC,
  failed_attempt_fee NUMERIC,
  net_receivable NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_settlement_id UUID;
  v_settlement_code TEXT;
  v_total_orders INT := 0;
  v_total_delivered INT := 0;
  v_total_not_delivered INT := 0;
  v_total_cod_expected NUMERIC := 0;
  v_total_cod_collected NUMERIC := p_total_amount_collected;
  v_total_carrier_fees NUMERIC := 0;
  v_failed_attempt_fee NUMERIC := 0;
  v_net_receivable NUMERIC := 0;
  v_failed_fee_percent NUMERIC;
  v_carrier_name TEXT;
  v_order JSONB;
  v_order_record RECORD;
  v_zone_rate NUMERIC;
  v_is_cod BOOLEAN;
  v_date_str TEXT;
  v_next_number INT;
  v_has_coverage_table BOOLEAN := FALSE;
BEGIN
  -- Validate carrier exists and get info
  SELECT name, COALESCE(failed_attempt_fee_percent, 50)
  INTO v_carrier_name, v_failed_fee_percent
  FROM carriers
  WHERE id = p_carrier_id AND store_id = p_store_id;

  IF v_carrier_name IS NULL THEN
    RAISE EXCEPTION 'Carrier not found';
  END IF;

  -- Check if carrier_coverage table exists
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'carrier_coverage'
  ) INTO v_has_coverage_table;

  -- Process each order
  FOR v_order IN SELECT * FROM jsonb_array_elements(p_orders)
  LOOP
    v_total_orders := v_total_orders + 1;

    -- Get order details
    SELECT o.* INTO v_order_record
    FROM orders o
    WHERE o.id = (v_order->>'order_id')::UUID
      AND o.store_id = p_store_id;

    IF v_order_record IS NULL THEN
      RAISE EXCEPTION 'Order % not found', v_order->>'order_id';
    END IF;

    -- Rate lookup cascade (matches frontend logic exactly)
    v_zone_rate := NULL;

    -- Priority 1: City-based coverage (carrier_coverage table)
    IF v_has_coverage_table
       AND v_order_record.shipping_city IS NOT NULL
       AND TRIM(v_order_record.shipping_city) != '' THEN
      SELECT rate INTO v_zone_rate
      FROM carrier_coverage
      WHERE carrier_id = p_carrier_id
        AND LOWER(TRIM(city)) = LOWER(TRIM(v_order_record.shipping_city))
        AND is_active = TRUE
      LIMIT 1;
    END IF;

    -- Also try with shipping_city_normalized if available
    IF v_zone_rate IS NULL AND v_has_coverage_table
       AND v_order_record.shipping_city_normalized IS NOT NULL
       AND TRIM(v_order_record.shipping_city_normalized) != '' THEN
      SELECT rate INTO v_zone_rate
      FROM carrier_coverage
      WHERE carrier_id = p_carrier_id
        AND normalize_location_text(city) = v_order_record.shipping_city_normalized
        AND is_active = TRUE
      LIMIT 1;
    END IF;

    -- Priority 2: Zone-based rate (carrier_zones table)
    IF v_zone_rate IS NULL AND v_order_record.delivery_zone IS NOT NULL THEN
      SELECT rate INTO v_zone_rate
      FROM carrier_zones
      WHERE carrier_id = p_carrier_id AND store_id = p_store_id
        AND LOWER(TRIM(zone_name)) = LOWER(TRIM(COALESCE(v_order_record.delivery_zone, '')))
      LIMIT 1;
    END IF;

    -- Priority 3: Deterministic fallback - prefer named defaults, then lowest rate
    IF v_zone_rate IS NULL THEN
      SELECT COALESCE(rate, 0) INTO v_zone_rate
      FROM carrier_zones
      WHERE carrier_id = p_carrier_id AND store_id = p_store_id
      ORDER BY
        CASE LOWER(TRIM(zone_name))
          WHEN 'default' THEN 1
          WHEN 'otros' THEN 2
          WHEN 'interior' THEN 3
          WHEN 'general' THEN 4
          ELSE 5
        END,
        rate ASC NULLS LAST
      LIMIT 1;
    END IF;

    v_zone_rate := COALESCE(v_zone_rate, 0);

    -- COD detection using centralized helper (Migration 115)
    v_is_cod := is_order_cod(v_order_record.payment_method, v_order_record.prepaid_method);

    IF (v_order->>'delivered')::BOOLEAN THEN
      v_total_delivered := v_total_delivered + 1;
      v_total_carrier_fees := v_total_carrier_fees + v_zone_rate;

      IF v_is_cod THEN
        v_total_cod_expected := v_total_cod_expected + COALESCE(v_order_record.total_price, 0);
      END IF;
    ELSE
      v_total_not_delivered := v_total_not_delivered + 1;
      v_failed_attempt_fee := v_failed_attempt_fee + (v_zone_rate * v_failed_fee_percent / 100);
    END IF;
  END LOOP;

  -- Calculate net receivable
  v_net_receivable := v_total_cod_collected - v_total_carrier_fees - v_failed_attempt_fee;

  -- Generate settlement code atomically
  v_date_str := TO_CHAR(p_delivery_date, 'DDMMYYYY');

  -- Get next number for today
  SELECT COALESCE(MAX(
    CASE
      WHEN ds.settlement_code LIKE 'LIQ-' || v_date_str || '-%'
      THEN NULLIF(SPLIT_PART(ds.settlement_code, '-', 3), '')::INT
      ELSE 0
    END
  ), 0) + 1
  INTO v_next_number
  FROM daily_settlements ds
  WHERE ds.store_id = p_store_id
    AND ds.settlement_code LIKE 'LIQ-' || v_date_str || '-%';

  v_settlement_code := 'LIQ-' || v_date_str || '-' || LPAD(v_next_number::TEXT, 3, '0');

  -- Create settlement record
  INSERT INTO daily_settlements (
    store_id, carrier_id, settlement_code, settlement_date,
    total_dispatched, total_delivered, total_not_delivered,
    total_cod_collected, total_carrier_fees, failed_attempt_fee,
    net_receivable, balance_due, status, notes, created_by
  )
  VALUES (
    p_store_id, p_carrier_id, v_settlement_code, p_delivery_date,
    v_total_orders, v_total_delivered, v_total_not_delivered,
    v_total_cod_collected, v_total_carrier_fees, v_failed_attempt_fee,
    v_net_receivable, v_net_receivable, 'pending', p_discrepancy_notes, p_user_id
  )
  RETURNING id INTO v_settlement_id;

  -- Return results
  RETURN QUERY SELECT
    v_settlement_id,
    v_settlement_code,
    v_total_orders,
    v_total_delivered,
    v_total_not_delivered,
    v_total_cod_expected,
    v_total_cod_collected,
    v_total_carrier_fees,
    v_failed_attempt_fee,
    v_net_receivable;
END;
$$;

-- Add comment for documentation
COMMENT ON FUNCTION process_delivery_reconciliation IS
  'Delivery-based reconciliation with deterministic rate fallback (Migration 122). '
  'Rate priority: city coverage > zone match > named fallback zones > lowest rate.';

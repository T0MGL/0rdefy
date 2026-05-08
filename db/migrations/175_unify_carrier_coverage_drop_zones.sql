-- Migration 175: 174_unify_carrier_coverage_drop_zones
-- Reconstructed from production DB on 2026-05-08
-- Original applied: 2026-05-08 06:00:37 UTC (version 20260508060037)
-- Part of Sprint B: carrier_zones -> carrier_coverage unification
--
-- NOTE on numbering: this migration was originally applied as 174 in
-- production but the local 174 slot is now occupied by the parallel
-- courier_operators feature. Renumbered to 175 here so a fresh setup
-- from the repo reproduces the production state. SQL is byte-identical
-- to what was applied.

-- 1. Drop dependent views first
DROP VIEW IF EXISTS v_carrier_zone_coverage_gaps;
DROP VIEW IF EXISTS v_carrier_health;
DROP VIEW IF EXISTS v_carrier_fee_settings;

-- 2a. validate_carrier_has_coverage (canonical)
CREATE OR REPLACE FUNCTION validate_carrier_has_coverage(p_carrier_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM carrier_coverage
  WHERE carrier_id = p_carrier_id
    AND is_active = TRUE
    AND rate IS NOT NULL
    AND rate > 0;
  RETURN v_count > 0;
END;
$$;

CREATE OR REPLACE FUNCTION validate_carrier_has_zones(p_carrier_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN validate_carrier_has_coverage(p_carrier_id);
END;
$$;

-- 2b. validate_dispatch_carrier_zones
CREATE OR REPLACE FUNCTION validate_dispatch_carrier_zones(p_carrier_id UUID)
RETURNS TABLE (
  is_valid BOOLEAN,
  zone_count INTEGER,
  has_default_zone BOOLEAN,
  zones_list TEXT,
  warning_message TEXT
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_count INTEGER;
  v_cities TEXT;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE rate IS NOT NULL AND rate > 0),
    STRING_AGG(city || ' (' || COALESCE(rate, 0)::TEXT || ')', ', ' ORDER BY city)
  INTO v_count, v_cities
  FROM carrier_coverage
  WHERE carrier_id = p_carrier_id
    AND is_active = TRUE;

  v_count := COALESCE(v_count, 0);

  IF v_count = 0 THEN
    RETURN QUERY SELECT
      FALSE,
      0,
      FALSE,
      NULL::TEXT,
      'Carrier has no priced city coverage configured. Configure at least one city with a rate before dispatching.'::TEXT;
  ELSE
    RETURN QUERY SELECT
      TRUE,
      v_count,
      TRUE,
      v_cities,
      NULL::TEXT;
  END IF;
END;
$$;

-- 2c. get_carrier_fee_for_zone (city-based)
CREATE OR REPLACE FUNCTION get_carrier_fee_for_zone(
  p_carrier_id UUID,
  p_zone_name TEXT
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_rate DECIMAL(12,2);
BEGIN
  IF p_zone_name IS NULL OR TRIM(p_zone_name) = '' THEN
    RETURN NULL;
  END IF;

  SELECT rate INTO v_rate
  FROM carrier_coverage
  WHERE carrier_id = p_carrier_id
    AND is_active = TRUE
    AND rate IS NOT NULL
    AND (
      LOWER(TRIM(city)) = LOWER(TRIM(p_zone_name))
      OR LOWER(TRIM(TRANSLATE(city, 'áéíóúñÁÉÍÓÚÑ', 'aeiounAEIOUN'))) =
         LOWER(TRIM(TRANSLATE(p_zone_name, 'áéíóúñÁÉÍÓÚÑ', 'aeiounAEIOUN')))
    )
  LIMIT 1;

  RETURN v_rate;
END;
$$;

-- 2d. get_carrier_fee_for_order
CREATE OR REPLACE FUNCTION get_carrier_fee_for_order(
  p_carrier_id UUID,
  p_zone_name TEXT,
  p_city TEXT DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_rate DECIMAL(12,2);
  v_search_term TEXT;
BEGIN
  v_search_term := COALESCE(NULLIF(TRIM(p_city), ''), TRIM(p_zone_name));

  IF v_search_term IS NULL OR v_search_term = '' THEN
    RETURN 0;
  END IF;

  SELECT rate INTO v_rate
  FROM carrier_coverage
  WHERE carrier_id = p_carrier_id
    AND is_active = TRUE
    AND rate IS NOT NULL
    AND (
      LOWER(TRIM(city)) = LOWER(v_search_term)
      OR LOWER(TRIM(TRANSLATE(city, 'áéíóúñÁÉÍÓÚÑ', 'aeiounAEIOUN'))) =
         LOWER(TRIM(TRANSLATE(v_search_term, 'áéíóúñÁÉÍÓÚÑ', 'aeiounAEIOUN')))
    )
  LIMIT 1;

  IF v_rate IS NOT NULL THEN
    RETURN v_rate;
  END IF;

  IF p_city IS NOT NULL AND TRIM(p_city) != '' AND p_zone_name IS NOT NULL AND TRIM(p_zone_name) != '' THEN
    SELECT rate INTO v_rate
    FROM carrier_coverage
    WHERE carrier_id = p_carrier_id
      AND is_active = TRUE
      AND rate IS NOT NULL
      AND (
        LOWER(TRIM(city)) = LOWER(TRIM(p_zone_name))
        OR LOWER(TRIM(TRANSLATE(city, 'áéíóúñÁÉÍÓÚÑ', 'aeiounAEIOUN'))) =
           LOWER(TRIM(TRANSLATE(p_zone_name, 'áéíóúñÁÉÍÓÚÑ', 'aeiounAEIOUN')))
      )
    LIMIT 1;

    IF v_rate IS NOT NULL THEN
      RETURN v_rate;
    END IF;
  END IF;

  RETURN 0;
END;
$$;

-- 2e. calculate_shipping_cost
CREATE OR REPLACE FUNCTION calculate_shipping_cost(
  p_carrier_id UUID,
  p_city TEXT,
  p_zone TEXT DEFAULT NULL
)
RETURNS TABLE (
  shipping_cost NUMERIC,
  zone_matched VARCHAR(100),
  match_type TEXT,
  carrier_has_zones BOOLEAN
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_rate DECIMAL(12,2);
  v_city VARCHAR(100);
  v_match_type TEXT;
  v_has_coverage BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM carrier_coverage
    WHERE carrier_id = p_carrier_id
      AND is_active = TRUE
      AND rate IS NOT NULL
      AND rate > 0
  ) INTO v_has_coverage;

  IF NOT v_has_coverage THEN
    RETURN QUERY SELECT
      NULL::DECIMAL(12,2),
      NULL::VARCHAR(100),
      'no_coverage_configured'::TEXT,
      FALSE;
    RETURN;
  END IF;

  IF p_city IS NOT NULL AND p_city != '' THEN
    SELECT rate, city INTO v_rate, v_city
    FROM carrier_coverage
    WHERE carrier_id = p_carrier_id
      AND is_active = TRUE
      AND rate IS NOT NULL
      AND (
        LOWER(TRIM(city)) = LOWER(TRIM(p_city))
        OR LOWER(TRIM(TRANSLATE(city, 'áéíóúñÁÉÍÓÚÑ', 'aeiounAEIOUN'))) =
           LOWER(TRIM(TRANSLATE(p_city, 'áéíóúñÁÉÍÓÚÑ', 'aeiounAEIOUN')))
      )
    LIMIT 1;

    IF FOUND THEN
      v_match_type := 'city_exact';
    END IF;
  END IF;

  IF v_rate IS NULL AND p_zone IS NOT NULL AND p_zone != '' THEN
    SELECT rate, city INTO v_rate, v_city
    FROM carrier_coverage
    WHERE carrier_id = p_carrier_id
      AND is_active = TRUE
      AND rate IS NOT NULL
      AND (
        LOWER(TRIM(city)) = LOWER(TRIM(p_zone))
        OR LOWER(TRIM(TRANSLATE(city, 'áéíóúñÁÉÍÓÚÑ', 'aeiounAEIOUN'))) =
           LOWER(TRIM(TRANSLATE(p_zone, 'áéíóúñÁÉÍÓÚÑ', 'aeiounAEIOUN')))
      )
    LIMIT 1;

    IF FOUND THEN
      v_match_type := 'zone_exact';
    END IF;
  END IF;

  IF v_rate IS NULL AND p_city IS NOT NULL AND p_city != '' THEN
    SELECT rate, city INTO v_rate, v_city
    FROM carrier_coverage
    WHERE carrier_id = p_carrier_id
      AND is_active = TRUE
      AND rate IS NOT NULL
      AND (
        LOWER(TRIM(city)) LIKE '%' || LOWER(TRIM(p_city)) || '%'
        OR LOWER(TRIM(p_city)) LIKE '%' || LOWER(TRIM(city)) || '%'
      )
    ORDER BY LENGTH(city) ASC
    LIMIT 1;

    IF FOUND THEN
      v_match_type := 'city_partial';
    END IF;
  END IF;

  IF v_rate IS NULL THEN
    v_match_type := 'no_match';
  END IF;

  RETURN QUERY SELECT v_rate, v_city, v_match_type, TRUE;
END;
$$;

-- 2f. suggest_carrier_for_order
CREATE OR REPLACE FUNCTION suggest_carrier_for_order(
  p_store_id UUID,
  p_city TEXT,
  p_zone TEXT DEFAULT NULL
)
RETURNS TABLE (
  carrier_id UUID,
  carrier_name VARCHAR(100),
  zone_matched VARCHAR(100),
  shipping_cost NUMERIC,
  delivery_rate NUMERIC,
  pending_orders BIGINT,
  recommendation_score INTEGER
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id AS carrier_id,
    c.name AS carrier_name,
    cc.city AS zone_matched,
    cc.rate AS shipping_cost,
    c.delivery_rate,
    COALESCE(active_orders.cnt, 0) AS pending_orders,
    (
      CASE
        WHEN LOWER(TRIM(cc.city)) = LOWER(TRIM(p_city)) THEN 100
        WHEN LOWER(TRIM(TRANSLATE(cc.city, 'áéíóúñÁÉÍÓÚÑ', 'aeiounAEIOUN'))) =
             LOWER(TRIM(TRANSLATE(p_city, 'áéíóúñÁÉÍÓÚÑ', 'aeiounAEIOUN'))) THEN 95
        WHEN LOWER(TRIM(cc.city)) = LOWER(TRIM(COALESCE(p_zone, ''))) THEN 90
        WHEN LOWER(cc.city) LIKE '%' || LOWER(TRIM(p_city)) || '%' THEN 70
        ELSE 0
      END
      + LEAST(COALESCE(c.delivery_rate, 0)::INTEGER, 30)
      - LEAST((COALESCE(active_orders.cnt, 0) / 10)::INTEGER, 20)
    )::INTEGER AS recommendation_score
  FROM carriers c
  JOIN carrier_coverage cc ON c.id = cc.carrier_id
    AND cc.is_active = TRUE
    AND cc.rate IS NOT NULL
    AND cc.rate > 0
  LEFT JOIN (
    SELECT courier_id, COUNT(*) AS cnt
    FROM orders
    WHERE sleeves_status IN ('confirmed', 'in_preparation', 'ready_to_ship', 'shipped')
    GROUP BY courier_id
  ) active_orders ON c.id = active_orders.courier_id
  WHERE c.store_id = p_store_id
    AND c.is_active = TRUE
    AND (
      LOWER(TRIM(cc.city)) = LOWER(TRIM(p_city))
      OR LOWER(TRIM(TRANSLATE(cc.city, 'áéíóúñÁÉÍÓÚÑ', 'aeiounAEIOUN'))) =
         LOWER(TRIM(TRANSLATE(p_city, 'áéíóúñÁÉÍÓÚÑ', 'aeiounAEIOUN')))
      OR LOWER(TRIM(cc.city)) = LOWER(TRIM(COALESCE(p_zone, '')))
      OR LOWER(cc.city) LIKE '%' || LOWER(TRIM(p_city)) || '%'
    )
  ORDER BY recommendation_score DESC, cc.rate ASC, c.delivery_rate DESC
  LIMIT 5;
END;
$$;

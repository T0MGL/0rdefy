-- ============================================================
-- Migration 121: Fix get_carrier_fee_for_order lookup
--
-- HOTFIX - Run directly in Supabase SQL Editor
-- Date: 2026-01-30
--
-- PROBLEM: get_carrier_fee_for_order() fails to find rates when:
-- 1. p_city is NULL but p_zone_name has a value like "ASUNCION"
-- 2. The comparison LOWER(TRIM(COALESCE(p_city, ''))) = '' never matches
--
-- FIX: Also search carrier_coverage by zone_name when city is NULL
--      AND normalize accent comparisons for better matching
-- ============================================================

CREATE OR REPLACE FUNCTION get_carrier_fee_for_order(
    p_carrier_id UUID,
    p_zone_name TEXT,
    p_city TEXT DEFAULT NULL
)
RETURNS DECIMAL(12,2)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_rate DECIMAL(12,2);
    v_fallback_zones TEXT[] := ARRAY['default', 'otros', 'interior', 'general'];
    v_zone TEXT;
    v_search_term TEXT;
BEGIN
    -- Determine what to search for
    -- Priority: p_city if provided, otherwise p_zone_name
    v_search_term := COALESCE(NULLIF(TRIM(p_city), ''), TRIM(p_zone_name));

    IF v_search_term IS NULL OR v_search_term = '' THEN
        RETURN 0;
    END IF;

    -- ============================================================
    -- STEP 1: Try carrier_coverage (city-based, from migration 090)
    -- ============================================================
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'carrier_coverage') THEN
        -- First try exact match on city
        SELECT rate INTO v_rate
        FROM carrier_coverage
        WHERE carrier_id = p_carrier_id
          AND is_active = TRUE
          AND rate IS NOT NULL
          AND (
              -- Exact match (case-insensitive)
              LOWER(TRIM(city)) = LOWER(v_search_term)
              -- Or match without accents (common case: Asunción vs ASUNCION)
              OR LOWER(TRIM(TRANSLATE(city, 'áéíóúñÁÉÍÓÚÑ', 'aeiounAEIOUN'))) =
                 LOWER(TRIM(TRANSLATE(v_search_term, 'áéíóúñÁÉÍÓÚÑ', 'aeiounAEIOUN')))
          )
        LIMIT 1;

        IF v_rate IS NOT NULL THEN
            RETURN v_rate;
        END IF;

        -- Try with the other parameter if first didn't match
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
    END IF;

    -- ============================================================
    -- STEP 2: Try carrier_zones (zone-based, from migration 045)
    -- ============================================================
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'carrier_zones') THEN
        -- Try exact zone match
        SELECT rate INTO v_rate
        FROM carrier_zones
        WHERE carrier_id = p_carrier_id
          AND is_active = true
          AND (
              LOWER(TRIM(zone_name)) = LOWER(v_search_term)
              OR LOWER(TRIM(TRANSLATE(zone_name, 'áéíóúñÁÉÍÓÚÑ', 'aeiounAEIOUN'))) =
                 LOWER(TRIM(TRANSLATE(v_search_term, 'áéíóúñÁÉÍÓÚÑ', 'aeiounAEIOUN')))
          )
        LIMIT 1;

        IF v_rate IS NOT NULL THEN
            RETURN v_rate;
        END IF;

        -- Try with p_city specifically if different from zone
        IF p_city IS NOT NULL AND TRIM(p_city) != '' THEN
            SELECT rate INTO v_rate
            FROM carrier_zones
            WHERE carrier_id = p_carrier_id
              AND is_active = true
              AND (
                  LOWER(TRIM(zone_name)) = LOWER(TRIM(p_city))
                  OR LOWER(TRIM(TRANSLATE(zone_name, 'áéíóúñÁÉÍÓÚÑ', 'aeiounAEIOUN'))) =
                     LOWER(TRIM(TRANSLATE(p_city, 'áéíóúñÁÉÍÓÚÑ', 'aeiounAEIOUN')))
              )
            LIMIT 1;

            IF v_rate IS NOT NULL THEN
                RETURN v_rate;
            END IF;
        END IF;

        -- Try fallback zones
        FOREACH v_zone IN ARRAY v_fallback_zones
        LOOP
            SELECT rate INTO v_rate
            FROM carrier_zones
            WHERE carrier_id = p_carrier_id
              AND is_active = true
              AND LOWER(TRIM(zone_name)) = v_zone
            LIMIT 1;

            IF v_rate IS NOT NULL THEN
                RETURN v_rate;
            END IF;
        END LOOP;

        -- Last resort: first active zone rate for this carrier
        SELECT rate INTO v_rate
        FROM carrier_zones
        WHERE carrier_id = p_carrier_id
          AND is_active = true
        ORDER BY created_at
        LIMIT 1;

        IF v_rate IS NOT NULL THEN
            RETURN v_rate;
        END IF;
    END IF;

    RETURN 0;
END;
$$;

COMMENT ON FUNCTION get_carrier_fee_for_order(UUID, TEXT, TEXT) IS
'Returns carrier fee for an order. FIXED in migration 121:
- Now searches carrier_coverage using BOTH city and zone_name
- Handles NULL p_city by falling back to p_zone_name
- Normalizes accents (Asunción = ASUNCION = asuncion)
- Checks carrier_coverage first (migration 090), then carrier_zones (migration 045)';

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_carrier_fee_for_order(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_carrier_fee_for_order(UUID, TEXT, TEXT) TO service_role;

-- Notify PostgREST
NOTIFY pgrst, 'reload schema';

-- Test the fix
DO $$
DECLARE
    v_rate DECIMAL(12,2);
BEGIN
    -- Test 1: ANDRES COURIER with zone ASUNCION (should find Asunción)
    v_rate := get_carrier_fee_for_order(
        '48f8d53b-1c33-45d5-b504-cd220f7a8d65'::UUID,
        'ASUNCION',
        NULL
    );

    IF v_rate > 0 THEN
        RAISE NOTICE 'TEST PASSED: ANDRES COURIER + ASUNCION zone = % Gs', v_rate;
    ELSE
        RAISE WARNING 'TEST FAILED: ANDRES COURIER + ASUNCION zone returned 0';
    END IF;

    -- Test 2: ANDRES COURIER with city Asunción
    v_rate := get_carrier_fee_for_order(
        '48f8d53b-1c33-45d5-b504-cd220f7a8d65'::UUID,
        NULL,
        'Asunción'
    );

    IF v_rate > 0 THEN
        RAISE NOTICE 'TEST PASSED: ANDRES COURIER + Asunción city = % Gs', v_rate;
    ELSE
        RAISE WARNING 'TEST FAILED: ANDRES COURIER + Asunción city returned 0';
    END IF;

    -- Test 3: Lucero del este with zone INTERIOR_1 (may not have a match)
    v_rate := get_carrier_fee_for_order(
        'f75d08f2-13ac-436d-8d96-e4455dd4f5bb'::UUID,
        'INTERIOR_1',
        NULL
    );

    RAISE NOTICE 'Lucero del este + INTERIOR_1 = % Gs (0 expected if no INTERIOR zone configured)', v_rate;

    RAISE NOTICE '';
    RAISE NOTICE 'Migration 121 complete. Now re-run the backfill:';
    RAISE NOTICE '  SELECT * FROM backfill_fix_prepaid_movements(NULL, FALSE);';
END $$;

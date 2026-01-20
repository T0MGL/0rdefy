-- ================================================================
-- MIGRATION 090: Carrier Coverage System (City-based Rates)
-- ================================================================
-- Purpose: Enable seamless carrier selection based on delivery city
--
-- Key Features:
--   1. Master list of Paraguay locations (cities + departments + zones)
--   2. Carrier coverage table with city-specific rates
--   3. Smart city autocomplete for order confirmation
--   4. Automatic carrier filtering based on coverage
-- ================================================================

-- ================================================================
-- 1. PARAGUAY LOCATIONS TABLE (Master Reference)
-- ================================================================
-- National reference table for all cities in Paraguay
-- This is shared across all stores (not store-specific)

CREATE TABLE IF NOT EXISTS paraguay_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Location hierarchy
    city VARCHAR(150) NOT NULL,              -- Official city name
    department VARCHAR(100) NOT NULL,         -- Department (state/province)
    zone_code VARCHAR(20) NOT NULL,           -- Zone classification: ASUNCION, CENTRAL, INTERIOR_1, INTERIOR_2

    -- Normalized fields for search
    city_normalized VARCHAR(150) NOT NULL,    -- Lowercase, no accents (for fuzzy search)
    department_normalized VARCHAR(100) NOT NULL,

    -- Metadata
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),

    -- Ensure unique cities (some cities have same name in different departments)
    CONSTRAINT unique_city_department UNIQUE(city, department)
);

-- Full-text search index for city autocomplete
CREATE INDEX IF NOT EXISTS idx_paraguay_locations_city_search
    ON paraguay_locations USING gin(to_tsvector('spanish', city || ' ' || department));

-- Fast lookups
CREATE INDEX IF NOT EXISTS idx_paraguay_locations_normalized
    ON paraguay_locations(city_normalized);
CREATE INDEX IF NOT EXISTS idx_paraguay_locations_department
    ON paraguay_locations(department);
CREATE INDEX IF NOT EXISTS idx_paraguay_locations_zone
    ON paraguay_locations(zone_code);

-- ================================================================
-- 2. CARRIER COVERAGE TABLE (Per-Store Rates)
-- ================================================================
-- Each carrier has specific rates per city
-- NULL rate = SIN COBERTURA (no coverage)

CREATE TABLE IF NOT EXISTS carrier_coverage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    carrier_id UUID NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,

    -- Location reference
    city VARCHAR(150) NOT NULL,               -- Must match paraguay_locations.city
    department VARCHAR(100) DEFAULT '',       -- Empty string instead of NULL for uniqueness

    -- Pricing
    rate DECIMAL(12,2),                       -- NULL = no coverage, 0 = free shipping

    -- Status
    is_active BOOLEAN DEFAULT TRUE,

    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Unique index for coverage per carrier per city (handles department being empty string)
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_carrier_city_coverage
    ON carrier_coverage(carrier_id, LOWER(city), LOWER(COALESCE(NULLIF(department, ''), '')));

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_carrier_coverage_store ON carrier_coverage(store_id);
CREATE INDEX IF NOT EXISTS idx_carrier_coverage_carrier ON carrier_coverage(carrier_id);
CREATE INDEX IF NOT EXISTS idx_carrier_coverage_city ON carrier_coverage(city);
CREATE INDEX IF NOT EXISTS idx_carrier_coverage_active ON carrier_coverage(carrier_id, is_active)
    WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_carrier_coverage_with_rate ON carrier_coverage(carrier_id, city)
    WHERE rate IS NOT NULL AND is_active = TRUE;

-- ================================================================
-- 3. ADD shipping_city COLUMNS TO ORDERS TABLE
-- ================================================================
-- Store the selected city for the order

-- Original city name as entered/selected
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_city VARCHAR(150);
COMMENT ON COLUMN orders.shipping_city IS 'City name for delivery (original format)';

-- Normalized version for lookups
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_city_normalized VARCHAR(150);
COMMENT ON COLUMN orders.shipping_city_normalized IS 'Normalized city name from paraguay_locations for consistent lookups';

CREATE INDEX IF NOT EXISTS idx_orders_shipping_city
    ON orders(shipping_city) WHERE shipping_city IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_shipping_city_normalized
    ON orders(shipping_city_normalized) WHERE shipping_city_normalized IS NOT NULL;

-- ================================================================
-- 4. FUNCTION: Normalize Text for Search
-- ================================================================
-- Removes accents and converts to lowercase for fuzzy matching

CREATE OR REPLACE FUNCTION normalize_location_text(p_text TEXT)
RETURNS TEXT AS $$
BEGIN
    IF p_text IS NULL THEN
        RETURN NULL;
    END IF;

    -- Convert to lowercase and remove accents
    RETURN LOWER(
        translate(
            p_text,
            'áéíóúàèìòùâêîôûäëïöüñÁÉÍÓÚÀÈÌÒÙÂÊÎÔÛÄËÏÖÜÑ',
            'aeiouaeiouaeiouaeiounaeiouaeiouaeiouaeioun'
        )
    );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ================================================================
-- 5. FUNCTION: Search Cities (Autocomplete)
-- ================================================================
-- Returns matching cities for autocomplete dropdown

CREATE OR REPLACE FUNCTION search_paraguay_cities(
    p_query TEXT,
    p_limit INT DEFAULT 10
)
RETURNS TABLE (
    city VARCHAR(150),
    department VARCHAR(100),
    zone_code VARCHAR(20),
    display_text TEXT
) AS $$
DECLARE
    v_normalized_query TEXT;
BEGIN
    v_normalized_query := normalize_location_text(p_query);

    RETURN QUERY
    SELECT
        pl.city,
        pl.department,
        pl.zone_code,
        pl.city || ' (' || pl.department || ')' as display_text
    FROM paraguay_locations pl
    WHERE pl.is_active = TRUE
      AND (
          -- Exact prefix match (most relevant)
          pl.city_normalized LIKE v_normalized_query || '%'
          -- Or contains match
          OR pl.city_normalized LIKE '%' || v_normalized_query || '%'
          -- Or department match
          OR pl.department_normalized LIKE v_normalized_query || '%'
      )
    ORDER BY
        -- Prioritize exact prefix matches
        CASE WHEN pl.city_normalized LIKE v_normalized_query || '%' THEN 0 ELSE 1 END,
        -- Then by population zones (Asunción first, then Central, etc.)
        CASE pl.zone_code
            WHEN 'ASUNCION' THEN 1
            WHEN 'CENTRAL' THEN 2
            WHEN 'INTERIOR_1' THEN 3
            ELSE 4
        END,
        pl.city
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

-- ================================================================
-- 6. FUNCTION: Get Carriers with Coverage for City
-- ================================================================
-- Returns all carriers that can deliver to a specific city

CREATE OR REPLACE FUNCTION get_carriers_for_city(
    p_store_id UUID,
    p_city VARCHAR(150),
    p_department VARCHAR(100) DEFAULT NULL
)
RETURNS TABLE (
    carrier_id UUID,
    carrier_name VARCHAR(255),
    carrier_phone VARCHAR(50),
    rate DECIMAL(12,2),
    zone_code VARCHAR(20),
    has_coverage BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        c.id as carrier_id,
        c.name as carrier_name,
        c.phone as carrier_phone,
        cc.rate,
        COALESCE(pl.zone_code, 'UNKNOWN') as zone_code,
        (cc.rate IS NOT NULL) as has_coverage
    FROM carriers c
    LEFT JOIN carrier_coverage cc ON cc.carrier_id = c.id
        AND cc.is_active = TRUE
        AND normalize_location_text(cc.city) = normalize_location_text(p_city)
        AND (p_department IS NULL OR cc.department IS NULL OR normalize_location_text(cc.department) = normalize_location_text(p_department))
    LEFT JOIN paraguay_locations pl ON normalize_location_text(pl.city) = normalize_location_text(p_city)
        AND (p_department IS NULL OR normalize_location_text(pl.department) = normalize_location_text(p_department))
    WHERE c.store_id = p_store_id
      AND c.is_active = TRUE
    ORDER BY
        -- First show carriers WITH coverage
        CASE WHEN cc.rate IS NOT NULL THEN 0 ELSE 1 END,
        -- Then by lowest rate
        cc.rate ASC NULLS LAST,
        c.name;
END;
$$ LANGUAGE plpgsql STABLE;

-- ================================================================
-- 7. FUNCTION: Calculate Shipping Cost
-- ================================================================
-- Returns the shipping cost for a specific carrier and city

CREATE OR REPLACE FUNCTION get_carrier_rate_for_city(
    p_carrier_id UUID,
    p_city VARCHAR(150),
    p_department VARCHAR(100) DEFAULT NULL
)
RETURNS DECIMAL(12,2) AS $$
DECLARE
    v_rate DECIMAL(12,2);
BEGIN
    SELECT cc.rate INTO v_rate
    FROM carrier_coverage cc
    WHERE cc.carrier_id = p_carrier_id
      AND cc.is_active = TRUE
      AND normalize_location_text(cc.city) = normalize_location_text(p_city)
      AND (p_department IS NULL OR cc.department IS NULL OR normalize_location_text(cc.department) = normalize_location_text(p_department))
    LIMIT 1;

    RETURN v_rate;
END;
$$ LANGUAGE plpgsql STABLE;

-- ================================================================
-- 8. FUNCTION: Bulk Import Carrier Coverage
-- ================================================================
-- Import coverage data from structured JSON

CREATE OR REPLACE FUNCTION import_carrier_coverage(
    p_store_id UUID,
    p_carrier_id UUID,
    p_coverage JSONB  -- Array of {city, department, rate}
)
RETURNS INT AS $$
DECLARE
    v_item JSONB;
    v_count INT := 0;
    v_city TEXT;
    v_department TEXT;
    v_rate DECIMAL(12,2);
    v_existing_id UUID;
BEGIN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_coverage)
    LOOP
        v_city := v_item->>'city';
        v_department := COALESCE(NULLIF(v_item->>'department', ''), '');
        v_rate := CASE
            WHEN v_item->>'rate' = 'SIN COBERTURA' THEN NULL
            WHEN v_item->>'rate' IS NULL THEN NULL
            ELSE (v_item->>'rate')::DECIMAL(12,2)
        END;

        -- Check if coverage already exists
        SELECT id INTO v_existing_id
        FROM carrier_coverage
        WHERE carrier_id = p_carrier_id
          AND LOWER(city) = LOWER(v_city)
          AND LOWER(COALESCE(NULLIF(department, ''), '')) = LOWER(v_department);

        IF v_existing_id IS NOT NULL THEN
            -- Update existing
            UPDATE carrier_coverage
            SET rate = v_rate,
                is_active = TRUE,
                updated_at = NOW()
            WHERE id = v_existing_id;
        ELSE
            -- Insert new
            INSERT INTO carrier_coverage (store_id, carrier_id, city, department, rate)
            VALUES (p_store_id, p_carrier_id, v_city, v_department, v_rate);
        END IF;

        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- 9. VIEW: Carrier Coverage Summary
-- ================================================================
-- Quick overview of carrier coverage by zone

CREATE OR REPLACE VIEW v_carrier_coverage_summary AS
SELECT
    c.store_id,
    c.id as carrier_id,
    c.name as carrier_name,
    COUNT(DISTINCT cc.city) FILTER (WHERE cc.rate IS NOT NULL) as cities_with_coverage,
    COUNT(DISTINCT cc.city) FILTER (WHERE cc.rate IS NULL) as cities_without_coverage,
    MIN(cc.rate) FILTER (WHERE cc.rate IS NOT NULL) as min_rate,
    MAX(cc.rate) FILTER (WHERE cc.rate IS NOT NULL) as max_rate,
    ROUND(AVG(cc.rate) FILTER (WHERE cc.rate IS NOT NULL), 0) as avg_rate
FROM carriers c
LEFT JOIN carrier_coverage cc ON cc.carrier_id = c.id AND cc.is_active = TRUE
WHERE c.is_active = TRUE
GROUP BY c.store_id, c.id, c.name;

-- ================================================================
-- 10. VIEW: Coverage Gaps (Cities without any carrier)
-- ================================================================
-- Shows cities that have no carrier coverage for a store

CREATE OR REPLACE VIEW v_coverage_gaps AS
SELECT
    o.store_id,
    COALESCE(o.shipping_city_normalized, normalize_location_text(o.shipping_city)) as city,
    pl.department,
    pl.zone_code,
    COUNT(*) as order_count,
    MAX(o.created_at) as last_order_date
FROM orders o
LEFT JOIN paraguay_locations pl ON normalize_location_text(pl.city) = COALESCE(o.shipping_city_normalized, normalize_location_text(o.shipping_city))
LEFT JOIN carrier_coverage cc ON normalize_location_text(cc.city) = COALESCE(o.shipping_city_normalized, normalize_location_text(o.shipping_city))
    AND cc.store_id = o.store_id
    AND cc.rate IS NOT NULL
WHERE cc.id IS NULL
  AND o.shipping_city IS NOT NULL
  AND o.sleeves_status NOT IN ('cancelled', 'returned')
GROUP BY o.store_id, COALESCE(o.shipping_city_normalized, normalize_location_text(o.shipping_city)), pl.department, pl.zone_code
ORDER BY order_count DESC;

-- ================================================================
-- 11. TRIGGERS
-- ================================================================

-- Auto-normalize city on insert/update for carrier_coverage
CREATE OR REPLACE FUNCTION fn_normalize_carrier_coverage()
RETURNS TRIGGER AS $$
BEGIN
    -- Ensure city exists in paraguay_locations (soft validation - just log warning)
    IF NOT EXISTS (
        SELECT 1 FROM paraguay_locations
        WHERE city_normalized = normalize_location_text(NEW.city)
    ) THEN
        RAISE WARNING 'City "%" not found in paraguay_locations master list', NEW.city;
    END IF;

    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_normalize_carrier_coverage ON carrier_coverage;
CREATE TRIGGER trigger_normalize_carrier_coverage
    BEFORE INSERT OR UPDATE ON carrier_coverage
    FOR EACH ROW EXECUTE FUNCTION fn_normalize_carrier_coverage();

-- Auto-normalize city_normalized on paraguay_locations insert/update
CREATE OR REPLACE FUNCTION fn_normalize_paraguay_location()
RETURNS TRIGGER AS $$
BEGIN
    NEW.city_normalized := normalize_location_text(NEW.city);
    NEW.department_normalized := normalize_location_text(NEW.department);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_normalize_paraguay_location ON paraguay_locations;
CREATE TRIGGER trigger_normalize_paraguay_location
    BEFORE INSERT OR UPDATE ON paraguay_locations
    FOR EACH ROW EXECUTE FUNCTION fn_normalize_paraguay_location();

-- ================================================================
-- 12. RLS POLICIES
-- ================================================================

ALTER TABLE carrier_coverage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "carrier_coverage_store_access" ON carrier_coverage;
CREATE POLICY "carrier_coverage_store_access" ON carrier_coverage
    FOR ALL USING (
        store_id IN (SELECT store_id FROM user_stores WHERE user_id = auth.uid())
    );

-- Paraguay locations is public/read-only for all authenticated users
ALTER TABLE paraguay_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "paraguay_locations_read" ON paraguay_locations;
CREATE POLICY "paraguay_locations_read" ON paraguay_locations
    FOR SELECT USING (TRUE);

-- ================================================================
-- 13. GRANTS
-- ================================================================

GRANT ALL ON carrier_coverage TO postgres;
GRANT SELECT, INSERT, UPDATE, DELETE ON carrier_coverage TO authenticated;

GRANT ALL ON paraguay_locations TO postgres;
GRANT SELECT ON paraguay_locations TO authenticated;  -- Read-only for users

GRANT SELECT ON v_carrier_coverage_summary TO authenticated;
GRANT SELECT ON v_coverage_gaps TO authenticated;

GRANT EXECUTE ON FUNCTION normalize_location_text TO authenticated;
GRANT EXECUTE ON FUNCTION search_paraguay_cities TO authenticated;
GRANT EXECUTE ON FUNCTION get_carriers_for_city TO authenticated;
GRANT EXECUTE ON FUNCTION get_carrier_rate_for_city TO authenticated;
GRANT EXECUTE ON FUNCTION import_carrier_coverage TO authenticated;

-- ================================================================
-- ✅ MIGRATION 090 COMPLETED
-- ================================================================
-- New Tables:
--   - paraguay_locations (master reference for all Paraguay cities)
--   - carrier_coverage (per-carrier, per-city rates)
--
-- New Functions:
--   - normalize_location_text() - Text normalization for fuzzy search
--   - search_paraguay_cities() - City autocomplete
--   - get_carriers_for_city() - Get available carriers for a city
--   - get_carrier_rate_for_city() - Get specific carrier rate
--   - import_carrier_coverage() - Bulk import coverage data
--
-- New Views:
--   - v_carrier_coverage_summary - Coverage statistics per carrier
--   - v_coverage_gaps - Cities with orders but no coverage
--
-- Usage Flow:
--   1. User types city → search_paraguay_cities() provides autocomplete
--   2. User selects city → get_carriers_for_city() shows available carriers with rates
--   3. User selects carrier → rate is auto-filled from coverage
--   4. Order confirmed with shipping_city_normalized for tracking
-- ================================================================

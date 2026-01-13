-- ================================================================
-- CARRIER SYSTEM PRODUCTION FIXES
-- ================================================================
-- Migration: 063_carrier_system_production_fixes.sql
-- Author: Bright Idea
-- Date: 2026-01-13
--
-- Fixes identified issues:
-- 1. Carriers can be deleted with active orders (data integrity)
-- 2. Dispatch without carrier zones allowed (fee=0 problem)
-- 3. No calculate_shipping_cost function (referenced but missing)
-- 4. Carrier zone coverage validation missing
-- 5. No monitoring views for carrier health
-- 6. Orders without carrier can get stuck
-- ================================================================

BEGIN;

-- ================================================================
-- FIX 1: Prevent carrier deletion with active orders
-- ================================================================
-- A carrier with orders in transit (shipped, in_preparation, ready_to_ship)
-- should NOT be deletable. This prevents orphaned orders.

CREATE OR REPLACE FUNCTION prevent_carrier_deletion_with_active_orders()
RETURNS TRIGGER AS $$
DECLARE
  v_active_count INTEGER;
  v_statuses TEXT[];
BEGIN
  -- Define statuses that indicate "active" orders
  v_statuses := ARRAY['pending', 'confirmed', 'in_preparation', 'ready_to_ship', 'shipped', 'in_transit'];

  -- Count orders assigned to this carrier in active statuses
  SELECT COUNT(*) INTO v_active_count
  FROM orders
  WHERE courier_id = OLD.id
    AND sleeves_status = ANY(v_statuses);

  IF v_active_count > 0 THEN
    RAISE EXCEPTION 'Cannot delete carrier "%" (ID: %): % active order(s) assigned. Reassign orders first or deactivate the carrier instead.',
      OLD.name, OLD.id, v_active_count;
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_prevent_carrier_deletion ON carriers;
CREATE TRIGGER trigger_prevent_carrier_deletion
  BEFORE DELETE ON carriers
  FOR EACH ROW
  EXECUTE FUNCTION prevent_carrier_deletion_with_active_orders();

COMMENT ON FUNCTION prevent_carrier_deletion_with_active_orders() IS
'Prevents deletion of carriers that have active orders assigned. Use deactivation instead.';


-- ================================================================
-- FIX 2: Carrier deactivation validation
-- ================================================================
-- When deactivating a carrier, warn if there are active orders

CREATE OR REPLACE FUNCTION validate_carrier_deactivation()
RETURNS TRIGGER AS $$
DECLARE
  v_active_count INTEGER;
BEGIN
  -- Only check when deactivating (is_active changes from true to false)
  IF OLD.is_active = TRUE AND NEW.is_active = FALSE THEN
    SELECT COUNT(*) INTO v_active_count
    FROM orders
    WHERE courier_id = NEW.id
      AND sleeves_status IN ('pending', 'confirmed', 'in_preparation', 'ready_to_ship', 'shipped', 'in_transit');

    IF v_active_count > 0 THEN
      -- Log warning but allow deactivation (soft warning, not blocking)
      RAISE WARNING 'Carrier "%" deactivated with % active orders. These orders may need reassignment.',
        NEW.name, v_active_count;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_validate_carrier_deactivation ON carriers;
CREATE TRIGGER trigger_validate_carrier_deactivation
  BEFORE UPDATE ON carriers
  FOR EACH ROW
  WHEN (OLD.is_active IS DISTINCT FROM NEW.is_active)
  EXECUTE FUNCTION validate_carrier_deactivation();

COMMENT ON FUNCTION validate_carrier_deactivation() IS
'Warns when deactivating a carrier that has active orders assigned.';


-- ================================================================
-- FIX 3: calculate_shipping_cost function (was missing)
-- ================================================================
-- This function calculates shipping cost based on carrier zones

CREATE OR REPLACE FUNCTION calculate_shipping_cost(
  p_carrier_id UUID,
  p_city TEXT,
  p_zone TEXT DEFAULT NULL
)
RETURNS TABLE (
  shipping_cost DECIMAL(12,2),
  zone_matched VARCHAR(100),
  match_type TEXT,
  carrier_has_zones BOOLEAN
) AS $$
DECLARE
  v_rate DECIMAL(12,2);
  v_zone_name VARCHAR(100);
  v_match_type TEXT;
  v_has_zones BOOLEAN;
BEGIN
  -- Check if carrier has any zones configured
  SELECT EXISTS (
    SELECT 1 FROM carrier_zones
    WHERE carrier_id = p_carrier_id AND is_active = TRUE
  ) INTO v_has_zones;

  IF NOT v_has_zones THEN
    -- Carrier has no zones - return NULL cost with warning indicator
    RETURN QUERY SELECT
      NULL::DECIMAL(12,2) as shipping_cost,
      NULL::VARCHAR(100) as zone_matched,
      'no_zones_configured'::TEXT as match_type,
      FALSE as carrier_has_zones;
    RETURN;
  END IF;

  -- Try to match by zone first (if provided)
  IF p_zone IS NOT NULL AND p_zone != '' THEN
    SELECT rate, zone_name INTO v_rate, v_zone_name
    FROM carrier_zones
    WHERE carrier_id = p_carrier_id
      AND is_active = TRUE
      AND LOWER(TRIM(zone_name)) = LOWER(TRIM(p_zone))
    LIMIT 1;

    IF FOUND THEN
      v_match_type := 'zone_exact';
    END IF;
  END IF;

  -- Try to match by city if zone didn't match
  IF v_rate IS NULL AND p_city IS NOT NULL AND p_city != '' THEN
    SELECT rate, zone_name INTO v_rate, v_zone_name
    FROM carrier_zones
    WHERE carrier_id = p_carrier_id
      AND is_active = TRUE
      AND LOWER(TRIM(zone_name)) = LOWER(TRIM(p_city))
    LIMIT 1;

    IF FOUND THEN
      v_match_type := 'city_exact';
    END IF;
  END IF;

  -- Try partial match on city (contains)
  IF v_rate IS NULL AND p_city IS NOT NULL AND p_city != '' THEN
    SELECT rate, zone_name INTO v_rate, v_zone_name
    FROM carrier_zones
    WHERE carrier_id = p_carrier_id
      AND is_active = TRUE
      AND (
        LOWER(TRIM(zone_name)) LIKE '%' || LOWER(TRIM(p_city)) || '%'
        OR LOWER(TRIM(p_city)) LIKE '%' || LOWER(TRIM(zone_name)) || '%'
      )
    ORDER BY LENGTH(zone_name) ASC  -- Prefer more specific matches
    LIMIT 1;

    IF FOUND THEN
      v_match_type := 'city_partial';
    END IF;
  END IF;

  -- Fallback to default zone
  IF v_rate IS NULL THEN
    SELECT rate, zone_name INTO v_rate, v_zone_name
    FROM carrier_zones
    WHERE carrier_id = p_carrier_id
      AND is_active = TRUE
      AND LOWER(zone_name) IN ('default', 'otros', 'interior', 'general')
    ORDER BY
      CASE LOWER(zone_name)
        WHEN 'default' THEN 1
        WHEN 'otros' THEN 2
        WHEN 'interior' THEN 3
        WHEN 'general' THEN 4
      END
    LIMIT 1;

    IF FOUND THEN
      v_match_type := 'default_fallback';
    ELSE
      v_match_type := 'no_match';
    END IF;
  END IF;

  RETURN QUERY SELECT
    v_rate as shipping_cost,
    v_zone_name as zone_matched,
    v_match_type as match_type,
    TRUE as carrier_has_zones;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION calculate_shipping_cost(UUID, TEXT, TEXT) IS
'Calculates shipping cost for an order based on carrier zones.
Match priority: 1) Exact zone, 2) Exact city, 3) Partial city, 4) Default zone.
Returns NULL cost if carrier has no zones configured.';


-- ================================================================
-- FIX 4: validate_dispatch_carrier_zones function
-- ================================================================
-- Validates carrier has zones before allowing dispatch session creation

CREATE OR REPLACE FUNCTION validate_dispatch_carrier_zones(p_carrier_id UUID)
RETURNS TABLE (
  is_valid BOOLEAN,
  zone_count INTEGER,
  has_default_zone BOOLEAN,
  zones_list TEXT,
  warning_message TEXT
) AS $$
DECLARE
  v_zone_count INTEGER;
  v_has_default BOOLEAN;
  v_zones TEXT;
BEGIN
  -- Count active zones
  SELECT
    COUNT(*),
    BOOL_OR(LOWER(zone_name) IN ('default', 'otros', 'interior', 'general')),
    STRING_AGG(zone_name || ' (' || rate::TEXT || ')', ', ' ORDER BY zone_name)
  INTO v_zone_count, v_has_default, v_zones
  FROM carrier_zones
  WHERE carrier_id = p_carrier_id
    AND is_active = TRUE;

  -- Handle NULL from empty result
  v_zone_count := COALESCE(v_zone_count, 0);
  v_has_default := COALESCE(v_has_default, FALSE);

  IF v_zone_count = 0 THEN
    RETURN QUERY SELECT
      FALSE as is_valid,
      0 as zone_count,
      FALSE as has_default_zone,
      NULL::TEXT as zones_list,
      'Carrier has NO zones configured. All orders will have carrier_fee=0. Configure at least one zone before dispatching.'::TEXT as warning_message;
  ELSIF NOT v_has_default THEN
    RETURN QUERY SELECT
      TRUE as is_valid,  -- Valid but with warning
      v_zone_count as zone_count,
      FALSE as has_default_zone,
      v_zones as zones_list,
      'Carrier has no default zone. Orders to unconfigured cities will have carrier_fee=0. Consider adding a "Default" zone.'::TEXT as warning_message;
  ELSE
    RETURN QUERY SELECT
      TRUE as is_valid,
      v_zone_count as zone_count,
      TRUE as has_default_zone,
      v_zones as zones_list,
      NULL::TEXT as warning_message;
  END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION validate_dispatch_carrier_zones(UUID) IS
'Validates carrier has zones configured before dispatch. Returns is_valid=FALSE if no zones exist.';


-- ================================================================
-- FIX 5: Orders without carrier helper view
-- ================================================================

CREATE OR REPLACE VIEW v_orders_without_carrier AS
SELECT
  o.id,
  o.store_id,
  o.order_number,
  COALESCE(o.shopify_order_name, o.shopify_order_number::TEXT, 'ORD-' || LEFT(o.id::TEXT, 8)) as display_order_number,
  o.customer_first_name || ' ' || COALESCE(o.customer_last_name, '') as customer_name,
  o.customer_phone,
  o.delivery_zone,
  o.total_price,
  o.payment_method,
  o.sleeves_status,
  o.created_at,
  NOW() - o.created_at as age,
  CASE
    WHEN o.sleeves_status = 'confirmed' AND NOW() - o.created_at > INTERVAL '24 hours' THEN 'CRITICAL'
    WHEN o.sleeves_status = 'confirmed' AND NOW() - o.created_at > INTERVAL '12 hours' THEN 'WARNING'
    WHEN o.sleeves_status IN ('ready_to_ship', 'in_preparation') THEN 'URGENT'
    ELSE 'NORMAL'
  END as urgency
FROM orders o
WHERE o.courier_id IS NULL
  AND o.sleeves_status IN ('confirmed', 'in_preparation', 'ready_to_ship')
ORDER BY
  CASE o.sleeves_status
    WHEN 'ready_to_ship' THEN 1
    WHEN 'in_preparation' THEN 2
    WHEN 'confirmed' THEN 3
  END,
  o.created_at ASC;

COMMENT ON VIEW v_orders_without_carrier IS
'Orders that need carrier assignment. Shows urgency based on status and age.';


-- ================================================================
-- FIX 6: Carrier zones coverage gaps view
-- ================================================================

CREATE OR REPLACE VIEW v_carrier_zone_coverage_gaps AS
WITH order_cities AS (
  -- Get unique cities from orders in last 30 days
  SELECT DISTINCT
    store_id,
    LOWER(TRIM(COALESCE(delivery_zone, ''))) as city,
    COUNT(*) as order_count
  FROM orders
  WHERE created_at > NOW() - INTERVAL '30 days'
    AND delivery_zone IS NOT NULL
    AND delivery_zone != ''
  GROUP BY store_id, LOWER(TRIM(COALESCE(delivery_zone, '')))
),
carrier_coverage AS (
  -- Get cities covered by each carrier
  SELECT
    c.id as carrier_id,
    c.store_id,
    c.name as carrier_name,
    LOWER(TRIM(cz.zone_name)) as zone_name,
    cz.rate
  FROM carriers c
  LEFT JOIN carrier_zones cz ON c.id = cz.carrier_id AND cz.is_active = TRUE
  WHERE c.is_active = TRUE
)
SELECT
  oc.store_id,
  oc.city,
  oc.order_count as orders_last_30_days,
  cc.carrier_id,
  cc.carrier_name,
  CASE
    WHEN cc.zone_name = oc.city THEN 'COVERED'
    WHEN cc.zone_name IN ('default', 'otros', 'interior', 'general') THEN 'DEFAULT_FALLBACK'
    ELSE 'NOT_COVERED'
  END as coverage_status,
  cc.rate as applicable_rate
FROM order_cities oc
CROSS JOIN carrier_coverage cc
WHERE oc.store_id = cc.store_id
  AND (
    cc.zone_name = oc.city
    OR cc.zone_name IN ('default', 'otros', 'interior', 'general')
    OR cc.zone_name IS NULL
  )
ORDER BY oc.store_id, oc.order_count DESC, cc.carrier_name;

COMMENT ON VIEW v_carrier_zone_coverage_gaps IS
'Shows which cities from recent orders are not covered by carrier zones.';


-- ================================================================
-- FIX 7: Carrier health monitoring view
-- ================================================================

CREATE OR REPLACE VIEW v_carrier_health AS
SELECT
  c.id as carrier_id,
  c.store_id,
  c.name as carrier_name,
  c.is_active,
  c.phone,
  c.email,
  c.delivery_rate,
  c.total_deliveries,
  c.successful_deliveries,
  c.failed_deliveries,
  c.average_rating,
  -- Zone configuration status
  COALESCE(zone_stats.zone_count, 0) as configured_zones,
  COALESCE(zone_stats.has_default, FALSE) as has_default_zone,
  -- Active orders
  COALESCE(order_stats.pending_count, 0) as pending_orders,
  COALESCE(order_stats.shipped_count, 0) as shipped_orders,
  COALESCE(order_stats.total_active, 0) as total_active_orders,
  -- Settlements
  COALESCE(settlement_stats.pending_balance, 0) as pending_settlement_balance,
  COALESCE(settlement_stats.pending_settlements, 0) as pending_settlement_count,
  -- Health score (0-100)
  CASE
    WHEN NOT c.is_active THEN 0
    WHEN COALESCE(zone_stats.zone_count, 0) = 0 THEN 20
    WHEN NOT COALESCE(zone_stats.has_default, FALSE) THEN 60
    WHEN c.delivery_rate < 70 THEN 70
    WHEN c.delivery_rate < 85 THEN 85
    ELSE 100
  END as health_score,
  -- Health status
  CASE
    WHEN NOT c.is_active THEN 'INACTIVE'
    WHEN COALESCE(zone_stats.zone_count, 0) = 0 THEN 'CRITICAL_NO_ZONES'
    WHEN NOT COALESCE(zone_stats.has_default, FALSE) THEN 'WARNING_NO_DEFAULT'
    WHEN c.delivery_rate < 70 THEN 'WARNING_LOW_DELIVERY_RATE'
    WHEN COALESCE(order_stats.shipped_count, 0) > 50 THEN 'WARNING_HIGH_PENDING'
    ELSE 'HEALTHY'
  END as health_status,
  -- Last activity
  order_stats.last_delivery_at,
  order_stats.last_assignment_at
FROM carriers c
LEFT JOIN (
  -- Zone statistics
  SELECT
    carrier_id,
    COUNT(*) as zone_count,
    BOOL_OR(LOWER(zone_name) IN ('default', 'otros', 'interior', 'general')) as has_default
  FROM carrier_zones
  WHERE is_active = TRUE
  GROUP BY carrier_id
) zone_stats ON c.id = zone_stats.carrier_id
LEFT JOIN (
  -- Order statistics
  SELECT
    courier_id,
    COUNT(*) FILTER (WHERE sleeves_status IN ('confirmed', 'in_preparation', 'ready_to_ship')) as pending_count,
    COUNT(*) FILTER (WHERE sleeves_status = 'shipped') as shipped_count,
    COUNT(*) FILTER (WHERE sleeves_status NOT IN ('delivered', 'cancelled', 'rejected', 'returned')) as total_active,
    MAX(delivered_at) as last_delivery_at,
    MAX(created_at) FILTER (WHERE courier_id IS NOT NULL) as last_assignment_at
  FROM orders
  GROUP BY courier_id
) order_stats ON c.id = order_stats.courier_id
LEFT JOIN (
  -- Settlement statistics
  SELECT
    carrier_id,
    SUM(balance_due) as pending_balance,
    COUNT(*) as pending_settlements
  FROM daily_settlements
  WHERE status IN ('pending', 'partial')
  GROUP BY carrier_id
) settlement_stats ON c.id = settlement_stats.carrier_id
ORDER BY c.store_id, health_score ASC, c.name;

COMMENT ON VIEW v_carrier_health IS
'Comprehensive carrier health view with zone configuration, delivery metrics, and settlement status.';


-- ================================================================
-- FIX 8: Function to reassign orders from one carrier to another
-- ================================================================

CREATE OR REPLACE FUNCTION reassign_carrier_orders(
  p_from_carrier_id UUID,
  p_to_carrier_id UUID,
  p_store_id UUID,
  p_statuses TEXT[] DEFAULT ARRAY['confirmed', 'in_preparation', 'ready_to_ship']
)
RETURNS TABLE (
  orders_reassigned INTEGER,
  from_carrier_name VARCHAR(255),
  to_carrier_name VARCHAR(255)
) AS $$
DECLARE
  v_from_name VARCHAR(255);
  v_to_name VARCHAR(255);
  v_count INTEGER;
BEGIN
  -- Validate carriers exist and belong to store
  SELECT name INTO v_from_name
  FROM carriers
  WHERE id = p_from_carrier_id AND store_id = p_store_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source carrier % not found in store %', p_from_carrier_id, p_store_id;
  END IF;

  SELECT name INTO v_to_name
  FROM carriers
  WHERE id = p_to_carrier_id AND store_id = p_store_id AND is_active = TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target carrier % not found or inactive in store %', p_to_carrier_id, p_store_id;
  END IF;

  -- Reassign orders
  WITH updated AS (
    UPDATE orders
    SET
      courier_id = p_to_carrier_id,
      updated_at = NOW()
    WHERE courier_id = p_from_carrier_id
      AND store_id = p_store_id
      AND sleeves_status = ANY(p_statuses)
    RETURNING id
  )
  SELECT COUNT(*) INTO v_count FROM updated;

  RETURN QUERY SELECT v_count, v_from_name, v_to_name;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION reassign_carrier_orders(UUID, UUID, UUID, TEXT[]) IS
'Bulk reassigns orders from one carrier to another. Only affects orders in specified statuses.';


-- ================================================================
-- FIX 9: Suggest carrier for order based on zone coverage
-- ================================================================

CREATE OR REPLACE FUNCTION suggest_carrier_for_order(
  p_store_id UUID,
  p_city TEXT,
  p_zone TEXT DEFAULT NULL
)
RETURNS TABLE (
  carrier_id UUID,
  carrier_name VARCHAR(255),
  zone_matched VARCHAR(100),
  shipping_cost DECIMAL(12,2),
  delivery_rate DECIMAL(5,2),
  pending_orders BIGINT,
  recommendation_score INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id as carrier_id,
    c.name as carrier_name,
    cz.zone_name as zone_matched,
    cz.rate as shipping_cost,
    c.delivery_rate,
    COALESCE(active_orders.cnt, 0) as pending_orders,
    -- Recommendation score (higher is better)
    (
      CASE
        WHEN LOWER(TRIM(cz.zone_name)) = LOWER(TRIM(p_city)) THEN 100
        WHEN LOWER(TRIM(cz.zone_name)) = LOWER(TRIM(COALESCE(p_zone, ''))) THEN 90
        WHEN LOWER(cz.zone_name) LIKE '%' || LOWER(TRIM(p_city)) || '%' THEN 70
        WHEN LOWER(cz.zone_name) IN ('default', 'otros', 'interior', 'general') THEN 50
        ELSE 0
      END
      + LEAST(c.delivery_rate::INTEGER, 30)  -- Up to 30 points for delivery rate
      - LEAST(COALESCE(active_orders.cnt, 0) / 10, 20)::INTEGER  -- Penalize overloaded carriers
    )::INTEGER as recommendation_score
  FROM carriers c
  JOIN carrier_zones cz ON c.id = cz.carrier_id AND cz.is_active = TRUE
  LEFT JOIN (
    SELECT courier_id, COUNT(*) as cnt
    FROM orders
    WHERE sleeves_status IN ('confirmed', 'in_preparation', 'ready_to_ship', 'shipped')
    GROUP BY courier_id
  ) active_orders ON c.id = active_orders.courier_id
  WHERE c.store_id = p_store_id
    AND c.is_active = TRUE
    AND (
      LOWER(TRIM(cz.zone_name)) = LOWER(TRIM(p_city))
      OR LOWER(TRIM(cz.zone_name)) = LOWER(TRIM(COALESCE(p_zone, '')))
      OR LOWER(cz.zone_name) LIKE '%' || LOWER(TRIM(p_city)) || '%'
      OR LOWER(cz.zone_name) IN ('default', 'otros', 'interior', 'general')
    )
  ORDER BY recommendation_score DESC, c.delivery_rate DESC
  LIMIT 5;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION suggest_carrier_for_order(UUID, TEXT, TEXT) IS
'Suggests best carriers for an order based on zone coverage, delivery rate, and current workload.';


-- ================================================================
-- FIX 10: Add indexes for carrier queries performance
-- ================================================================

-- Index for orders by carrier and status (common query)
CREATE INDEX IF NOT EXISTS idx_orders_carrier_status
ON orders(courier_id, sleeves_status)
WHERE courier_id IS NOT NULL;

-- Index for orders without carrier (assignment queries)
CREATE INDEX IF NOT EXISTS idx_orders_no_carrier_status
ON orders(store_id, sleeves_status, created_at)
WHERE courier_id IS NULL AND sleeves_status IN ('confirmed', 'in_preparation', 'ready_to_ship');

-- Index for carrier zones lookup
CREATE INDEX IF NOT EXISTS idx_carrier_zones_lookup
ON carrier_zones(carrier_id, is_active, LOWER(zone_name));

-- Index for active carriers
CREATE INDEX IF NOT EXISTS idx_carriers_active_store
ON carriers(store_id, is_active)
WHERE is_active = TRUE;


-- ================================================================
-- GRANTS
-- ================================================================

GRANT EXECUTE ON FUNCTION calculate_shipping_cost(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION validate_dispatch_carrier_zones(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION reassign_carrier_orders(UUID, UUID, UUID, TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION suggest_carrier_for_order(UUID, TEXT, TEXT) TO authenticated;

GRANT SELECT ON v_orders_without_carrier TO authenticated;
GRANT SELECT ON v_carrier_zone_coverage_gaps TO authenticated;
GRANT SELECT ON v_carrier_health TO authenticated;


-- ================================================================
-- VERIFICATION
-- ================================================================

DO $$
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Migration 063 Verification';
  RAISE NOTICE '========================================';

  -- Verify trigger exists
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_prevent_carrier_deletion') THEN
    RAISE NOTICE 'OK: Carrier deletion prevention trigger exists';
  ELSE
    RAISE EXCEPTION 'FAILED: Carrier deletion prevention trigger not created';
  END IF;

  -- Verify calculate_shipping_cost function
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'calculate_shipping_cost') THEN
    RAISE NOTICE 'OK: calculate_shipping_cost function exists';
  ELSE
    RAISE EXCEPTION 'FAILED: calculate_shipping_cost function not created';
  END IF;

  -- Verify views
  IF EXISTS (SELECT 1 FROM pg_views WHERE viewname = 'v_carrier_health') THEN
    RAISE NOTICE 'OK: v_carrier_health view exists';
  ELSE
    RAISE EXCEPTION 'FAILED: v_carrier_health view not created';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_views WHERE viewname = 'v_orders_without_carrier') THEN
    RAISE NOTICE 'OK: v_orders_without_carrier view exists';
  ELSE
    RAISE EXCEPTION 'FAILED: v_orders_without_carrier view not created';
  END IF;

  RAISE NOTICE '========================================';
  RAISE NOTICE 'Migration 063 Complete!';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Production fixes applied:';
  RAISE NOTICE '1. Carrier deletion protection (active orders)';
  RAISE NOTICE '2. Carrier deactivation warning';
  RAISE NOTICE '3. calculate_shipping_cost function';
  RAISE NOTICE '4. validate_dispatch_carrier_zones function';
  RAISE NOTICE '5. v_orders_without_carrier view';
  RAISE NOTICE '6. v_carrier_zone_coverage_gaps view';
  RAISE NOTICE '7. v_carrier_health monitoring view';
  RAISE NOTICE '8. reassign_carrier_orders function';
  RAISE NOTICE '9. suggest_carrier_for_order function';
  RAISE NOTICE '10. Performance indexes';
  RAISE NOTICE '========================================';
END $$;

COMMIT;

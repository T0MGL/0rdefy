-- ============================================================================
-- EJECUTAR ESTE SQL AHORA EN SUPABASE (copia y pega todo)
-- ============================================================================

-- FIX 1: has_feature_access
DROP FUNCTION IF EXISTS has_feature_access(UUID, TEXT);

CREATE OR REPLACE FUNCTION has_feature_access(
  p_store_id UUID,
  p_feature TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
  v_owner_id UUID;
  v_current_plan subscription_plan_type;
  v_has_access BOOLEAN;
BEGIN
  SELECT user_id INTO v_owner_id
  FROM user_stores
  WHERE store_id = p_store_id AND role = 'owner' AND is_active = true
  LIMIT 1;

  IF v_owner_id IS NULL THEN
    v_current_plan := 'free';
  ELSE
    SELECT COALESCE(s.plan, 'free'::subscription_plan_type) INTO v_current_plan
    FROM subscriptions s
    WHERE s.user_id = v_owner_id AND s.is_primary = true
    LIMIT 1;

    IF v_current_plan IS NULL THEN
      v_current_plan := 'free';
    END IF;
  END IF;

  EXECUTE format('SELECT %I FROM plan_limits WHERE plan = $1', 'has_' || p_feature)
  INTO v_has_access USING v_current_plan;

  RETURN COALESCE(v_has_access, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- FIX 2: get_store_usage
DROP FUNCTION IF EXISTS get_store_usage(UUID);

CREATE OR REPLACE FUNCTION get_store_usage(p_store_id UUID)
RETURNS TABLE(
  current_plan subscription_plan_type,
  max_orders_per_month INTEGER,
  max_products INTEGER,
  max_users INTEGER,
  total_orders_this_month INTEGER,
  total_products INTEGER,
  total_users INTEGER
) AS $$
DECLARE
  v_owner_id UUID;
  v_current_plan subscription_plan_type;
BEGIN
  SELECT user_id INTO v_owner_id
  FROM user_stores
  WHERE store_id = p_store_id AND role = 'owner' AND is_active = true
  LIMIT 1;

  IF v_owner_id IS NULL THEN
    v_current_plan := 'free';
  ELSE
    SELECT COALESCE(s.plan, 'free'::subscription_plan_type) INTO v_current_plan
    FROM subscriptions s
    WHERE s.user_id = v_owner_id AND s.is_primary = true
    LIMIT 1;

    IF v_current_plan IS NULL THEN
      v_current_plan := 'free';
    END IF;
  END IF;

  RETURN QUERY
  WITH limits AS (
    SELECT pl.max_orders_per_month, pl.max_products, pl.max_users
    FROM plan_limits pl WHERE pl.plan = v_current_plan
  ),
  usage AS (
    SELECT
      COUNT(DISTINCT o.id) FILTER (WHERE o.created_at >= date_trunc('month', CURRENT_DATE)) as orders_count,
      COUNT(DISTINCT p.id) as products_count,
      COUNT(DISTINCT us.user_id) as users_count
    FROM stores s
    LEFT JOIN orders o ON o.store_id = s.id
    LEFT JOIN products p ON p.store_id = s.id
    LEFT JOIN user_stores us ON us.store_id = s.id AND us.is_active = true
    WHERE s.id = p_store_id
  )
  SELECT v_current_plan, l.max_orders_per_month, l.max_products, l.max_users,
         COALESCE(u.orders_count::INTEGER, 0), COALESCE(u.products_count::INTEGER, 0), COALESCE(u.users_count::INTEGER, 0)
  FROM limits l, usage u;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Verificar
SELECT 'has_feature_access' as funcion, COUNT(*) as existe FROM pg_proc WHERE proname = 'has_feature_access' AND pronargs = 2
UNION ALL
SELECT 'get_store_usage', COUNT(*) FROM pg_proc WHERE proname = 'get_store_usage' AND pronargs = 1;

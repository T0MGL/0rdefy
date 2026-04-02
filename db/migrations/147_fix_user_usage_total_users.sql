-- Migration 146: Fix total_users count in get_user_usage
--
-- Bug: total_users subquery filtered by us.user_id = p_user_id AND us.role = 'owner',
-- which always returns 1 (the owner counting themselves).
-- Fix: count all active members across the owner's stores.

CREATE OR REPLACE FUNCTION get_user_usage(p_user_id UUID)
RETURNS TABLE(
  store_count BIGINT,
  total_users BIGINT,
  total_orders_this_month BIGINT,
  total_products BIGINT,
  max_stores INTEGER,
  max_users INTEGER,
  max_orders_per_month INTEGER,
  max_products INTEGER,
  plan TEXT,
  stores JSONB
) AS $$
DECLARE
  v_subscription RECORD;
  v_stores JSONB;
BEGIN
  SELECT * INTO v_subscription
  FROM get_user_subscription(p_user_id);

  IF v_subscription IS NULL THEN
    RETURN QUERY
    SELECT
      0::BIGINT as store_count,
      0::BIGINT as total_users,
      0::BIGINT as total_orders_this_month,
      0::BIGINT as total_products,
      pl.max_stores,
      pl.max_users,
      pl.max_orders_per_month,
      pl.max_products,
      pl.plan::TEXT,
      '[]'::JSONB as stores
    FROM plan_limits pl
    WHERE pl.plan = 'free';
    RETURN;
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'store_id', s.id,
      'store_name', s.name,
      'users_count', (
        SELECT COUNT(*)
        FROM user_stores us2
        WHERE us2.store_id = s.id AND us2.is_active = true
      ),
      'orders_count', (
        SELECT COUNT(*)
        FROM orders o
        WHERE o.store_id = s.id
          AND o.created_at >= date_trunc('month', CURRENT_TIMESTAMP)
      ),
      'products_count', (
        SELECT COUNT(*)
        FROM products p
        WHERE p.store_id = s.id
      )
    )
  ) INTO v_stores
  FROM stores s
  JOIN user_stores us ON us.store_id = s.id
  WHERE us.user_id = p_user_id
    AND us.role = 'owner'
    AND us.is_active = true;

  RETURN QUERY
  SELECT
    v_subscription.store_count,
    (
      -- Count all active members across all stores owned by this user
      SELECT COUNT(DISTINCT members.user_id)
      FROM user_stores owner_stores
      JOIN user_stores members ON members.store_id = owner_stores.store_id
        AND members.is_active = true
      WHERE owner_stores.user_id = p_user_id
        AND owner_stores.role = 'owner'
        AND owner_stores.is_active = true
    ) as total_users,
    (
      SELECT COUNT(*)
      FROM orders o
      JOIN user_stores us ON us.store_id = o.store_id
      WHERE us.user_id = p_user_id
        AND us.role = 'owner'
        AND us.is_active = true
        AND o.created_at >= date_trunc('month', CURRENT_TIMESTAMP)
    ) as total_orders_this_month,
    (
      SELECT COUNT(*)
      FROM products p
      JOIN user_stores us ON us.store_id = p.store_id
      WHERE us.user_id = p_user_id
        AND us.role = 'owner'
        AND us.is_active = true
    ) as total_products,
    v_subscription.max_stores,
    v_subscription.max_users,
    v_subscription.max_orders_per_month,
    v_subscription.max_products,
    v_subscription.plan,
    COALESCE(v_stores, '[]'::JSONB) as stores;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

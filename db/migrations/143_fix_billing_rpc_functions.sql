-- =============================================
-- Migration 143: Fix billing RPC functions
-- =============================================
-- Fixes two broken RPC functions in the billing system:
--
-- 1. get_user_usage: crashed with "structure of query does not match function result type"
--    when user had no subscription. Root cause: pl.plan (subscription_plan_type) returned
--    without cast to TEXT in the fallback branch.
--
-- 2. get_available_credits: crashed with "column used_amount_cents does not exist".
--    Root cause: function referenced a column that was never created. The table uses
--    is_used (boolean) + amount_cents, not a partial-credit model.
--
-- Impact: These errors fired on every billing page load and every Stripe webhook,
--         causing silent fallback to default values (free plan limits, 0 credits).
-- =============================================

-- Fix 1: get_user_usage - cast pl.plan::TEXT in fallback branch
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
        FROM user_stores us
        WHERE us.store_id = s.id AND us.is_active = true
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
      SELECT COUNT(DISTINCT us.user_id)
      FROM user_stores us
      JOIN stores s ON s.id = us.store_id
      WHERE us.user_id = p_user_id
        AND us.role = 'owner'
        AND us.is_active = true
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

-- Fix 2: get_available_credits - use is_used boolean instead of non-existent used_amount_cents
CREATE OR REPLACE FUNCTION get_available_credits(p_user_id UUID)
RETURNS INTEGER AS $$
BEGIN
  RETURN COALESCE(
    (SELECT SUM(amount_cents)::INTEGER
     FROM referral_credits
     WHERE user_id = p_user_id
       AND is_used = false
       AND (expires_at IS NULL OR expires_at > NOW())),
    0
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

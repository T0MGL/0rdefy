-- Migration 052: Migrate Subscriptions from Store-Level to User-Level
-- Description: Move subscription model from stores to users (owners)
-- This allows one subscription to cover multiple stores (up to plan limit)
-- Professional plan: $169/month → 3 stores (not $169 per store)

-- ============================================================================
-- PHASE 1: ADD NEW COLUMNS (Non-breaking changes)
-- ============================================================================

-- Add user_id column (nullable for now)
ALTER TABLE subscriptions
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;

-- Add is_primary flag (for future multi-subscription support)
ALTER TABLE subscriptions
ADD COLUMN IF NOT EXISTS is_primary BOOLEAN DEFAULT true;

-- ============================================================================
-- PHASE 2: MIGRATE DATA (Store → User)
-- ============================================================================

-- Migrate store_id → user_id (find owner of each store)
UPDATE subscriptions s
SET user_id = (
  SELECT us.user_id
  FROM user_stores us
  WHERE us.store_id = s.store_id
    AND us.role = 'owner'
    AND us.is_active = true
  ORDER BY us.created_at ASC  -- Take oldest owner if multiple
  LIMIT 1
)
WHERE user_id IS NULL;

-- Log orphaned subscriptions (stores without owner)
DO $$
DECLARE
  orphaned_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO orphaned_count
  FROM subscriptions
  WHERE user_id IS NULL;

  IF orphaned_count > 0 THEN
    RAISE NOTICE 'Found % orphaned subscriptions (stores without owner)', orphaned_count;
  END IF;
END $$;

-- Delete orphaned subscriptions (data cleanup)
DELETE FROM subscriptions WHERE user_id IS NULL;

-- ============================================================================
-- PHASE 3: CONSOLIDATE DUPLICATE SUBSCRIPTIONS
-- ============================================================================

-- If a user has multiple subscriptions (from multiple stores),
-- keep only the highest tier plan as primary
WITH ranked_subs AS (
  SELECT
    id,
    user_id,
    plan,
    status,
    stripe_subscription_id,
    created_at,
    ROW_NUMBER() OVER (
      PARTITION BY user_id
      ORDER BY
        -- Priority 1: Plan tier (highest first)
        CASE plan
          WHEN 'professional' THEN 4
          WHEN 'growth' THEN 3
          WHEN 'starter' THEN 2
          WHEN 'free' THEN 1
          ELSE 0
        END DESC,
        -- Priority 2: Status (active > trialing > others)
        CASE status
          WHEN 'active' THEN 3
          WHEN 'trialing' THEN 2
          ELSE 1
        END DESC,
        -- Priority 3: Newest subscription
        created_at DESC
    ) as rank
  FROM subscriptions
)
UPDATE subscriptions s
SET is_primary = (rs.rank = 1)
FROM ranked_subs rs
WHERE s.id = rs.id;

-- Log consolidation results
DO $$
DECLARE
  total_users INTEGER;
  total_subs INTEGER;
  duplicate_subs INTEGER;
BEGIN
  SELECT COUNT(DISTINCT user_id) INTO total_users FROM subscriptions;
  SELECT COUNT(*) INTO total_subs FROM subscriptions;
  SELECT COUNT(*) INTO duplicate_subs FROM subscriptions WHERE is_primary = false;

  RAISE NOTICE 'Subscription consolidation complete:';
  RAISE NOTICE '  Total users: %', total_users;
  RAISE NOTICE '  Total subscriptions: %', total_subs;
  RAISE NOTICE '  Duplicate subscriptions to remove: %', duplicate_subs;
END $$;

-- Archive duplicate subscriptions to history before deleting
-- Note: subscription_history has limited columns: subscription_id, store_id, event_type, from_plan, to_plan, metadata, created_at
INSERT INTO subscription_history (
  subscription_id,
  store_id,
  event_type,
  from_plan,
  metadata
)
SELECT
  s.id as subscription_id,
  s.store_id,
  'consolidated' as event_type,
  s.plan as from_plan,
  jsonb_build_object(
    'reason', 'Migration 052: Consolidated duplicate subscription (kept higher tier plan)',
    'original_plan', s.plan,
    'status', s.status,
    'created_at', s.created_at
  ) as metadata
FROM subscriptions s
WHERE s.is_primary = false;

-- Delete non-primary subscriptions
DELETE FROM subscriptions WHERE is_primary = false;

-- ============================================================================
-- PHASE 4: ADD CONSTRAINTS
-- ============================================================================

-- Make user_id NOT NULL
ALTER TABLE subscriptions
ALTER COLUMN user_id SET NOT NULL;

-- Add unique constraint (one primary subscription per user)
-- Note: PostgreSQL doesn't support WHERE in ALTER TABLE ADD CONSTRAINT
-- So we create a partial unique index for the business logic
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_user_id_primary_unique
ON subscriptions(user_id)
WHERE is_primary = true;

-- Also add a regular unique constraint for upsert operations
-- This allows Supabase upsert to work with onConflict: 'user_id,is_primary'
ALTER TABLE subscriptions
ADD CONSTRAINT unique_user_primary_subscription UNIQUE (user_id, is_primary);

-- ============================================================================
-- PHASE 5: NEW RPC FUNCTIONS
-- ============================================================================

-- Function: Get user's subscription (all stores covered by this subscription)
CREATE OR REPLACE FUNCTION get_user_subscription(p_user_id UUID)
RETURNS TABLE (
  subscription_id UUID,
  user_id UUID,
  plan TEXT,
  status TEXT,
  billing_cycle TEXT,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  trial_ends_at TIMESTAMPTZ,
  store_count BIGINT,
  max_stores INTEGER,
  max_users INTEGER,
  max_orders_per_month INTEGER,
  max_products INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.id as subscription_id,
    s.user_id,
    s.plan,
    s.status,
    s.billing_cycle,
    s.current_period_start,
    s.current_period_end,
    s.cancel_at_period_end,
    s.stripe_customer_id,
    s.stripe_subscription_id,
    s.trial_ends_at,
    (
      SELECT COUNT(*)
      FROM user_stores us
      WHERE us.user_id = p_user_id
        AND us.role = 'owner'
        AND us.is_active = true
    ) as store_count,
    pl.max_stores,
    pl.max_users,
    pl.max_orders_per_month,
    pl.max_products
  FROM subscriptions s
  JOIN plan_limits pl ON s.plan = pl.plan
  WHERE s.user_id = p_user_id
    AND s.is_primary = true
  LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Get store's plan via owner's subscription
CREATE OR REPLACE FUNCTION get_store_plan_via_owner(p_store_id UUID)
RETURNS TABLE (
  plan TEXT,
  status TEXT,
  max_users INTEGER,
  max_orders_per_month INTEGER,
  max_products INTEGER,
  max_stores INTEGER,
  max_integrations INTEGER,
  has_warehouse BOOLEAN,
  has_returns BOOLEAN,
  has_merchandise BOOLEAN,
  has_shipping_labels BOOLEAN,
  has_auto_inventory BOOLEAN,
  has_shopify_import BOOLEAN,
  has_shopify_bidirectional BOOLEAN,
  has_team_management BOOLEAN,
  has_advanced_team BOOLEAN,
  has_custom_roles BOOLEAN,
  has_smart_alerts BOOLEAN,
  has_campaign_tracking BOOLEAN,
  has_api_read BOOLEAN,
  has_api_write BOOLEAN,
  has_custom_webhooks BOOLEAN,
  analytics_history_days INTEGER,
  has_pdf_excel_reports BOOLEAN,
  price_monthly_cents INTEGER,
  price_annual_cents INTEGER,
  has_trial BOOLEAN,
  trial_days INTEGER
) AS $$
DECLARE
  v_owner_id UUID;
BEGIN
  -- Get store owner
  SELECT user_id INTO v_owner_id
  FROM user_stores
  WHERE store_id = p_store_id
    AND role = 'owner'
    AND is_active = true
  LIMIT 1;

  -- If no owner, return free plan
  IF v_owner_id IS NULL THEN
    RETURN QUERY
    SELECT * FROM plan_limits WHERE plan_limits.plan = 'free';
    RETURN;
  END IF;

  -- Get owner's subscription plan
  RETURN QUERY
  SELECT
    pl.plan,
    s.status,
    pl.max_users,
    pl.max_orders_per_month,
    pl.max_products,
    pl.max_stores,
    pl.max_integrations,
    pl.has_warehouse,
    pl.has_returns,
    pl.has_merchandise,
    pl.has_shipping_labels,
    pl.has_auto_inventory,
    pl.has_shopify_import,
    pl.has_shopify_bidirectional,
    pl.has_team_management,
    pl.has_advanced_team,
    pl.has_custom_roles,
    pl.has_smart_alerts,
    pl.has_campaign_tracking,
    pl.has_api_read,
    pl.has_api_write,
    pl.has_custom_webhooks,
    pl.analytics_history_days,
    pl.has_pdf_excel_reports,
    pl.price_monthly_cents,
    pl.price_annual_cents,
    pl.has_trial,
    pl.trial_days
  FROM subscriptions s
  JOIN plan_limits pl ON s.plan = pl.plan
  WHERE s.user_id = v_owner_id
    AND s.is_primary = true
    AND s.status IN ('active', 'trialing')
  LIMIT 1;

  -- If no active subscription, return free plan
  IF NOT FOUND THEN
    RETURN QUERY
    SELECT * FROM plan_limits WHERE plan_limits.plan = 'free';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Get user's aggregated usage across all stores
CREATE OR REPLACE FUNCTION get_user_usage(p_user_id UUID)
RETURNS TABLE (
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
  -- Get user's subscription
  SELECT * INTO v_subscription
  FROM get_user_subscription(p_user_id);

  -- If no subscription, return free plan limits with zero usage
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
      pl.plan,
      '[]'::JSONB as stores
    FROM plan_limits pl
    WHERE pl.plan = 'free';
    RETURN;
  END IF;

  -- Build stores array with per-store stats
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

  -- Return aggregated usage
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

-- Function: Check if user can create new store
CREATE OR REPLACE FUNCTION can_create_store(p_user_id UUID)
RETURNS TABLE (
  can_create BOOLEAN,
  current_stores BIGINT,
  max_stores INTEGER,
  plan TEXT,
  reason TEXT
) AS $$
DECLARE
  v_subscription RECORD;
  v_store_count BIGINT;
BEGIN
  -- Get user's subscription
  SELECT * INTO v_subscription
  FROM get_user_subscription(p_user_id);

  -- Count current stores
  SELECT COUNT(*) INTO v_store_count
  FROM user_stores us
  WHERE us.user_id = p_user_id
    AND us.role = 'owner'
    AND us.is_active = true;

  -- If no subscription, use free plan limits
  IF v_subscription IS NULL THEN
    RETURN QUERY
    SELECT
      (v_store_count < pl.max_stores) as can_create,
      v_store_count,
      pl.max_stores,
      pl.plan,
      CASE
        WHEN v_store_count < pl.max_stores THEN 'You can create a new store'
        ELSE 'Store limit reached for free plan. Upgrade to create more stores.'
      END as reason
    FROM plan_limits pl
    WHERE pl.plan = 'free';
    RETURN;
  END IF;

  -- Check against subscription limits
  RETURN QUERY
  SELECT
    (v_store_count < v_subscription.max_stores OR v_subscription.max_stores = -1) as can_create,
    v_store_count,
    v_subscription.max_stores,
    v_subscription.plan,
    CASE
      WHEN v_subscription.max_stores = -1 THEN 'You can create unlimited stores'
      WHEN v_store_count < v_subscription.max_stores THEN
        format('You can create %s more store(s)', v_subscription.max_stores - v_store_count)
      ELSE
        format('Store limit reached (%s/%s). Upgrade to create more stores.',
          v_store_count, v_subscription.max_stores)
    END as reason;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- PHASE 6: UPDATE EXISTING FUNCTIONS
-- ============================================================================

-- Update can_add_user_to_store to check owner's subscription instead of store's
CREATE OR REPLACE FUNCTION can_add_user_to_store(p_store_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_owner_id UUID;
  v_subscription RECORD;
  v_current_users INTEGER;
  v_pending_invites INTEGER;
BEGIN
  -- Get store owner
  SELECT user_id INTO v_owner_id
  FROM user_stores
  WHERE store_id = p_store_id
    AND role = 'owner'
    AND is_active = true
  LIMIT 1;

  IF v_owner_id IS NULL THEN
    RETURN false;  -- No owner found
  END IF;

  -- Get owner's subscription
  SELECT * INTO v_subscription
  FROM get_user_subscription(v_owner_id);

  -- If no subscription, use free plan (max 1 user)
  IF v_subscription IS NULL THEN
    SELECT COUNT(*) INTO v_current_users
    FROM user_stores
    WHERE store_id = p_store_id AND is_active = true;
    RETURN v_current_users < 1;
  END IF;

  -- Count current users in this store
  SELECT COUNT(*) INTO v_current_users
  FROM user_stores
  WHERE store_id = p_store_id AND is_active = true;

  -- Count pending invitations for this store
  SELECT COUNT(*) INTO v_pending_invites
  FROM collaborator_invitations
  WHERE store_id = p_store_id
    AND status = 'pending'
    AND expires_at > NOW();

  -- Check if under limit (or unlimited)
  IF v_subscription.max_users = -1 THEN
    RETURN true;  -- Unlimited users
  END IF;

  RETURN (v_current_users + v_pending_invites) < v_subscription.max_users;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- PHASE 7: DROP OLD CONSTRAINT (after data migration)
-- ============================================================================

-- Drop old store_id foreign key constraint
-- Note: We keep the column for now (will be removed in a future migration after full testing)
-- This allows rollback if needed
ALTER TABLE subscriptions
DROP CONSTRAINT IF EXISTS subscriptions_store_id_fkey;

-- Mark store_id column as deprecated (don't use it anymore)
COMMENT ON COLUMN subscriptions.store_id IS 'DEPRECATED: Use user_id instead. Will be removed in migration 053.';

-- ============================================================================
-- PHASE 8: INDEXES FOR PERFORMANCE
-- ============================================================================

-- Index on user_id for fast subscription lookups
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id
ON subscriptions(user_id) WHERE is_primary = true;

-- Index on user_id + status for active subscription queries
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id_status
ON subscriptions(user_id, status) WHERE is_primary = true;

-- ============================================================================
-- VERIFICATION & SUMMARY
-- ============================================================================

-- Verification query
DO $$
DECLARE
  v_total_users INTEGER;
  v_total_subs INTEGER;
  v_total_stores INTEGER;
  v_multi_store_users INTEGER;
BEGIN
  SELECT COUNT(DISTINCT user_id) INTO v_total_users FROM subscriptions;
  SELECT COUNT(*) INTO v_total_subs FROM subscriptions WHERE is_primary = true;
  SELECT COUNT(DISTINCT store_id) INTO v_total_stores FROM user_stores WHERE role = 'owner';

  SELECT COUNT(*) INTO v_multi_store_users
  FROM (
    SELECT user_id
    FROM user_stores
    WHERE role = 'owner' AND is_active = true
    GROUP BY user_id
    HAVING COUNT(*) > 1
  ) sub;

  RAISE NOTICE '========================================';
  RAISE NOTICE 'Migration 052 Complete!';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Total users with subscriptions: %', v_total_users;
  RAISE NOTICE 'Total primary subscriptions: %', v_total_subs;
  RAISE NOTICE 'Total stores with owners: %', v_total_stores;
  RAISE NOTICE 'Users with multiple stores: %', v_multi_store_users;
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Subscriptions are now USER-BASED';
  RAISE NOTICE 'One subscription covers all stores (up to plan limit)';
  RAISE NOTICE '========================================';
END $$;

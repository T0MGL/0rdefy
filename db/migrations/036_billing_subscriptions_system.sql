-- =============================================
-- Migration 036: Billing & Subscriptions System
-- Description: Complete billing system with Stripe integration,
--              subscription plans, trials, referrals, and discount codes
-- Author: Claude Code
-- Date: 2024-12-31
-- =============================================

-- =============================================
-- ENUMS
-- =============================================

-- Subscription plan types
DO $$ BEGIN
  CREATE TYPE subscription_plan_type AS ENUM ('free', 'starter', 'growth', 'professional');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Billing cycle
DO $$ BEGIN
  CREATE TYPE billing_cycle_type AS ENUM ('monthly', 'annual');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Subscription status
DO $$ BEGIN
  CREATE TYPE subscription_status_type AS ENUM (
    'active',
    'trialing',
    'past_due',
    'canceled',
    'unpaid',
    'incomplete',
    'incomplete_expired'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Discount code type
DO $$ BEGIN
  CREATE TYPE discount_code_type AS ENUM ('percentage', 'fixed', 'trial_extension');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- =============================================
-- PLAN LIMITS TABLE (Reference)
-- =============================================

CREATE TABLE IF NOT EXISTS plan_limits (
  plan subscription_plan_type PRIMARY KEY,
  max_users INTEGER NOT NULL,
  max_orders_per_month INTEGER NOT NULL,
  max_products INTEGER NOT NULL,
  max_stores INTEGER NOT NULL DEFAULT 1,
  max_integrations INTEGER NOT NULL DEFAULT 0,

  -- Features
  has_warehouse BOOLEAN NOT NULL DEFAULT false,
  has_returns BOOLEAN NOT NULL DEFAULT false,
  has_merchandise BOOLEAN NOT NULL DEFAULT false,
  has_shipping_labels BOOLEAN NOT NULL DEFAULT false,
  has_auto_inventory BOOLEAN NOT NULL DEFAULT false,
  has_shopify_import BOOLEAN NOT NULL DEFAULT false,
  has_shopify_bidirectional BOOLEAN NOT NULL DEFAULT false,
  has_team_management BOOLEAN NOT NULL DEFAULT false,
  has_advanced_team BOOLEAN NOT NULL DEFAULT false,
  has_custom_roles BOOLEAN NOT NULL DEFAULT false,
  has_smart_alerts BOOLEAN NOT NULL DEFAULT false,
  has_campaign_tracking BOOLEAN NOT NULL DEFAULT false,
  has_api_read BOOLEAN NOT NULL DEFAULT false,
  has_api_write BOOLEAN NOT NULL DEFAULT false,
  has_custom_webhooks BOOLEAN NOT NULL DEFAULT false,

  -- Analytics
  analytics_history_days INTEGER NOT NULL DEFAULT 7,
  has_pdf_excel_reports BOOLEAN NOT NULL DEFAULT false,

  -- Pricing (in cents for precision)
  price_monthly_cents INTEGER NOT NULL DEFAULT 0,
  price_annual_cents INTEGER NOT NULL DEFAULT 0,

  -- Trial
  has_trial BOOLEAN NOT NULL DEFAULT false,
  trial_days INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert plan limits
INSERT INTO plan_limits (
  plan, max_users, max_orders_per_month, max_products, max_stores, max_integrations,
  has_warehouse, has_returns, has_merchandise, has_shipping_labels, has_auto_inventory,
  has_shopify_import, has_shopify_bidirectional, has_team_management, has_advanced_team,
  has_custom_roles, has_smart_alerts, has_campaign_tracking, has_api_read, has_api_write,
  has_custom_webhooks, analytics_history_days, has_pdf_excel_reports,
  price_monthly_cents, price_annual_cents, has_trial, trial_days
) VALUES
  -- FREE: $0
  ('free', 1, 50, 100, 1, 0,
   false, false, false, false, false,
   false, false, false, false, false,
   false, false, false, false, false,
   7, false, 0, 0, false, 0),

  -- STARTER: $29/month, $288/year ($24/month)
  ('starter', 3, 500, 500, 1, 1,
   true, true, true, true, true,
   true, false, true, false, false,
   false, false, false, false, false,
   30, true, 2900, 28800, true, 14),

  -- GROWTH: $79/month, $792/year ($66/month)
  ('growth', 10, 2000, 2000, 1, 1,
   true, true, true, true, true,
   true, true, true, true, false,
   true, true, true, false, false,
   365, true, 7900, 79200, true, 14),

  -- PROFESSIONAL: $169/month, $1,704/year ($142/month)
  ('professional', 25, 10000, -1, 3, -1,
   true, true, true, true, true,
   true, true, true, true, true,
   true, true, true, true, true,
   -1, true, 16900, 170400, false, 0)

ON CONFLICT (plan) DO UPDATE SET
  max_users = EXCLUDED.max_users,
  max_orders_per_month = EXCLUDED.max_orders_per_month,
  max_products = EXCLUDED.max_products,
  max_stores = EXCLUDED.max_stores,
  max_integrations = EXCLUDED.max_integrations,
  has_warehouse = EXCLUDED.has_warehouse,
  has_returns = EXCLUDED.has_returns,
  has_merchandise = EXCLUDED.has_merchandise,
  has_shipping_labels = EXCLUDED.has_shipping_labels,
  has_auto_inventory = EXCLUDED.has_auto_inventory,
  has_shopify_import = EXCLUDED.has_shopify_import,
  has_shopify_bidirectional = EXCLUDED.has_shopify_bidirectional,
  has_team_management = EXCLUDED.has_team_management,
  has_advanced_team = EXCLUDED.has_advanced_team,
  has_custom_roles = EXCLUDED.has_custom_roles,
  has_smart_alerts = EXCLUDED.has_smart_alerts,
  has_campaign_tracking = EXCLUDED.has_campaign_tracking,
  has_api_read = EXCLUDED.has_api_read,
  has_api_write = EXCLUDED.has_api_write,
  has_custom_webhooks = EXCLUDED.has_custom_webhooks,
  analytics_history_days = EXCLUDED.analytics_history_days,
  has_pdf_excel_reports = EXCLUDED.has_pdf_excel_reports,
  price_monthly_cents = EXCLUDED.price_monthly_cents,
  price_annual_cents = EXCLUDED.price_annual_cents,
  has_trial = EXCLUDED.has_trial,
  trial_days = EXCLUDED.trial_days;

-- =============================================
-- SUBSCRIPTIONS TABLE
-- =============================================

CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,

  -- Plan info
  plan subscription_plan_type NOT NULL DEFAULT 'free',
  billing_cycle billing_cycle_type,
  status subscription_status_type NOT NULL DEFAULT 'active',

  -- Stripe references
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT UNIQUE,
  stripe_price_id TEXT,

  -- Trial period
  trial_started_at TIMESTAMPTZ,
  trial_ends_at TIMESTAMPTZ,

  -- Billing period
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,

  -- Cancellation
  cancel_at_period_end BOOLEAN DEFAULT false,
  canceled_at TIMESTAMPTZ,
  cancellation_reason TEXT,

  -- Applied discounts
  referral_code_used TEXT,
  discount_code_used TEXT,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT unique_store_subscription UNIQUE (store_id)
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_subscriptions_store ON subscriptions(store_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer ON subscriptions(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_subscription ON subscriptions(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

-- =============================================
-- SUBSCRIPTION HISTORY (Audit log)
-- =============================================

CREATE TABLE IF NOT EXISTS subscription_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID REFERENCES subscriptions(id) ON DELETE CASCADE,
  store_id UUID REFERENCES stores(id) ON DELETE CASCADE,

  event_type TEXT NOT NULL, -- 'created', 'upgraded', 'downgraded', 'canceled', 'reactivated', 'trial_started', 'trial_ended', 'payment_failed'
  from_plan subscription_plan_type,
  to_plan subscription_plan_type,

  stripe_event_id TEXT,
  metadata JSONB,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscription_history_subscription ON subscription_history(subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscription_history_store ON subscription_history(store_id);

-- =============================================
-- SUBSCRIPTION TRIALS
-- =============================================

CREATE TABLE IF NOT EXISTS subscription_trials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,

  plan_tried subscription_plan_type NOT NULL,
  trial_started_at TIMESTAMPTZ DEFAULT NOW(),
  trial_ends_at TIMESTAMPTZ NOT NULL,

  converted BOOLEAN DEFAULT false,
  converted_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- One trial per plan per user
  CONSTRAINT unique_user_plan_trial UNIQUE (user_id, plan_tried)
);

CREATE INDEX IF NOT EXISTS idx_trials_user ON subscription_trials(user_id);
CREATE INDEX IF NOT EXISTS idx_trials_store ON subscription_trials(store_id);

-- =============================================
-- REFERRAL CODES
-- =============================================

CREATE TABLE IF NOT EXISTS referral_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code TEXT UNIQUE NOT NULL,

  -- Stats
  total_signups INTEGER DEFAULT 0,
  total_conversions INTEGER DEFAULT 0,
  total_credits_earned_cents INTEGER DEFAULT 0,

  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referral_codes_user ON referral_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_referral_codes_code ON referral_codes(code);

-- Function to generate referral code
CREATE OR REPLACE FUNCTION generate_referral_code()
RETURNS TEXT AS $$
DECLARE
  new_code TEXT;
  code_exists BOOLEAN;
BEGIN
  LOOP
    -- Generate 6 character alphanumeric code
    new_code := UPPER(SUBSTRING(MD5(RANDOM()::TEXT || NOW()::TEXT) FROM 1 FOR 6));

    -- Check if exists
    SELECT EXISTS(SELECT 1 FROM referral_codes WHERE code = new_code) INTO code_exists;

    EXIT WHEN NOT code_exists;
  END LOOP;

  RETURN new_code;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- REFERRALS TRACKING
-- =============================================

CREATE TABLE IF NOT EXISTS referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who referred who
  referrer_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referred_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referral_code TEXT NOT NULL REFERENCES referral_codes(code),

  -- Timeline
  signed_up_at TIMESTAMPTZ DEFAULT NOW(),
  first_payment_at TIMESTAMPTZ,

  -- Rewards
  referrer_credit_applied BOOLEAN DEFAULT false,
  referrer_credit_applied_at TIMESTAMPTZ,
  referrer_credit_amount_cents INTEGER DEFAULT 1000, -- $10

  referred_discount_applied BOOLEAN DEFAULT false,
  referred_discount_percentage INTEGER DEFAULT 20, -- 20%

  -- Metadata
  referred_plan subscription_plan_type,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT unique_referral UNIQUE (referred_user_id)
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_user_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referred ON referrals(referred_user_id);
CREATE INDEX IF NOT EXISTS idx_referrals_code ON referrals(referral_code);

-- =============================================
-- REFERRAL CREDITS
-- =============================================

CREATE TABLE IF NOT EXISTS referral_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  amount_cents INTEGER NOT NULL,
  source_referral_id UUID REFERENCES referrals(id),

  -- Application
  applied_to_invoice TEXT, -- Stripe invoice ID
  applied_at TIMESTAMPTZ,

  -- Status
  is_used BOOLEAN DEFAULT false,
  expires_at TIMESTAMPTZ, -- Optional expiration

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referral_credits_user ON referral_credits(user_id);
CREATE INDEX IF NOT EXISTS idx_referral_credits_unused ON referral_credits(user_id) WHERE is_used = false;

-- =============================================
-- DISCOUNT CODES
-- =============================================

CREATE TABLE IF NOT EXISTS discount_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  code TEXT UNIQUE NOT NULL,
  type discount_code_type NOT NULL,
  value INTEGER NOT NULL, -- Percentage (20 = 20%) or cents ($10 = 1000)

  -- Validity
  valid_from TIMESTAMPTZ DEFAULT NOW(),
  valid_until TIMESTAMPTZ,
  max_uses INTEGER, -- NULL = unlimited
  current_uses INTEGER DEFAULT 0,

  -- Restrictions
  applicable_plans subscription_plan_type[], -- NULL = all plans
  first_payment_only BOOLEAN DEFAULT true,
  new_customers_only BOOLEAN DEFAULT false,
  min_plan subscription_plan_type, -- Minimum plan required

  -- Stripe reference
  stripe_coupon_id TEXT,
  stripe_promotion_code_id TEXT,

  -- Metadata
  description TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_discount_codes_code ON discount_codes(code);
CREATE INDEX IF NOT EXISTS idx_discount_codes_active ON discount_codes(is_active) WHERE is_active = true;

-- =============================================
-- DISCOUNT REDEMPTIONS
-- =============================================

CREATE TABLE IF NOT EXISTS discount_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  discount_code_id UUID REFERENCES discount_codes(id),
  user_id UUID REFERENCES users(id),
  store_id UUID REFERENCES stores(id),

  applied_at TIMESTAMPTZ DEFAULT NOW(),
  amount_discounted_cents INTEGER,

  stripe_subscription_id TEXT,
  stripe_invoice_id TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_discount_redemptions_code ON discount_redemptions(discount_code_id);
CREATE INDEX IF NOT EXISTS idx_discount_redemptions_user ON discount_redemptions(user_id);

-- =============================================
-- USAGE TRACKING
-- =============================================

CREATE TABLE IF NOT EXISTS usage_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,

  -- Period
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,

  -- Counts
  orders_count INTEGER DEFAULT 0,
  products_count INTEGER DEFAULT 0,
  users_count INTEGER DEFAULT 0,

  -- Warnings sent
  warning_80_sent BOOLEAN DEFAULT false,
  warning_90_sent BOOLEAN DEFAULT false,
  warning_100_sent BOOLEAN DEFAULT false,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT unique_store_period UNIQUE (store_id, period_start)
);

CREATE INDEX IF NOT EXISTS idx_usage_tracking_store ON usage_tracking(store_id);
CREATE INDEX IF NOT EXISTS idx_usage_tracking_period ON usage_tracking(period_start, period_end);

-- =============================================
-- STRIPE WEBHOOK EVENTS (for idempotency)
-- =============================================

CREATE TABLE IF NOT EXISTS stripe_billing_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  stripe_event_id TEXT UNIQUE NOT NULL,
  event_type TEXT NOT NULL,

  processed BOOLEAN DEFAULT false,
  processed_at TIMESTAMPTZ,

  payload JSONB,
  error TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stripe_billing_events_event_id ON stripe_billing_events(stripe_event_id);
CREATE INDEX IF NOT EXISTS idx_stripe_billing_events_type ON stripe_billing_events(event_type);

-- =============================================
-- FUNCTIONS
-- =============================================

-- Get available referral credits for a user
CREATE OR REPLACE FUNCTION get_available_credits(p_user_id UUID)
RETURNS INTEGER AS $$
DECLARE
  total_credits INTEGER;
BEGIN
  SELECT COALESCE(SUM(amount_cents), 0) INTO total_credits
  FROM referral_credits
  WHERE user_id = p_user_id
    AND is_used = false
    AND (expires_at IS NULL OR expires_at > NOW());

  RETURN total_credits;
END;
$$ LANGUAGE plpgsql;

-- Check if user can start trial for a plan
CREATE OR REPLACE FUNCTION can_start_trial(p_user_id UUID, p_plan subscription_plan_type)
RETURNS BOOLEAN AS $$
DECLARE
  has_tried BOOLEAN;
  plan_has_trial BOOLEAN;
BEGIN
  -- Check if plan offers trial
  SELECT has_trial INTO plan_has_trial
  FROM plan_limits
  WHERE plan = p_plan;

  IF NOT plan_has_trial THEN
    RETURN false;
  END IF;

  -- Check if user already tried this plan
  SELECT EXISTS(
    SELECT 1 FROM subscription_trials
    WHERE user_id = p_user_id AND plan_tried = p_plan
  ) INTO has_tried;

  RETURN NOT has_tried;
END;
$$ LANGUAGE plpgsql;

-- Get store's current usage
CREATE OR REPLACE FUNCTION get_store_usage(p_store_id UUID)
RETURNS TABLE (
  orders_this_month INTEGER,
  products_count INTEGER,
  users_count INTEGER,
  plan subscription_plan_type,
  max_orders INTEGER,
  max_products INTEGER,
  max_users INTEGER,
  orders_percentage INTEGER,
  products_percentage INTEGER,
  users_percentage INTEGER
) AS $$
BEGIN
  RETURN QUERY
  WITH current_usage AS (
    SELECT
      (SELECT COUNT(*) FROM orders WHERE store_id = p_store_id
       AND created_at >= date_trunc('month', CURRENT_DATE))::INTEGER as orders_count,
      (SELECT COUNT(*) FROM products WHERE store_id = p_store_id)::INTEGER as products_count,
      (SELECT COUNT(*) FROM user_stores WHERE store_id = p_store_id AND is_active = true)::INTEGER as users_count
  ),
  current_plan AS (
    SELECT COALESCE(s.plan, 'free'::subscription_plan_type) as plan
    FROM stores st
    LEFT JOIN subscriptions s ON s.store_id = st.id
    WHERE st.id = p_store_id
  )
  SELECT
    cu.orders_count,
    cu.products_count,
    cu.users_count,
    cp.plan,
    pl.max_orders_per_month,
    pl.max_products,
    pl.max_users,
    CASE WHEN pl.max_orders_per_month > 0
      THEN (cu.orders_count * 100 / pl.max_orders_per_month)
      ELSE 0 END,
    CASE WHEN pl.max_products > 0
      THEN (cu.products_count * 100 / pl.max_products)
      ELSE 0 END,
    CASE WHEN pl.max_users > 0
      THEN (cu.users_count * 100 / pl.max_users)
      ELSE 0 END
  FROM current_usage cu
  CROSS JOIN current_plan cp
  JOIN plan_limits pl ON pl.plan = cp.plan;
END;
$$ LANGUAGE plpgsql;

-- Check if store has access to a feature
CREATE OR REPLACE FUNCTION has_feature_access(p_store_id UUID, p_feature TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  has_access BOOLEAN;
  current_plan subscription_plan_type;
BEGIN
  -- Get current plan
  SELECT COALESCE(s.plan, 'free'::subscription_plan_type) INTO current_plan
  FROM stores st
  LEFT JOIN subscriptions s ON s.store_id = st.id AND s.status IN ('active', 'trialing')
  WHERE st.id = p_store_id;

  -- Check feature access based on plan
  EXECUTE format(
    'SELECT %I FROM plan_limits WHERE plan = $1',
    'has_' || p_feature
  ) INTO has_access USING current_plan;

  RETURN COALESCE(has_access, false);
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- TRIGGERS
-- =============================================

-- Auto-update subscription updated_at
CREATE OR REPLACE FUNCTION update_subscription_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_subscription_timestamp ON subscriptions;
CREATE TRIGGER trigger_update_subscription_timestamp
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION update_subscription_timestamp();

-- Log subscription changes
CREATE OR REPLACE FUNCTION log_subscription_change()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO subscription_history (subscription_id, store_id, event_type, to_plan)
    VALUES (NEW.id, NEW.store_id, 'created', NEW.plan);
  ELSIF TG_OP = 'UPDATE' THEN
    -- Plan change
    IF OLD.plan != NEW.plan THEN
      INSERT INTO subscription_history (subscription_id, store_id, event_type, from_plan, to_plan)
      VALUES (NEW.id, NEW.store_id,
        CASE WHEN NEW.plan > OLD.plan THEN 'upgraded' ELSE 'downgraded' END,
        OLD.plan, NEW.plan);
    END IF;

    -- Cancellation
    IF OLD.canceled_at IS NULL AND NEW.canceled_at IS NOT NULL THEN
      INSERT INTO subscription_history (subscription_id, store_id, event_type, from_plan)
      VALUES (NEW.id, NEW.store_id, 'canceled', NEW.plan);
    END IF;

    -- Trial started
    IF OLD.status != 'trialing' AND NEW.status = 'trialing' THEN
      INSERT INTO subscription_history (subscription_id, store_id, event_type, to_plan)
      VALUES (NEW.id, NEW.store_id, 'trial_started', NEW.plan);
    END IF;

    -- Trial ended (converted)
    IF OLD.status = 'trialing' AND NEW.status = 'active' THEN
      INSERT INTO subscription_history (subscription_id, store_id, event_type, to_plan)
      VALUES (NEW.id, NEW.store_id, 'trial_converted', NEW.plan);
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_log_subscription_change ON subscriptions;
CREATE TRIGGER trigger_log_subscription_change
  AFTER INSERT OR UPDATE ON subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION log_subscription_change();

-- Update referral code stats
CREATE OR REPLACE FUNCTION update_referral_stats()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- New signup
    UPDATE referral_codes
    SET total_signups = total_signups + 1
    WHERE code = NEW.referral_code;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Conversion (first payment)
    IF OLD.first_payment_at IS NULL AND NEW.first_payment_at IS NOT NULL THEN
      UPDATE referral_codes
      SET
        total_conversions = total_conversions + 1,
        total_credits_earned_cents = total_credits_earned_cents + NEW.referrer_credit_amount_cents
      WHERE code = NEW.referral_code;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_referral_stats ON referrals;
CREATE TRIGGER trigger_update_referral_stats
  AFTER INSERT OR UPDATE ON referrals
  FOR EACH ROW
  EXECUTE FUNCTION update_referral_stats();

-- =============================================
-- DEFAULT SUBSCRIPTIONS FOR EXISTING STORES
-- =============================================

-- Create free subscription for any store that doesn't have one
INSERT INTO subscriptions (store_id, plan, status)
SELECT id, 'free', 'active'
FROM stores
WHERE id NOT IN (SELECT store_id FROM subscriptions)
ON CONFLICT (store_id) DO NOTHING;

-- =============================================
-- GRANT PERMISSIONS
-- =============================================

-- Grant necessary permissions (adjust based on your setup)
-- GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO authenticated;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

COMMENT ON TABLE subscriptions IS 'Store subscription information linked to Stripe';
COMMENT ON TABLE plan_limits IS 'Feature limits and pricing for each subscription plan';
COMMENT ON TABLE referral_codes IS 'Unique referral codes for users to share';
COMMENT ON TABLE referrals IS 'Tracking of referral signups and conversions';
COMMENT ON TABLE referral_credits IS 'Credits earned from successful referrals';
COMMENT ON TABLE discount_codes IS 'Promotional discount codes';
COMMENT ON TABLE usage_tracking IS 'Monthly usage tracking for limit enforcement';

-- ============================================================================
-- MIGRATION 137: Enable RLS on all remaining tables
-- Date: 2026-03-25
--
-- Tables covered: 14 tables that were missing RLS
-- Access patterns:
--   store_id tables: USING (store_id IN (SELECT store_id FROM user_stores ...))
--   user_id tables: USING (user_id = auth.uid())
--   read-all: system reference tables (plan_limits, discount_codes)
--   no policy (service_role only): stripe_billing_events, shopify_webhook_idempotency,
--     external_webhook_logs, external_webhook_idempotency, webhook_queue
-- Backend uses service_role (bypasses RLS). Frontend uses authenticated.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. BILLING: store_id based
-- ============================================================================

-- plan_limits: system reference table, no store_id. Everyone can read.
ALTER TABLE plan_limits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "plan_limits_read_all" ON plan_limits;
CREATE POLICY "plan_limits_read_all" ON plan_limits FOR SELECT
USING (true);

-- subscription_trials (has store_id)
ALTER TABLE subscription_trials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "subscription_trials_store_access" ON subscription_trials;
CREATE POLICY "subscription_trials_store_access" ON subscription_trials FOR ALL
USING (store_id IN (SELECT store_id FROM user_stores WHERE user_id = auth.uid()))
WITH CHECK (store_id IN (SELECT store_id FROM user_stores WHERE user_id = auth.uid()));

-- stripe_billing_events (no store_id, Stripe webhook data, service_role only)
ALTER TABLE stripe_billing_events ENABLE ROW LEVEL SECURITY;

-- discount_codes (global, no store_id, everyone can read)
ALTER TABLE discount_codes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "discount_codes_read_all" ON discount_codes;
CREATE POLICY "discount_codes_read_all" ON discount_codes FOR SELECT
USING (true);

-- discount_redemptions (has store_id)
ALTER TABLE discount_redemptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "discount_redemptions_store_access" ON discount_redemptions;
CREATE POLICY "discount_redemptions_store_access" ON discount_redemptions FOR ALL
USING (store_id IN (SELECT store_id FROM user_stores WHERE user_id = auth.uid()))
WITH CHECK (store_id IN (SELECT store_id FROM user_stores WHERE user_id = auth.uid()));

-- ============================================================================
-- 2. BILLING: user_id based (no store_id)
-- referral_codes, referrals, referral_credits are per-user, not per-store
-- ============================================================================

-- referral_codes (has user_id, no store_id)
ALTER TABLE referral_codes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "referral_codes_own_user" ON referral_codes;
CREATE POLICY "referral_codes_own_user" ON referral_codes FOR ALL
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- referrals (has referrer_user_id and referred_user_id, no store_id)
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "referrals_own_user" ON referrals;
CREATE POLICY "referrals_own_user" ON referrals FOR SELECT
USING (referrer_user_id = auth.uid() OR referred_user_id = auth.uid());

-- referral_credits (has user_id, no store_id)
ALTER TABLE referral_credits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "referral_credits_own_user" ON referral_credits;
CREATE POLICY "referral_credits_own_user" ON referral_credits FOR SELECT
USING (user_id = auth.uid());

-- ============================================================================
-- 3. SHOPIFY: store_id based (only tables that exist)
-- ============================================================================

-- shopify_webhook_retry_queue (has store_id)
ALTER TABLE shopify_webhook_retry_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "shopify_webhook_retry_queue_store_access" ON shopify_webhook_retry_queue;
CREATE POLICY "shopify_webhook_retry_queue_store_access" ON shopify_webhook_retry_queue FOR ALL
USING (store_id IN (SELECT store_id FROM user_stores WHERE user_id = auth.uid()))
WITH CHECK (store_id IN (SELECT store_id FROM user_stores WHERE user_id = auth.uid()));

-- shopify_webhook_metrics (has store_id)
ALTER TABLE shopify_webhook_metrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "shopify_webhook_metrics_store_access" ON shopify_webhook_metrics;
CREATE POLICY "shopify_webhook_metrics_store_access" ON shopify_webhook_metrics FOR SELECT
USING (store_id IN (SELECT store_id FROM user_stores WHERE user_id = auth.uid()));

-- ============================================================================
-- 5. SYSTEM/INFRASTRUCTURE (no store_id, backend only)
-- RLS enabled, no policies. Only service_role can access.
-- ============================================================================

ALTER TABLE shopify_webhook_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_webhook_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_webhook_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_queue ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '============================================';
  RAISE NOTICE '  MIGRATION 137 - VERIFICATION';
  RAISE NOTICE '============================================';
  RAISE NOTICE 'RLS enabled on 14 tables:';
  RAISE NOTICE '  store_id: subscription_trials, discount_redemptions,';
  RAISE NOTICE '            shopify_webhook_retry_queue, shopify_webhook_metrics';
  RAISE NOTICE '  user_id:  referral_codes, referrals, referral_credits';
  RAISE NOTICE '  read-all: plan_limits, discount_codes';
  RAISE NOTICE '  no policy (service_role only): stripe_billing_events,';
  RAISE NOTICE '            shopify_webhook_idempotency, external_webhook_logs,';
  RAISE NOTICE '            external_webhook_idempotency, webhook_queue';
  RAISE NOTICE '============================================';
END $$;

COMMIT;

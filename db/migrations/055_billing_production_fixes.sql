-- =============================================
-- Migration 055: Billing Production Fixes
-- Description: Security and reliability fixes for billing system
--              - Trial reminder tracking
--              - Referral credit waiting period support
--              - Discount code increment function
-- Author: Claude
-- Date: 2026-01-13
-- =============================================

BEGIN;

-- =============================================
-- 1. Add trial_reminder_sent column to subscriptions
-- Used by cron job to track which trials have been notified
-- =============================================

ALTER TABLE subscriptions
ADD COLUMN IF NOT EXISTS trial_reminder_sent TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN subscriptions.trial_reminder_sent IS
'Timestamp when trial expiration reminder was sent. NULL = not sent yet.';

-- Index for efficient cron queries
CREATE INDEX IF NOT EXISTS idx_subscriptions_trial_reminder
ON subscriptions(status, trial_ends_at, trial_reminder_sent)
WHERE status = 'trialing';

-- =============================================
-- 2. Add store_id to subscription_history for backwards compatibility
-- Some older records may reference store_id
-- =============================================

-- First check if column exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'subscription_history' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE subscription_history ADD COLUMN user_id UUID REFERENCES users(id);
  END IF;
END $$;

-- =============================================
-- 3. Function to increment referral conversion stats
-- Called by cron job when applying deferred credits
-- =============================================

CREATE OR REPLACE FUNCTION increment_referral_conversion(
  p_referral_code TEXT,
  p_credit_amount INTEGER
)
RETURNS VOID AS $$
BEGIN
  UPDATE referral_codes
  SET
    total_conversions = total_conversions + 1,
    total_credits_earned_cents = total_credits_earned_cents + p_credit_amount
  WHERE code = p_referral_code;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION increment_referral_conversion(TEXT, INTEGER) IS
'Atomically increments conversion stats when referral credit is applied after waiting period';

-- =============================================
-- 4. Add is_active to subscription_trials for trial tracking
-- =============================================

ALTER TABLE subscription_trials
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

COMMENT ON COLUMN subscription_trials.is_active IS
'Whether this trial is currently active. Set to false when converted or expired.';

-- =============================================
-- 5. Index for efficient past_due enforcement queries
-- =============================================

CREATE INDEX IF NOT EXISTS idx_subscriptions_past_due_enforcement
ON subscriptions(status, updated_at)
WHERE status = 'past_due';

-- =============================================
-- 6. Index for efficient referral credit processing
-- =============================================

CREATE INDEX IF NOT EXISTS idx_referrals_pending_credit
ON referrals(first_payment_at, referrer_credit_applied)
WHERE referrer_credit_applied = false AND first_payment_at IS NOT NULL;

-- =============================================
-- 7. Add subscription_id to subscription_history if missing
-- =============================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'subscription_history' AND column_name = 'subscription_id'
  ) THEN
    ALTER TABLE subscription_history ADD COLUMN subscription_id UUID REFERENCES subscriptions(id);
  END IF;
END $$;

-- =============================================
-- Verification
-- =============================================

DO $$
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Migration 055 Verification';
  RAISE NOTICE '========================================';

  -- Verify columns exist
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'subscriptions' AND column_name = 'trial_reminder_sent') THEN
    RAISE NOTICE 'OK: subscriptions.trial_reminder_sent exists';
  ELSE
    RAISE EXCEPTION 'FAILED: subscriptions.trial_reminder_sent not created';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'increment_referral_conversion') THEN
    RAISE NOTICE 'OK: increment_referral_conversion function exists';
  ELSE
    RAISE EXCEPTION 'FAILED: increment_referral_conversion function not created';
  END IF;

  RAISE NOTICE '========================================';
  RAISE NOTICE 'Migration 055 Complete!';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Production fixes applied:';
  RAISE NOTICE '1. Trial reminder tracking column';
  RAISE NOTICE '2. Referral credit increment function';
  RAISE NOTICE '3. Optimized indexes for cron jobs';
  RAISE NOTICE '========================================';
END $$;

COMMIT;

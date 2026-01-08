-- =============================================
-- Migration 037: Fix Referral Tracking System
-- Description: Proper tracking of referrals with trial phases
-- Author: Bright Idea
-- Date: 2026-01-06
-- =============================================

-- =============================================
-- 1. ADD TRIAL TRACKING TO REFERRALS TABLE
-- =============================================

-- Add trial_started_at field to track when user actually starts using the product
ALTER TABLE referrals
ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ;

COMMENT ON COLUMN referrals.trial_started_at IS 'When the referred user started their trial (checkout completed)';

-- =============================================
-- 2. DROP OLD TRIGGER (incorrect logic)
-- =============================================

DROP TRIGGER IF EXISTS trigger_update_referral_stats ON referrals;

-- =============================================
-- 3. CREATE NEW TRIGGER WITH CORRECT LOGIC
-- =============================================

CREATE OR REPLACE FUNCTION update_referral_stats()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- New referral record created (signup)
    -- Don't increment total_signups yet - wait for trial to start
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    -- Trial started (checkout completed)
    IF OLD.trial_started_at IS NULL AND NEW.trial_started_at IS NOT NULL THEN
      UPDATE referral_codes
      SET total_signups = total_signups + 1
      WHERE code = NEW.referral_code;

      RAISE NOTICE 'Referral trial started: % for code %', NEW.referred_user_id, NEW.referral_code;
    END IF;

    -- Conversion (first payment)
    IF OLD.first_payment_at IS NULL AND NEW.first_payment_at IS NOT NULL THEN
      UPDATE referral_codes
      SET
        total_conversions = total_conversions + 1,
        total_credits_earned_cents = total_credits_earned_cents + NEW.referrer_credit_amount_cents
      WHERE code = NEW.referral_code;

      RAISE NOTICE 'Referral converted: % for code %', NEW.referred_user_id, NEW.referral_code;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recreate trigger
CREATE TRIGGER trigger_update_referral_stats
  AFTER INSERT OR UPDATE ON referrals
  FOR EACH ROW
  EXECUTE FUNCTION update_referral_stats();

-- =============================================
-- 4. RESET INCORRECT STATS (OPTIONAL - Comment out if you want to keep existing data)
-- =============================================

-- Reset all counters to 0 and recalculate from actual data
-- Uncomment the following lines if you want to reset stats:

/*
UPDATE referral_codes
SET
  total_signups = 0,
  total_conversions = 0,
  total_credits_earned_cents = 0;

-- Recalculate signups (only those who started trial)
UPDATE referral_codes rc
SET total_signups = (
  SELECT COUNT(*)
  FROM referrals r
  WHERE r.referral_code = rc.code
    AND r.trial_started_at IS NOT NULL
);

-- Recalculate conversions (only those who paid)
UPDATE referral_codes rc
SET total_conversions = (
  SELECT COUNT(*)
  FROM referrals r
  WHERE r.referral_code = rc.code
    AND r.first_payment_at IS NOT NULL
);

-- Recalculate credits earned
UPDATE referral_codes rc
SET total_credits_earned_cents = (
  SELECT COALESCE(SUM(r.referrer_credit_amount_cents), 0)
  FROM referrals r
  WHERE r.referral_code = rc.code
    AND r.referrer_credit_applied = true
);
*/

-- =============================================
-- 5. CREATE HELPER VIEW FOR REFERRAL ANALYTICS
-- =============================================

CREATE OR REPLACE VIEW referral_funnel_analytics AS
SELECT
  rc.code,
  rc.user_id as referrer_user_id,
  u.name as referrer_name,
  u.email as referrer_email,

  -- Funnel metrics
  COUNT(r.id) FILTER (WHERE r.signed_up_at IS NOT NULL) as total_registered,
  COUNT(r.id) FILTER (WHERE r.trial_started_at IS NOT NULL) as total_trials_started,
  COUNT(r.id) FILTER (WHERE r.first_payment_at IS NOT NULL) as total_paid,

  -- Conversion rates
  CASE
    WHEN COUNT(r.id) FILTER (WHERE r.signed_up_at IS NOT NULL) > 0
    THEN ROUND(
      (COUNT(r.id) FILTER (WHERE r.trial_started_at IS NOT NULL)::numeric /
       COUNT(r.id) FILTER (WHERE r.signed_up_at IS NOT NULL)::numeric) * 100,
      2
    )
    ELSE 0
  END as signup_to_trial_rate,

  CASE
    WHEN COUNT(r.id) FILTER (WHERE r.trial_started_at IS NOT NULL) > 0
    THEN ROUND(
      (COUNT(r.id) FILTER (WHERE r.first_payment_at IS NOT NULL)::numeric /
       COUNT(r.id) FILTER (WHERE r.trial_started_at IS NOT NULL)::numeric) * 100,
      2
    )
    ELSE 0
  END as trial_to_paid_rate,

  -- Credits
  rc.total_credits_earned_cents / 100.0 as total_credits_earned_usd,

  -- Status
  rc.is_active,
  rc.created_at as code_created_at

FROM referral_codes rc
JOIN users u ON u.id = rc.user_id
LEFT JOIN referrals r ON r.referral_code = rc.code
GROUP BY rc.code, rc.user_id, u.name, u.email, rc.total_credits_earned_cents, rc.is_active, rc.created_at;

COMMENT ON VIEW referral_funnel_analytics IS 'Analytics view showing referral funnel conversion rates';

-- =============================================
-- 6. CREATE FUNCTION TO GET REFERRAL FUNNEL FOR USER
-- =============================================

CREATE OR REPLACE FUNCTION get_referral_funnel(p_user_id UUID)
RETURNS TABLE (
  code TEXT,
  total_registered BIGINT,
  total_trials_started BIGINT,
  total_paid BIGINT,
  signup_to_trial_rate NUMERIC,
  trial_to_paid_rate NUMERIC,
  total_credits_earned_usd NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    rfa.code,
    rfa.total_registered,
    rfa.total_trials_started,
    rfa.total_paid,
    rfa.signup_to_trial_rate,
    rfa.trial_to_paid_rate,
    rfa.total_credits_earned_usd
  FROM referral_funnel_analytics rfa
  WHERE rfa.referrer_user_id = p_user_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_referral_funnel IS 'Get referral funnel analytics for a specific user';

-- =============================================
-- VERIFICATION QUERIES
-- =============================================

-- Check if migration applied successfully
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'referrals'
    AND column_name = 'trial_started_at'
  ) THEN
    RAISE NOTICE '✅ Migration 037 applied successfully';
    RAISE NOTICE 'New column: referrals.trial_started_at';
    RAISE NOTICE 'New view: referral_funnel_analytics';
    RAISE NOTICE 'New function: get_referral_funnel(uuid)';
  ELSE
    RAISE WARNING '❌ Migration 037 may have failed';
  END IF;
END $$;

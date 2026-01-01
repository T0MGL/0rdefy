-- =============================================
-- Migration 036 ESSENTIAL: Billing Tables for Referrals
-- Run this in Supabase SQL Editor
-- =============================================

-- REFERRAL CODES TABLE
CREATE TABLE IF NOT EXISTS referral_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code TEXT UNIQUE NOT NULL,
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
    new_code := UPPER(SUBSTRING(MD5(RANDOM()::TEXT || NOW()::TEXT) FROM 1 FOR 6));
    SELECT EXISTS(SELECT 1 FROM referral_codes WHERE code = new_code) INTO code_exists;
    EXIT WHEN NOT code_exists;
  END LOOP;
  RETURN new_code;
END;
$$ LANGUAGE plpgsql;

-- REFERRALS TRACKING TABLE
CREATE TABLE IF NOT EXISTS referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referred_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referral_code TEXT NOT NULL,
  signed_up_at TIMESTAMPTZ DEFAULT NOW(),
  first_payment_at TIMESTAMPTZ,
  referrer_credit_applied BOOLEAN DEFAULT false,
  referrer_credit_applied_at TIMESTAMPTZ,
  referrer_credit_amount_cents INTEGER DEFAULT 1000,
  referred_discount_applied BOOLEAN DEFAULT false,
  referred_discount_percentage INTEGER DEFAULT 20,
  referred_plan TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_referral UNIQUE (referred_user_id)
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_user_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referred ON referrals(referred_user_id);
CREATE INDEX IF NOT EXISTS idx_referrals_code ON referrals(referral_code);

-- REFERRAL CREDITS TABLE
CREATE TABLE IF NOT EXISTS referral_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referral_id UUID REFERENCES referrals(id),
  amount_cents INTEGER NOT NULL,
  used_amount_cents INTEGER DEFAULT 0,
  stripe_applied BOOLEAN DEFAULT false,
  stripe_applied_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credits_user ON referral_credits(user_id);

-- Function to get available credits
CREATE OR REPLACE FUNCTION get_available_credits(p_user_id UUID)
RETURNS INTEGER AS $$
BEGIN
  RETURN COALESCE(
    (SELECT SUM(amount_cents - used_amount_cents)
     FROM referral_credits
     WHERE user_id = p_user_id
       AND (expires_at IS NULL OR expires_at > NOW())
       AND amount_cents > used_amount_cents),
    0
  );
END;
$$ LANGUAGE plpgsql;

-- SUBSCRIPTION TRIALS TABLE (if not exists)
CREATE TABLE IF NOT EXISTS subscription_trials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  plan_tried TEXT NOT NULL,
  trial_started_at TIMESTAMPTZ DEFAULT NOW(),
  trial_ends_at TIMESTAMPTZ,
  converted BOOLEAN DEFAULT false,
  converted_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_user_plan_trial UNIQUE (user_id, plan_tried)
);

CREATE INDEX IF NOT EXISTS idx_trials_user ON subscription_trials(user_id);
CREATE INDEX IF NOT EXISTS idx_trials_store ON subscription_trials(store_id);

-- STRIPE BILLING EVENTS TABLE (for webhook idempotency)
CREATE TABLE IF NOT EXISTS stripe_billing_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id TEXT UNIQUE NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB,
  processed BOOLEAN DEFAULT false,
  processed_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stripe_events_id ON stripe_billing_events(stripe_event_id);

-- Trigger to update referral stats
CREATE OR REPLACE FUNCTION update_referral_stats()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE referral_codes
    SET total_signups = total_signups + 1
    WHERE code = NEW.referral_code;
  ELSIF TG_OP = 'UPDATE' THEN
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
FOR EACH ROW EXECUTE FUNCTION update_referral_stats();

-- Done!
SELECT 'Migration 036 Essential applied successfully!' as status;

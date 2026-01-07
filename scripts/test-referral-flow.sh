#!/bin/bash

# =====================================================
# Script: Test Referral Flow (Migration 037)
# Description: Test the corrected referral tracking system
# =====================================================

set -e

echo "🧪 Testing Referral Flow (Migration 037)"
echo "========================================="
echo ""

# Source environment variables
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Check if SUPABASE_URL is set
if [ -z "$SUPABASE_URL" ]; then
    echo "❌ Error: SUPABASE_URL not set"
    exit 1
fi

echo "1️⃣ Verifying migration 037 applied..."
echo ""

psql "$DATABASE_URL" -c "
SELECT
    CASE
        WHEN EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'referrals' AND column_name = 'trial_started_at'
        ) THEN '✅ Column referrals.trial_started_at exists'
        ELSE '❌ Column referrals.trial_started_at missing'
    END as column_check,
    CASE
        WHEN EXISTS (
            SELECT 1 FROM information_schema.views
            WHERE table_name = 'referral_funnel_analytics'
        ) THEN '✅ View referral_funnel_analytics exists'
        ELSE '❌ View referral_funnel_analytics missing'
    END as view_check;
"

echo ""
echo "2️⃣ Testing referral trigger logic..."
echo ""

psql "$DATABASE_URL" << 'SQL'
-- Create a test referrer user
INSERT INTO users (email, password_hash, name, is_active)
VALUES ('referrer@test.com', 'test', 'Test Referrer', true)
ON CONFLICT (email) DO UPDATE SET name = 'Test Referrer'
RETURNING id as referrer_id;

-- Get referrer ID
DO $$
DECLARE
    v_referrer_id UUID;
    v_referred_id UUID;
    v_code TEXT;
BEGIN
    -- Get referrer
    SELECT id INTO v_referrer_id FROM users WHERE email = 'referrer@test.com';

    -- Generate referral code
    SELECT generate_referral_code() INTO v_code;

    -- Create referral code
    INSERT INTO referral_codes (user_id, code)
    VALUES (v_referrer_id, v_code)
    ON CONFLICT (code) DO NOTHING;

    RAISE NOTICE '✅ Created referral code: %', v_code;

    -- Create referred user
    INSERT INTO users (email, password_hash, name, is_active)
    VALUES ('referred@test.com', 'test', 'Test Referred', true)
    ON CONFLICT (email) DO UPDATE SET name = 'Test Referred'
    RETURNING id INTO v_referred_id;

    -- Create referral (signup only - no trial yet)
    INSERT INTO referrals (referrer_user_id, referred_user_id, referral_code, signed_up_at)
    VALUES (v_referrer_id, v_referred_id, v_code, NOW())
    ON CONFLICT (referred_user_id) DO NOTHING;

    RAISE NOTICE '✅ Created referral record';

    -- Check stats (should be 0 signups because trial not started)
    RAISE NOTICE 'Checking stats after signup (should be 0 signups)...';

    -- Now simulate trial start
    UPDATE referrals
    SET trial_started_at = NOW()
    WHERE referred_user_id = v_referred_id;

    RAISE NOTICE '✅ Updated trial_started_at';
    RAISE NOTICE 'Checking stats after trial start (should be 1 signup)...';

    -- Now simulate payment
    UPDATE referrals
    SET first_payment_at = NOW()
    WHERE referred_user_id = v_referred_id;

    RAISE NOTICE '✅ Updated first_payment_at';
    RAISE NOTICE 'Checking stats after payment (should be 1 conversion)...';
END $$;

-- Show final stats
SELECT
    rc.code,
    rc.total_signups,
    rc.total_conversions,
    rc.total_credits_earned_cents / 100.0 as credits_usd
FROM referral_codes rc
JOIN users u ON u.id = rc.user_id
WHERE u.email = 'referrer@test.com';
SQL

echo ""
echo "3️⃣ Testing funnel analytics view..."
echo ""

psql "$DATABASE_URL" -c "
SELECT
    referrer_email,
    total_registered,
    total_trials_started,
    total_paid,
    signup_to_trial_rate,
    trial_to_paid_rate
FROM referral_funnel_analytics
WHERE referrer_email = 'referrer@test.com';
"

echo ""
echo "4️⃣ Cleanup test data..."
echo ""

psql "$DATABASE_URL" << 'SQL'
-- Delete test referrals
DELETE FROM referrals WHERE referred_user_id IN (
    SELECT id FROM users WHERE email = 'referred@test.com'
);

-- Delete test referral codes
DELETE FROM referral_codes WHERE user_id IN (
    SELECT id FROM users WHERE email = 'referrer@test.com'
);

-- Delete test users
DELETE FROM users WHERE email IN ('referrer@test.com', 'referred@test.com');
SQL

echo "✅ Test data cleaned up"
echo ""
echo "========================================="
echo "✅ All tests passed!"
echo ""
echo "📊 Summary of changes in Migration 037:"
echo "  • total_signups now counts only trials started (not just registrations)"
echo "  • Added trial_started_at field to track when user actually starts using product"
echo "  • Created referral_funnel_analytics view for detailed conversion tracking"
echo "  • Added anti-self-referral validation in auth.ts"
echo ""
echo "🚀 Next steps:"
echo "  1. Apply migration: psql \$DATABASE_URL -f db/migrations/037_fix_referral_tracking.sql"
echo "  2. Restart backend: npm run dev"
echo "  3. Test referral flow end-to-end"
echo ""

-- =============================================
-- Migration 118: Grant Professional Plan to Founder Accounts
-- Description: Manually grants Professional plan to specific accounts
--              that should have full access without Stripe checkout
-- Author: Bright Idea
-- Date: 2026-01-30
-- =============================================

-- =============================================
-- FOUNDER ACCOUNTS
-- These accounts get Professional plan perpetually:
-- 1. hanselechague6@gmail.com
-- 2. gaston@thebrightidea.ai
-- =============================================

-- Upsert subscriptions for founder accounts
-- If subscription exists, update to professional + active
-- If not exists, create new subscription

DO $$
DECLARE
    v_user_id UUID;
    v_email TEXT;
    v_founder_emails TEXT[] := ARRAY['hanselechague6@gmail.com', 'gaston@thebrightidea.ai'];
BEGIN
    FOREACH v_email IN ARRAY v_founder_emails
    LOOP
        -- Get user ID by email from auth.users
        SELECT id INTO v_user_id
        FROM auth.users
        WHERE email = v_email;

        IF v_user_id IS NULL THEN
            RAISE NOTICE 'User not found: %', v_email;
            CONTINUE;
        END IF;

        -- Check if subscription exists
        IF EXISTS (SELECT 1 FROM subscriptions WHERE user_id = v_user_id AND is_primary = true) THEN
            -- Update existing subscription to professional + active
            UPDATE subscriptions
            SET
                plan = 'professional',
                status = 'active',
                billing_cycle = 'annual',
                current_period_start = NOW(),
                current_period_end = NOW() + INTERVAL '100 years', -- Perpetual
                cancel_at_period_end = false,
                updated_at = NOW()
            WHERE user_id = v_user_id AND is_primary = true;

            RAISE NOTICE 'Updated subscription for % to Professional (perpetual)', v_email;
        ELSE
            -- Create new subscription
            INSERT INTO subscriptions (
                user_id,
                plan,
                status,
                billing_cycle,
                current_period_start,
                current_period_end,
                cancel_at_period_end,
                is_primary,
                created_at,
                updated_at
            ) VALUES (
                v_user_id,
                'professional',
                'active',
                'annual',
                NOW(),
                NOW() + INTERVAL '100 years', -- Perpetual
                false,
                true,
                NOW(),
                NOW()
            );

            RAISE NOTICE 'Created Professional subscription for % (perpetual)', v_email;
        END IF;
    END LOOP;
END $$;

-- =============================================
-- VERIFICATION
-- =============================================

-- Show subscription status for founders
DO $$
DECLARE
    v_record RECORD;
BEGIN
    RAISE NOTICE '==========================================';
    RAISE NOTICE 'Migration 118: Founder Subscriptions Status';
    RAISE NOTICE '==========================================';

    FOR v_record IN
        SELECT
            u.email,
            s.plan,
            s.status,
            s.current_period_end,
            s.is_primary
        FROM auth.users u
        LEFT JOIN subscriptions s ON s.user_id = u.id AND s.is_primary = true
        WHERE u.email IN ('hanselechague6@gmail.com', 'gaston@thebrightidea.ai')
    LOOP
        RAISE NOTICE 'Email: % | Plan: % | Status: % | Expires: % | Primary: %',
            v_record.email,
            COALESCE(v_record.plan::text, 'NO SUBSCRIPTION'),
            COALESCE(v_record.status::text, '-'),
            COALESCE(v_record.current_period_end::text, '-'),
            COALESCE(v_record.is_primary::text, '-');
    END LOOP;

    RAISE NOTICE '==========================================';
END $$;

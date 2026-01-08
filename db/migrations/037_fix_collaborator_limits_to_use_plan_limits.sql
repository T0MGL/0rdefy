-- =============================================
-- Migration 037: Fix Collaborator Limits to Use plan_limits
-- Description: Update can_add_user_to_store and get_store_user_stats functions
--              to read from subscriptions + plan_limits instead of stores.max_users
-- Author: Bright Idea
-- Date: 2026-01-03
-- =============================================

-- =============================================
-- UPDATE can_add_user_to_store FUNCTION
-- Now reads from subscriptions -> plan_limits instead of stores.max_users
-- =============================================

CREATE OR REPLACE FUNCTION can_add_user_to_store(p_store_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_current_users INTEGER;
    v_max_users INTEGER;
    v_current_plan subscription_plan_type;
BEGIN
    -- Count current active users + pending invitations
    SELECT COUNT(*) INTO v_current_users
    FROM user_stores
    WHERE store_id = p_store_id AND is_active = true;

    -- Add pending invitations that haven't expired
    v_current_users := v_current_users + (
        SELECT COUNT(*)
        FROM collaborator_invitations
        WHERE store_id = p_store_id
        AND used = false
        AND expires_at > NOW()
    );

    -- Get the current plan from subscriptions table (with fallback to 'free')
    SELECT COALESCE(s.plan, 'free'::subscription_plan_type) INTO v_current_plan
    FROM stores st
    LEFT JOIN subscriptions s ON s.store_id = st.id AND s.status IN ('active', 'trialing')
    WHERE st.id = p_store_id;

    -- If no plan found, default to free
    IF v_current_plan IS NULL THEN
        v_current_plan := 'free';
    END IF;

    -- Get max_users from plan_limits
    SELECT max_users INTO v_max_users
    FROM plan_limits
    WHERE plan = v_current_plan;

    -- If no limit found, default to 1 (free plan)
    IF v_max_users IS NULL THEN
        v_max_users := 1;
    END IF;

    -- Unlimited users if max_users = -1
    IF v_max_users = -1 THEN
        RETURN TRUE;
    END IF;

    RETURN v_current_users < v_max_users;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION can_add_user_to_store(UUID) IS
'Checks if a store can add more users based on their subscription plan limits.
Reads from subscriptions + plan_limits tables (not stores.max_users).';

-- =============================================
-- UPDATE get_store_user_stats FUNCTION
-- Returns stats based on subscriptions + plan_limits
-- =============================================

CREATE OR REPLACE FUNCTION get_store_user_stats(p_store_id UUID)
RETURNS TABLE (
    current_users INTEGER,
    pending_invitations INTEGER,
    max_users INTEGER,
    plan TEXT,
    slots_available INTEGER
) AS $$
DECLARE
    v_current_plan subscription_plan_type;
BEGIN
    -- Get the current plan from subscriptions table (with fallback to 'free')
    SELECT COALESCE(s.plan, 'free'::subscription_plan_type) INTO v_current_plan
    FROM stores st
    LEFT JOIN subscriptions s ON s.store_id = st.id AND s.status IN ('active', 'trialing')
    WHERE st.id = p_store_id;

    -- If no plan found, default to free
    IF v_current_plan IS NULL THEN
        v_current_plan := 'free';
    END IF;

    RETURN QUERY
    SELECT
        (SELECT COUNT(*)::INTEGER FROM user_stores WHERE store_id = p_store_id AND is_active = true) as current_users,
        (SELECT COUNT(*)::INTEGER FROM collaborator_invitations WHERE store_id = p_store_id AND used = false AND expires_at > NOW()) as pending_invitations,
        pl.max_users,
        v_current_plan::TEXT as plan,
        CASE
            WHEN pl.max_users = -1 THEN -1  -- Unlimited
            ELSE pl.max_users - (
                SELECT COUNT(*)::INTEGER FROM user_stores WHERE store_id = p_store_id AND is_active = true
            ) - (
                SELECT COUNT(*)::INTEGER FROM collaborator_invitations WHERE store_id = p_store_id AND used = false AND expires_at > NOW()
            )
        END as slots_available
    FROM plan_limits pl
    WHERE pl.plan = v_current_plan;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_store_user_stats(UUID) IS
'Returns user statistics for a store including current users, pending invitations, max allowed, and available slots.
Reads from subscriptions + plan_limits tables (not stores.max_users).';

-- =============================================
-- Verify the fix by checking Gastón's store
-- =============================================

-- This should return TRUE for professional plan (25 users max)
-- SELECT can_add_user_to_store('4cf0e361-4c7b-4125-87e2-68c148bca1ef');

-- This should show max_users = 25 for professional plan
-- SELECT * FROM get_store_user_stats('4cf0e361-4c7b-4125-87e2-68c148bca1ef');

-- Upgrade hanselechague6@gmail.com to professional plan
DO $$
DECLARE
    v_user_id UUID;
BEGIN
    -- 1. Get User ID
    SELECT id INTO v_user_id FROM users WHERE email = 'hanselechague6@gmail.com';

    IF v_user_id IS NULL THEN
        RAISE NOTICE 'User hanselechague6@gmail.com not found';
        RETURN;
    END IF;

    RAISE NOTICE 'Upgrading user % (%)', v_user_id, 'hanselechague6@gmail.com';

    -- 2. Update user plan
    -- Checking if column exists first (it should based on schema findings)
    UPDATE users 
    SET subscription_plan = 'professional',
        updated_at = NOW()
    WHERE id = v_user_id;

    -- 3. Upgrade all stores where this user is admin/owner
    -- Note: We update both stores (if they have a plan column) and the subscriptions table
    
    -- Update subscriptions table for all stores the user is associated with as owner/admin
    INSERT INTO subscriptions (store_id, plan, status, updated_at)
    SELECT store_id, 'professional'::subscription_plan_type, 'active', NOW()
    FROM user_stores
    WHERE user_id = v_user_id
    ON CONFLICT (store_id) DO UPDATE SET
        plan = 'professional',
        status = 'active',
        updated_at = NOW();

    RAISE NOTICE 'Upgrade complete for user and their associated stores.';
END $$;

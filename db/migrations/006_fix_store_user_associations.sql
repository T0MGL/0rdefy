-- ================================================================
-- NEONFLOW - FIX STORE-USER ASSOCIATIONS
-- ================================================================
-- This migration diagnoses and fixes any orphaned stores or users
-- without proper associations in user_stores table
-- ================================================================

-- ================================================================
-- DIAGNOSTIC QUERIES (Run these first to see the problem)
-- ================================================================

-- Check for stores without any associated users
SELECT s.id, s.name, s.created_at
FROM stores s
LEFT JOIN user_stores us ON s.id = us.store_id
WHERE us.id IS NULL;

-- Check for users without any associated stores
SELECT u.id, u.email, u.name, u.created_at
FROM users u
LEFT JOIN user_stores us ON u.id = us.user_id
WHERE us.id IS NULL;

-- Check total counts
SELECT
    (SELECT COUNT(*) FROM users) as total_users,
    (SELECT COUNT(*) FROM stores) as total_stores,
    (SELECT COUNT(*) FROM user_stores) as total_associations;

-- ================================================================
-- FIX: Associate orphaned stores to their creators
-- ================================================================
-- Strategy: Match stores to users created around the same time
-- This assumes stores were created during user registration
-- ================================================================

-- Create associations for orphaned stores (match by creation time)
INSERT INTO user_stores (user_id, store_id, role, created_at)
SELECT
    u.id as user_id,
    s.id as store_id,
    'owner' as role,
    NOW() as created_at
FROM stores s
LEFT JOIN user_stores us ON s.id = us.store_id
INNER JOIN users u ON ABS(EXTRACT(EPOCH FROM (s.created_at - u.created_at))) < 5  -- Within 5 seconds
WHERE us.id IS NULL
ON CONFLICT (user_id, store_id) DO NOTHING;

-- ================================================================
-- FIX: Create default stores for users without stores
-- ================================================================
-- If a user has no store, create one for them
-- ================================================================

DO $$
DECLARE
    orphan_user RECORD;
    new_store_id UUID;
BEGIN
    FOR orphan_user IN (
        SELECT u.id, u.name, u.email
        FROM users u
        LEFT JOIN user_stores us ON u.id = us.user_id
        WHERE us.id IS NULL
    )
    LOOP
        -- Create a new store for this user
        INSERT INTO stores (name, country, timezone, currency, is_active)
        VALUES (
            orphan_user.name || '''s Store',
            'PY',
            'America/Asuncion',
            'USD',
            TRUE
        )
        RETURNING id INTO new_store_id;

        -- Link user to new store
        INSERT INTO user_stores (user_id, store_id, role)
        VALUES (orphan_user.id, new_store_id, 'owner');

        RAISE NOTICE 'Created store % for user %', new_store_id, orphan_user.email;
    END LOOP;
END $$;

-- ================================================================
-- VALIDATION QUERIES (Run after fixes)
-- ================================================================

-- Verify all users have at least one store
SELECT
    u.id,
    u.email,
    u.name,
    COUNT(us.store_id) as store_count
FROM users u
LEFT JOIN user_stores us ON u.id = us.user_id
GROUP BY u.id, u.email, u.name
HAVING COUNT(us.store_id) = 0;

-- Should return 0 rows if all users have stores

-- Verify all stores have at least one user
SELECT
    s.id,
    s.name,
    COUNT(us.user_id) as user_count
FROM stores s
LEFT JOIN user_stores us ON s.id = us.store_id
GROUP BY s.id, s.name
HAVING COUNT(us.user_id) = 0;

-- Should return 0 rows if all stores have users

-- Final summary
SELECT
    'Users' as entity,
    COUNT(*) as total,
    (SELECT COUNT(DISTINCT user_id) FROM user_stores) as with_associations
FROM users
UNION ALL
SELECT
    'Stores' as entity,
    COUNT(*) as total,
    (SELECT COUNT(DISTINCT store_id) FROM user_stores) as with_associations
FROM stores;

-- ================================================================
-- MIGRATION COMPLETE
-- ================================================================
-- All users should now have at least one store
-- All stores should now have at least one user
-- ================================================================

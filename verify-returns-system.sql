-- ================================================================
-- VERIFY RETURNS SYSTEM MIGRATION
-- ================================================================
-- Run these queries in Supabase SQL Editor to verify the migration
-- ================================================================

-- 1. Check if tables exist
SELECT
    table_name,
    table_type
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name LIKE 'return_%'
ORDER BY table_name;

-- Expected results:
-- return_session_items    | BASE TABLE
-- return_session_orders   | BASE TABLE
-- return_sessions         | BASE TABLE

-- 2. Check table structures
SELECT
    table_name,
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
AND table_name IN ('return_sessions', 'return_session_orders', 'return_session_items')
ORDER BY table_name, ordinal_position;

-- 3. Check if functions exist
SELECT
    routine_name,
    routine_type,
    data_type as return_type
FROM information_schema.routines
WHERE routine_schema = 'public'
AND routine_name IN ('generate_return_session_code', 'complete_return_session')
ORDER BY routine_name;

-- Expected results:
-- complete_return_session        | FUNCTION | json
-- generate_return_session_code   | FUNCTION | character varying

-- 4. Check indexes
SELECT
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE schemaname = 'public'
AND tablename LIKE 'return_%'
ORDER BY tablename, indexname;

-- 5. Check if 'returned' status was added to order_status enum
SELECT
    e.enumlabel as status_value
FROM pg_type t
JOIN pg_enum e ON t.oid = e.enumtypid
WHERE t.typname = 'order_status'
ORDER BY e.enumlabel;

-- Should include: 'returned' in the list

-- 6. Check permissions
SELECT
    grantee,
    table_name,
    privilege_type
FROM information_schema.table_privileges
WHERE table_schema = 'public'
AND table_name IN ('return_sessions', 'return_session_orders', 'return_session_items')
AND grantee IN ('postgres', 'authenticated', 'anon')
ORDER BY table_name, grantee, privilege_type;

-- 7. Test function - Generate a session code (dry run)
-- Replace 'YOUR_STORE_ID_HERE' with an actual store_id from your stores table
-- SELECT generate_return_session_code('YOUR_STORE_ID_HERE');

-- Expected result: RET-04122025-01 (format: RET-DDMMYYYY-NN)

-- ================================================================
-- ✅ VERIFICATION COMPLETE
-- ================================================================
-- If all queries return expected results, the migration was successful!
-- ================================================================

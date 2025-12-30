-- ================================================================
-- SCRIPT DE VERIFICACIÓN DE MIGRACIÓN
-- ================================================================
-- Ejecuta este script para verificar que todas las tablas,
-- funciones, triggers y views se crearon correctamente
-- ================================================================

-- ================================================================
-- 1. VERIFICAR TABLAS (Deberían ser 43 tablas)
-- ================================================================
SELECT
    'TABLAS CREADAS' as verificacion,
    COUNT(*) as cantidad,
    CASE
        WHEN COUNT(*) >= 43 THEN '✅ OK'
        ELSE '❌ FALTAN TABLAS'
    END as estado
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE';

-- Lista de tablas
SELECT
    table_name,
    pg_size_pretty(pg_total_relation_size(quote_ident(table_name)::regclass)) as tamaño
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
ORDER BY table_name;

-- ================================================================
-- 2. VERIFICAR FUNCIONES (Deberían ser 35+)
-- ================================================================
SELECT
    'FUNCIONES CREADAS' as verificacion,
    COUNT(*) as cantidad,
    CASE
        WHEN COUNT(*) >= 30 THEN '✅ OK'
        ELSE '❌ FALTAN FUNCIONES'
    END as estado
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_type = 'FUNCTION'
  AND routine_name NOT LIKE 'pg_%';

-- Lista de funciones
SELECT
    routine_name,
    routine_type,
    data_type as return_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_type = 'FUNCTION'
  AND routine_name NOT LIKE 'pg_%'
ORDER BY routine_name;

-- ================================================================
-- 3. VERIFICAR TRIGGERS (Deberían ser 30+)
-- ================================================================
SELECT
    'TRIGGERS CREADOS' as verificacion,
    COUNT(DISTINCT trigger_name) as cantidad,
    CASE
        WHEN COUNT(DISTINCT trigger_name) >= 30 THEN '✅ OK'
        ELSE '❌ FALTAN TRIGGERS'
    END as estado
FROM information_schema.triggers
WHERE trigger_schema = 'public';

-- Lista de triggers
SELECT
    event_object_table as tabla,
    trigger_name,
    event_manipulation as evento,
    action_timing as timing
FROM information_schema.triggers
WHERE trigger_schema = 'public'
ORDER BY event_object_table, trigger_name;

-- ================================================================
-- 4. VERIFICAR VIEWS (Deberían ser 6)
-- ================================================================
SELECT
    'VIEWS CREADAS' as verificacion,
    COUNT(*) as cantidad,
    CASE
        WHEN COUNT(*) >= 6 THEN '✅ OK'
        ELSE '❌ FALTAN VIEWS'
    END as estado
FROM information_schema.views
WHERE table_schema = 'public';

-- Lista de views
SELECT
    table_name as view_name
FROM information_schema.views
WHERE table_schema = 'public'
ORDER BY table_name;

-- ================================================================
-- 5. VERIFICAR EXTENSIONES
-- ================================================================
SELECT
    extname as extension,
    extversion as version,
    '✅ OK' as estado
FROM pg_extension
WHERE extname IN ('uuid-ossp', 'pgcrypto')
ORDER BY extname;

-- ================================================================
-- 6. VERIFICAR ENUMS
-- ================================================================
SELECT
    t.typname as enum_name,
    array_agg(e.enumlabel ORDER BY e.enumsortorder) as valores,
    '✅ OK' as estado
FROM pg_type t
JOIN pg_enum e ON t.oid = e.enumtypid
WHERE t.typname = 'order_status'
GROUP BY t.typname;

-- ================================================================
-- 7. VERIFICAR ÍNDICES IMPORTANTES
-- ================================================================
SELECT
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('orders', 'products', 'customers', 'order_line_items')
ORDER BY tablename, indexname;

-- ================================================================
-- 8. VERIFICAR ROW LEVEL SECURITY (RLS)
-- ================================================================
SELECT
    tablename,
    CASE
        WHEN rowsecurity THEN '✅ RLS HABILITADO'
        ELSE '⚠️  RLS DESHABILITADO'
    END as rls_status
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('stores', 'users', 'products', 'orders', 'customers')
ORDER BY tablename;

-- ================================================================
-- 9. VERIFICAR FOREIGN KEYS CRÍTICAS
-- ================================================================
SELECT
    tc.table_name,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name,
    '✅ OK' as estado
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
  AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
  AND tc.table_name IN ('orders', 'order_line_items', 'picking_sessions', 'return_sessions')
ORDER BY tc.table_name, kcu.column_name;

-- ================================================================
-- 10. VERIFICAR TABLAS CRÍTICAS PARA EL SISTEMA
-- ================================================================
SELECT
    'stores' as tabla_critica,
    COUNT(*) as registros_existentes,
    CASE
        WHEN COUNT(*) > 0 THEN '✅ TIENE DATOS'
        ELSE '⚠️  SIN DATOS (normal en nueva DB)'
    END as estado
FROM stores
UNION ALL
SELECT
    'users' as tabla_critica,
    COUNT(*) as registros_existentes,
    CASE
        WHEN COUNT(*) > 0 THEN '✅ TIENE DATOS'
        ELSE '⚠️  SIN DATOS (normal en nueva DB)'
    END as estado
FROM users
UNION ALL
SELECT
    'products' as tabla_critica,
    COUNT(*) as registros_existentes,
    CASE
        WHEN COUNT(*) > 0 THEN '✅ TIENE DATOS'
        ELSE '⚠️  SIN DATOS (normal en nueva DB)'
    END as estado
FROM products
UNION ALL
SELECT
    'orders' as tabla_critica,
    COUNT(*) as registros_existentes,
    CASE
        WHEN COUNT(*) > 0 THEN '✅ TIENE DATOS'
        ELSE '⚠️  SIN DATOS (normal en nueva DB)'
    END as estado
FROM orders;

-- ================================================================
-- RESUMEN FINAL
-- ================================================================
SELECT
    '========================================' as resumen,
    'VERIFICACIÓN COMPLETADA' as estado,
    '========================================' as detalle;

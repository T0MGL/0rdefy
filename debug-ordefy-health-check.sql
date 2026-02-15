-- ================================================================
-- ORDEFY COMPREHENSIVE HEALTH CHECK & DEBUG SCRIPT
-- Ejecutar en base de datos de producción para detectar inconsistencias
-- ================================================================

-- Set store_id para la tienda de NOCTE
-- NOTA: Reemplazar con el UUID real de la tienda
\set store_id '\'STORE_UUID_AQUI\''

\echo '========================================='
\echo 'ORDEFY HEALTH CHECK - NOCTE'
\echo 'Started at: ' :current_timestamp
\echo '========================================='
\echo ''

-- ================================================================
-- 1. INVENTORY & STOCK TRACKING INTEGRITY
-- ================================================================
\echo '1. CHECKING INVENTORY INTEGRITY...'
\echo '-----------------------------------'

-- 1.1 Productos con stock negativo (ERROR CRÍTICO)
\echo '1.1 Productos con stock negativo:'
SELECT
    p.id,
    p.name,
    p.sku,
    p.stock,
    p.updated_at
FROM products p
WHERE p.store_id = :store_id
  AND p.stock < 0
ORDER BY p.stock ASC;

-- 1.2 Discrepancias en inventory_movements vs stock actual
\echo ''
\echo '1.2 Discrepancias entre inventory_movements y stock actual:'
SELECT
    p.id AS product_id,
    p.name AS product_name,
    p.stock AS current_stock,
    COALESCE(SUM(im.quantity_change), 0) AS total_movements,
    p.stock - COALESCE(SUM(im.quantity_change), 0) AS discrepancy
FROM products p
LEFT JOIN inventory_movements im ON im.product_id = p.id
WHERE p.store_id = :store_id
GROUP BY p.id, p.name, p.stock
HAVING p.stock - COALESCE(SUM(im.quantity_change), 0) != 0
ORDER BY ABS(p.stock - COALESCE(SUM(im.quantity_change), 0)) DESC;

-- 1.3 Órdenes que deberían haber deducido stock pero no lo hicieron
\echo ''
\echo '1.3 Órdenes en ready_to_ship/shipped/delivered sin deducción de stock:'
SELECT
    o.id,
    o.order_number,
    o.shopify_order_name,
    o.sleeves_status,
    o.updated_at,
    COUNT(DISTINCT im.id) AS inventory_movements_count
FROM orders o
LEFT JOIN inventory_movements im ON im.order_id = o.id AND im.movement_type = 'order_deduction'
WHERE o.store_id = :store_id
  AND o.sleeves_status IN ('ready_to_ship', 'shipped', 'delivered', 'in_transit')
  AND im.id IS NULL
GROUP BY o.id, o.order_number, o.shopify_order_name, o.sleeves_status, o.updated_at
ORDER BY o.updated_at DESC
LIMIT 20;

-- 1.4 Movimientos de inventario duplicados para la misma orden
\echo ''
\echo '1.4 Movimientos de inventario duplicados (posible double-deduction):'
SELECT
    im.order_id,
    im.product_id,
    p.name AS product_name,
    im.movement_type,
    COUNT(*) AS movement_count,
    SUM(im.quantity_change) AS total_quantity_change
FROM inventory_movements im
JOIN products p ON p.id = im.product_id
WHERE im.store_id = :store_id
  AND im.movement_type IN ('order_deduction', 'order_restoration')
GROUP BY im.order_id, im.product_id, p.name, im.movement_type
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC;

-- ================================================================
-- 2. ORDER STATUS & TRANSITION INTEGRITY
-- ================================================================
\echo ''
\echo '2. CHECKING ORDER STATUS INTEGRITY...'
\echo '--------------------------------------'

-- 2.1 Órdenes en estados inválidos o inconsistentes
\echo '2.1 Órdenes con estados problemáticos:'
SELECT
    o.id,
    o.order_number,
    o.shopify_order_name,
    o.sleeves_status,
    o.created_at,
    o.updated_at,
    o.courier_id,
    o.is_pickup,
    CASE
        WHEN o.sleeves_status IN ('shipped', 'delivered') AND o.courier_id IS NULL AND o.is_pickup = FALSE
            THEN 'Enviado sin transportadora'
        WHEN o.sleeves_status = 'in_preparation' AND NOT EXISTS (
            SELECT 1 FROM picking_session_orders pso
            JOIN picking_sessions ps ON ps.id = pso.session_id
            WHERE pso.order_id = o.id AND ps.status IN ('in_progress', 'picking', 'packing')
        )
            THEN 'En preparación pero sin sesión de picking activa'
        WHEN o.sleeves_status = 'pending' AND o.created_at < NOW() - INTERVAL '30 days'
            THEN 'Pendiente por más de 30 días'
        ELSE 'Otro problema'
    END AS issue
FROM orders o
WHERE o.store_id = :store_id
  AND (
    (o.sleeves_status IN ('shipped', 'delivered') AND o.courier_id IS NULL AND o.is_pickup = FALSE)
    OR (o.sleeves_status = 'in_preparation' AND NOT EXISTS (
        SELECT 1 FROM picking_session_orders pso
        JOIN picking_sessions ps ON ps.id = pso.session_id
        WHERE pso.order_id = o.id AND ps.status IN ('in_progress', 'picking', 'packing')
    ))
    OR (o.sleeves_status = 'pending' AND o.created_at < NOW() - INTERVAL '30 days')
  )
ORDER BY o.created_at DESC
LIMIT 20;

-- 2.2 Órdenes con transiciones de estado sospechosas
\echo ''
\echo '2.2 Transiciones de estado anormales (saltos de estado):'
WITH status_transitions AS (
    SELECT
        osh.order_id,
        o.order_number,
        o.shopify_order_name,
        osh.from_status,
        osh.to_status,
        osh.changed_at,
        LAG(osh.to_status) OVER (PARTITION BY osh.order_id ORDER BY osh.changed_at) AS previous_status
    FROM order_status_history osh
    JOIN orders o ON o.id = osh.order_id
    WHERE o.store_id = :store_id
)
SELECT *
FROM status_transitions
WHERE
    -- Detectar saltos inválidos (e.g., pending → shipped sin pasar por confirmed)
    (from_status = 'pending' AND to_status IN ('ready_to_ship', 'shipped', 'delivered'))
    OR (from_status = 'confirmed' AND to_status IN ('shipped', 'delivered'))
    OR (to_status IN ('pending', 'confirmed') AND from_status IN ('shipped', 'delivered'))
ORDER BY changed_at DESC
LIMIT 20;

-- ================================================================
-- 3. WAREHOUSE & PICKING SESSIONS INTEGRITY
-- ================================================================
\echo ''
\echo '3. CHECKING WAREHOUSE INTEGRITY...'
\echo '-----------------------------------'

-- 3.1 Sesiones de picking "huérfanas" o estancadas
\echo '3.1 Sesiones de picking con problemas:'
SELECT
    ps.id,
    ps.session_code,
    ps.status,
    ps.created_at,
    ps.last_activity_at,
    ps.abandoned_at,
    NOW() - ps.last_activity_at AS time_since_activity,
    COUNT(DISTINCT pso.order_id) AS orders_count,
    CASE
        WHEN ps.status IN ('in_progress', 'picking', 'packing') AND ps.last_activity_at < NOW() - INTERVAL '48 hours'
            THEN 'CRITICAL: Sesión estancada > 48h'
        WHEN ps.status IN ('in_progress', 'picking', 'packing') AND ps.last_activity_at < NOW() - INTERVAL '24 hours'
            THEN 'WARNING: Sesión estancada > 24h'
        WHEN ps.status = 'completed' AND ps.abandoned_at IS NOT NULL
            THEN 'Completada pero con abandoned_at'
        ELSE 'Otro problema'
    END AS issue
FROM picking_sessions ps
LEFT JOIN picking_session_orders pso ON pso.session_id = ps.id
WHERE ps.store_id = :store_id
  AND (
    (ps.status IN ('in_progress', 'picking', 'packing') AND ps.last_activity_at < NOW() - INTERVAL '24 hours')
    OR (ps.status = 'completed' AND ps.abandoned_at IS NOT NULL)
  )
GROUP BY ps.id, ps.session_code, ps.status, ps.created_at, ps.last_activity_at, ps.abandoned_at
ORDER BY ps.last_activity_at ASC;

-- 3.2 Órdenes "huérfanas" en sesiones de picking (Migration 102 debería prevenir esto)
\echo ''
\echo '3.2 Órdenes en sesiones de picking con estados incompatibles:'
SELECT
    ps.id AS session_id,
    ps.session_code,
    ps.status AS session_status,
    o.id AS order_id,
    o.order_number,
    o.shopify_order_name,
    o.sleeves_status AS order_status,
    pso.created_at AS added_to_session_at
FROM picking_sessions ps
JOIN picking_session_orders pso ON pso.session_id = ps.id
JOIN orders o ON o.id = pso.order_id
WHERE ps.store_id = :store_id
  AND ps.status IN ('in_progress', 'picking', 'packing')
  AND o.sleeves_status NOT IN ('confirmed', 'in_preparation', 'ready_to_ship')
ORDER BY pso.created_at DESC;

-- 3.3 Progreso de empaquetado con cantidades mayores a las pickadas
\echo ''
\echo '3.3 Progreso de empaquetado inconsistente (packed > picked):'
SELECT
    pp.session_id,
    ps.session_code,
    pp.product_id,
    p.name AS product_name,
    pp.variant_id,
    psi.quantity_needed,
    psi.quantity_picked,
    pp.quantity_packed,
    pp.quantity_packed - COALESCE(psi.quantity_picked, 0) AS overpacked
FROM packing_progress pp
JOIN picking_sessions ps ON ps.id = pp.session_id
JOIN products p ON p.id = pp.product_id
LEFT JOIN picking_session_items psi ON psi.session_id = pp.session_id
    AND psi.product_id = pp.product_id
    AND COALESCE(psi.variant_id::text, '') = COALESCE(pp.variant_id::text, '')
WHERE ps.store_id = :store_id
  AND pp.quantity_packed > COALESCE(psi.quantity_picked, 0)
ORDER BY pp.quantity_packed - COALESCE(psi.quantity_picked, 0) DESC;

-- ================================================================
-- 4. SETTLEMENTS & DISPATCH CALCULATIONS
-- ================================================================
\echo ''
\echo '4. CHECKING SETTLEMENTS & DISPATCH...'
\echo '--------------------------------------'

-- 4.1 Sesiones de despacho con cálculos sospechosos
\echo '4.1 Sesiones de despacho con problemas de cálculo:'
SELECT
    ds.id,
    ds.session_code,
    ds.status,
    ds.carrier_id,
    c.name AS carrier_name,
    COUNT(DISTINCT dso.order_id) AS orders_count,
    SUM(CASE WHEN o.payment_method = 'cod' THEN o.total_price ELSE 0 END) AS total_cod_expected,
    ds.total_cod_collected,
    ds.carrier_fees_cod,
    ds.carrier_fees_prepaid,
    ds.failed_attempt_fees,
    ds.net_receivable,
    -- Verificar cálculo de net_receivable
    (ds.total_cod_collected - ds.carrier_fees_cod - ds.carrier_fees_prepaid - COALESCE(ds.failed_attempt_fees, 0)) AS calculated_net,
    ds.net_receivable - (ds.total_cod_collected - ds.carrier_fees_cod - ds.carrier_fees_prepaid - COALESCE(ds.failed_attempt_fees, 0)) AS discrepancy
FROM dispatch_sessions ds
JOIN carriers c ON c.id = ds.carrier_id
LEFT JOIN dispatch_session_orders dso ON dso.session_id = ds.id
LEFT JOIN orders o ON o.id = dso.order_id
WHERE ds.store_id = :store_id
  AND ds.status IN ('processing', 'settled')
GROUP BY ds.id, ds.session_code, ds.status, ds.carrier_id, c.name, ds.total_cod_collected,
         ds.carrier_fees_cod, ds.carrier_fees_prepaid, ds.failed_attempt_fees, ds.net_receivable
HAVING ABS(ds.net_receivable - (ds.total_cod_collected - ds.carrier_fees_cod - ds.carrier_fees_prepaid - COALESCE(ds.failed_attempt_fees, 0))) > 100
ORDER BY ABS(ds.net_receivable - (ds.total_cod_collected - ds.carrier_fees_cod - ds.carrier_fees_prepaid - COALESCE(ds.failed_attempt_fees, 0))) DESC;

-- 4.2 Órdenes en múltiples sesiones de despacho activas (Migration 059 debería prevenir esto)
\echo ''
\echo '4.2 Órdenes duplicadas en sesiones de despacho:'
SELECT
    o.id AS order_id,
    o.order_number,
    o.shopify_order_name,
    COUNT(DISTINCT dso.session_id) AS session_count,
    STRING_AGG(DISTINCT ds.session_code, ', ') AS session_codes
FROM orders o
JOIN dispatch_session_orders dso ON dso.order_id = o.id
JOIN dispatch_sessions ds ON ds.id = dso.session_id
WHERE o.store_id = :store_id
  AND ds.status IN ('dispatched', 'processing')
GROUP BY o.id, o.order_number, o.shopify_order_name
HAVING COUNT(DISTINCT dso.session_id) > 1
ORDER BY COUNT(DISTINCT dso.session_id) DESC;

-- ================================================================
-- 5. ANALYTICS & METRICS VERIFICATION
-- ================================================================
\echo ''
\echo '5. CHECKING ANALYTICS CALCULATIONS...'
\echo '---------------------------------------'

-- 5.1 Verificar Revenue calculation
\echo '5.1 Revenue calculation verification (últimos 7 días):'
WITH date_range AS (
    SELECT
        NOW() - INTERVAL '7 days' AS start_date,
        NOW() AS end_date
),
manual_calculation AS (
    SELECT
        SUM(o.total_price) AS total_revenue,
        COUNT(*) AS order_count
    FROM orders o
    CROSS JOIN date_range dr
    WHERE o.store_id = :store_id
      AND o.created_at >= dr.start_date
      AND o.created_at < dr.end_date
      AND o.sleeves_status NOT IN ('cancelled', 'rejected')
)
SELECT
    'Last 7 days' AS period,
    mc.total_revenue,
    mc.order_count,
    mc.total_revenue / NULLIF(mc.order_count, 0) AS avg_order_value
FROM manual_calculation mc;

-- 5.2 Verificar Costs calculation
\echo ''
\echo '5.2 Costs calculation verification (últimos 7 días):'
WITH date_range AS (
    SELECT
        NOW() - INTERVAL '7 days' AS start_date,
        NOW() AS end_date
),
manual_calculation AS (
    SELECT
        SUM(oli.quantity * COALESCE(p.cost, 0)) AS total_costs,
        SUM(oli.quantity) AS total_units
    FROM orders o
    CROSS JOIN date_range dr
    JOIN order_line_items oli ON oli.order_id = o.id
    LEFT JOIN products p ON p.id = oli.product_id
    WHERE o.store_id = :store_id
      AND o.created_at >= dr.start_date
      AND o.created_at < dr.end_date
      AND o.sleeves_status NOT IN ('cancelled', 'rejected')
)
SELECT
    'Last 7 days' AS period,
    mc.total_costs,
    mc.total_units,
    mc.total_costs / NULLIF(mc.total_units, 0) AS avg_cost_per_unit
FROM manual_calculation mc;

-- 5.3 Verificar Profit Margin
\echo ''
\echo '5.3 Profit margin verification (últimos 7 días):'
WITH date_range AS (
    SELECT
        NOW() - INTERVAL '7 days' AS start_date,
        NOW() AS end_date
),
revenue_calc AS (
    SELECT SUM(o.total_price) AS total_revenue
    FROM orders o
    CROSS JOIN date_range dr
    WHERE o.store_id = :store_id
      AND o.created_at >= dr.start_date
      AND o.created_at < dr.end_date
      AND o.sleeves_status NOT IN ('cancelled', 'rejected')
),
costs_calc AS (
    SELECT SUM(oli.quantity * COALESCE(p.cost, 0)) AS total_costs
    FROM orders o
    CROSS JOIN date_range dr
    JOIN order_line_items oli ON oli.order_id = o.id
    LEFT JOIN products p ON p.id = oli.product_id
    WHERE o.store_id = :store_id
      AND o.created_at >= dr.start_date
      AND o.created_at < dr.end_date
      AND o.sleeves_status NOT IN ('cancelled', 'rejected')
),
marketing_calc AS (
    SELECT SUM(c.investment) AS total_marketing
    FROM campaigns c
    CROSS JOIN date_range dr
    WHERE c.store_id = :store_id
      AND c.is_active = TRUE
      AND c.created_at >= dr.start_date
      AND c.created_at < dr.end_date
)
SELECT
    'Last 7 days' AS period,
    r.total_revenue,
    co.total_costs,
    m.total_marketing,
    (r.total_revenue - co.total_costs - COALESCE(m.total_marketing, 0)) AS net_profit,
    CASE
        WHEN r.total_revenue > 0
        THEN ((r.total_revenue - co.total_costs - COALESCE(m.total_marketing, 0)) / r.total_revenue * 100)
        ELSE 0
    END AS profit_margin_percent
FROM revenue_calc r, costs_calc co, marketing_calc m;

-- 5.4 Verificar Delivery Rate
\echo ''
\echo '5.4 Delivery rate verification (últimos 7 días):'
WITH date_range AS (
    SELECT
        NOW() - INTERVAL '7 days' AS start_date,
        NOW() AS end_date
)
SELECT
    'Last 7 days' AS period,
    COUNT(*) AS total_orders,
    COUNT(*) FILTER (WHERE o.sleeves_status = 'delivered') AS delivered_orders,
    COUNT(*) FILTER (WHERE o.sleeves_status IN ('shipped', 'in_transit')) AS in_transit_orders,
    COUNT(*) FILTER (WHERE o.sleeves_status IN ('cancelled', 'rejected')) AS cancelled_orders,
    CASE
        WHEN COUNT(*) > 0
        THEN (COUNT(*) FILTER (WHERE o.sleeves_status = 'delivered')::DECIMAL / COUNT(*) * 100)
        ELSE 0
    END AS delivery_rate_percent
FROM orders o
CROSS JOIN date_range dr
WHERE o.store_id = :store_id
  AND o.created_at >= dr.start_date
  AND o.created_at < dr.end_date;

-- ================================================================
-- 6. SHOPIFY SYNC STATUS
-- ================================================================
\echo ''
\echo '6. CHECKING SHOPIFY SYNC STATUS...'
\echo '-----------------------------------'

-- 6.1 Productos con problemas de sincronización
\echo '6.1 Productos con sync_status problemático:'
SELECT
    p.id,
    p.name,
    p.sku,
    p.sync_status,
    p.sync_error,
    p.shopify_product_id,
    p.shopify_variant_id,
    p.stock,
    p.updated_at,
    p.last_synced_at
FROM products p
WHERE p.store_id = :store_id
  AND p.sync_status IN ('error', 'pending')
  AND p.shopify_product_id IS NOT NULL
ORDER BY p.updated_at DESC
LIMIT 20;

-- 6.2 Productos desactualizados (pending sync por más de 1 hora)
\echo ''
\echo '6.2 Productos con sync pendiente por mucho tiempo:'
SELECT
    p.id,
    p.name,
    p.sku,
    p.sync_status,
    p.updated_at,
    p.last_synced_at,
    NOW() - p.updated_at AS time_pending
FROM products p
WHERE p.store_id = :store_id
  AND p.sync_status = 'pending'
  AND p.shopify_product_id IS NOT NULL
  AND p.updated_at < NOW() - INTERVAL '1 hour'
ORDER BY p.updated_at ASC
LIMIT 20;

-- ================================================================
-- 7. PRODUCT VARIANTS & BUNDLES
-- ================================================================
\echo ''
\echo '7. CHECKING PRODUCT VARIANTS...'
\echo '--------------------------------'

-- 7.1 Bundles con stock calculado incorrectamente
\echo '7.1 Bundles con available_packs inconsistente:'
SELECT
    p.id AS parent_id,
    p.name AS parent_name,
    p.stock AS parent_stock,
    v.id AS variant_id,
    v.name AS variant_name,
    v.variant_type,
    v.units_per_pack,
    FLOOR(p.stock / NULLIF(v.units_per_pack, 0)) AS calculated_packs,
    v.stock AS variant_stock
FROM products p
JOIN product_variants v ON v.parent_product_id = p.id
WHERE p.store_id = :store_id
  AND v.variant_type = 'bundle'
  AND v.uses_shared_stock = TRUE
  AND v.units_per_pack > 0
  AND v.stock != FLOOR(p.stock / v.units_per_pack)
ORDER BY ABS(v.stock - FLOOR(p.stock / v.units_per_pack)) DESC;

-- 7.2 Variations con uses_shared_stock incorrecto
\echo ''
\echo '7.2 Variations con uses_shared_stock = TRUE (debería ser FALSE):'
SELECT
    v.id,
    v.name,
    v.variant_type,
    v.uses_shared_stock,
    v.stock,
    p.name AS parent_name
FROM product_variants v
JOIN products p ON p.id = v.parent_product_id
WHERE p.store_id = :store_id
  AND v.variant_type = 'variation'
  AND v.uses_shared_stock = TRUE;

-- ================================================================
-- 8. CARRIER COVERAGE & ZONES
-- ================================================================
\echo ''
\echo '8. CHECKING CARRIER COVERAGE...'
\echo '--------------------------------'

-- 8.1 Transportadoras sin zonas configuradas
\echo '8.1 Transportadoras sin coverage configurado:'
SELECT
    c.id,
    c.name,
    c.is_active,
    COUNT(DISTINCT cc.city) AS cities_with_coverage,
    COUNT(DISTINCT o.id) AS total_orders
FROM carriers c
LEFT JOIN carrier_coverage cc ON cc.carrier_id = c.id AND cc.is_active = TRUE
LEFT JOIN orders o ON o.courier_id = c.id
WHERE c.store_id = :store_id
  AND c.is_active = TRUE
GROUP BY c.id, c.name, c.is_active
HAVING COUNT(DISTINCT cc.city) = 0
ORDER BY COUNT(DISTINCT o.id) DESC;

-- 8.2 Órdenes con ciudades sin cobertura
\echo ''
\echo '8.2 Órdenes recientes con ciudades sin cobertura de transportadora:'
SELECT
    o.id,
    o.order_number,
    o.shipping_city,
    o.shipping_city_normalized,
    o.courier_id,
    c.name AS carrier_name,
    o.sleeves_status,
    o.created_at
FROM orders o
LEFT JOIN carriers c ON c.id = o.courier_id
WHERE o.store_id = :store_id
  AND o.shipping_city_normalized IS NOT NULL
  AND o.courier_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM carrier_coverage cc
    WHERE cc.carrier_id = o.courier_id
      AND cc.city = o.shipping_city_normalized
      AND cc.is_active = TRUE
      AND cc.rate IS NOT NULL
  )
  AND o.created_at >= NOW() - INTERVAL '30 days'
ORDER BY o.created_at DESC
LIMIT 20;

-- ================================================================
-- 9. RETURNS SYSTEM
-- ================================================================
\echo ''
\echo '9. CHECKING RETURNS SYSTEM...'
\echo '------------------------------'

-- 9.1 Sesiones de devolución con problemas
\echo '9.1 Sesiones de devolución inconsistentes:'
SELECT
    rs.id,
    rs.session_code,
    rs.status,
    rs.created_at,
    rs.completed_at,
    COUNT(DISTINCT rso.order_id) AS orders_count,
    rs.processed_orders,
    COUNT(DISTINCT rso.order_id) - rs.processed_orders AS order_count_discrepancy
FROM return_sessions rs
LEFT JOIN return_session_orders rso ON rso.session_id = rs.id
WHERE rs.store_id = :store_id
  AND rs.status = 'completed'
GROUP BY rs.id, rs.session_code, rs.status, rs.created_at, rs.completed_at, rs.processed_orders
HAVING COUNT(DISTINCT rso.order_id) != rs.processed_orders
ORDER BY rs.completed_at DESC;

-- 9.2 Órdenes en múltiples sesiones de devolución activas
\echo ''
\echo '9.2 Órdenes duplicadas en sesiones de devolución:'
SELECT
    o.id AS order_id,
    o.order_number,
    o.shopify_order_name,
    COUNT(DISTINCT rso.session_id) AS session_count,
    STRING_AGG(DISTINCT rs.session_code, ', ') AS session_codes
FROM orders o
JOIN return_session_orders rso ON rso.order_id = o.id
JOIN return_sessions rs ON rs.id = rso.session_id
WHERE o.store_id = :store_id
  AND rs.status IN ('in_progress', 'completed')
GROUP BY o.id, o.order_number, o.shopify_order_name
HAVING COUNT(DISTINCT rso.session_id) > 1
ORDER BY COUNT(DISTINCT rso.session_id) DESC;

-- ================================================================
-- 10. SUMMARY & HEALTH SCORE
-- ================================================================
\echo ''
\echo '10. OVERALL HEALTH SUMMARY'
\echo '--------------------------'

WITH health_metrics AS (
    -- Inventory health
    SELECT
        'inventory' AS metric_category,
        CASE
            WHEN COUNT(*) FILTER (WHERE stock < 0) > 0 THEN 'CRITICAL'
            WHEN COUNT(*) FILTER (WHERE stock = 0) > COUNT(*) * 0.3 THEN 'WARNING'
            ELSE 'OK'
        END AS status,
        COUNT(*) AS total_products,
        COUNT(*) FILTER (WHERE stock < 0) AS negative_stock_count,
        COUNT(*) FILTER (WHERE stock = 0) AS out_of_stock_count
    FROM products
    WHERE store_id = :store_id

    UNION ALL

    -- Orders health
    SELECT
        'orders' AS metric_category,
        CASE
            WHEN COUNT(*) FILTER (WHERE sleeves_status = 'pending' AND created_at < NOW() - INTERVAL '7 days') > 10 THEN 'WARNING'
            ELSE 'OK'
        END AS status,
        COUNT(*) AS total_orders,
        COUNT(*) FILTER (WHERE sleeves_status = 'pending' AND created_at < NOW() - INTERVAL '7 days') AS old_pending_orders,
        COUNT(*) FILTER (WHERE sleeves_status = 'delivered') AS delivered_orders
    FROM orders
    WHERE store_id = :store_id
      AND created_at >= NOW() - INTERVAL '30 days'

    UNION ALL

    -- Warehouse health
    SELECT
        'warehouse' AS metric_category,
        CASE
            WHEN COUNT(*) FILTER (WHERE status IN ('in_progress', 'picking', 'packing') AND last_activity_at < NOW() - INTERVAL '48 hours') > 0 THEN 'CRITICAL'
            WHEN COUNT(*) FILTER (WHERE status IN ('in_progress', 'picking', 'packing') AND last_activity_at < NOW() - INTERVAL '24 hours') > 0 THEN 'WARNING'
            ELSE 'OK'
        END AS status,
        COUNT(*) AS total_sessions,
        COUNT(*) FILTER (WHERE status IN ('in_progress', 'picking', 'packing') AND last_activity_at < NOW() - INTERVAL '48 hours') AS critical_stale,
        COUNT(*) FILTER (WHERE status IN ('in_progress', 'picking', 'packing') AND last_activity_at < NOW() - INTERVAL '24 hours') AS warning_stale
    FROM picking_sessions
    WHERE store_id = :store_id

    UNION ALL

    -- Shopify sync health
    SELECT
        'shopify_sync' AS metric_category,
        CASE
            WHEN COUNT(*) FILTER (WHERE sync_status = 'error') > 5 THEN 'WARNING'
            WHEN COUNT(*) FILTER (WHERE sync_status = 'pending' AND updated_at < NOW() - INTERVAL '1 hour') > 10 THEN 'WARNING'
            ELSE 'OK'
        END AS status,
        COUNT(*) AS total_synced_products,
        COUNT(*) FILTER (WHERE sync_status = 'error') AS error_count,
        COUNT(*) FILTER (WHERE sync_status = 'pending') AS pending_count
    FROM products
    WHERE store_id = :store_id
      AND shopify_product_id IS NOT NULL
)
SELECT
    metric_category,
    status,
    total_products AS metric_1,
    negative_stock_count AS metric_2,
    out_of_stock_count AS metric_3
FROM health_metrics
ORDER BY
    CASE status
        WHEN 'CRITICAL' THEN 1
        WHEN 'WARNING' THEN 2
        WHEN 'OK' THEN 3
    END,
    metric_category;

\echo ''
\echo '========================================='
\echo 'HEALTH CHECK COMPLETED'
\echo '========================================='

-- ============================================================================
-- SCRIPT DE VERIFICACIÓN DE INTEGRIDAD DE COSTOS
-- ============================================================================
-- Este script verifica que todos los costos estén configurados correctamente
-- en productos, órdenes y análisis financieros.
-- Ejecutar en Supabase SQL Editor
-- ============================================================================

-- 1. PRODUCTOS CON COSTOS INCOMPLETOS
-- Productos activos que no tienen costos configurados (potencial problema)
SELECT
  'PRODUCTOS_SIN_COSTO' as verificacion,
  COUNT(*) as cantidad,
  ARRAY_AGG(name ORDER BY created_at DESC) FILTER (WHERE name IS NOT NULL) as primeros_10
FROM products
WHERE is_active = true
  AND (cost IS NULL OR cost = 0)
  AND stock > 0  -- Solo productos con stock
  AND is_service = false  -- Excluir servicios
LIMIT 10;

-- 2. VERIFICAR CAMPOS DE COSTOS VARIABLES
-- Productos con packaging_cost o additional_costs NULL (deberían ser 0)
SELECT
  'COSTOS_VARIABLES_NULL' as verificacion,
  COUNT(*) as cantidad_packaging_null,
  COUNT(*) FILTER (WHERE additional_costs IS NULL) as cantidad_additional_null
FROM products
WHERE is_active = true
  AND (packaging_cost IS NULL OR additional_costs IS NULL);

-- 3. SERVICIOS CON COSTOS DE EMPAQUE
-- Los servicios NO deberían tener packaging_cost
SELECT
  'SERVICIOS_CON_PACKAGING' as verificacion,
  COUNT(*) as cantidad,
  ARRAY_AGG(name ORDER BY created_at DESC) FILTER (WHERE name IS NOT NULL) as productos
FROM products
WHERE is_service = true
  AND packaging_cost > 0;

-- 4. CÁLCULO DE RENTABILIDAD MANUAL
-- Verificar que la fórmula de rentabilidad sea correcta
SELECT
  'VERIFICACION_RENTABILIDAD' as verificacion,
  COUNT(*) as total_productos,
  COUNT(*) FILTER (WHERE
    ABS(
      profitability -
      CASE
        WHEN price > 0 THEN
          ((price - COALESCE(cost, 0) - COALESCE(packaging_cost, 0) - COALESCE(additional_costs, 0)) / price * 100)
        ELSE 0
      END
    ) > 0.1  -- Tolerancia de 0.1% por redondeo
  ) as productos_con_error,
  ARRAY_AGG(
    name || ' (DB: ' || profitability::text || '%, Calculado: ' ||
    ROUND(
      CASE
        WHEN price > 0 THEN
          ((price - COALESCE(cost, 0) - COALESCE(packaging_cost, 0) - COALESCE(additional_costs, 0)) / price * 100)
        ELSE 0
      END, 1
    )::text || '%)'
    ORDER BY created_at DESC
  ) FILTER (WHERE
    ABS(
      profitability -
      CASE
        WHEN price > 0 THEN
          ((price - COALESCE(cost, 0) - COALESCE(packaging_cost, 0) - COALESCE(additional_costs, 0)) / price * 100)
        ELSE 0
      END
    ) > 0.1
  ) as productos_incorrectos
FROM products
WHERE is_active = true;

-- 5. PRODUCTOS IMPORTADOS DE SHOPIFY SIN COSTOS
-- Productos de Shopify que aún no tienen costos configurados
SELECT
  'SHOPIFY_PRODUCTOS_SIN_COSTO' as verificacion,
  COUNT(*) as cantidad,
  ARRAY_AGG(name ORDER BY created_at DESC) FILTER (WHERE name IS NOT NULL) as primeros_10
FROM products
WHERE shopify_product_id IS NOT NULL
  AND is_active = true
  AND (cost IS NULL OR cost = 0)
  AND stock > 0
LIMIT 10;

-- 6. RESUMEN DE COSTOS POR TIENDA
-- Análisis agregado de costos por tienda
SELECT
  'RESUMEN_POR_TIENDA' as verificacion,
  store_id,
  COUNT(*) as total_productos,
  COUNT(*) FILTER (WHERE cost > 0) as productos_con_costo,
  COUNT(*) FILTER (WHERE packaging_cost > 0) as productos_con_empaque,
  COUNT(*) FILTER (WHERE additional_costs > 0) as productos_con_costos_adicionales,
  ROUND(AVG(cost), 0) as costo_promedio,
  ROUND(AVG(packaging_cost), 0) as empaque_promedio,
  ROUND(AVG(additional_costs), 0) as adicionales_promedio,
  ROUND(AVG(profitability), 1) as rentabilidad_promedio
FROM products
WHERE is_active = true
GROUP BY store_id;

-- 7. PRODUCTOS CON RENTABILIDAD NEGATIVA O CERO
-- Productos que no están generando ganancia
SELECT
  'PRODUCTOS_SIN_RENTABILIDAD' as verificacion,
  COUNT(*) as cantidad,
  ARRAY_AGG(
    name || ' (Rentabilidad: ' || profitability::text || '%, Precio: ₲' || price::text ||
    ', Costo total: ₲' || (COALESCE(cost, 0) + COALESCE(packaging_cost, 0) + COALESCE(additional_costs, 0))::text || ')'
    ORDER BY profitability ASC
  ) FILTER (WHERE name IS NOT NULL) as productos
FROM products
WHERE is_active = true
  AND profitability <= 0
  AND stock > 0
LIMIT 10;

-- 8. COMPARACIÓN DE COSTOS: BASE vs TOTAL
-- Ver diferencia entre usar solo cost vs cost total
SELECT
  'COMPARACION_COSTOS' as verificacion,
  COUNT(*) as total_productos,
  ROUND(SUM(COALESCE(cost, 0)), 0) as suma_costo_base,
  ROUND(SUM(COALESCE(cost, 0) + COALESCE(packaging_cost, 0) + COALESCE(additional_costs, 0)), 0) as suma_costo_total,
  ROUND(
    (SUM(COALESCE(packaging_cost, 0) + COALESCE(additional_costs, 0)) /
     NULLIF(SUM(COALESCE(cost, 0) + COALESCE(packaging_cost, 0) + COALESCE(additional_costs, 0)), 0)) * 100,
    1
  ) as porcentaje_costos_variables
FROM products
WHERE is_active = true
  AND stock > 0;

-- 9. ÓRDENES CON LINE ITEMS SIN PRODUCT_ID
-- Line items que no están vinculados a productos (no se pueden calcular costos)
SELECT
  'LINE_ITEMS_SIN_PRODUCT' as verificacion,
  COUNT(DISTINCT o.id) as ordenes_afectadas,
  SUM((li->>'quantity')::int) as items_sin_producto
FROM orders o
CROSS JOIN LATERAL jsonb_array_elements(o.line_items) AS li
WHERE li->>'product_id' IS NULL
  AND o.sleeves_status IN ('confirmed', 'shipped', 'delivered')
  AND o.created_at > CURRENT_DATE - INTERVAL '30 days';

-- 10. VALIDACIÓN FINAL
-- Resumen ejecutivo de la verificación
SELECT
  'VALIDACION_FINAL' as verificacion,
  jsonb_build_object(
    'productos_activos', (SELECT COUNT(*) FROM products WHERE is_active = true),
    'productos_con_costo', (SELECT COUNT(*) FROM products WHERE is_active = true AND cost > 0),
    'productos_con_packaging', (SELECT COUNT(*) FROM products WHERE is_active = true AND packaging_cost > 0),
    'productos_con_adicionales', (SELECT COUNT(*) FROM products WHERE is_active = true AND additional_costs > 0),
    'rentabilidad_promedio', (SELECT ROUND(AVG(profitability), 1) FROM products WHERE is_active = true AND profitability > 0),
    'productos_rentables', (SELECT COUNT(*) FROM products WHERE is_active = true AND profitability > 20),
    'productos_no_rentables', (SELECT COUNT(*) FROM products WHERE is_active = true AND profitability <= 0 AND stock > 0)
  ) as resumen;

-- ============================================================================
-- INSTRUCCIONES DE USO:
-- ============================================================================
-- 1. Copiar y pegar este script completo en Supabase SQL Editor
-- 2. Ejecutar (Run)
-- 3. Revisar cada verificación en orden
-- 4. Productos sin costo configurado deben actualizarse manualmente
-- 5. Productos con rentabilidad incorrecta indican bug en el cálculo
-- ============================================================================

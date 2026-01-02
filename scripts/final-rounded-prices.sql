-- =============================================
-- PRECIOS FINALES REDONDEADOS - TODOS LOS PLANES
-- =============================================
-- Todos los precios son números redondos sin decimales
-- El precio anual muestra un precio/mes redondo

-- Verificar precios actuales
SELECT
  plan,
  price_monthly_cents / 100.0 AS "Precio Mensual",
  price_annual_cents / 100.0 AS "Precio Anual",
  ROUND((price_annual_cents / 12.0) / 100.0, 0) AS "Precio/Mes (Anual)"
FROM plan_limits
WHERE plan IN ('starter', 'growth', 'professional')
ORDER BY price_monthly_cents;

-- RESUMEN DE PRECIOS:
-- =============================================
-- STARTER:
--   Mensual: $29/mes
--   Anual: $288/año = $24/mes

-- GROWTH:
--   Mensual: $79/mes
--   Anual: $792/año = $66/mes

-- PROFESSIONAL:
--   Mensual: $169/mes
--   Anual: $1,704/año = $142/mes
-- =============================================

-- Stripe Price IDs (activos):
-- =============================================
-- STARTER:
--   Monthly: price_1SkWhi8jew17tEHtwMsLHYBE
--   Annual:  price_1SlGbh8jew17tEHtNxuLQI7Y

-- GROWTH:
--   Monthly: price_1SkWhk8jew17tEHt5dTb8ra5
--   Annual:  price_1SlGbi8jew17tEHtrNgekJLu

-- PROFESSIONAL:
--   Monthly: price_1SlGWI8jew17tEHtmMXcP9zG
--   Annual:  price_1SlGbk8jew17tEHtKaxvPuBc
-- =============================================

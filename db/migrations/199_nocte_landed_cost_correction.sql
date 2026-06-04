-- ============================================================
-- Migration 199: Correct NOCTE landed cost (63.492 -> 50.822 Gs/lente)
-- ============================================================
-- CONTEXT: product_variants.cost for NOCTE lenses was inflated 24.9%.
-- Real landed cost confirmed by owner: 50.822 Gs per lens.
--
-- SAFETY (verified): order_line_items.unit_cost is a point-in-time
-- snapshot taken at order creation (Migration 128, orders.ts:1916/2272,
-- and every webhook path). Analytics COGS reads oli.unit_cost, never a
-- live JOIN to product_variants.cost. Therefore this UPDATE affects only
-- NEW orders; historical orders keep their original COGS untouched.
--
-- SCOPE: store 1eeaf2c7-2cd2-4257-8213-d90b1280a19d (NOCTE), parent
-- product 91f20b61. Single lenses set to 50.822. Bundles carry the
-- per-lens cost baked in (units_per_pack * per-lens), so they are
-- corrected to keep pack COGS truthful:
--   PAREJA  (units_per_pack=2) -> 50.822 * 2 = 101.644
--   OFICINA (units_per_pack=3) -> 50.822 * 3 = 152.466
-- Bundle line items snapshot the bundle variant's own cost directly
-- (orders.ts:2285), so bundles MUST be corrected too.
-- ============================================================

BEGIN;

-- Single lenses (variation, units_per_pack = 1)
UPDATE product_variants
SET cost = 50822.00, updated_at = NOW()
WHERE id IN (
    'd222a082-4614-4f3f-972f-b9ff940b9686',  -- NOCTE-GLASSES-ROJO
    '3f5b4944-3012-4cee-a0f4-635ae8fe0389',  -- NOCTE-GLASSES-NARANJA
    'cae97115-4036-4b51-be8e-a11682a3254d'   -- NOCTE-GLASSES-AMARILLO
)
AND product_id = '91f20b61-7adf-4193-a307-8e823867c312'
AND is_active = true;

-- Pack Pareja bundles (units_per_pack = 2): 50.822 * 2
UPDATE product_variants
SET cost = 101644.00, updated_at = NOW()
WHERE id IN (
    '7fad75bb-87e4-4067-91d0-868aa303011f',  -- NOCTE-GLASSES-PAREJA
    'b10dd075-4473-4386-8830-739cdf2a889b',  -- NOCTE-OGLASSES-PAREJA
    '6bc347c0-f706-48cf-afc3-0832a89d0179'   -- NOCTE-YGLASSES-PAREJA
)
AND product_id = '91f20b61-7adf-4193-a307-8e823867c312'
AND is_active = true;

-- Pack Oficina bundles (units_per_pack = 3): 50.822 * 3
UPDATE product_variants
SET cost = 152466.00, updated_at = NOW()
WHERE id IN (
    '92c89cbd-1321-4c0b-b1ce-6b721b4e5970',  -- NOCTE-GLASSES-OFICINA
    '8714e71c-80d2-430a-8462-b7f4cbcd4e59',  -- NOCTE-OGLASSES-OFICINA
    '4cf5b298-45bd-4bb3-9b7b-7dbfeff02ddb'   -- NOCTE-YGLASSES-OFICINA
)
AND product_id = '91f20b61-7adf-4193-a307-8e823867c312'
AND is_active = true;

-- Parent product-level cost (used only for catalog "profitability %" display,
-- never for historical order COGS). Aligned to per-lens landed cost.
UPDATE products
SET cost = 50822.00, updated_at = NOW()
WHERE id = '91f20b61-7adf-4193-a307-8e823867c312'
AND store_id = '1eeaf2c7-2cd2-4257-8213-d90b1280a19d';

COMMIT;

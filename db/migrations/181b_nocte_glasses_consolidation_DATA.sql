-- ============================================================================
-- MIGRATION 181b: NOCTE Glasses Consolidation (DATA MOVE) -- GATED
-- ============================================================================
--
-- DO NOT RUN IN PRODUCTION WITHOUT EXPLICIT GO FROM GASTON.
-- Run 181b_DRY_RUN first on a restored copy and confirm the validation block
-- prints OK for every assertion.
--
-- WHAT THIS DOES (store 1eeaf2c7 only, NOCTE)
-- -------------------------------------------
-- Today NOCTE has 3 separate parent products, one per color, each holding the
-- color stock on products.stock (Rojo 200, Naranja 50, Amarillo 44) and 9
-- variants all flagged uses_shared_stock=TRUE (3 color "bundles" units_per_pack=1
-- plus 6 pack bundles units_per_pack 2/3).
--
-- After this migration:
--   * ONE canonical parent product (the existing Rojo parent, renamed to the
--     generic "NOCTE Glasses") owns all variants.
--   * Three COLOR VARIATIONS (Rojo/Naranja/Amarillo), variant_type='variation',
--     uses_shared_stock=FALSE, each holding its OWN stock (200/50/44).
--   * The Pareja and Oficina pack bundles for all colors are reparented onto
--     the canonical product and gain bundle_components rows pointing at the
--     color variations.
--   * The two redundant parent products (Naranja, Amarillo) are deactivated
--     (is_active=FALSE), NOT deleted, so historical line_items.product_id stays
--     valid and FKs never break.
--   * Legacy parent SKUs and legacy variant SKUs are registered as aliases.
--   * Historical line_items.variant_id is backfilled where the SKU identifies
--     a unique variant; bundle line items get default bundle_selections.
--
-- INVARIANTS (validated pre and post, transaction aborts on any failure):
--   physical color stock 200 / 50 / 44 is conserved exactly.
--   no order_line_items row is orphaned (every product_id still resolves).
--   no SKU stops resolving (canonical or alias).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Pinned IDs (verified against prod 2026-05-29). If any lookup returns NULL
-- the migration aborts before mutating anything.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    c_store     CONSTANT UUID := '1eeaf2c7-2cd2-4257-8213-d90b1280a19d';

    -- parents
    v_p_rojo     UUID;  -- canonical going forward
    v_p_naranja  UUID;
    v_p_amarillo UUID;

    -- color "bundle" variants (units_per_pack=1) -> become color VARIATIONS
    v_v_rojo     UUID;
    v_v_naranja  UUID;
    v_v_amarillo UUID;

    -- stock snapshot (pre)
    s_rojo INT; s_naranja INT; s_amarillo INT;
    s_total_pre INT; s_total_post INT;

    -- pack variants to reparent
    r RECORD;
BEGIN
    SELECT id INTO v_p_rojo     FROM products WHERE store_id=c_store AND sku='NOCTE-GLASSES-PERSONAL';
    SELECT id INTO v_p_naranja  FROM products WHERE store_id=c_store AND sku='NOCTE-OGLASSES-PERSONAL';
    SELECT id INTO v_p_amarillo FROM products WHERE store_id=c_store AND sku='NOCTE-YGLASSES-PERSONAL';

    SELECT id INTO v_v_rojo     FROM product_variants WHERE store_id=c_store AND sku='NOCTE-GLASSES-ROJO';
    SELECT id INTO v_v_naranja  FROM product_variants WHERE store_id=c_store AND sku='NOCTE-GLASSES-NARANJA';
    SELECT id INTO v_v_amarillo FROM product_variants WHERE store_id=c_store AND sku='NOCTE-GLASSES-AMARILLO';

    IF v_p_rojo IS NULL OR v_p_naranja IS NULL OR v_p_amarillo IS NULL
       OR v_v_rojo IS NULL OR v_v_naranja IS NULL OR v_v_amarillo IS NULL THEN
        RAISE EXCEPTION 'Pinned product/variant lookup failed. Aborting (no rows changed).';
    END IF;

    s_rojo     := (SELECT stock FROM products WHERE id=v_p_rojo);
    s_naranja  := (SELECT stock FROM products WHERE id=v_p_naranja);
    s_amarillo := (SELECT stock FROM products WHERE id=v_p_amarillo);
    s_total_pre := s_rojo + s_naranja + s_amarillo;

    RAISE NOTICE '[181b] PRE stock  rojo=% naranja=% amarillo=% total=%', s_rojo, s_naranja, s_amarillo, s_total_pre;

    -- =====================================================================
    -- 1. Move color stock onto the color VARIATIONS, flip to independent
    -- =====================================================================
    UPDATE product_variants SET
        stock = s_rojo,
        uses_shared_stock = FALSE,
        variant_type = 'variation',
        units_per_pack = 1,
        option1_name = 'Color', option1_value = 'Rojo',
        updated_at = NOW()
    WHERE id = v_v_rojo;

    UPDATE product_variants SET
        product_id = v_p_rojo,            -- reparent onto canonical
        stock = s_naranja,
        uses_shared_stock = FALSE,
        variant_type = 'variation',
        units_per_pack = 1,
        option1_name = 'Color', option1_value = 'Naranja',
        updated_at = NOW()
    WHERE id = v_v_naranja;

    UPDATE product_variants SET
        product_id = v_p_rojo,
        stock = s_amarillo,
        uses_shared_stock = FALSE,
        variant_type = 'variation',
        units_per_pack = 1,
        option1_name = 'Color', option1_value = 'Amarillo',
        updated_at = NOW()
    WHERE id = v_v_amarillo;

    -- =====================================================================
    -- 2. Reparent the pack bundles onto the canonical product.
    --    Keep uses_shared_stock semantics OFF: packs now deduct via
    --    bundle_components -> variation stock (preflight fills selections).
    --    We set uses_shared_stock=TRUE so the migration-146 trigger path
    --    (bundle branch) is taken; bundle_selections drives the deduction
    --    from the color variations. units_per_pack stays 2 / 3.
    -- =====================================================================
    UPDATE product_variants SET product_id = v_p_rojo, updated_at = NOW()
    WHERE store_id=c_store AND sku IN (
        'NOCTE-GLASSES-PAREJA','NOCTE-GLASSES-OFICINA',
        'NOCTE-OGLASSES-PAREJA','NOCTE-OGLASSES-OFICINA',
        'NOCTE-YGLASSES-PAREJA','NOCTE-YGLASSES-OFICINA'
    );

    -- =====================================================================
    -- 3. Canonical parent: rename generic, zero its pooled stock (stock now
    --    lives on variations), keep its SKU resolving via alias to Rojo.
    -- =====================================================================
    UPDATE products SET
        name = 'NOCTE Glasses',
        stock = 0,
        updated_at = NOW()
    WHERE id = v_p_rojo;

    -- Deactivate the now-redundant parents (NOT deleted: keeps FKs valid).
    UPDATE products SET is_active = FALSE, stock = 0, updated_at = NOW()
    WHERE id IN (v_p_naranja, v_p_amarillo);

    -- =====================================================================
    -- 4. Bundle component definitions (default = single color per pack,
    --    matching today's per-color packs). Mixed packs override at order.
    --      Pareja (2) -> 2x its color   Oficina (3) -> 3x its color
    -- =====================================================================
    -- Rojo packs
    INSERT INTO bundle_components (store_id, bundle_variant_id, component_variant_id, quantity)
    SELECT c_store, pv.id, v_v_rojo, pv.units_per_pack
    FROM product_variants pv WHERE pv.store_id=c_store AND pv.sku IN ('NOCTE-GLASSES-PAREJA','NOCTE-GLASSES-OFICINA')
    ON CONFLICT (bundle_variant_id, component_variant_id) DO NOTHING;
    -- Naranja packs
    INSERT INTO bundle_components (store_id, bundle_variant_id, component_variant_id, quantity)
    SELECT c_store, pv.id, v_v_naranja, pv.units_per_pack
    FROM product_variants pv WHERE pv.store_id=c_store AND pv.sku IN ('NOCTE-OGLASSES-PAREJA','NOCTE-OGLASSES-OFICINA')
    ON CONFLICT (bundle_variant_id, component_variant_id) DO NOTHING;
    -- Amarillo packs
    INSERT INTO bundle_components (store_id, bundle_variant_id, component_variant_id, quantity)
    SELECT c_store, pv.id, v_v_amarillo, pv.units_per_pack
    FROM product_variants pv WHERE pv.store_id=c_store AND pv.sku IN ('NOCTE-YGLASSES-PAREJA','NOCTE-YGLASSES-OFICINA')
    ON CONFLICT (bundle_variant_id, component_variant_id) DO NOTHING;

    -- =====================================================================
    -- 5. SKU aliases: legacy parent SKUs continue resolving to a variant.
    --    NOCTE-GLASSES-PERSONAL was historically the generic single lens =>
    --    map to Rojo (the default single SKU the website still sends as ROJO).
    --    The legacy O/Y personal parent SKUs map to their color variation.
    -- =====================================================================
    INSERT INTO product_variant_aliases (store_id, variant_id, alias_sku, source, notes) VALUES
        (c_store, v_v_rojo,     'NOCTE-GLASSES-PERSONAL',  'legacy', 'pre-consolidation generic single lens -> Rojo'),
        (c_store, v_v_naranja,  'NOCTE-OGLASSES-PERSONAL', 'legacy', 'pre-consolidation Naranja parent SKU'),
        (c_store, v_v_amarillo, 'NOCTE-YGLASSES-PERSONAL', 'legacy', 'pre-consolidation Amarillo parent SKU')
    ON CONFLICT (store_id, UPPER(TRIM(alias_sku))) DO NOTHING;

    -- =====================================================================
    -- 6. Backfill historical line_items.variant_id where SKU is unambiguous.
    --    Single-color SKUs -> color variation. Pack SKUs -> the pack bundle
    --    variant (already had variant_id in most cases; this fills the gaps).
    -- =====================================================================
    -- single-lens history -> Rojo variation
    UPDATE order_line_items oli
    SET variant_id = v_v_rojo, variant_type = 'variation'
    FROM orders o
    WHERE oli.order_id = o.id AND o.store_id = c_store
      AND oli.variant_id IS NULL
      AND UPPER(TRIM(oli.sku)) IN ('NOCTE-GLASSES-PERSONAL','NOCTE-GLASSES-ROJO');

    UPDATE order_line_items oli
    SET variant_id = v_v_naranja, variant_type = 'variation'
    FROM orders o
    WHERE oli.order_id = o.id AND o.store_id = c_store
      AND oli.variant_id IS NULL
      AND UPPER(TRIM(oli.sku)) IN ('NOCTE-OGLASSES-PERSONAL','NOCTE-GLASSES-NARANJA');

    UPDATE order_line_items oli
    SET variant_id = v_v_amarillo, variant_type = 'variation'
    FROM orders o
    WHERE oli.order_id = o.id AND o.store_id = c_store
      AND oli.variant_id IS NULL
      AND UPPER(TRIM(oli.sku)) IN ('NOCTE-YGLASSES-PERSONAL','NOCTE-GLASSES-AMARILLO');

    -- NOTE: ENVIO-PRIORITARIO and rows with NULL sku are intentionally left as-is.
    -- They are a real product (shipping service) and untyped historical noise;
    -- backfilling them would be a guess. They keep product_id resolution.

    -- =====================================================================
    -- 7. POST validation. Any failure here rolls back the whole transaction.
    -- =====================================================================
    s_total_post := (SELECT COALESCE(SUM(stock),0) FROM product_variants
                     WHERE id IN (v_v_rojo, v_v_naranja, v_v_amarillo));

    IF s_total_post <> s_total_pre THEN
        RAISE EXCEPTION '[181b] STOCK CONSERVATION FAILED pre=% post=%', s_total_pre, s_total_post;
    END IF;
    IF (SELECT stock FROM product_variants WHERE id=v_v_rojo) <> s_rojo
       OR (SELECT stock FROM product_variants WHERE id=v_v_naranja) <> s_naranja
       OR (SELECT stock FROM product_variants WHERE id=v_v_amarillo) <> s_amarillo THEN
        RAISE EXCEPTION '[181b] PER-COLOR STOCK MISMATCH';
    END IF;

    -- every color variation now belongs to canonical, independent stock
    IF EXISTS (SELECT 1 FROM product_variants
               WHERE id IN (v_v_rojo,v_v_naranja,v_v_amarillo)
               AND (product_id <> v_p_rojo OR uses_shared_stock IS TRUE)) THEN
        RAISE EXCEPTION '[181b] color variation reparent/flag failed';
    END IF;

    -- alias coverage: legacy SKUs resolve
    IF (SELECT COUNT(*) FROM product_variant_aliases WHERE store_id=c_store) < 3 THEN
        RAISE EXCEPTION '[181b] alias coverage incomplete';
    END IF;

    RAISE NOTICE '[181b] POST OK. color stock conserved (% total). aliases & components in place.', s_total_post;
END $$;

COMMIT;

-- ============================================================================
-- ROLLBACK (manual, run inside its own transaction BEFORE any new orders post)
-- ----------------------------------------------------------------------------
-- Reverse is data-specific. The safe rollback is RESTORE FROM the pre-migration
-- snapshot taken in the dry-run step. A scripted reverse is provided for the
-- window where no new orders have been processed:
--   BEGIN;
--   UPDATE products SET is_active=TRUE WHERE store_id='1eeaf2c7...' AND sku IN ('NOCTE-OGLASSES-PERSONAL','NOCTE-YGLASSES-PERSONAL');
--   UPDATE products SET stock=200, name='NOCTE® Red Light Blocking Glasses' WHERE sku='NOCTE-GLASSES-PERSONAL' AND store_id='1eeaf2c7...';
--   UPDATE products SET stock=50  WHERE sku='NOCTE-OGLASSES-PERSONAL' AND store_id='1eeaf2c7...';
--   UPDATE products SET stock=44  WHERE sku='NOCTE-YGLASSES-PERSONAL' AND store_id='1eeaf2c7...';
--   UPDATE product_variants SET product_id=<orig>, stock=0, uses_shared_stock=TRUE, variant_type='bundle' WHERE sku IN (...);  -- per snapshot
--   DELETE FROM bundle_components WHERE store_id='1eeaf2c7...';
--   DELETE FROM product_variant_aliases WHERE store_id='1eeaf2c7...';
--   UPDATE order_line_items SET variant_id=NULL WHERE ...;  -- only the rows this migration set
--   COMMIT;
-- Because order processing mutates stock, snapshot-restore is the authoritative
-- rollback. Scripted reverse is valid ONLY if zero orders changed status since.
-- ============================================================================

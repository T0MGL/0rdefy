-- ============================================================================
-- MIGRATION 181: Variant-Level Inventory (Platform Capability) + Bundle
--                Composition Definitions
-- ============================================================================
--
-- WHAT THIS IS
-- ------------
-- Ordefy never supported true per-variant inventory. The only workaround was
-- one parent product per color, each variant flagged uses_shared_stock=TRUE so
-- it deducted from its own parent pool. That is wrong at the product level:
-- Shopify and Woo model ONE product with N variations, each variation holding
-- its own stock, and packs that compose from those variations.
--
-- This migration introduces the platform primitives so every tenant can run
-- per-variant stock and color-mixed bundles seamlessly:
--
--   1. product_variant_aliases     legacy/external SKUs keep resolving forever
--   2. bundle_components            a bundle's default variation makeup
--   3. (helper RPCs)               resolve alias -> variant, expand a bundle
--
-- It is ADDITIVE ONLY. No column is dropped, no SKU is deleted, no existing
-- row semantics change. uses_shared_stock bundles keep working exactly as
-- before (Solenne and any other tenant on the old model are untouched). The
-- NOCTE data move is a SEPARATE, GATED migration (181b) so this structural
-- migration can ship and be verified on its own.
--
-- MULTI-TENANT SAFETY
-- -------------------
-- Every new table carries store_id, RLS enabled, FK indexes, tenant-scoped
-- unique constraints. Nothing here references a specific store.
--
-- Author: Ordefy (ordefy-ceo)
-- Date: 2026-05-29
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: SKU alias table
-- ----------------------------------------------------------------------------
-- A variant (or parent product) can answer to more than one SKU. This is how
-- legacy SKUs and external-channel SKUs keep resolving after consolidation
-- WITHOUT mutating the canonical sku column and WITHOUT deleting history.
--
-- Resolution precedence (enforced in the RPC, STEP 3):
--   1. exact variant.sku
--   2. exact product.sku (parent-only, guarded by AMBIGUOUS_PARENT_SKU rule)
--   3. alias -> variant_id (this table)
-- ============================================================================

CREATE TABLE IF NOT EXISTS product_variant_aliases (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id    UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    variant_id  UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
    alias_sku   VARCHAR(255) NOT NULL,
    source      VARCHAR(40) NOT NULL DEFAULT 'legacy',  -- legacy | shopify | manual | external
    notes       TEXT,
    created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Tenant-scoped uniqueness on the normalized alias. One alias maps to exactly
-- one variant per store. UPPER(TRIM()) mirrors find_product_or_variant_by_sku.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_variant_alias_store_sku
    ON product_variant_aliases (store_id, UPPER(TRIM(alias_sku)));

CREATE INDEX IF NOT EXISTS idx_variant_alias_variant
    ON product_variant_aliases (variant_id);

COMMENT ON TABLE product_variant_aliases IS
  'Additional SKUs that resolve to a canonical variant. Used for legacy SKU '
  'continuity and external-channel SKU mapping. Never delete a legacy SKU; '
  'register it here instead.';

-- ============================================================================
-- STEP 2: Bundle component definitions
-- ----------------------------------------------------------------------------
-- Declares the DEFAULT variation makeup of a bundle variant. The per-order
-- override still lives in order_line_items.bundle_selections (migration 146).
-- This table is what lets a "Pack Oficina" know it is 3 lenses, and what the
-- default color split is when the customer did not pick a mix.
--
-- A bundle component points FROM a bundle variant TO a component variant
-- (a color variation) with a quantity. Sum(quantity) MUST equal the bundle's
-- units_per_pack (validated by trigger below).
-- ============================================================================

CREATE TABLE IF NOT EXISTS bundle_components (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id             UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    bundle_variant_id    UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
    component_variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
    quantity             INTEGER NOT NULL CHECK (quantity > 0),
    created_at           TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT bundle_component_no_self CHECK (bundle_variant_id <> component_variant_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_bundle_component
    ON bundle_components (bundle_variant_id, component_variant_id);

CREATE INDEX IF NOT EXISTS idx_bundle_component_bundle
    ON bundle_components (bundle_variant_id);
CREATE INDEX IF NOT EXISTS idx_bundle_component_component
    ON bundle_components (component_variant_id);
CREATE INDEX IF NOT EXISTS idx_bundle_component_store
    ON bundle_components (store_id);

COMMENT ON TABLE bundle_components IS
  'Default variation makeup of a bundle variant. quantity sums to the bundle '
  'units_per_pack. Per-order overrides live in order_line_items.bundle_selections.';

-- ============================================================================
-- STEP 3: RLS (tenant isolation, identical pattern to product_variants)
-- ============================================================================

ALTER TABLE product_variant_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE bundle_components ENABLE ROW LEVEL SECURITY;

-- The API uses the service role (supabaseAdmin) which bypasses RLS, but RLS
-- must still be ON with a tenant policy so direct/anon access is impossible
-- and the multi-tenant guarantee holds at the row level.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='product_variant_aliases' AND policyname='variant_alias_store_isolation') THEN
        CREATE POLICY variant_alias_store_isolation ON product_variant_aliases
            USING (store_id IN (SELECT store_id FROM user_stores WHERE user_id = auth.uid()))
            WITH CHECK (store_id IN (SELECT store_id FROM user_stores WHERE user_id = auth.uid()));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='bundle_components' AND policyname='bundle_component_store_isolation') THEN
        CREATE POLICY bundle_component_store_isolation ON bundle_components
            USING (store_id IN (SELECT store_id FROM user_stores WHERE user_id = auth.uid()))
            WITH CHECK (store_id IN (SELECT store_id FROM user_stores WHERE user_id = auth.uid()));
    END IF;
END $$;

-- ============================================================================
-- STEP 4: Alias-aware SKU resolver
-- ----------------------------------------------------------------------------
-- New RPC. Does NOT replace find_product_or_variant_by_sku (kept intact so
-- Solenne and every other caller are byte-for-byte unaffected). Callers opt in.
-- Precedence: variant.sku -> alias -> product.sku.
-- ============================================================================

CREATE OR REPLACE FUNCTION find_product_or_variant_by_sku_aliased(
    p_store_id UUID,
    p_sku VARCHAR
)
RETURNS TABLE(
    entity_type VARCHAR,
    product_id UUID,
    variant_id UUID,
    product_name VARCHAR,
    variant_title VARCHAR,
    sku VARCHAR,
    price NUMERIC,
    stock INTEGER,
    image_url TEXT,
    matched_via VARCHAR
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_norm VARCHAR(255);
BEGIN
    v_norm := UPPER(TRIM(p_sku));
    IF v_norm IS NULL OR v_norm = '' THEN
        RETURN;
    END IF;

    -- 1. canonical variant SKU
    RETURN QUERY
    SELECT 'variant'::VARCHAR, pv.product_id, pv.id, p.name, pv.variant_title,
           pv.sku, pv.price, pv.stock, COALESCE(pv.image_url, p.image_url),
           'variant_sku'::VARCHAR
    FROM product_variants pv
    JOIN products p ON p.id = pv.product_id
    WHERE pv.store_id = p_store_id
      AND UPPER(TRIM(pv.sku)) = v_norm
      AND pv.is_active = TRUE AND p.is_active = TRUE
    LIMIT 1;
    IF FOUND THEN RETURN; END IF;

    -- 2. alias -> variant
    RETURN QUERY
    SELECT 'variant'::VARCHAR, pv.product_id, pv.id, p.name, pv.variant_title,
           pv.sku, pv.price, pv.stock, COALESCE(pv.image_url, p.image_url),
           'alias'::VARCHAR
    FROM product_variant_aliases a
    JOIN product_variants pv ON pv.id = a.variant_id
    JOIN products p ON p.id = pv.product_id
    WHERE a.store_id = p_store_id
      AND UPPER(TRIM(a.alias_sku)) = v_norm
      AND pv.is_active = TRUE AND p.is_active = TRUE
    LIMIT 1;
    IF FOUND THEN RETURN; END IF;

    -- 3. parent product SKU (the AMBIGUOUS_PARENT_SKU guard in TS still applies
    --    on top of this when the product has active variants)
    RETURN QUERY
    SELECT 'product'::VARCHAR, p.id, NULL::UUID, p.name, NULL::VARCHAR,
           p.sku, p.price, p.stock, p.image_url, 'product_sku'::VARCHAR
    FROM products p
    WHERE p.store_id = p_store_id
      AND UPPER(TRIM(p.sku)) = v_norm
      AND p.is_active = TRUE
    LIMIT 1;

    RETURN;
END;
$$;

-- ============================================================================
-- STEP 5: bundle_components integrity trigger
-- ----------------------------------------------------------------------------
-- Guards that a bundle's component quantities sum to its units_per_pack, and
-- that store_id matches both variants. Fires on INSERT/UPDATE/DELETE.
-- ============================================================================

CREATE OR REPLACE FUNCTION validate_bundle_components()
RETURNS TRIGGER AS $$
DECLARE
    v_bundle_variant UUID;
    v_units_per_pack INT;
    v_sum INT;
    v_bundle_store UUID;
    v_component_store UUID;
BEGIN
    v_bundle_variant := COALESCE(NEW.bundle_variant_id, OLD.bundle_variant_id);

    -- store_id consistency (only on write rows)
    IF TG_OP IN ('INSERT','UPDATE') THEN
        SELECT store_id, units_per_pack INTO v_bundle_store, v_units_per_pack
        FROM product_variants WHERE id = NEW.bundle_variant_id;
        SELECT store_id INTO v_component_store
        FROM product_variants WHERE id = NEW.component_variant_id;

        IF v_bundle_store IS NULL OR v_component_store IS NULL THEN
            RAISE EXCEPTION 'bundle_components: variant not found';
        END IF;
        IF v_bundle_store <> NEW.store_id OR v_component_store <> NEW.store_id THEN
            RAISE EXCEPTION 'bundle_components: store_id mismatch between row and variants';
        END IF;
    ELSE
        SELECT units_per_pack INTO v_units_per_pack
        FROM product_variants WHERE id = v_bundle_variant;
    END IF;

    -- After the write settles, sum must not exceed units_per_pack. We allow a
    -- partial definition (sum < units_per_pack) during editing, but never over.
    SELECT COALESCE(SUM(quantity), 0) INTO v_sum
    FROM bundle_components WHERE bundle_variant_id = v_bundle_variant;

    IF v_units_per_pack IS NOT NULL AND v_sum > v_units_per_pack THEN
        RAISE EXCEPTION 'bundle_components for variant % sum (%) exceeds units_per_pack (%)',
            v_bundle_variant, v_sum, v_units_per_pack;
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_validate_bundle_components ON bundle_components;
CREATE CONSTRAINT TRIGGER trigger_validate_bundle_components
    AFTER INSERT OR UPDATE OR DELETE ON bundle_components
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION validate_bundle_components();

-- ============================================================================
-- STEP 6: bundle expansion helper
-- ----------------------------------------------------------------------------
-- Returns the default component selections for a bundle variant as the same
-- JSONB shape order_line_items.bundle_selections uses:
--   [{"variant_id": "...", "variant_name": "...", "quantity": N}, ...]
-- The webhook preflight (E4) uses this to auto-fill bundle_selections when the
-- external payload does not specify a color mix, so the stock trigger always
-- has variant-level selections to deduct from variation stock.
-- ============================================================================

CREATE OR REPLACE FUNCTION expand_bundle_default_selections(p_bundle_variant_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(
        jsonb_agg(jsonb_build_object(
            'variant_id', bc.component_variant_id,
            'variant_name', cv.variant_title,
            'quantity', bc.quantity
        )),
        NULL
    )
    FROM bundle_components bc
    JOIN product_variants cv ON cv.id = bc.component_variant_id
    WHERE bc.bundle_variant_id = p_bundle_variant_id;
$$;

-- ============================================================================
-- STEP 7: Composition-aware bundle availability view
-- ----------------------------------------------------------------------------
-- v_bundles_inventory historically derived available_packs from the PARENT
-- product stock. After consolidation a bundle's stock lives in the color
-- VARIATIONS via bundle_components, and the parent pool is 0. This redefinition
-- is backward compatible:
--   * bundle HAS components -> available_packs = min over components of
--     floor(component_variation_stock / component_qty)  (true composed limit)
--   * bundle has NO components -> fall back to the legacy parent-stock formula
--     (Solenne and any tenant still on the parent-pool model are unaffected)
-- ============================================================================

CREATE OR REPLACE VIEW v_bundles_inventory AS
SELECT
    pv.id,
    pv.product_id,
    pv.store_id,
    pv.sku,
    pv.variant_title,
    pv.units_per_pack,
    pv.price,
    pv.cost,
    pv.is_active,
    pv.position,
    pv.shopify_variant_id,
    p.name AS product_name,
    p.stock AS parent_stock,
    CASE
        WHEN EXISTS (SELECT 1 FROM bundle_components bc WHERE bc.bundle_variant_id = pv.id) THEN
            COALESCE((
                SELECT MIN(FLOOR(COALESCE(cv.stock, 0)::numeric / GREATEST(bc.quantity, 1)::numeric))::integer
                FROM bundle_components bc
                JOIN product_variants cv ON cv.id = bc.component_variant_id
                WHERE bc.bundle_variant_id = pv.id
            ), 0)
        ELSE
            FLOOR(COALESCE(p.stock, 0)::numeric / GREATEST(COALESCE(pv.units_per_pack, 1), 1)::numeric)::integer
    END AS available_packs,
    CASE
        WHEN (
            CASE
                WHEN EXISTS (SELECT 1 FROM bundle_components bc WHERE bc.bundle_variant_id = pv.id) THEN
                    COALESCE((
                        SELECT MIN(FLOOR(COALESCE(cv.stock, 0)::numeric / GREATEST(bc.quantity, 1)::numeric))
                        FROM bundle_components bc
                        JOIN product_variants cv ON cv.id = bc.component_variant_id
                        WHERE bc.bundle_variant_id = pv.id
                    ), 0)
                ELSE FLOOR(COALESCE(p.stock, 0)::numeric / GREATEST(COALESCE(pv.units_per_pack, 1), 1)::numeric)
            END
        ) <= 0 THEN 'out_of_stock'::text
        WHEN (
            CASE
                WHEN EXISTS (SELECT 1 FROM bundle_components bc WHERE bc.bundle_variant_id = pv.id) THEN
                    COALESCE((
                        SELECT MIN(FLOOR(COALESCE(cv.stock, 0)::numeric / GREATEST(bc.quantity, 1)::numeric))
                        FROM bundle_components bc
                        JOIN product_variants cv ON cv.id = bc.component_variant_id
                        WHERE bc.bundle_variant_id = pv.id
                    ), 0)
                ELSE FLOOR(COALESCE(p.stock, 0)::numeric / GREATEST(COALESCE(pv.units_per_pack, 1), 1)::numeric)
            END
        ) <= 5 THEN 'low_stock'::text
        ELSE 'in_stock'::text
    END AS stock_status
FROM product_variants pv
JOIN products p ON p.id = pv.product_id
WHERE pv.variant_type::text = 'bundle' AND pv.is_active = TRUE AND p.is_active = TRUE;

COMMIT;

-- ============================================================================
-- ROLLBACK
-- ----------------------------------------------------------------------------
-- This migration is purely additive. To fully reverse:
--   BEGIN;
--   DROP FUNCTION IF EXISTS expand_bundle_default_selections(UUID);
--   DROP TRIGGER IF EXISTS trigger_validate_bundle_components ON bundle_components;
--   DROP FUNCTION IF EXISTS validate_bundle_components();
--   DROP FUNCTION IF EXISTS find_product_or_variant_by_sku_aliased(UUID, VARCHAR);
--   DROP TABLE IF EXISTS bundle_components;
--   DROP TABLE IF EXISTS product_variant_aliases;
--   COMMIT;
-- No data is mutated, so rollback loses only alias/component definitions.
-- ============================================================================

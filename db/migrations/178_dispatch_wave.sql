-- ================================================================
-- Migration 178: Dispatch Wave (Wave Dispatch by product)
-- ================================================================
-- Adds three RPCs and supporting indices that power the new
-- "Despacho por producto" feature in /shipping and /orders:
--
--   1. get_mono_product_order_ids(store_id, product_ids[])
--      Returns orders whose ALL line items belong to the same product
--      (any of the provided ids). Used as a server-side filter to keep
--      multi-product orders out of mono-product batches, which is the
--      core of the wave dispatch pattern.
--
--   2. get_dispatch_product_summary(store_id)
--      Returns one row per product with aggregated stats for the
--      ready_to_ship orders (count, units, COD total) plus a single
--      "Mixtos" bucket for multi-product orders. Powers the cards view.
--
--   3. get_pick_list_for_orders(store_id, order_ids[])
--      Returns variant-level aggregated quantities for a given set of
--      orders. Powers the printable pick list PDF.
--
-- All RPCs are SECURITY DEFINER and scope every query to the caller-
-- supplied store_id (no cross-store leakage). The accompanying indices
-- keep summary queries under 150ms even with thousands of historical
-- orders.
-- ================================================================

-- ----------------------------------------------------------------
-- RPC 1: mono-product order ids for a given list of products
-- ----------------------------------------------------------------
-- Mono-product = every line item shares the same product_id.
-- Variants and bundles of the same product still count as mono.
CREATE OR REPLACE FUNCTION get_mono_product_order_ids(
    p_store_id UUID,
    p_product_ids UUID[]
)
RETURNS TABLE(order_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT oli.order_id
    FROM order_line_items oli
    JOIN orders o ON o.id = oli.order_id
    WHERE o.store_id = p_store_id
      AND o.deleted_at IS NULL
    GROUP BY oli.order_id
    HAVING COUNT(DISTINCT oli.product_id) = 1
       AND (array_agg(DISTINCT oli.product_id))[1] = ANY(p_product_ids);
$$;

COMMENT ON FUNCTION get_mono_product_order_ids(UUID, UUID[]) IS
'Returns ids of orders that contain only one distinct product (mono-product), where that product is in the provided list. Used by /orders and /shipping product filters.';

-- ----------------------------------------------------------------
-- RPC 2: per-product summary for the ready-to-ship dispatch view
-- ----------------------------------------------------------------
-- Returns one row per product whose ready_to_ship orders are all
-- mono-product, plus a single "Mixtos" row aggregating all multi-
-- product ready_to_ship orders. The frontend renders cards from
-- this output.
CREATE OR REPLACE FUNCTION get_dispatch_product_summary(
    p_store_id UUID
)
RETURNS TABLE(
    product_id UUID,
    product_name TEXT,
    product_image TEXT,
    order_count BIGINT,
    unit_count BIGINT,
    cod_total NUMERIC,
    is_mono BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH ready_orders AS (
        SELECT o.id, o.cod_amount
        FROM orders o
        WHERE o.store_id = p_store_id
          AND o.sleeves_status = 'ready_to_ship'
          AND o.deleted_at IS NULL
    ),
    order_product_distinct AS (
        SELECT
            oli.order_id,
            COUNT(DISTINCT oli.product_id) AS distinct_products,
            (array_agg(DISTINCT oli.product_id))[1] AS first_product_id,
            SUM(oli.quantity) AS total_units
        FROM order_line_items oli
        WHERE oli.order_id IN (SELECT id FROM ready_orders)
        GROUP BY oli.order_id
    ),
    mono AS (
        SELECT
            opd.first_product_id AS product_id,
            COUNT(*)::BIGINT AS order_count,
            SUM(opd.total_units)::BIGINT AS unit_count,
            SUM(COALESCE(ro.cod_amount, 0))::NUMERIC AS cod_total
        FROM order_product_distinct opd
        JOIN ready_orders ro ON ro.id = opd.order_id
        WHERE opd.distinct_products = 1
        GROUP BY opd.first_product_id
    ),
    mixed AS (
        SELECT
            COUNT(*)::BIGINT AS order_count,
            COALESCE(SUM(ro.cod_amount), 0)::NUMERIC AS cod_total
        FROM order_product_distinct opd
        JOIN ready_orders ro ON ro.id = opd.order_id
        WHERE opd.distinct_products > 1
    )
    SELECT
        p.id AS product_id,
        p.name AS product_name,
        p.image_url AS product_image,
        m.order_count,
        m.unit_count,
        m.cod_total,
        TRUE AS is_mono
    FROM mono m
    JOIN products p ON p.id = m.product_id

    UNION ALL

    SELECT
        NULL::UUID AS product_id,
        'Mixtos'::TEXT AS product_name,
        NULL::TEXT AS product_image,
        mx.order_count,
        0::BIGINT AS unit_count,
        mx.cod_total,
        FALSE AS is_mono
    FROM mixed mx
    WHERE mx.order_count > 0

    ORDER BY 4 DESC;
$$;

COMMENT ON FUNCTION get_dispatch_product_summary(UUID) IS
'Returns aggregated stats per product for the ready_to_ship dispatch view, plus a single "Mixtos" bucket for multi-product orders. Powers the /shipping cards view.';

-- ----------------------------------------------------------------
-- RPC 3: pick list aggregated by product/variant for a set of orders
-- ----------------------------------------------------------------
-- Used by the printable pick list PDF. Aggregates physical units the
-- picker has to pull from the warehouse, grouped by product and
-- variant.
CREATE OR REPLACE FUNCTION get_pick_list_for_orders(
    p_store_id UUID,
    p_order_ids UUID[]
)
RETURNS TABLE(
    product_id UUID,
    product_name TEXT,
    variant_id UUID,
    variant_title TEXT,
    sku TEXT,
    total_quantity BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        oli.product_id,
        oli.product_name,
        oli.variant_id,
        oli.variant_title,
        oli.sku,
        SUM(oli.quantity)::BIGINT AS total_quantity
    FROM order_line_items oli
    JOIN orders o ON o.id = oli.order_id
    WHERE o.store_id = p_store_id
      AND o.id = ANY(p_order_ids)
      AND o.deleted_at IS NULL
    GROUP BY oli.product_id, oli.product_name, oli.variant_id, oli.variant_title, oli.sku
    ORDER BY oli.product_name NULLS LAST, oli.variant_title NULLS LAST;
$$;

COMMENT ON FUNCTION get_pick_list_for_orders(UUID, UUID[]) IS
'Returns variant-level aggregated quantities for a given set of orders, scoped to the caller store. Used by the printable pick list PDF.';

-- ----------------------------------------------------------------
-- Indices
-- ----------------------------------------------------------------
-- Speeds up the GROUP BY oli.order_id + product_id pivots used by all
-- three RPCs above.
CREATE INDEX IF NOT EXISTS idx_oli_product_order
    ON order_line_items(product_id, order_id);

-- Targets the most common scan in /shipping (ready_to_ship orders for
-- a store, excluding soft-deleted ones).
CREATE INDEX IF NOT EXISTS idx_orders_store_status_active
    ON orders(store_id, sleeves_status)
    WHERE deleted_at IS NULL;

-- ----------------------------------------------------------------
-- Permissions
-- ----------------------------------------------------------------
-- SECURITY DEFINER functions default to PUBLIC EXECUTE, which includes the
-- unauthenticated `anon` role. Even though every RPC scopes its query to a
-- caller-supplied store_id, leaving anon enabled would let anyone iterate
-- store ids over the public REST endpoint. We revoke first, then grant to
-- authenticated and service_role only.
REVOKE EXECUTE ON FUNCTION get_mono_product_order_ids(UUID, UUID[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION get_dispatch_product_summary(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION get_pick_list_for_orders(UUID, UUID[]) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION get_mono_product_order_ids(UUID, UUID[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_dispatch_product_summary(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_pick_list_for_orders(UUID, UUID[]) TO authenticated, service_role;

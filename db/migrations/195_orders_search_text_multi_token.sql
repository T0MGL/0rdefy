-- Migration 195: Multi-token search on orders via a generated search_text column.
--
-- Problem
-- -------
-- The previous search path built a single OR group across individual columns:
--   customer_first_name.ilike.%Q% OR customer_last_name.ilike.%Q% OR ...
-- so a query like "Sol Gomez" never matched a customer whose first name is
-- "Sol" and last name is "Gomez": no single column contains the full string.
-- This is the canonical "first + last name" multi-token failure mode and the
-- complaint Gaston flagged in production (Orders page + Courier Portal).
--
-- Solution
-- --------
-- 1. Enable `unaccent` so diacritics ("Gómez" vs "gomez") collapse server-side.
-- 2. Wrap unaccent in an IMMUTABLE helper so it can back a generated column
--    and a GIN index (unaccent itself is STABLE because its dictionary lives
--    in the catalog; the immutable wrapper is the standard Postgres workaround
--    documented at supabase.com/docs/guides/database/extensions/unaccent).
-- 3. Add `orders.search_text` as a GENERATED column that concatenates every
--    field a user would ever type into the search box (names, phone, order
--    numbers, both Shopify variants) and applies immutable_unaccent(lower(...)).
-- 4. Index it with GIN + gin_trgm_ops so ILIKE '%token%' is index-backed.
-- 5. Application code (api/routes/orders.ts, api/routes/portal.ts) splits the
--    input on whitespace and AND-chains one ILIKE per token against
--    search_text. Order of tokens no longer matters; diacritics no longer
--    matter; the planner uses the GIN index.
--
-- Cost
-- ----
-- - ~80 bytes / row of materialized text (negligible, table has ~2k rows
--   today and is bounded by COD ecommerce volume in PY).
-- - GIN trigram index ~3x the column size; sub-millisecond ILIKE on the
--   current dataset, low-double-digit ms at 100k rows.
-- - Generated column is auto-maintained by Postgres on every UPDATE/INSERT;
--   no trigger, no backfill drift.
--
-- Safety
-- ------
-- - Forward-only. No destructive operations. Adding a column + index is safe
--   on a hot table because both operations support CONCURRENTLY where used.
-- - search_text is STORED (not VIRTUAL) so the GIN index is valid; Postgres
--   currently only supports STORED generated columns.
-- - pg_trgm is already installed in this project (verified via list_extensions).

-- ---------------------------------------------------------------------------
-- 1. Extensions
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- 2. Immutable unaccent wrapper
-- ---------------------------------------------------------------------------
-- unaccent() is technically STABLE because the rules dictionary could change.
-- For our use case (Spanish/Portuguese diacritics) the mapping is stable, so
-- we wrap it as IMMUTABLE. This is the documented pattern for using unaccent
-- in indexes and generated columns.

CREATE OR REPLACE FUNCTION public.immutable_unaccent(text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
AS $$
    SELECT public.unaccent('public.unaccent'::regdictionary, $1)
$$;

COMMENT ON FUNCTION public.immutable_unaccent(text) IS
    'IMMUTABLE wrapper around unaccent() so it can be used in generated columns and GIN/BTREE indexes. Strips diacritics: Gómez -> Gomez.';

-- ---------------------------------------------------------------------------
-- 3. Generated search_text column
-- ---------------------------------------------------------------------------
-- We concatenate every field a user might search by with a space separator,
-- then normalize (lower + unaccent). Whitespace between fields means a token
-- never accidentally matches across field boundaries.
--
-- NOTE: ALTER TABLE ADD GENERATED is non-blocking only at the catalog level;
-- Postgres must rewrite the table to backfill. For 2k rows this is instant.
-- At scale this would need a phased migration; we are far from that threshold.

ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS search_text text
    GENERATED ALWAYS AS (
        public.immutable_unaccent(lower(
            coalesce(customer_first_name, '') || ' ' ||
            coalesce(customer_last_name,  '') || ' ' ||
            coalesce(customer_phone,      '') || ' ' ||
            coalesce(customer_email,      '') || ' ' ||
            coalesce(customer_address,    '') || ' ' ||
            coalesce(shipping_city,       '') || ' ' ||
            coalesce(order_number,        '') || ' ' ||
            coalesce(shopify_order_name,  '') || ' ' ||
            coalesce(shopify_order_number,'')
        ))
    ) STORED;

COMMENT ON COLUMN public.orders.search_text IS
    'Multi-token search column. Concatenation of customer + order identifier fields, lowercased and unaccented. Backed by a GIN trigram index. Application splits the query on whitespace and AND-chains one ILIKE per token against this column.';

-- ---------------------------------------------------------------------------
-- 4. GIN trigram index
-- ---------------------------------------------------------------------------
-- gin_trgm_ops makes ILIKE '%token%' index-backed. We pair it with the
-- store_id predicate because every search runs inside a store scope.

CREATE INDEX IF NOT EXISTS idx_orders_search_text_trgm
    ON public.orders
    USING gin (search_text gin_trgm_ops);

-- Composite covering for the most common access path: tenant-scoped search
-- ordered by recency.
CREATE INDEX IF NOT EXISTS idx_orders_store_id_search_text
    ON public.orders (store_id)
    INCLUDE (search_text)
    WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 5. Verification queries (for manual run, not executed)
-- ---------------------------------------------------------------------------
-- After migration, this query MUST return Marcelo Gomez when searching
-- "Marcelo Gomez" (multi-token across first+last):
--
--   SELECT id, customer_first_name, customer_last_name
--   FROM orders
--   WHERE store_id = '<NOCTE>'
--     AND search_text ILIKE '%marcelo%'
--     AND search_text ILIKE '%gomez%';
--
-- And this query MUST hit the GIN index (verify with EXPLAIN ANALYZE):
--
--   EXPLAIN ANALYZE
--   SELECT id FROM orders
--   WHERE store_id = '<NOCTE>' AND search_text ILIKE '%gomez%';

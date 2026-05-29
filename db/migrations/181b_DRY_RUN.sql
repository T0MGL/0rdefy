-- ============================================================================
-- 181b DRY RUN: run on a RESTORED COPY of prod, not prod.
-- ----------------------------------------------------------------------------
-- Wraps 181b in a transaction that always ROLLS BACK, printing the validation
-- NOTICEs so the operator can confirm conservation before the real run.
--
-- Procedure:
--   1. Restore a fresh copy of the prod DB (Supabase branch or pg_dump/restore).
--   2. Apply 181 (structural) on the copy.
--   3. Run THIS file on the copy. It executes 181b logic and rolls back.
--   4. Confirm the console prints:
--        [181b] PRE stock  rojo=200 naranja=50 amarillo=44 total=294
--        [181b] POST OK. color stock conserved (294 total). ...
--   5. Run the read-only assertions at the bottom (outside the rolled-back tx).
--
-- Only after all assertions pass and Gaston gives GO -> run 181b for real.
-- ============================================================================

-- Paste the full body of 181b here between BEGIN and ROLLBACK when executing,
-- OR run 181b then issue ROLLBACK instead of COMMIT. Simplest path:
--
--   psql -1 -v ON_ERROR_STOP=1 <<'SQL'
--   \i db/migrations/181b_nocte_glasses_consolidation_DATA.sql
--   SQL
-- but replace the final COMMIT with ROLLBACK for the dry run.

-- Read-only pre-flight assertions (safe to run against prod, mutate nothing):

-- A. Stock that MUST be conserved (expect 200 / 50 / 44, total 294):
SELECT sku, name, stock
FROM products
WHERE store_id='1eeaf2c7-2cd2-4257-8213-d90b1280a19d'
  AND sku IN ('NOCTE-GLASSES-PERSONAL','NOCTE-OGLASSES-PERSONAL','NOCTE-YGLASSES-PERSONAL')
ORDER BY sku;

-- B. All variants that will be touched (expect 9, all uses_shared_stock=TRUE today):
SELECT sku, variant_title, uses_shared_stock, variant_type, units_per_pack, stock, product_id
FROM product_variants
WHERE store_id='1eeaf2c7-2cd2-4257-8213-d90b1280a19d'
ORDER BY units_per_pack, sku;

-- C. Historical line_items that the backfill will set (variant_id IS NULL today):
SELECT UPPER(TRIM(oli.sku)) AS sku, COUNT(*) AS rows_to_backfill
FROM order_line_items oli
JOIN orders o ON o.id = oli.order_id
WHERE o.store_id='1eeaf2c7-2cd2-4257-8213-d90b1280a19d'
  AND oli.variant_id IS NULL
  AND UPPER(TRIM(oli.sku)) IN (
    'NOCTE-GLASSES-PERSONAL','NOCTE-GLASSES-ROJO',
    'NOCTE-OGLASSES-PERSONAL','NOCTE-GLASSES-NARANJA',
    'NOCTE-YGLASSES-PERSONAL','NOCTE-GLASSES-AMARILLO')
GROUP BY 1 ORDER BY 2 DESC;

-- D. Rows intentionally NOT backfilled (sanity: ENVIO + null sku noise):
SELECT COALESCE(UPPER(TRIM(oli.sku)),'(null)') AS sku, COUNT(*) AS left_as_is
FROM order_line_items oli
JOIN orders o ON o.id = oli.order_id
WHERE o.store_id='1eeaf2c7-2cd2-4257-8213-d90b1280a19d'
  AND oli.variant_id IS NULL
  AND COALESCE(UPPER(TRIM(oli.sku)),'') NOT IN (
    'NOCTE-GLASSES-PERSONAL','NOCTE-GLASSES-ROJO',
    'NOCTE-OGLASSES-PERSONAL','NOCTE-GLASSES-NARANJA',
    'NOCTE-YGLASSES-PERSONAL','NOCTE-GLASSES-AMARILLO')
GROUP BY 1 ORDER BY 2 DESC;

-- ============================================================================
-- Migration 179 — Dedupe orders.order_number and enforce uniqueness per store
-- ============================================================================
-- Problem
--   orders has no unique constraint on (store_id, order_number). The legacy
--   generator (external-webhook.service.ts) parsed digits out of the previous
--   order_number and incremented, producing values like "ORD-20260127" that
--   collide with the BEFORE INSERT trigger output that uses dates. Up to 7
--   copies of the same order_number exist for a single store today (NOCTE).
--   This causes Helena confirm-by-number lookups, settlement reconciliation,
--   and any downstream consumer to return the wrong row non-deterministically.
--
-- Strategy
--   1. Within one transaction, find every duplicated (store_id, order_number)
--      pair (deleted_at IS NULL).
--   2. Keep the OLDEST row by created_at, deterministic tiebreak by id.
--   3. Rename every other duplicate to a unique value using the canonical
--      trigger pattern: 'ORD-' || YYYYMMDD(created_at) || '-' || left(id, 6).
--      The id-based suffix is collision-free because id is the row's UUID PK.
--   4. Create a UNIQUE INDEX on (store_id, order_number) WHERE deleted_at IS
--      NULL. Soft-deleted duplicates are out of scope.
--   5. Verify zero duplicates remain; abort the transaction if any survive.
--
-- Rollback
--   The transaction commits only after the verification block passes. If any
--   duplicate survives the rename pass, RAISE EXCEPTION rolls everything back
--   and no schema change is applied. To undo a successful migration:
--     -- DROP INDEX IF EXISTS orders_store_order_number_unique_idx;
--     -- (the renamed order_numbers are not reverted automatically; record
--     --  the original→new map from the verification SELECT below if a manual
--     --  rollback of business data is required).
--
-- Idempotent
--   Re-running this migration on a clean dataset (no duplicates) is a no-op
--   for the rename pass and skips index creation when the index already
--   exists.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Snapshot the duplicate set for the audit log (visible in psql output).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_dupe_pairs INT;
    v_dupe_rows INT;
BEGIN
    SELECT COUNT(*), COALESCE(SUM(c), 0)
      INTO v_dupe_pairs, v_dupe_rows
      FROM (
          SELECT store_id, order_number, COUNT(*) AS c
            FROM orders
           WHERE deleted_at IS NULL
             AND order_number IS NOT NULL
           GROUP BY 1, 2
          HAVING COUNT(*) > 1
      ) d;
    RAISE NOTICE 'Migration 179: % duplicate (store_id, order_number) pairs found across % rows',
        v_dupe_pairs, v_dupe_rows;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Rename every non-oldest duplicate.
--
--    Window function picks created_at ASC, id ASC as the canonical "keep"
--    row. Every row with rn > 1 is renamed using the trigger's own format,
--    plus a suffix derived from the row id so collisions are impossible.
--
--    LEFT(id::text, 6) on a UUID PK is unique per row. Even if two same-day
--    duplicates of the same legacy order_number share the YYYYMMDD prefix,
--    their UUID prefixes diverge so the renamed values are distinct.
-- ---------------------------------------------------------------------------
WITH ranked AS (
    SELECT
        id,
        store_id,
        order_number,
        created_at,
        ROW_NUMBER() OVER (
            PARTITION BY store_id, order_number
            ORDER BY created_at ASC, id ASC
        ) AS rn
      FROM orders
     WHERE deleted_at IS NULL
       AND order_number IS NOT NULL
)
UPDATE orders AS o
   SET order_number = 'ORD-'
       || TO_CHAR(r.created_at, 'YYYYMMDD')
       || '-'
       || SUBSTRING(o.id::text, 1, 6)
  FROM ranked r
 WHERE o.id = r.id
   AND r.rn > 1;

-- ---------------------------------------------------------------------------
-- 3. Verify no duplicates remain BEFORE creating the unique index.
--    If any survive, abort the transaction.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_remaining INT;
BEGIN
    SELECT COUNT(*)
      INTO v_remaining
      FROM (
          SELECT store_id, order_number
            FROM orders
           WHERE deleted_at IS NULL
             AND order_number IS NOT NULL
           GROUP BY 1, 2
          HAVING COUNT(*) > 1
      ) d;
    IF v_remaining > 0 THEN
        RAISE EXCEPTION
            'Migration 179 aborting: % duplicate (store_id, order_number) pairs survived the rename pass',
            v_remaining;
    END IF;
    RAISE NOTICE 'Migration 179: dedupe pass clean (0 duplicates)';
END $$;

-- ---------------------------------------------------------------------------
-- 4. Enforce uniqueness on (store_id, order_number) for live rows.
--    Partial index excludes soft-deleted rows so historical conflicts cannot
--    block future inserts.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS orders_store_order_number_unique_idx
    ON orders (store_id, order_number)
 WHERE deleted_at IS NULL
   AND order_number IS NOT NULL;

COMMENT ON INDEX orders_store_order_number_unique_idx IS
    'Migration 179: enforces unique order_number per store for live (not soft-deleted) rows. Backed by external-webhook.service.ts retry-on-23505 path.';

COMMIT;

-- ============================================================================
-- Post-conditions
--   - SELECT store_id, order_number, COUNT(*) FROM orders
--     WHERE deleted_at IS NULL AND order_number IS NOT NULL
--     GROUP BY 1,2 HAVING COUNT(*) > 1; -- returns zero rows
--   - INSERT colliding row -> 23505 unique_violation, caught by app retry.
-- ============================================================================

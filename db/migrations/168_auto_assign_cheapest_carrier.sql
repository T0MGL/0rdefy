-- ================================================================
-- Migration 168: Per-store toggle for automatic carrier auto-assignment
-- ================================================================
-- Adds stores.auto_assign_cheapest_carrier (BOOLEAN NOT NULL DEFAULT TRUE).
--
-- Context:
--   The carrier coverage system (migration 090) auto-selects the cheapest
--   carrier with coverage when the user picks a delivery city in the order
--   confirmation / carrier assignment dialogs. Some stores prefer to choose
--   manually every time (relationship pricing, courier rotation, internal
--   policy). This flag lets the owner toggle the behavior per store.
--
--   - TRUE  (default): keep current behavior, frontend auto-picks cheapest
--                      carrier with coverage and pre-fills shipping cost.
--   - FALSE          : frontend renders the carriers + rates list but does
--                      NOT preselect anything. The user must click manually.
--
-- Backend: this column is read-only enrichment. The actual auto-pick happens
-- in the frontend (OrderConfirmationDialog, CarrierAssignmentDialog), which
-- reads the flag from currentStore. No server-side enforcement is needed
-- because the GET /carriers/coverage/city endpoint already returns the full
-- list of carriers + rates regardless of the flag, the change is purely
-- about what the UI does with that list.
--
-- Migration is idempotent. Existing rows are backfilled to TRUE so the
-- behavior is unchanged for everyone after deploy.
-- ================================================================

-- 1. Add the column with DEFAULT TRUE so existing rows are backfilled
--    automatically by Postgres.
ALTER TABLE stores
    ADD COLUMN IF NOT EXISTS auto_assign_cheapest_carrier BOOLEAN DEFAULT TRUE;

-- 2. Backfill any NULL rows defensively (in case the column existed without
--    a default in some branch). Safe no-op when DEFAULT applied above.
UPDATE stores
   SET auto_assign_cheapest_carrier = TRUE
 WHERE auto_assign_cheapest_carrier IS NULL;

-- 3. Lock the column down: NOT NULL so frontend never has to handle a
--    tri-state, and the default stays TRUE for newly created stores.
ALTER TABLE stores
    ALTER COLUMN auto_assign_cheapest_carrier SET NOT NULL;

ALTER TABLE stores
    ALTER COLUMN auto_assign_cheapest_carrier SET DEFAULT TRUE;

COMMENT ON COLUMN stores.auto_assign_cheapest_carrier IS
    'When TRUE (default), the order confirmation / carrier assignment UI auto-selects the cheapest carrier with coverage for the chosen city. When FALSE, the UI shows carriers + rates but forces the operator to pick manually. Enforced client-side; the coverage API always returns the full list.';

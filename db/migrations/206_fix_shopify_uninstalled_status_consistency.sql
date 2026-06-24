-- Migration 206: Fix shopify_integrations status vs uninstalled_at inconsistency
--
-- CONTEXT
-- Production held rows where status = 'active' while uninstalled_at was populated.
-- That state is contradictory: an active integration cannot also carry an uninstall
-- timestamp. The root cause was in the reconnect/reactivation code paths
-- (shopify-oauth, shopify-manual-oauth, shopify route reconnect, and the billing
-- app/subscriptions/update handler), which flipped status back to 'active' on
-- reinstall but never cleared the uninstalled_at marker left by the prior uninstall.
-- The handler code is fixed forward in the same change set; this migration repairs
-- the rows that were already corrupted before the code fix shipped.
--
-- RESOLUTION
-- Two disjoint inconsistent shapes, each repaired by intent:
--
--   1. status = 'active' AND uninstalled_at IS NOT NULL
--      The row is genuinely active (it was reconnected and carries a live token).
--      The uninstalled_at value is the stale lie. Clear it.
--
--   2. status <> 'active' AND status <> 'uninstalled' AND uninstalled_at IS NOT NULL
--      The integration was uninstalled (timestamp present) but the status label was
--      never normalized to 'uninstalled'. Normalize the status, keep the timestamp.
--
-- Rows already consistent (status = 'uninstalled' with uninstalled_at set, or
-- status = 'active' with uninstalled_at NULL) are untouched. The statement is
-- idempotent: re-running it is a no-op once the rows are clean.

BEGIN;

-- Shape 1: active rows carrying a stale uninstall timestamp.
UPDATE shopify_integrations
SET uninstalled_at = NULL,
    updated_at = NOW()
WHERE status = 'active'
  AND uninstalled_at IS NOT NULL;

-- Shape 2: uninstalled rows whose status label was never normalized.
UPDATE shopify_integrations
SET status = 'uninstalled',
    updated_at = NOW()
WHERE status <> 'active'
  AND status <> 'uninstalled'
  AND uninstalled_at IS NOT NULL;

-- Guard: no contradictory rows must remain after this migration.
DO $$
DECLARE
  remaining INTEGER;
BEGIN
  SELECT COUNT(*) INTO remaining
  FROM shopify_integrations
  WHERE status = 'active'
    AND uninstalled_at IS NOT NULL;

  IF remaining > 0 THEN
    RAISE EXCEPTION 'Migration 206 left % active rows with a stale uninstalled_at', remaining;
  END IF;
END $$;

COMMIT;

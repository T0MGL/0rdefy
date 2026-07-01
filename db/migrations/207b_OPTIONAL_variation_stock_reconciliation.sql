-- ============================================================================
-- Migration 207b (OPTIONAL, DO NOT AUTO-RUN): variation stock reconciliation
-- ============================================================================
--
-- This file is a data repair for the historical mis-routing fixed by 207.
-- It is NOT part of the forward fix and MUST NOT run automatically. ordefy-ceo
-- scopes and authorizes the reconciliation. The whole body is wrapped in a
-- guard that no-ops unless the operator explicitly sets the flag below, so a
-- migration runner that applies this directory does nothing.
--
-- WHAT WENT WRONG (see 207 header for the trigger bug)
-- ----------------------------------------------------
-- For variation d222a082-4614-4f3f-972f-b9ff940b9686 (SKU NOCTE-GLASSES-ROJO,
-- variant_type='variation', uses_shared_stock=false, units_per_pack=1) under
-- store 1eeaf2c7-2cd2-4257-8213-d90b1280a19d, the buggy trigger decremented the
-- PARENT product (91f20b61-7adf-4193-a307-8e823867c312, SKU
-- NOCTE-GLASSES-PERSONAL) instead of the variation's own product_variants.stock.
--
-- Measured against prod at authoring time (read-only):
--   parent-column (WRONG) : 78 orders, 81 movements, 81 units
--   variant-column (right): 56 orders, 62 movements, 86 units
--   other (revert edge)   : 1 order,  1 movement,  1 unit
-- Net over-deduction on the parent = 81 units that should have hit the variant.
--
-- Confirm the numbers are still current before running. Real balances drift as
-- new orders land, and once 207 ships the mis-route stops growing but the
-- historical 81-unit skew stays until repaired.
--
-- WHAT THIS DOES (only when enabled)
-- ----------------------------------
-- Recomputes the exact mis-routed unit count from inventory_movements (the
-- audit log is the source of truth, not a hardcoded 81), then in ONE
-- transaction:
--   1. adds those units back to the PARENT product stock (undo the wrong debit)
--   2. subtracts the SAME units from the VARIATION stock (apply the right debit)
--   3. tags the affected movement rows so they are not double-counted if this
--      runs twice (idempotency via a marker in notes).
-- Net physical inventory is unchanged: it only moves the debit to the correct
-- column. It asserts non-negative resulting stock and ROLLS BACK otherwise.
--
-- SCOPE IS SINGLE-VARIANT ON PURPOSE. If other variations are affected, clone
-- this file per variant after ordefy-ceo confirms each one; do not generalize
-- blindly across the table.
-- ============================================================================

DO $reconcile$
DECLARE
    -- Flip to TRUE only under ordefy-ceo authorization to actually run.
    c_enabled       CONSTANT BOOLEAN := FALSE;

    c_store_id      CONSTANT UUID := '1eeaf2c7-2cd2-4257-8213-d90b1280a19d';
    c_variant_id    CONSTANT UUID := 'd222a082-4614-4f3f-972f-b9ff940b9686';
    c_product_id    CONSTANT UUID := '91f20b61-7adf-4193-a307-8e823867c312';
    -- Marker appended to repaired rows so a re-run skips them.
    c_marker        CONSTANT TEXT := ' [reconciled:207b]';

    v_units_to_move INT;
    v_new_parent    INT;
    v_new_variant   INT;
BEGIN
    IF NOT c_enabled THEN
        RAISE NOTICE '207b reconciliation is DISABLED (c_enabled = FALSE). No changes made.';
        RETURN;
    END IF;

    -- Sum the units that were wrongly charged to the parent for this variation
    -- and have not already been reconciled.
    SELECT COALESCE(SUM(-im.quantity_change), 0)
    INTO v_units_to_move
    FROM inventory_movements im
    WHERE im.variant_id = c_variant_id
      AND im.store_id = c_store_id
      AND im.quantity_change < 0
      AND im.movement_type LIKE 'order_%'
      AND im.notes LIKE 'Stock decremented:%'
      AND im.notes NOT LIKE '%' || c_marker;

    IF v_units_to_move <= 0 THEN
        RAISE NOTICE '207b: nothing to reconcile (units_to_move = %).', v_units_to_move;
        RETURN;
    END IF;

    RAISE NOTICE '207b: moving % units from parent % to variation %',
        v_units_to_move, c_product_id, c_variant_id;

    UPDATE products
    SET stock = stock + v_units_to_move, updated_at = NOW()
    WHERE id = c_product_id AND store_id = c_store_id
    RETURNING stock INTO v_new_parent;

    UPDATE product_variants
    SET stock = stock - v_units_to_move, updated_at = NOW()
    WHERE id = c_variant_id
    RETURNING stock INTO v_new_variant;

    IF v_new_variant < 0 THEN
        RAISE EXCEPTION '207b ABORT: variation stock would go negative (% - % = %). Re-verify counts before running.',
            v_new_variant + v_units_to_move, v_units_to_move, v_new_variant;
    END IF;

    -- Mark the mis-routed rows so a second run is a no-op.
    UPDATE inventory_movements
    SET notes = notes || c_marker
    WHERE variant_id = c_variant_id
      AND store_id = c_store_id
      AND quantity_change < 0
      AND movement_type LIKE 'order_%'
      AND notes LIKE 'Stock decremented:%'
      AND notes NOT LIKE '%' || c_marker;

    RAISE NOTICE '207b DONE: parent stock now %, variation stock now %.', v_new_parent, v_new_variant;
END;
$reconcile$;

-- ============================================================================
-- Migration 180 — Propagate order_line_items mutations to orders.updated_at
-- ============================================================================
-- Why
--   Realtime postgres_changes is subscribed only to public.orders. The client
--   (src/pages/Orders.tsx) opens a websocket filtered by store_id and merges
--   incoming UPDATE rows into the in-memory list as a pure delta.
--
--   order_line_items is intentionally NOT in supabase_realtime: the table has
--   no store_id column, so the existing store-scoped subscription filter and
--   RLS policy have nothing to bind on. Adding it would require either
--   denormalizing store_id (write amplification on a hot table) or moving the
--   subscription to per-order_id channels (does not scale with list size).
--
--   Net effect today: when a coworker on another device adds, edits, or
--   removes an item from an order (price change, quantity bump, cancellation
--   of an upsell), the row in the on-screen order list does not move. The
--   user only sees the change after a manual reload or the safety-net poll
--   fires (30 minutes).
--
--   This migration closes that gap by touching the parent order whenever an
--   item row is mutated. The orders UPDATE then flows through the existing
--   realtime pipeline (publication, REPLICA IDENTITY FULL, RLS policy via
--   realtime_user_store_ids) and reaches every subscribed client within a
--   second.
--
-- Trigger semantics
--   - Fires AFTER INSERT, UPDATE, DELETE on order_line_items.
--   - Updates orders.updated_at to NOW() for the affected order_id, which is
--     resolved from NEW (insert/update) or OLD (delete).
--   - SECURITY DEFINER + an explicit search_path so it runs regardless of the
--     caller's role; backend writes go through service_role today, but RPCs
--     and future client-side writes (under RLS) must produce the same signal.
--   - The function is a no-op if the order row is already gone (cascade
--     deletes) — the UPDATE simply matches zero rows.
--
-- Cycle safety
--   orders has trigger_update_orders_timestamp (also bumps updated_at on
--   UPDATE) but it does NOT touch order_line_items, so no recursion. The
--   write inside this trigger does not modify line_items either.
--
-- Cost
--   One additional UPDATE per line_item mutation. orders is the natural
--   parent of these writes; the cost is negligible compared to the realtime
--   freshness it unlocks.
--
-- Rollback
--   DROP TRIGGER trigger_realtime_touch_order_on_line_items_change ON
--     public.order_line_items;
--   DROP FUNCTION public.realtime_touch_order_on_line_items_change();
-- ============================================================================

CREATE OR REPLACE FUNCTION public.realtime_touch_order_on_line_items_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order_id UUID;
BEGIN
    v_order_id := COALESCE(NEW.order_id, OLD.order_id);

    IF v_order_id IS NOT NULL THEN
        UPDATE public.orders
           SET updated_at = NOW()
         WHERE id = v_order_id;
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION public.realtime_touch_order_on_line_items_change() IS
    'Migration 180: bumps orders.updated_at when an order_line_items row is inserted/updated/deleted, so the existing realtime postgres_changes subscription on orders fires for every line-level mutation.';

DROP TRIGGER IF EXISTS trigger_realtime_touch_order_on_line_items_change
    ON public.order_line_items;

CREATE TRIGGER trigger_realtime_touch_order_on_line_items_change
AFTER INSERT OR UPDATE OR DELETE ON public.order_line_items
FOR EACH ROW
EXECUTE FUNCTION public.realtime_touch_order_on_line_items_change();

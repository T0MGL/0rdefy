-- ================================================================
-- MIGRATION 095: Delivery Preferences System
-- ================================================================
-- Author: Bright Idea
-- Date: 2026-01-20
--
-- Purpose: Add delivery preferences field to orders for scheduling
-- delivery around customer availability (travel, time preferences, etc.)
--
-- Use Cases:
--   - Customer is traveling and can't receive until specific date
--   - Customer prefers morning/afternoon/evening delivery
--   - Special instructions for the courier (leave with doorman, call first)
--
-- Schema:
--   delivery_preferences JSONB:
--   {
--     "not_before_date": "2026-01-25",           -- ISO date, don't deliver before this
--     "preferred_time_slot": "afternoon",        -- morning, afternoon, evening, any
--     "delivery_notes": "Dejar con el portero"   -- Free text instructions
--   }
--
-- Non-Breaking:
--   - Single additive column (JSONB, nullable)
--   - No changes to existing confirm_order_atomic RPC
--   - Preferences saved via separate UPDATE after confirmation
-- ================================================================


-- ================================================================
-- 1. ADD delivery_preferences COLUMN
-- ================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders' AND column_name = 'delivery_preferences'
    ) THEN
        ALTER TABLE orders ADD COLUMN delivery_preferences JSONB DEFAULT NULL;

        COMMENT ON COLUMN orders.delivery_preferences IS
            'Customer delivery preferences as JSONB object.
             Fields:
               - not_before_date: ISO date string (YYYY-MM-DD), do not deliver before this date
               - preferred_time_slot: "morning" (8-12), "afternoon" (14-18), "evening" (18-21), or "any"
               - delivery_notes: Free text instructions for the courier
             Example: {"not_before_date": "2026-01-25", "preferred_time_slot": "afternoon", "delivery_notes": "Leave with doorman"}';
    END IF;
END $$;


-- ================================================================
-- 2. INDEX FOR QUERYING ORDERS WITH RESTRICTIONS
-- ================================================================

-- Index for finding orders that can't be delivered yet (has not_before_date in future)
CREATE INDEX IF NOT EXISTS idx_orders_delivery_preferences
ON orders USING GIN (delivery_preferences)
WHERE delivery_preferences IS NOT NULL;

-- Partial index for orders with active delivery restrictions
CREATE INDEX IF NOT EXISTS idx_orders_has_delivery_preferences
ON orders(store_id, sleeves_status)
WHERE delivery_preferences IS NOT NULL;


-- ================================================================
-- 3. HELPER FUNCTION: Check if order has active delivery restriction
-- ================================================================
-- Returns TRUE if order has a not_before_date that is still in the future

CREATE OR REPLACE FUNCTION has_active_delivery_restriction(p_order_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_not_before_date DATE;
BEGIN
    SELECT (delivery_preferences->>'not_before_date')::DATE
    INTO v_not_before_date
    FROM orders
    WHERE id = p_order_id;

    IF v_not_before_date IS NULL THEN
        RETURN FALSE;
    END IF;

    RETURN v_not_before_date > CURRENT_DATE;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION has_active_delivery_restriction(UUID) IS
'Checks if an order has an active delivery date restriction.
Returns TRUE if the order has a not_before_date that is still in the future.
Used by warehouse/dispatch to filter out restricted orders.';

GRANT EXECUTE ON FUNCTION has_active_delivery_restriction(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION has_active_delivery_restriction(UUID) TO service_role;


-- ================================================================
-- 4. HELPER FUNCTION: Get delivery preference summary
-- ================================================================
-- Returns a human-readable summary for display in UI

CREATE OR REPLACE FUNCTION get_delivery_preference_summary(p_delivery_preferences JSONB)
RETURNS TEXT AS $$
DECLARE
    v_parts TEXT[] := '{}';
    v_not_before TEXT;
    v_time_slot TEXT;
    v_notes TEXT;
BEGIN
    IF p_delivery_preferences IS NULL THEN
        RETURN NULL;
    END IF;

    -- Extract not_before_date
    v_not_before := p_delivery_preferences->>'not_before_date';
    IF v_not_before IS NOT NULL AND v_not_before != '' THEN
        v_parts := array_append(v_parts, 'Desde ' || TO_CHAR(v_not_before::DATE, 'DD/MM'));
    END IF;

    -- Extract time slot
    v_time_slot := p_delivery_preferences->>'preferred_time_slot';
    IF v_time_slot IS NOT NULL AND v_time_slot != '' AND v_time_slot != 'any' THEN
        v_parts := array_append(v_parts,
            CASE v_time_slot
                WHEN 'morning' THEN 'Mañana'
                WHEN 'afternoon' THEN 'Tarde'
                WHEN 'evening' THEN 'Noche'
                ELSE v_time_slot
            END
        );
    END IF;

    -- Extract notes (truncated)
    v_notes := p_delivery_preferences->>'delivery_notes';
    IF v_notes IS NOT NULL AND v_notes != '' THEN
        IF LENGTH(v_notes) > 30 THEN
            v_parts := array_append(v_parts, '"' || LEFT(v_notes, 27) || '..."');
        ELSE
            v_parts := array_append(v_parts, '"' || v_notes || '"');
        END IF;
    END IF;

    IF array_length(v_parts, 1) = 0 OR array_length(v_parts, 1) IS NULL THEN
        RETURN NULL;
    END IF;

    RETURN array_to_string(v_parts, ' • ');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION get_delivery_preference_summary(JSONB) IS
'Returns a human-readable summary of delivery preferences for UI display.
Example output: "Desde 25/01 • Tarde • \"Dejar con portero...\""';

GRANT EXECUTE ON FUNCTION get_delivery_preference_summary(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION get_delivery_preference_summary(JSONB) TO service_role;


-- ================================================================
-- 5. VIEW: Orders with delivery restrictions
-- ================================================================
-- Useful for warehouse/logistics to see restricted orders

CREATE OR REPLACE VIEW v_orders_with_delivery_restrictions AS
SELECT
    o.id,
    o.store_id,
    o.shopify_order_name,
    o.customer_first_name || ' ' || COALESCE(o.customer_last_name, '') as customer_name,
    o.sleeves_status as status,
    o.delivery_preferences->>'not_before_date' as not_before_date,
    o.delivery_preferences->>'preferred_time_slot' as preferred_time_slot,
    o.delivery_preferences->>'delivery_notes' as delivery_notes,
    get_delivery_preference_summary(o.delivery_preferences) as preference_summary,
    CASE
        WHEN (o.delivery_preferences->>'not_before_date')::DATE > CURRENT_DATE
        THEN TRUE
        ELSE FALSE
    END as is_restricted,
    CASE
        WHEN (o.delivery_preferences->>'not_before_date')::DATE > CURRENT_DATE
        THEN (o.delivery_preferences->>'not_before_date')::DATE - CURRENT_DATE
        ELSE 0
    END as days_until_available,
    o.created_at,
    o.confirmed_at
FROM orders o
WHERE o.delivery_preferences IS NOT NULL
  AND o.sleeves_status NOT IN ('delivered', 'cancelled', 'returned')
ORDER BY
    is_restricted DESC,
    not_before_date ASC NULLS LAST,
    o.created_at DESC;

COMMENT ON VIEW v_orders_with_delivery_restrictions IS
'Shows all orders with delivery preferences/restrictions.
is_restricted = TRUE means the order cannot be shipped yet (not_before_date is in the future).
Used by logistics team to plan deliveries around customer availability.';

GRANT SELECT ON v_orders_with_delivery_restrictions TO authenticated;


-- ================================================================
-- 6. VERIFICATION
-- ================================================================

DO $$
DECLARE
    v_has_column BOOLEAN;
    v_has_restriction_func BOOLEAN;
    v_has_summary_func BOOLEAN;
BEGIN
    -- Check column
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders' AND column_name = 'delivery_preferences'
    ) INTO v_has_column;

    -- Check functions
    SELECT EXISTS (
        SELECT 1 FROM pg_proc WHERE proname = 'has_active_delivery_restriction'
    ) INTO v_has_restriction_func;

    SELECT EXISTS (
        SELECT 1 FROM pg_proc WHERE proname = 'get_delivery_preference_summary'
    ) INTO v_has_summary_func;

    -- Validate
    IF NOT (v_has_column AND v_has_restriction_func AND v_has_summary_func) THEN
        RAISE EXCEPTION 'Migration 095 failed: column=%, restriction_func=%, summary_func=%',
            v_has_column, v_has_restriction_func, v_has_summary_func;
    END IF;

    RAISE NOTICE '';
    RAISE NOTICE '================================================';
    RAISE NOTICE 'Migration 095: Delivery Preferences System';
    RAISE NOTICE '================================================';
    RAISE NOTICE 'delivery_preferences column: OK';
    RAISE NOTICE 'has_active_delivery_restriction function: OK';
    RAISE NOTICE 'get_delivery_preference_summary function: OK';
    RAISE NOTICE 'v_orders_with_delivery_restrictions view: OK';
    RAISE NOTICE 'Indexes: OK';
    RAISE NOTICE '================================================';
    RAISE NOTICE '';
    RAISE NOTICE 'Usage:';
    RAISE NOTICE '  - Set via PATCH /api/orders/:id with delivery_preferences JSON';
    RAISE NOTICE '  - Or during confirmation in OrderConfirmationDialog';
    RAISE NOTICE '  - Query restricted orders: SELECT * FROM v_orders_with_delivery_restrictions';
    RAISE NOTICE '  - Check restriction: SELECT has_active_delivery_restriction(order_id)';
    RAISE NOTICE '';
END $$;


-- ================================================================
-- 7. NOTIFY POSTGREST
-- ================================================================

NOTIFY pgrst, 'reload schema';

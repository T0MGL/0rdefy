-- ================================================================
-- ORDEFY - AUTO-RESOLVE INCIDENT ON ORDER STATUS CHANGE
-- ================================================================
-- Migration: 116
-- Date: 2026-01-28
-- Author: Claude
--
-- Problem: When an order is marked as 'incident' and then changed to
-- another status (cancelled, delivered, shipped, etc.) from the Orders
-- page, the order remains visible in the Incidents section because
-- the delivery_incidents record is not resolved.
--
-- Solution: Add a trigger that automatically resolves the incident
-- when the order status changes FROM 'incident' to any other status.
-- ================================================================

-- ================================================================
-- STEP 1: CREATE FUNCTION TO AUTO-RESOLVE INCIDENT
-- ================================================================
-- This function is called when an order's sleeves_status changes
-- FROM 'incident' to another status. It resolves the active incident.

CREATE OR REPLACE FUNCTION resolve_incident_on_order_status_change()
RETURNS TRIGGER AS $$
DECLARE
    v_incident_id UUID;
    v_new_resolution_type VARCHAR(50);
BEGIN
    -- Only process when:
    -- 1. Status changes FROM 'incident' to something else
    -- 2. Order had an active incident
    IF OLD.sleeves_status = 'incident'
       AND NEW.sleeves_status != 'incident'
       AND OLD.has_active_incident = TRUE THEN

        -- Determine resolution type based on new status
        v_new_resolution_type := CASE NEW.sleeves_status
            WHEN 'delivered' THEN 'delivered'
            WHEN 'cancelled' THEN 'cancelled'
            WHEN 'returned' THEN 'cancelled'
            WHEN 'not_delivered' THEN 'delivery_failed'
            ELSE 'admin_resolved'  -- shipped, confirmed, pending, etc.
        END;

        -- Get the active incident ID
        SELECT id INTO v_incident_id
        FROM delivery_incidents
        WHERE order_id = NEW.id
          AND status = 'active'
        ORDER BY created_at DESC
        LIMIT 1;

        IF v_incident_id IS NOT NULL THEN
            -- Resolve the incident
            UPDATE delivery_incidents
            SET status = 'resolved',
                resolution_type = v_new_resolution_type,
                resolved_at = NOW(),
                resolved_by = 'admin',
                resolution_notes = format('Auto-resolved: order status changed from incident to %s', NEW.sleeves_status),
                updated_at = NOW()
            WHERE id = v_incident_id;

            -- Cancel any pending retry attempts
            UPDATE incident_retry_attempts
            SET status = 'cancelled',
                updated_at = NOW()
            WHERE incident_id = v_incident_id
              AND status IN ('scheduled', 'in_progress');

            RAISE NOTICE 'Auto-resolved incident % for order % (new status: %)',
                v_incident_id, NEW.id, NEW.sleeves_status;
        END IF;

        -- Clear the active incident flag
        NEW.has_active_incident := FALSE;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION resolve_incident_on_order_status_change IS
    'Automatically resolves active incident when order status changes from incident to another status';

-- ================================================================
-- STEP 2: CREATE TRIGGER
-- ================================================================
-- This trigger fires BEFORE UPDATE so we can modify has_active_incident

DROP TRIGGER IF EXISTS trigger_resolve_incident_on_status_change ON orders;

CREATE TRIGGER trigger_resolve_incident_on_status_change
    BEFORE UPDATE ON orders
    FOR EACH ROW
    WHEN (OLD.sleeves_status = 'incident' AND NEW.sleeves_status != 'incident')
    EXECUTE FUNCTION resolve_incident_on_order_status_change();

COMMENT ON TRIGGER trigger_resolve_incident_on_status_change ON orders IS
    'Auto-resolves delivery incident when order status changes from incident';

-- ================================================================
-- STEP 3: FIX EXISTING ORPHANED INCIDENTS
-- ================================================================
-- Resolve any incidents where the order is no longer in 'incident' status

-- 3a. Resolve orphaned incidents
UPDATE delivery_incidents di
SET status = 'resolved',
    resolution_type = CASE
        WHEN o.sleeves_status = 'delivered' THEN 'delivered'
        WHEN o.sleeves_status IN ('cancelled', 'returned') THEN 'cancelled'
        ELSE 'admin_resolved'
    END,
    resolved_at = NOW(),
    resolved_by = 'migration_116',
    resolution_notes = format('Auto-fixed orphaned incident: order was in %s status', o.sleeves_status),
    updated_at = NOW()
FROM orders o
WHERE di.order_id = o.id
  AND di.status = 'active'
  AND o.sleeves_status != 'incident';

-- 3b. Cancel associated retry attempts for resolved incidents
UPDATE incident_retry_attempts ira
SET status = 'cancelled',
    updated_at = NOW()
FROM delivery_incidents di
WHERE ira.incident_id = di.id
  AND di.resolved_by = 'migration_116'
  AND ira.status IN ('scheduled', 'in_progress');

-- 3c. Clear has_active_incident flag for orders that shouldn't have it
UPDATE orders
SET has_active_incident = FALSE,
    updated_at = NOW()
WHERE has_active_incident = TRUE
  AND sleeves_status != 'incident'
  AND NOT EXISTS (
      SELECT 1 FROM delivery_incidents di
      WHERE di.order_id = orders.id
        AND di.status = 'active'
  );

-- ================================================================
-- STEP 4: CREATE VIEW FOR MONITORING
-- ================================================================
-- View to detect any future orphaned incidents (for debugging)

CREATE OR REPLACE VIEW v_orphaned_incidents AS
SELECT
    di.id AS incident_id,
    di.order_id,
    di.store_id,
    di.status AS incident_status,
    di.created_at AS incident_created_at,
    o.sleeves_status AS current_order_status,
    o.has_active_incident,
    o.updated_at AS order_updated_at,
    CASE
        WHEN di.status = 'active' AND o.sleeves_status != 'incident'
            THEN 'ORPHANED: incident active but order not in incident status'
        WHEN di.status = 'active' AND o.has_active_incident = FALSE
            THEN 'FLAG_MISMATCH: incident active but has_active_incident is false'
        WHEN di.status != 'active' AND o.has_active_incident = TRUE
            THEN 'FLAG_STALE: incident resolved but has_active_incident still true'
        ELSE 'OK'
    END AS issue_type
FROM delivery_incidents di
INNER JOIN orders o ON di.order_id = o.id
WHERE (
    (di.status = 'active' AND o.sleeves_status != 'incident')
    OR (di.status = 'active' AND o.has_active_incident = FALSE)
    OR (di.status != 'active' AND o.has_active_incident = TRUE)
);

COMMENT ON VIEW v_orphaned_incidents IS
    'Shows incidents with data inconsistencies (should normally be empty)';

-- ================================================================
-- MIGRATION COMPLETE
-- ================================================================
-- Summary:
-- ✅ Created resolve_incident_on_order_status_change() function
-- ✅ Created trigger_resolve_incident_on_status_change trigger
-- ✅ Fixed existing orphaned incidents from production data
-- ✅ Created v_orphaned_incidents monitoring view
--
-- Behavior:
-- When order status changes FROM 'incident' TO any other status:
-- 1. Active incident is automatically resolved
-- 2. Resolution type is set based on new status
-- 3. Pending retry attempts are cancelled
-- 4. has_active_incident flag is cleared
--
-- Testing:
-- 1. Create order, set to 'incident' status (creates incident)
-- 2. Change to 'cancelled' from Orders page
-- 3. Order should disappear from Incidents page
-- 4. SELECT * FROM v_orphaned_incidents; should be empty
-- ================================================================

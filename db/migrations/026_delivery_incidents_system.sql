-- ================================================================
-- ORDEFY - DELIVERY INCIDENTS AND RETRY SYSTEM
-- ================================================================
-- Sistema de incidencias para pedidos con problemas de entrega
-- Permite hasta 3 intentos adicionales de reentrega con tracking
-- ================================================================

-- ================================================================
-- STEP 1: CREATE delivery_incidents TABLE
-- ================================================================
-- Registra incidencias cuando un pedido no puede ser entregado
-- por motivos extra-oficiales (no rechazo del cliente)

CREATE TABLE IF NOT EXISTS delivery_incidents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    initial_attempt_id UUID REFERENCES delivery_attempts(id) ON DELETE SET NULL,

    -- Status tracking
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    -- Status: 'active' (awaiting resolution), 'resolved' (delivered/cancelled), 'expired' (max retries reached)

    -- Retry configuration
    max_retry_attempts INT NOT NULL DEFAULT 3,
    current_retry_count INT NOT NULL DEFAULT 0,

    -- Resolution tracking
    resolution_type VARCHAR(50),
    -- Resolution: 'delivered', 'cancelled', 'customer_rejected', NULL (still active)
    resolved_at TIMESTAMP,
    resolved_by VARCHAR(100), -- 'courier', 'admin', 'customer'
    resolution_notes TEXT,

    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),

    CONSTRAINT check_retry_count CHECK (current_retry_count >= 0 AND current_retry_count <= max_retry_attempts),
    CONSTRAINT check_status CHECK (status IN ('active', 'resolved', 'expired'))
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_incidents_order ON delivery_incidents(order_id);
CREATE INDEX IF NOT EXISTS idx_incidents_store ON delivery_incidents(store_id);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON delivery_incidents(store_id, status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_incidents_created ON delivery_incidents(store_id, created_at DESC);

-- Comments
COMMENT ON TABLE delivery_incidents IS 'Tracks delivery incidents requiring multiple retry attempts';
COMMENT ON COLUMN delivery_incidents.status IS 'active = awaiting resolution, resolved = completed, expired = max retries reached';
COMMENT ON COLUMN delivery_incidents.resolution_type IS 'How the incident was resolved: delivered, cancelled, customer_rejected';

-- ================================================================
-- STEP 2: CREATE incident_retry_attempts TABLE
-- ================================================================
-- Registra cada intento de reentrega dentro de una incidencia

CREATE TABLE IF NOT EXISTS incident_retry_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id UUID NOT NULL REFERENCES delivery_incidents(id) ON DELETE CASCADE,
    delivery_attempt_id UUID REFERENCES delivery_attempts(id) ON DELETE SET NULL,

    -- Retry information
    retry_number INT NOT NULL, -- 1, 2, or 3
    scheduled_date DATE,
    rescheduled_by VARCHAR(100), -- 'courier', 'admin', 'customer'

    -- Status tracking
    status VARCHAR(50) NOT NULL DEFAULT 'scheduled',
    -- Status: 'scheduled', 'in_progress', 'delivered', 'failed', 'cancelled'

    -- Attempt details
    courier_notes TEXT,
    failure_reason TEXT,
    payment_method VARCHAR(50),
    proof_photo_url TEXT,

    -- Timestamps
    attempted_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),

    CONSTRAINT check_retry_number CHECK (retry_number >= 1 AND retry_number <= 3),
    CONSTRAINT check_retry_status CHECK (status IN ('scheduled', 'in_progress', 'delivered', 'failed', 'cancelled')),
    CONSTRAINT unique_incident_retry UNIQUE(incident_id, retry_number)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_retry_attempts_incident ON incident_retry_attempts(incident_id);
CREATE INDEX IF NOT EXISTS idx_retry_attempts_delivery ON incident_retry_attempts(delivery_attempt_id);
CREATE INDEX IF NOT EXISTS idx_retry_attempts_status ON incident_retry_attempts(incident_id, status);
CREATE INDEX IF NOT EXISTS idx_retry_attempts_scheduled ON incident_retry_attempts(scheduled_date) WHERE status = 'scheduled';

-- Comments
COMMENT ON TABLE incident_retry_attempts IS 'Tracks individual retry attempts for delivery incidents';
COMMENT ON COLUMN incident_retry_attempts.retry_number IS 'Sequential retry number (1-3) for this incident';
COMMENT ON COLUMN incident_retry_attempts.rescheduled_by IS 'Who scheduled this retry: courier, admin, customer';

-- ================================================================
-- STEP 3: ADD INCIDENT TRACKING TO ORDERS
-- ================================================================
-- Add field to quickly check if order has active incident

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS has_active_incident BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_orders_active_incident
    ON orders(store_id, has_active_incident)
    WHERE has_active_incident = TRUE;

COMMENT ON COLUMN orders.has_active_incident IS 'Quick flag to check if order has an active delivery incident';

-- ================================================================
-- STEP 4: CREATE FUNCTION TO AUTO-CREATE INCIDENT
-- ================================================================
-- Automatically creates an incident when delivery fails

CREATE OR REPLACE FUNCTION create_incident_on_delivery_failure()
RETURNS TRIGGER AS $$
DECLARE
    v_attempt_id UUID;
BEGIN
    -- Only create incident if:
    -- 1. Order status changed to 'incident'
    -- 2. No active incident exists for this order
    -- 3. Status was changed (not initial insert)
    IF NEW.sleeves_status = 'incident'
       AND (OLD IS NULL OR OLD.sleeves_status != 'incident') THEN

        -- Check if active incident already exists
        IF NOT EXISTS (
            SELECT 1 FROM delivery_incidents
            WHERE order_id = NEW.id AND status = 'active'
        ) THEN

            -- Get the most recent failed delivery attempt
            SELECT id INTO v_attempt_id
            FROM delivery_attempts
            WHERE order_id = NEW.id
              AND status = 'failed'
            ORDER BY created_at DESC
            LIMIT 1;

            -- Create incident record
            INSERT INTO delivery_incidents (
                order_id,
                store_id,
                initial_attempt_id,
                status,
                max_retry_attempts,
                current_retry_count
            ) VALUES (
                NEW.id,
                NEW.store_id,
                v_attempt_id,
                'active',
                3,
                0
            );

            -- Update order flag
            NEW.has_active_incident := TRUE;

            RAISE NOTICE 'Created incident for order %', NEW.id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- STEP 5: CREATE TRIGGER FOR AUTO-INCIDENT CREATION
-- ================================================================

DROP TRIGGER IF EXISTS trigger_create_incident_on_failure ON orders;

CREATE TRIGGER trigger_create_incident_on_failure
    BEFORE UPDATE ON orders
    FOR EACH ROW
    EXECUTE FUNCTION create_incident_on_delivery_failure();

COMMENT ON FUNCTION create_incident_on_delivery_failure IS 'Automatically creates delivery incident when order status changes to incident';

-- ================================================================
-- STEP 6: CREATE FUNCTION TO UPDATE INCIDENT ON RETRY
-- ================================================================
-- Updates incident when a retry attempt is completed

CREATE OR REPLACE FUNCTION update_incident_on_retry_completion()
RETURNS TRIGGER AS $$
DECLARE
    v_incident_id UUID;
    v_order_id UUID;
    v_store_id UUID;
BEGIN
    -- Only process when status changes to 'delivered' or 'failed'
    IF NEW.status IN ('delivered', 'failed')
       AND (OLD.status IS NULL OR OLD.status NOT IN ('delivered', 'failed')) THEN

        -- Get incident details
        SELECT incident_id INTO v_incident_id FROM NEW;

        SELECT order_id, store_id INTO v_order_id, v_store_id
        FROM delivery_incidents
        WHERE id = v_incident_id;

        IF NEW.status = 'delivered' THEN
            -- Mark incident as resolved
            UPDATE delivery_incidents
            SET status = 'resolved',
                resolution_type = 'delivered',
                resolved_at = NOW(),
                resolved_by = 'courier',
                updated_at = NOW()
            WHERE id = v_incident_id;

            -- Update order status
            UPDATE orders
            SET sleeves_status = 'delivered',
                delivery_status = 'confirmed',
                delivered_at = NOW(),
                has_active_incident = FALSE,
                updated_at = NOW()
            WHERE id = v_order_id;

            RAISE NOTICE 'Incident % resolved - order delivered', v_incident_id;

        ELSIF NEW.status = 'failed' THEN
            -- Increment retry count
            UPDATE delivery_incidents
            SET current_retry_count = current_retry_count + 1,
                updated_at = NOW()
            WHERE id = v_incident_id;

            -- Check if max retries reached
            UPDATE delivery_incidents
            SET status = 'expired',
                resolution_type = 'max_retries_reached',
                resolved_at = NOW(),
                updated_at = NOW()
            WHERE id = v_incident_id
              AND current_retry_count >= max_retry_attempts;

            RAISE NOTICE 'Incident % retry failed, count incremented', v_incident_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- STEP 7: CREATE TRIGGER FOR RETRY COMPLETION
-- ================================================================

DROP TRIGGER IF EXISTS trigger_update_incident_on_retry ON incident_retry_attempts;

CREATE TRIGGER trigger_update_incident_on_retry
    AFTER UPDATE ON incident_retry_attempts
    FOR EACH ROW
    EXECUTE FUNCTION update_incident_on_retry_completion();

COMMENT ON FUNCTION update_incident_on_retry_completion IS 'Updates incident status when retry attempt completes';

-- ================================================================
-- STEP 8: CREATE VIEW FOR ACTIVE INCIDENTS DASHBOARD
-- ================================================================
-- Convenient view for the Incidents page

CREATE OR REPLACE VIEW v_active_incidents AS
SELECT
    i.id AS incident_id,
    i.order_id,
    i.store_id,
    i.status AS incident_status,
    i.current_retry_count,
    i.max_retry_attempts,
    i.created_at AS incident_created_at,

    -- Order details
    o.shopify_order_number,
    o.customer_first_name,
    o.customer_last_name,
    o.customer_phone,
    o.customer_address,
    o.total_price,
    o.delivery_failure_reason,
    o.courier_notes,
    o.sleeves_status,

    -- Carrier info
    c.name AS carrier_name,
    c.phone AS carrier_phone,

    -- Initial attempt info
    da.failed_reason AS initial_failure_reason,
    da.failure_notes AS initial_failure_notes,
    da.actual_date AS initial_attempt_date,

    -- Retry attempts (as JSON array)
    COALESCE(
        (
            SELECT json_agg(
                json_build_object(
                    'retry_number', ira.retry_number,
                    'status', ira.status,
                    'scheduled_date', ira.scheduled_date,
                    'courier_notes', ira.courier_notes,
                    'failure_reason', ira.failure_reason,
                    'attempted_at', COALESCE(ira.attempted_at, ira.created_at)
                ) ORDER BY ira.retry_number
            )
            FROM incident_retry_attempts ira
            WHERE ira.incident_id = i.id
        ),
        '[]'::json
    ) AS retry_attempts

FROM delivery_incidents i
INNER JOIN orders o ON i.order_id = o.id
LEFT JOIN carriers c ON o.courier_id = c.id
LEFT JOIN delivery_attempts da ON i.initial_attempt_id = da.id
WHERE i.status = 'active'
ORDER BY i.created_at DESC;

COMMENT ON VIEW v_active_incidents IS 'Active delivery incidents with order and retry details for dashboard';

-- ================================================================
-- MIGRATION COMPLETE
-- ================================================================
-- Summary:
-- ✅ Created delivery_incidents table
-- ✅ Created incident_retry_attempts table
-- ✅ Added has_active_incident flag to orders
-- ✅ Auto-creates incident when delivery fails
-- ✅ Auto-updates incident when retries complete
-- ✅ Created dashboard view for incidents management
--
-- Next steps:
-- 1. Create API endpoints for incidents management
-- 2. Create Incidents page in frontend
-- 3. Modify delivery confirmation flow to show retry checklist
-- ================================================================

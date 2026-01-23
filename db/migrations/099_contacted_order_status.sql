-- ================================================================
-- Migration 099: Contacted Order Status
-- ================================================================
-- Adds a new "contacted" status between "pending" and "confirmed"
-- This status indicates that a WhatsApp message has been sent to the customer
-- but they haven't confirmed the order yet.
--
-- Flow: pending → contacted → confirmed → in_preparation → ...
-- ================================================================

-- Add contacted tracking columns to orders table
ALTER TABLE orders ADD COLUMN IF NOT EXISTS contacted_at TIMESTAMP;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS contacted_by VARCHAR(100);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS contacted_method VARCHAR(50) DEFAULT 'whatsapp';

-- Add index for filtering contacted orders
CREATE INDEX IF NOT EXISTS idx_orders_contacted_at ON orders(store_id, contacted_at) WHERE contacted_at IS NOT NULL;

-- Update the status check constraint to include 'contacted'
-- First, drop the existing constraint if it exists
DO $$
BEGIN
    -- Try to drop the old constraint
    ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
    ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_sleeves_status_check;
EXCEPTION WHEN OTHERS THEN
    -- Ignore if constraint doesn't exist
    NULL;
END $$;

-- Add new constraint with 'contacted' status
ALTER TABLE orders ADD CONSTRAINT orders_sleeves_status_check
    CHECK (sleeves_status IS NULL OR sleeves_status IN (
        'pending',
        'contacted',  -- NEW: WhatsApp sent, waiting for response
        'confirmed',
        'in_preparation',
        'ready_to_ship',
        'shipped',
        'in_transit',
        'delivered',
        'returned',
        'cancelled',
        'rejected',
        'incident'
    ));

-- ================================================================
-- Update the order status history trigger to handle contacted status
-- ================================================================
CREATE OR REPLACE FUNCTION fn_log_order_status_change()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.sleeves_status IS DISTINCT FROM NEW.sleeves_status THEN
        INSERT INTO order_status_history (
            order_id, store_id, previous_status, new_status,
            changed_by, changed_by_n8n, change_source, notes
        ) VALUES (
            NEW.id, NEW.store_id, OLD.sleeves_status, NEW.sleeves_status,
            COALESCE(NEW.confirmed_by, NEW.contacted_by, 'system'),
            COALESCE(NEW.n8n_sent, FALSE),
            CASE
                WHEN NEW.n8n_sent = TRUE THEN 'n8n'
                WHEN NEW.contacted_method = 'whatsapp' AND NEW.sleeves_status = 'contacted' THEN 'whatsapp_contact'
                WHEN NEW.confirmation_method = 'whatsapp' THEN 'whatsapp_webhook'
                WHEN NEW.shopify_order_id IS NOT NULL THEN 'shopify_sync'
                ELSE 'dashboard'
            END,
            NULL
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- Create a view for orders waiting for customer response
-- ================================================================
CREATE OR REPLACE VIEW v_orders_awaiting_response AS
SELECT
    o.id,
    o.store_id,
    o.order_number,
    o.customer_first_name || ' ' || COALESCE(o.customer_last_name, '') AS customer_name,
    o.customer_phone,
    o.total_price,
    o.contacted_at,
    o.contacted_by,
    o.contacted_method,
    EXTRACT(EPOCH FROM (NOW() - o.contacted_at))/3600 AS hours_since_contact,
    CASE
        WHEN o.contacted_at < NOW() - INTERVAL '48 hours' THEN 'CRITICAL'
        WHEN o.contacted_at < NOW() - INTERVAL '24 hours' THEN 'WARNING'
        ELSE 'OK'
    END AS urgency_level
FROM orders o
WHERE o.sleeves_status = 'contacted'
  AND o.deleted_at IS NULL
ORDER BY o.contacted_at ASC;

COMMENT ON VIEW v_orders_awaiting_response IS
'Orders in "contacted" status waiting for customer confirmation. Shows urgency based on time since contact.';

-- ================================================================
-- Create helper function to get contact follow-up candidates
-- ================================================================
CREATE OR REPLACE FUNCTION get_contact_followup_orders(
    p_store_id UUID,
    p_hours_threshold INT DEFAULT 24
)
RETURNS TABLE (
    order_id UUID,
    order_number VARCHAR,
    customer_name TEXT,
    customer_phone VARCHAR,
    total_price NUMERIC,
    contacted_at TIMESTAMP,
    hours_since_contact NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        o.id,
        o.order_number,
        o.customer_first_name || ' ' || COALESCE(o.customer_last_name, '') AS customer_name,
        o.customer_phone,
        o.total_price,
        o.contacted_at,
        EXTRACT(EPOCH FROM (NOW() - o.contacted_at))/3600 AS hours_since_contact
    FROM orders o
    WHERE o.store_id = p_store_id
      AND o.sleeves_status = 'contacted'
      AND o.contacted_at < NOW() - (p_hours_threshold || ' hours')::INTERVAL
      AND o.deleted_at IS NULL
    ORDER BY o.contacted_at ASC;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_contact_followup_orders IS
'Returns orders that have been contacted but not confirmed after X hours. Use for follow-up reminders.';

-- ================================================================
-- Add comment for documentation
-- ================================================================
COMMENT ON COLUMN orders.contacted_at IS 'Timestamp when WhatsApp message was sent to customer';
COMMENT ON COLUMN orders.contacted_by IS 'User who sent the WhatsApp message';
COMMENT ON COLUMN orders.contacted_method IS 'Method used to contact (whatsapp, phone, email)';

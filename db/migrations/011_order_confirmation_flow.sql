-- ================================================================
-- ORDEFY - ORDER CONFIRMATION AND COURIER FLOW
-- ================================================================
-- Implements the new order confirmation workflow with courier assignment
-- and delivery tracking via unique QR codes
-- ================================================================

-- ================================================================
-- STEP 1: UPDATE ORDER STATUS ENUM AND FIELDS
-- ================================================================

-- Update orders table with new status flow and delivery fields
ALTER TABLE orders
  -- Update status to support new workflow
  ADD COLUMN IF NOT EXISTS upsell_added BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS courier_id UUID REFERENCES carriers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS proof_photo_url TEXT,
  ADD COLUMN IF NOT EXISTS qr_code_url TEXT,
  ADD COLUMN IF NOT EXISTS delivery_link_token VARCHAR(10) UNIQUE,
  ADD COLUMN IF NOT EXISTS delivery_status VARCHAR(20) DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS delivery_failure_reason TEXT,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMP;

-- Update comments for new workflow
COMMENT ON COLUMN orders.sleeves_status IS 'New flow: pending_confirmation, confirmed, prepared, delivered_to_courier, in_transit, delivered, not_delivered, reconciled';
COMMENT ON COLUMN orders.upsell_added IS 'Whether an upsell was added during confirmation';
COMMENT ON COLUMN orders.courier_id IS 'Assigned courier for delivery';
COMMENT ON COLUMN orders.proof_photo_url IS 'Photo proof of delivery uploaded by courier';
COMMENT ON COLUMN orders.qr_code_url IS 'Generated QR code URL for delivery tracking';
COMMENT ON COLUMN orders.delivery_link_token IS 'Unique 10-character token for delivery confirmation link';
COMMENT ON COLUMN orders.delivery_status IS 'pending, confirmed, failed - Status from courier delivery confirmation';
COMMENT ON COLUMN orders.delivery_failure_reason IS 'Reason provided by courier if delivery failed';
COMMENT ON COLUMN orders.delivered_at IS 'Timestamp when courier confirmed delivery';
COMMENT ON COLUMN orders.reconciled_at IS 'Timestamp when order was reconciled';

-- Create index for courier lookups
CREATE INDEX IF NOT EXISTS idx_orders_courier ON orders(courier_id);
CREATE INDEX IF NOT EXISTS idx_orders_delivery_token ON orders(delivery_link_token);
CREATE INDEX IF NOT EXISTS idx_orders_delivery_status ON orders(store_id, delivery_status);

-- ================================================================
-- STEP 2: UPDATE CARRIERS TABLE
-- ================================================================

-- Add delivery rate calculation fields
ALTER TABLE carriers
  ADD COLUMN IF NOT EXISTS total_deliveries INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS successful_deliveries INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failed_deliveries INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_rate DECIMAL(5,2) GENERATED ALWAYS AS (
    CASE
      WHEN total_deliveries > 0 THEN (successful_deliveries::DECIMAL / total_deliveries * 100)
      ELSE 0
    END
  ) STORED;

COMMENT ON COLUMN carriers.total_deliveries IS 'Total number of deliveries assigned to this courier';
COMMENT ON COLUMN carriers.successful_deliveries IS 'Number of successful deliveries';
COMMENT ON COLUMN carriers.failed_deliveries IS 'Number of failed deliveries';
COMMENT ON COLUMN carriers.delivery_rate IS 'Calculated success rate (successful/total * 100)';

-- ================================================================
-- STEP 3: CREATE CONFIRMADOR ROLE
-- ================================================================

-- Add role field to users table if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'role'
  ) THEN
    ALTER TABLE users ADD COLUMN role VARCHAR(50) DEFAULT 'user';
    COMMENT ON COLUMN users.role IS 'User role: user, confirmador, admin, etc.';
  END IF;
END $$;

-- ================================================================
-- STEP 4: CREATE FUNCTION TO GENERATE DELIVERY TOKEN
-- ================================================================

CREATE OR REPLACE FUNCTION generate_delivery_token()
RETURNS VARCHAR(10) AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- Excluded confusing chars
  result TEXT := '';
  i INT;
BEGIN
  FOR i IN 1..10 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION generate_delivery_token() IS 'Generates a unique 10-character alphanumeric token for delivery links';

-- ================================================================
-- STEP 5: CREATE TRIGGER TO AUTO-GENERATE DELIVERY TOKEN
-- ================================================================

CREATE OR REPLACE FUNCTION set_delivery_token()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.sleeves_status = 'confirmed' AND NEW.delivery_link_token IS NULL THEN
    NEW.delivery_link_token := generate_delivery_token();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_set_delivery_token ON orders;
CREATE TRIGGER trigger_set_delivery_token
  BEFORE INSERT OR UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION set_delivery_token();

-- ================================================================
-- STEP 6: CREATE TRIGGER TO UPDATE CARRIER STATS
-- ================================================================

CREATE OR REPLACE FUNCTION update_carrier_delivery_stats()
RETURNS TRIGGER AS $$
BEGIN
  -- When delivery status changes to confirmed or failed
  IF NEW.delivery_status != OLD.delivery_status AND NEW.courier_id IS NOT NULL THEN
    -- Increment successful deliveries
    IF NEW.delivery_status = 'confirmed' THEN
      UPDATE carriers
      SET
        total_deliveries = total_deliveries + 1,
        successful_deliveries = successful_deliveries + 1
      WHERE id = NEW.courier_id;
    -- Increment failed deliveries
    ELSIF NEW.delivery_status = 'failed' THEN
      UPDATE carriers
      SET
        total_deliveries = total_deliveries + 1,
        failed_deliveries = failed_deliveries + 1
      WHERE id = NEW.courier_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_carrier_stats ON orders;
CREATE TRIGGER trigger_update_carrier_stats
  AFTER UPDATE ON orders
  FOR EACH ROW
  WHEN (NEW.delivery_status IS DISTINCT FROM OLD.delivery_status)
  EXECUTE FUNCTION update_carrier_delivery_stats();

-- ================================================================
-- STEP 7: CREATE VIEW FOR COURIER PERFORMANCE
-- ================================================================

CREATE OR REPLACE VIEW courier_performance AS
SELECT
  c.id,
  c.name,
  c.phone,
  c.store_id,
  c.total_deliveries,
  c.successful_deliveries,
  c.failed_deliveries,
  c.delivery_rate,
  COUNT(DISTINCT o.id) as assigned_orders,
  COUNT(DISTINCT CASE WHEN o.delivery_status = 'confirmed' THEN o.id END) as delivered_orders,
  COUNT(DISTINCT CASE WHEN o.delivery_status = 'failed' THEN o.id END) as failed_orders,
  COUNT(DISTINCT CASE WHEN o.delivery_status = 'pending' THEN o.id END) as pending_orders,
  AVG(CASE
    WHEN o.delivery_status = 'confirmed'
    THEN EXTRACT(EPOCH FROM (o.delivered_at - o.confirmed_at))/3600
  END) as avg_delivery_time_hours
FROM carriers c
LEFT JOIN orders o ON o.courier_id = c.id
GROUP BY c.id, c.name, c.phone, c.store_id, c.total_deliveries,
         c.successful_deliveries, c.failed_deliveries, c.delivery_rate;

COMMENT ON VIEW courier_performance IS 'Aggregated courier performance metrics with delivery statistics';

-- ================================================================
-- STEP 8: GRANT PERMISSIONS
-- ================================================================

GRANT SELECT ON courier_performance TO authenticated;

-- ================================================================
-- MIGRATION COMPLETE
-- ================================================================
-- Order Confirmation Flow Implementation
-- New status workflow: pending_confirmation → confirmed → delivered/not_delivered
-- Automatic delivery token generation and courier statistics tracking
-- ================================================================

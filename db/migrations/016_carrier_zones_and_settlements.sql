-- ================================================================
-- MIGRATION 016: Carrier Zones & Advanced Settlements
-- ================================================================
-- Adds support for:
-- 1. Zone-based carrier rates (e.g., "Asunción": ₲30.000, "Interior": ₲50.000)
-- 2. Dual settlement workflows (daily cash + deferred carrier payments)
-- 3. Free shipping model: Net Receivable = Total COD - Carrier Fees
-- ================================================================

-- ================================================================
-- 1. CREATE CARRIER_ZONES TABLE
-- ================================================================
-- Purpose: Define different shipping rates per carrier per zone
-- Example: Juan charges ₲30.000 for Asunción, ₲50.000 for Interior

CREATE TABLE IF NOT EXISTS carrier_zones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    carrier_id UUID NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,

    -- Zone information
    zone_name VARCHAR(100) NOT NULL,        -- e.g., "Asunción", "Interior", "Gran Asunción"
    zone_code VARCHAR(20),                  -- e.g., "ASU", "INT", "GRA"

    -- Pricing (in Guaraníes - no decimals needed but using DECIMAL for consistency)
    rate DECIMAL(12,2) NOT NULL,            -- Shipping cost in ₲ (e.g., 30000.00)

    -- Status
    is_active BOOLEAN DEFAULT TRUE,

    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),

    -- Ensure unique zone names per carrier
    CONSTRAINT unique_carrier_zone UNIQUE(carrier_id, zone_name)
);

-- Indexes for carrier_zones
CREATE INDEX IF NOT EXISTS idx_carrier_zones_carrier ON carrier_zones(carrier_id);
CREATE INDEX IF NOT EXISTS idx_carrier_zones_store ON carrier_zones(store_id);
CREATE INDEX IF NOT EXISTS idx_carrier_zones_active ON carrier_zones(carrier_id, is_active) WHERE is_active = TRUE;

-- ================================================================
-- 2. UPDATE CARRIERS TABLE
-- ================================================================
-- Purpose: Differentiate internal fleet (daily cash) vs external carriers (deferred)

-- Add carrier_type
ALTER TABLE carriers ADD COLUMN IF NOT EXISTS carrier_type VARCHAR(20) DEFAULT 'internal';
COMMENT ON COLUMN carriers.carrier_type IS 'internal = daily cash riders, external = deferred payment companies';

-- Add default_zone for quick assignments
ALTER TABLE carriers ADD COLUMN IF NOT EXISTS default_zone VARCHAR(100);

-- ================================================================
-- 3. UPDATE ORDERS TABLE
-- ================================================================
-- Purpose: Track internal shipping costs and zone assignment

-- Add shipping_cost (what we pay the carrier - internal expense)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_cost DECIMAL(12,2) DEFAULT 0.00;
COMMENT ON COLUMN orders.shipping_cost IS 'Internal shipping expense in ₲ (what we owe the carrier)';

-- Add delivery_zone
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_zone VARCHAR(100);
COMMENT ON COLUMN orders.delivery_zone IS 'Delivery zone assigned (e.g., Asunción, Interior)';

-- Add carrier_settlement_id (will be linked after creating carrier_settlements table)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS carrier_settlement_id UUID;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_orders_shipping_cost ON orders(shipping_cost) WHERE shipping_cost > 0;
CREATE INDEX IF NOT EXISTS idx_orders_zone ON orders(delivery_zone) WHERE delivery_zone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_carrier_settlement ON orders(carrier_settlement_id) WHERE carrier_settlement_id IS NOT NULL;

-- ================================================================
-- 4. CREATE CARRIER_SETTLEMENTS TABLE
-- ================================================================
-- Purpose: Manage deferred payments to external carriers (weekly/monthly)
-- Business Logic: Net Amount = Total COD Collected - Total Shipping Costs

CREATE TABLE IF NOT EXISTS carrier_settlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    carrier_id UUID NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,

    -- Period covered by this settlement
    settlement_period_start DATE NOT NULL,
    settlement_period_end DATE NOT NULL,

    -- Order counts and financials (in Guaraníes)
    total_orders INT NOT NULL DEFAULT 0,
    total_cod_collected DECIMAL(12,2) NOT NULL DEFAULT 0.00,   -- Sum(order.total_price) - what carrier collected
    total_shipping_cost DECIMAL(12,2) NOT NULL DEFAULT 0.00,   -- Sum(order.shipping_cost) - carrier fees

    -- NET RECEIVABLE = What carrier owes us after deducting their fees
    -- Example: Collected ₲1.000.000, Fees ₲50.000 → Net ₲950.000
    net_amount DECIMAL(12,2) GENERATED ALWAYS AS (total_cod_collected - total_shipping_cost) STORED,

    -- Settlement status
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled')),
    payment_date DATE,
    payment_method VARCHAR(50),            -- transfer, cash, cheque, etc.
    payment_reference VARCHAR(255),        -- bank ref, transaction ID, cheque number

    -- Metadata
    notes TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),

    -- Ensure no duplicate settlements for same period
    CONSTRAINT unique_carrier_settlement_period UNIQUE(store_id, carrier_id, settlement_period_start, settlement_period_end)
);

-- Indexes for carrier_settlements
CREATE INDEX IF NOT EXISTS idx_carrier_settlements_store ON carrier_settlements(store_id);
CREATE INDEX IF NOT EXISTS idx_carrier_settlements_carrier ON carrier_settlements(carrier_id);
CREATE INDEX IF NOT EXISTS idx_carrier_settlements_status ON carrier_settlements(status);
CREATE INDEX IF NOT EXISTS idx_carrier_settlements_period ON carrier_settlements(settlement_period_start, settlement_period_end);
CREATE INDEX IF NOT EXISTS idx_carrier_settlements_pending ON carrier_settlements(status, carrier_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_carrier_settlements_date ON carrier_settlements(created_at DESC);

-- ================================================================
-- 5. ADD FOREIGN KEY TO ORDERS
-- ================================================================
-- Link orders to carrier settlements

ALTER TABLE orders DROP CONSTRAINT IF EXISTS fk_orders_carrier_settlement;
ALTER TABLE orders ADD CONSTRAINT fk_orders_carrier_settlement
    FOREIGN KEY (carrier_settlement_id)
    REFERENCES carrier_settlements(id)
    ON DELETE SET NULL;

-- ================================================================
-- 6. CREATE TRIGGERS FOR UPDATED_AT
-- ================================================================

-- Trigger for carrier_zones
DROP TRIGGER IF EXISTS trigger_update_carrier_zones_timestamp ON carrier_zones;
CREATE TRIGGER trigger_update_carrier_zones_timestamp
    BEFORE UPDATE ON carrier_zones
    FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

-- Trigger for carrier_settlements
DROP TRIGGER IF EXISTS trigger_update_carrier_settlements_timestamp ON carrier_settlements;
CREATE TRIGGER trigger_update_carrier_settlements_timestamp
    BEFORE UPDATE ON carrier_settlements
    FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

-- ================================================================
-- 7. CREATE HELPER FUNCTION FOR SETTLEMENT CREATION
-- ================================================================
-- Purpose: Automate bulk settlement creation with proper calculations

CREATE OR REPLACE FUNCTION create_carrier_settlement(
    p_store_id UUID,
    p_carrier_id UUID,
    p_period_start DATE,
    p_period_end DATE,
    p_created_by UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_settlement_id UUID;
    v_total_orders INT;
    v_total_cod DECIMAL(12,2);
    v_total_shipping DECIMAL(12,2);
BEGIN
    -- Calculate totals from delivered orders in period (not yet settled)
    SELECT
        COUNT(*),
        COALESCE(SUM(total_price), 0),
        COALESCE(SUM(shipping_cost), 0)
    INTO v_total_orders, v_total_cod, v_total_shipping
    FROM orders
    WHERE store_id = p_store_id
      AND courier_id = p_carrier_id
      AND sleeves_status = 'delivered'
      AND delivered_at >= p_period_start
      AND delivered_at < (p_period_end + INTERVAL '1 day')
      AND carrier_settlement_id IS NULL;

    -- Validate that there are orders to settle
    IF v_total_orders = 0 THEN
        RAISE EXCEPTION 'No hay pedidos entregados en el período seleccionado';
    END IF;

    -- Create settlement record
    INSERT INTO carrier_settlements (
        store_id, carrier_id,
        settlement_period_start, settlement_period_end,
        total_orders, total_cod_collected, total_shipping_cost,
        status, created_by
    ) VALUES (
        p_store_id, p_carrier_id,
        p_period_start, p_period_end,
        v_total_orders, v_total_cod, v_total_shipping,
        'pending', p_created_by
    )
    RETURNING id INTO v_settlement_id;

    -- Link orders to this settlement
    UPDATE orders
    SET carrier_settlement_id = v_settlement_id
    WHERE store_id = p_store_id
      AND courier_id = p_carrier_id
      AND sleeves_status = 'delivered'
      AND delivered_at >= p_period_start
      AND delivered_at < (p_period_end + INTERVAL '1 day')
      AND carrier_settlement_id IS NULL;

    RETURN v_settlement_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION create_carrier_settlement IS 'Creates bulk settlement for carrier in date range and links delivered orders';

-- ================================================================
-- 8. CREATE VIEW FOR PENDING SETTLEMENTS SUMMARY
-- ================================================================
-- Purpose: Show carriers with pending deliveries (not yet settled)

CREATE OR REPLACE VIEW pending_carrier_settlements_summary AS
SELECT
    c.id as carrier_id,
    c.name as carrier_name,
    c.carrier_type,
    c.store_id,
    COUNT(DISTINCT o.id) as pending_orders_count,
    COALESCE(SUM(o.total_price), 0) as total_cod_pending,
    COALESCE(SUM(o.shipping_cost), 0) as total_shipping_cost_pending,
    COALESCE(SUM(o.total_price) - SUM(o.shipping_cost), 0) as net_receivable_pending,
    MIN(o.delivered_at)::date as oldest_delivery_date,
    MAX(o.delivered_at)::date as newest_delivery_date
FROM carriers c
INNER JOIN orders o ON o.courier_id = c.id
WHERE o.sleeves_status = 'delivered'
  AND o.carrier_settlement_id IS NULL
  AND c.carrier_type = 'external'
  AND c.is_active = TRUE
GROUP BY c.id, c.name, c.carrier_type, c.store_id
HAVING COUNT(o.id) > 0
ORDER BY oldest_delivery_date ASC;

COMMENT ON VIEW pending_carrier_settlements_summary IS 'Shows external carriers with delivered orders pending settlement';

-- ================================================================
-- 9. GRANT PERMISSIONS
-- ================================================================

GRANT ALL ON carrier_zones TO postgres;
GRANT SELECT, INSERT, UPDATE, DELETE ON carrier_zones TO authenticated;

GRANT ALL ON carrier_settlements TO postgres;
GRANT SELECT, INSERT, UPDATE, DELETE ON carrier_settlements TO authenticated;

GRANT SELECT ON pending_carrier_settlements_summary TO authenticated;
GRANT EXECUTE ON FUNCTION create_carrier_settlement TO authenticated;

-- ================================================================
-- 10. SAMPLE DATA (OPTIONAL - FOR TESTING)
-- ================================================================
-- Uncomment to insert sample zones for testing

/*
-- Example: Add zones for an existing carrier (replace carrier_id with real UUID)
INSERT INTO carrier_zones (store_id, carrier_id, zone_name, zone_code, rate) VALUES
    ((SELECT id FROM stores LIMIT 1), (SELECT id FROM carriers LIMIT 1), 'Asunción', 'ASU', 30000.00),
    ((SELECT id FROM stores LIMIT 1), (SELECT id FROM carriers LIMIT 1), 'Gran Asunción', 'GRA', 40000.00),
    ((SELECT id FROM stores LIMIT 1), (SELECT id FROM carriers LIMIT 1), 'Interior', 'INT', 50000.00);
*/

-- ================================================================
-- ✅ MIGRATION 016 COMPLETED
-- ================================================================
-- New Tables:
--   - carrier_zones (zone-based pricing)
--   - carrier_settlements (deferred payment tracking)
--
-- Updated Tables:
--   - carriers (added carrier_type, default_zone)
--   - orders (added shipping_cost, delivery_zone, carrier_settlement_id)
--
-- New Functions:
--   - create_carrier_settlement() (bulk settlement automation)
--
-- New Views:
--   - pending_carrier_settlements_summary (pending deliveries by carrier)
-- ================================================================

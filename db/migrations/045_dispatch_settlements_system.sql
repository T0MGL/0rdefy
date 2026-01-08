-- ================================================================
-- MIGRATION 045: Dispatch Sessions & Daily Settlements System
-- ================================================================
-- Purpose: Complete cashflow reconciliation system for couriers
--
-- Flow:
--   1. DISPATCH: Select orders → Assign courier → Export CSV
--   2. COURIER: Updates CSV with delivery results
--   3. IMPORT: Import CSV → Process results → Generate settlement
--   4. SETTLEMENT: Calculate COD collected - carrier fees = Net receivable
-- ================================================================

-- ================================================================
-- 1. DISPATCH SESSIONS TABLE
-- ================================================================
-- Purpose: Track batches of orders dispatched to couriers daily
-- Each session generates a CSV for the courier

CREATE TABLE IF NOT EXISTS dispatch_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    carrier_id UUID NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,

    -- Session identification
    session_code VARCHAR(30) NOT NULL,           -- Format: DISP-DDMMYYYY-NN (e.g., DISP-07012026-01)
    dispatch_date DATE NOT NULL DEFAULT CURRENT_DATE,

    -- Order counts
    total_orders INT NOT NULL DEFAULT 0,
    total_cod_expected DECIMAL(12,2) DEFAULT 0,  -- Sum of COD orders' total_price
    total_prepaid INT DEFAULT 0,                  -- Count of prepaid orders

    -- Status tracking
    status VARCHAR(20) DEFAULT 'dispatched' CHECK (status IN (
        'dispatched',    -- Orders sent out with courier
        'processing',    -- CSV imported, being processed
        'settled',       -- Settlement created
        'cancelled'      -- Session cancelled
    )),

    -- Settlement link (created after import)
    daily_settlement_id UUID,

    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    exported_at TIMESTAMP,                        -- When CSV was exported
    imported_at TIMESTAMP,                        -- When results CSV was imported
    settled_at TIMESTAMP,                         -- When settlement was finalized

    -- Creator
    created_by UUID REFERENCES users(id),

    -- Ensure unique session codes per store
    CONSTRAINT unique_dispatch_session_code UNIQUE(store_id, session_code)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_dispatch_sessions_store ON dispatch_sessions(store_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_sessions_carrier ON dispatch_sessions(carrier_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_sessions_date ON dispatch_sessions(dispatch_date DESC);
CREATE INDEX IF NOT EXISTS idx_dispatch_sessions_status ON dispatch_sessions(status);

-- ================================================================
-- 2. DISPATCH SESSION ORDERS TABLE
-- ================================================================
-- Purpose: Link orders to dispatch sessions with delivery results

CREATE TABLE IF NOT EXISTS dispatch_session_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dispatch_session_id UUID NOT NULL REFERENCES dispatch_sessions(id) ON DELETE CASCADE,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,

    -- Order snapshot at dispatch time
    order_number VARCHAR(50),
    customer_name VARCHAR(255),
    customer_phone VARCHAR(50),
    delivery_address TEXT,
    delivery_city VARCHAR(100),
    delivery_zone VARCHAR(100),

    -- Financial snapshot
    total_price DECIMAL(12,2) NOT NULL,           -- Order total at dispatch
    payment_method VARCHAR(50),                    -- CONTRA ENTREGA, PAGO ANTICIPADO, etc.
    is_cod BOOLEAN DEFAULT TRUE,                   -- True if courier needs to collect

    -- Carrier fee (from zone rate)
    carrier_fee DECIMAL(12,2) DEFAULT 0,

    -- ============================================================
    -- COURIER FILLS THESE (from CSV import)
    -- ============================================================
    delivery_status VARCHAR(30) DEFAULT 'pending' CHECK (delivery_status IN (
        'pending',       -- Not yet processed
        'delivered',     -- Successfully delivered
        'not_delivered', -- Could not deliver
        'rejected',      -- Customer rejected
        'rescheduled',   -- Will try again
        'returned'       -- Returned to sender
    )),

    -- Amount actually collected (may differ from total_price)
    amount_collected DECIMAL(12,2),

    -- Reason for non-delivery
    failure_reason VARCHAR(50) CHECK (failure_reason IS NULL OR failure_reason IN (
        'no_answer',            -- No contesta
        'wrong_address',        -- Dirección incorrecta
        'customer_absent',      -- Cliente ausente
        'customer_rejected',    -- Cliente rechazó
        'insufficient_funds',   -- Sin dinero
        'address_not_found',    -- No se encontró dirección
        'rescheduled',          -- Reprogramado
        'other'                 -- Otro
    )),

    -- Additional notes from courier
    courier_notes TEXT,

    -- Processing timestamps
    delivered_at TIMESTAMP,
    processed_at TIMESTAMP,                        -- When this row was processed from import

    -- Unique order per session
    CONSTRAINT unique_order_per_dispatch UNIQUE(dispatch_session_id, order_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_dispatch_orders_session ON dispatch_session_orders(dispatch_session_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_orders_order ON dispatch_session_orders(order_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_orders_status ON dispatch_session_orders(delivery_status);
CREATE INDEX IF NOT EXISTS idx_dispatch_orders_cod ON dispatch_session_orders(is_cod) WHERE is_cod = TRUE;

-- ================================================================
-- 3. DAILY SETTLEMENTS TABLE - ADD NEW COLUMNS TO EXISTING TABLE
-- ================================================================
-- Purpose: End-of-day financial reconciliation with courier
-- NOTE: The daily_settlements table already exists in the master migration.
-- We're adding new columns to support the dispatch workflow.

-- Add dispatch session link
ALTER TABLE daily_settlements
    ADD COLUMN IF NOT EXISTS dispatch_session_id UUID;

-- Add settlement code for new system
ALTER TABLE daily_settlements
    ADD COLUMN IF NOT EXISTS settlement_code VARCHAR(30);

-- Add order counts
ALTER TABLE daily_settlements
    ADD COLUMN IF NOT EXISTS total_dispatched INT DEFAULT 0;

ALTER TABLE daily_settlements
    ADD COLUMN IF NOT EXISTS total_delivered INT DEFAULT 0;

ALTER TABLE daily_settlements
    ADD COLUMN IF NOT EXISTS total_not_delivered INT DEFAULT 0;

ALTER TABLE daily_settlements
    ADD COLUMN IF NOT EXISTS total_cod_delivered INT DEFAULT 0;

ALTER TABLE daily_settlements
    ADD COLUMN IF NOT EXISTS total_prepaid_delivered INT DEFAULT 0;

-- Add financial columns
ALTER TABLE daily_settlements
    ADD COLUMN IF NOT EXISTS total_cod_collected DECIMAL(12,2) DEFAULT 0;

ALTER TABLE daily_settlements
    ADD COLUMN IF NOT EXISTS total_carrier_fees DECIMAL(12,2) DEFAULT 0;

ALTER TABLE daily_settlements
    ADD COLUMN IF NOT EXISTS failed_attempt_fee DECIMAL(12,2) DEFAULT 0;

-- Add payment tracking columns
ALTER TABLE daily_settlements
    ADD COLUMN IF NOT EXISTS amount_paid DECIMAL(12,2) DEFAULT 0;

ALTER TABLE daily_settlements
    ADD COLUMN IF NOT EXISTS payment_date DATE;

ALTER TABLE daily_settlements
    ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50);

ALTER TABLE daily_settlements
    ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(255);

ALTER TABLE daily_settlements
    ADD COLUMN IF NOT EXISTS dispute_reason TEXT;

ALTER TABLE daily_settlements
    ADD COLUMN IF NOT EXISTS created_by UUID;

-- Add net_receivable as computed column (if not generated, we'll calculate in app)
-- Note: Can't add GENERATED columns via ALTER TABLE easily, so we'll handle in code
ALTER TABLE daily_settlements
    ADD COLUMN IF NOT EXISTS net_receivable DECIMAL(12,2) DEFAULT 0;

ALTER TABLE daily_settlements
    ADD COLUMN IF NOT EXISTS balance_due DECIMAL(12,2) DEFAULT 0;

-- Update status check constraint to allow new values
-- First drop the existing constraint if it exists
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.check_constraints
        WHERE constraint_name = 'daily_settlements_status_check'
    ) THEN
        ALTER TABLE daily_settlements DROP CONSTRAINT daily_settlements_status_check;
    END IF;
END $$;

-- Add new constraint with all status values
ALTER TABLE daily_settlements
    ADD CONSTRAINT daily_settlements_status_check
    CHECK (status IN ('pending', 'completed', 'with_issues', 'partial', 'paid', 'disputed', 'cancelled'));

-- Add foreign key for dispatch_session_id (if dispatch_sessions table exists)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'fk_daily_settlements_dispatch_session'
    ) THEN
        ALTER TABLE daily_settlements
            ADD CONSTRAINT fk_daily_settlements_dispatch_session
            FOREIGN KEY (dispatch_session_id)
            REFERENCES dispatch_sessions(id)
            ON DELETE SET NULL;
    END IF;
EXCEPTION WHEN OTHERS THEN
    -- Ignore if constraint already exists or dispatch_sessions doesn't exist yet
    NULL;
END $$;

-- Link dispatch_sessions to daily_settlements (the other direction)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'fk_dispatch_daily_settlement'
    ) THEN
        ALTER TABLE dispatch_sessions
            ADD CONSTRAINT fk_dispatch_daily_settlement
            FOREIGN KEY (daily_settlement_id)
            REFERENCES daily_settlements(id)
            ON DELETE SET NULL;
    END IF;
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;

-- Indexes for new columns
CREATE INDEX IF NOT EXISTS idx_daily_settlements_dispatch ON daily_settlements(dispatch_session_id) WHERE dispatch_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_daily_settlements_code ON daily_settlements(settlement_code) WHERE settlement_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_daily_settlements_pending ON daily_settlements(status, carrier_id) WHERE status = 'pending';

-- ================================================================
-- 4. FUNCTION: Generate Dispatch Session Code
-- ================================================================

CREATE OR REPLACE FUNCTION generate_dispatch_session_code(p_store_id UUID, p_date DATE DEFAULT CURRENT_DATE)
RETURNS VARCHAR(30) AS $$
DECLARE
    v_count INT;
    v_date_str VARCHAR(8);
BEGIN
    v_date_str := TO_CHAR(p_date, 'DDMMYYYY');

    SELECT COUNT(*) + 1 INTO v_count
    FROM dispatch_sessions
    WHERE store_id = p_store_id
      AND dispatch_date = p_date;

    RETURN 'DISP-' || v_date_str || '-' || LPAD(v_count::TEXT, 2, '0');
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- 5. FUNCTION: Generate Settlement Code
-- ================================================================

CREATE OR REPLACE FUNCTION generate_settlement_code(p_store_id UUID, p_date DATE DEFAULT CURRENT_DATE)
RETURNS VARCHAR(30) AS $$
DECLARE
    v_count INT;
    v_date_str VARCHAR(8);
BEGIN
    v_date_str := TO_CHAR(p_date, 'DDMMYYYY');

    SELECT COUNT(*) + 1 INTO v_count
    FROM daily_settlements
    WHERE store_id = p_store_id
      AND settlement_date = p_date;

    RETURN 'LIQ-' || v_date_str || '-' || LPAD(v_count::TEXT, 2, '0');
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- 6. FUNCTION: Create Dispatch Session
-- ================================================================
-- Creates a dispatch session and links selected orders

CREATE OR REPLACE FUNCTION create_dispatch_session(
    p_store_id UUID,
    p_carrier_id UUID,
    p_order_ids UUID[],
    p_created_by UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_session_id UUID;
    v_session_code VARCHAR(30);
    v_order RECORD;
    v_zone_rate DECIMAL(12,2);
    v_total_cod DECIMAL(12,2) := 0;
    v_total_prepaid INT := 0;
BEGIN
    -- Generate session code
    v_session_code := generate_dispatch_session_code(p_store_id);

    -- Create dispatch session
    INSERT INTO dispatch_sessions (
        store_id, carrier_id, session_code, dispatch_date,
        total_orders, status, created_by, exported_at
    ) VALUES (
        p_store_id, p_carrier_id, v_session_code, CURRENT_DATE,
        array_length(p_order_ids, 1), 'dispatched', p_created_by, NOW()
    )
    RETURNING id INTO v_session_id;

    -- Add orders to session
    FOR v_order IN
        SELECT o.*, c.name as customer_name_val, c.phone as customer_phone_val
        FROM orders o
        LEFT JOIN customers c ON o.customer_id = c.id
        WHERE o.id = ANY(p_order_ids)
    LOOP
        -- Get zone rate for this order's city
        SELECT COALESCE(cz.rate, 0) INTO v_zone_rate
        FROM carrier_zones cz
        WHERE cz.carrier_id = p_carrier_id
          AND cz.is_active = TRUE
          AND (
              LOWER(cz.zone_name) = LOWER(COALESCE(v_order.delivery_zone, v_order.shipping_city, ''))
              OR LOWER(cz.zone_name) = LOWER(COALESCE(v_order.shipping_city, ''))
          )
        LIMIT 1;

        -- If no specific zone found, try default
        IF v_zone_rate IS NULL OR v_zone_rate = 0 THEN
            SELECT COALESCE(cz.rate, 0) INTO v_zone_rate
            FROM carrier_zones cz
            WHERE cz.carrier_id = p_carrier_id
              AND cz.is_active = TRUE
              AND cz.zone_code = 'DEFAULT'
            LIMIT 1;
        END IF;

        -- Insert order into dispatch session
        INSERT INTO dispatch_session_orders (
            dispatch_session_id, order_id,
            order_number, customer_name, customer_phone,
            delivery_address, delivery_city, delivery_zone,
            total_price, payment_method, is_cod, carrier_fee
        ) VALUES (
            v_session_id, v_order.id,
            v_order.order_number, v_order.customer_name_val, v_order.customer_phone_val,
            CONCAT_WS(', ', v_order.shipping_address, v_order.shipping_reference),
            v_order.shipping_city, COALESCE(v_order.delivery_zone, v_order.shipping_city),
            v_order.total_price,
            COALESCE(v_order.payment_method, 'CONTRA ENTREGA'),
            COALESCE(v_order.payment_method, 'CONTRA ENTREGA') = 'CONTRA ENTREGA',
            COALESCE(v_zone_rate, 0)
        );

        -- Update order status to shipped and assign carrier
        UPDATE orders
        SET sleeves_status = 'shipped',
            courier_id = p_carrier_id,
            shipped_at = NOW()
        WHERE id = v_order.id
          AND sleeves_status IN ('ready_to_ship', 'shipped');

        -- Track totals
        IF COALESCE(v_order.payment_method, 'CONTRA ENTREGA') = 'CONTRA ENTREGA' THEN
            v_total_cod := v_total_cod + COALESCE(v_order.total_price, 0);
        ELSE
            v_total_prepaid := v_total_prepaid + 1;
        END IF;
    END LOOP;

    -- Update session totals
    UPDATE dispatch_sessions
    SET total_cod_expected = v_total_cod,
        total_prepaid = v_total_prepaid
    WHERE id = v_session_id;

    RETURN v_session_id;
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- 7. FUNCTION: Process Dispatch Results & Create Settlement
-- ================================================================
-- Called after importing CSV with delivery results

CREATE OR REPLACE FUNCTION process_dispatch_settlement(
    p_dispatch_session_id UUID,
    p_created_by UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_session RECORD;
    v_settlement_id UUID;
    v_settlement_code VARCHAR(30);
    v_stats RECORD;
BEGIN
    -- Get session info
    SELECT * INTO v_session
    FROM dispatch_sessions
    WHERE id = p_dispatch_session_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Dispatch session not found';
    END IF;

    IF v_session.status = 'settled' THEN
        RAISE EXCEPTION 'Session already settled';
    END IF;

    -- Calculate statistics from dispatch_session_orders
    SELECT
        COUNT(*) as total_dispatched,
        COUNT(*) FILTER (WHERE delivery_status = 'delivered') as total_delivered,
        COUNT(*) FILTER (WHERE delivery_status IN ('not_delivered', 'rejected', 'returned')) as total_not_delivered,
        COUNT(*) FILTER (WHERE delivery_status = 'delivered' AND is_cod = TRUE) as total_cod_delivered,
        COUNT(*) FILTER (WHERE delivery_status = 'delivered' AND is_cod = FALSE) as total_prepaid_delivered,
        COALESCE(SUM(amount_collected) FILTER (WHERE delivery_status = 'delivered'), 0) as total_cod_collected,
        COALESCE(SUM(carrier_fee) FILTER (WHERE delivery_status = 'delivered'), 0) as total_carrier_fees,
        COALESCE(SUM(carrier_fee) FILTER (WHERE delivery_status IN ('not_delivered', 'rejected')) * 0.5, 0) as failed_attempt_fee
    INTO v_stats
    FROM dispatch_session_orders
    WHERE dispatch_session_id = p_dispatch_session_id;

    -- Generate settlement code
    v_settlement_code := generate_settlement_code(v_session.store_id);

    -- Create daily settlement
    INSERT INTO daily_settlements (
        store_id, carrier_id, dispatch_session_id,
        settlement_code, settlement_date,
        total_dispatched, total_delivered, total_not_delivered,
        total_cod_delivered, total_prepaid_delivered,
        total_cod_collected, total_carrier_fees, failed_attempt_fee,
        status, created_by
    ) VALUES (
        v_session.store_id, v_session.carrier_id, p_dispatch_session_id,
        v_settlement_code, CURRENT_DATE,
        v_stats.total_dispatched, v_stats.total_delivered, v_stats.total_not_delivered,
        v_stats.total_cod_delivered, v_stats.total_prepaid_delivered,
        v_stats.total_cod_collected, v_stats.total_carrier_fees, v_stats.failed_attempt_fee,
        'pending', p_created_by
    )
    RETURNING id INTO v_settlement_id;

    -- Update dispatch session
    UPDATE dispatch_sessions
    SET status = 'settled',
        daily_settlement_id = v_settlement_id,
        settled_at = NOW()
    WHERE id = p_dispatch_session_id;

    -- Update orders with final status
    UPDATE orders o
    SET sleeves_status = CASE
            WHEN dso.delivery_status = 'delivered' THEN 'delivered'
            WHEN dso.delivery_status = 'rejected' THEN 'cancelled'
            WHEN dso.delivery_status = 'returned' THEN 'returned'
            ELSE o.sleeves_status
        END,
        delivered_at = CASE WHEN dso.delivery_status = 'delivered' THEN COALESCE(dso.delivered_at, NOW()) ELSE NULL END
    FROM dispatch_session_orders dso
    WHERE dso.dispatch_session_id = p_dispatch_session_id
      AND dso.order_id = o.id
      AND dso.delivery_status != 'pending';

    RETURN v_settlement_id;
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- 8. FUNCTION: Mark Settlement as Paid
-- ================================================================

CREATE OR REPLACE FUNCTION mark_settlement_paid(
    p_settlement_id UUID,
    p_amount DECIMAL(12,2),
    p_method VARCHAR(50),
    p_reference VARCHAR(255) DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
    v_settlement RECORD;
    v_new_status VARCHAR(20);
BEGIN
    SELECT * INTO v_settlement
    FROM daily_settlements
    WHERE id = p_settlement_id;

    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    -- Calculate new status
    IF (v_settlement.amount_paid + p_amount) >= v_settlement.net_receivable THEN
        v_new_status := 'paid';
    ELSE
        v_new_status := 'partial';
    END IF;

    UPDATE daily_settlements
    SET amount_paid = amount_paid + p_amount,
        payment_date = CURRENT_DATE,
        payment_method = p_method,
        payment_reference = COALESCE(p_reference, payment_reference),
        status = v_new_status
    WHERE id = p_settlement_id;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- 9. VIEW: Pending Settlements Summary
-- ================================================================

CREATE OR REPLACE VIEW v_pending_settlements AS
SELECT
    ds.id,
    ds.store_id,
    ds.carrier_id,
    c.name as carrier_name,
    ds.settlement_code,
    ds.settlement_date,
    ds.total_dispatched,
    ds.total_delivered,
    ds.total_not_delivered,
    ds.total_cod_collected,
    ds.total_carrier_fees,
    ds.net_receivable,
    ds.amount_paid,
    ds.balance_due,
    ds.status,
    ds.created_at
FROM daily_settlements ds
JOIN carriers c ON c.id = ds.carrier_id
WHERE ds.status IN ('pending', 'partial')
ORDER BY ds.settlement_date DESC;

-- ================================================================
-- 10. VIEW: Dispatch Session Details
-- ================================================================

CREATE OR REPLACE VIEW v_dispatch_session_details AS
SELECT
    dso.dispatch_session_id,
    dso.order_id,
    dso.order_number,
    dso.customer_name,
    dso.customer_phone,
    dso.delivery_address,
    dso.delivery_city,
    dso.delivery_zone,
    dso.total_price,
    dso.payment_method,
    dso.is_cod,
    dso.carrier_fee,
    dso.delivery_status,
    dso.amount_collected,
    dso.failure_reason,
    dso.courier_notes,
    dso.delivered_at,
    ds.session_code,
    ds.dispatch_date,
    c.name as carrier_name
FROM dispatch_session_orders dso
JOIN dispatch_sessions ds ON ds.id = dso.dispatch_session_id
JOIN carriers c ON c.id = ds.carrier_id
ORDER BY ds.dispatch_date DESC, dso.order_number;

-- ================================================================
-- 11. TRIGGERS
-- ================================================================

-- Update timestamp triggers
DROP TRIGGER IF EXISTS trigger_update_dispatch_sessions_timestamp ON dispatch_sessions;
CREATE TRIGGER trigger_update_dispatch_sessions_timestamp
    BEFORE UPDATE ON dispatch_sessions
    FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

DROP TRIGGER IF EXISTS trigger_update_daily_settlements_timestamp ON daily_settlements;
CREATE TRIGGER trigger_update_daily_settlements_timestamp
    BEFORE UPDATE ON daily_settlements
    FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

-- ================================================================
-- 12. RLS POLICIES
-- ================================================================

-- Enable RLS
ALTER TABLE dispatch_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispatch_session_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_settlements ENABLE ROW LEVEL SECURITY;

-- Dispatch sessions policies
DROP POLICY IF EXISTS "dispatch_sessions_store_access" ON dispatch_sessions;
CREATE POLICY "dispatch_sessions_store_access" ON dispatch_sessions
    FOR ALL USING (
        store_id IN (SELECT store_id FROM user_stores WHERE user_id = auth.uid())
    );

-- Dispatch session orders policies
DROP POLICY IF EXISTS "dispatch_session_orders_access" ON dispatch_session_orders;
CREATE POLICY "dispatch_session_orders_access" ON dispatch_session_orders
    FOR ALL USING (
        dispatch_session_id IN (
            SELECT id FROM dispatch_sessions
            WHERE store_id IN (SELECT store_id FROM user_stores WHERE user_id = auth.uid())
        )
    );

-- Daily settlements policies
DROP POLICY IF EXISTS "daily_settlements_store_access" ON daily_settlements;
CREATE POLICY "daily_settlements_store_access" ON daily_settlements
    FOR ALL USING (
        store_id IN (SELECT store_id FROM user_stores WHERE user_id = auth.uid())
    );

-- ================================================================
-- 13. GRANTS
-- ================================================================

GRANT ALL ON dispatch_sessions TO postgres;
GRANT SELECT, INSERT, UPDATE, DELETE ON dispatch_sessions TO authenticated;

GRANT ALL ON dispatch_session_orders TO postgres;
GRANT SELECT, INSERT, UPDATE, DELETE ON dispatch_session_orders TO authenticated;

GRANT ALL ON daily_settlements TO postgres;
GRANT SELECT, INSERT, UPDATE, DELETE ON daily_settlements TO authenticated;

GRANT SELECT ON v_pending_settlements TO authenticated;
GRANT SELECT ON v_dispatch_session_details TO authenticated;

GRANT EXECUTE ON FUNCTION generate_dispatch_session_code TO authenticated;
GRANT EXECUTE ON FUNCTION generate_settlement_code TO authenticated;
GRANT EXECUTE ON FUNCTION create_dispatch_session TO authenticated;
GRANT EXECUTE ON FUNCTION process_dispatch_settlement TO authenticated;
GRANT EXECUTE ON FUNCTION mark_settlement_paid TO authenticated;

-- ================================================================
-- ✅ MIGRATION 045 COMPLETED
-- ================================================================
-- New Tables:
--   - dispatch_sessions (batch dispatch tracking)
--   - dispatch_session_orders (order-level dispatch details)
--   - daily_settlements (end-of-day financial reconciliation)
--
-- New Functions:
--   - generate_dispatch_session_code()
--   - generate_settlement_code()
--   - create_dispatch_session()
--   - process_dispatch_settlement()
--   - mark_settlement_paid()
--
-- New Views:
--   - v_pending_settlements
--   - v_dispatch_session_details
--
-- Flow:
--   1. create_dispatch_session() - Create session with orders
--   2. Export CSV for courier
--   3. Import CSV results (update dispatch_session_orders)
--   4. process_dispatch_settlement() - Generate settlement
--   5. mark_settlement_paid() - Record payment
-- ================================================================

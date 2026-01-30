-- =============================================
-- Migration 065: Unified Carrier Account System
-- =============================================
-- Purpose: Create a unified system to track money flow between store and carriers
--          regardless of whether orders are processed via CSV/Excel or direct QR marking.
--
-- This migration creates:
-- 1. Carrier configuration (settlement_type, charges_failed_attempts)
-- 2. carrier_account_movements - Tracks ALL money flows (COD collected, fees owed, payments)
-- 3. carrier_payment_records - Formal payment registration
-- 4. Automatic triggers to create movements when orders are delivered
-- 5. Views for balance calculation and reporting
--
-- Business Rules:
-- - When courier delivers COD order: They OWE us the COD amount
-- - When courier delivers ANY order: We OWE them the carrier fee
-- - When courier fails delivery: We may OWE them partial fee (configurable)
-- - Net balance = What they owe us - What we owe them
-- - Positive balance = Courier owes store
-- - Negative balance = Store owes courier
--
-- PRODUCTION HARDENING (v1.1):
-- - Added SECURITY DEFINER to trigger functions
-- - Made FK references conditional (dispatch_sessions, daily_settlements)
-- - Added carrier_zones table existence check
-- - Added service_role grants
-- - Added advisory lock to payment code generator
-- - Added error handling in trigger
--
-- Author: Claude
-- Date: 2026-01-13
-- Updated: 2026-01-30 (production hardening)
--
-- NOTE: Migration 119 fixes prepaid detection bug in create_delivery_movements()
-- =============================================

BEGIN;

-- =============================================
-- 0. DEPENDENCY CHECK
-- =============================================
-- Fail early with clear message if dependencies are missing

DO $$
BEGIN
    -- Check carriers table exists (from migration 008b)
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'carriers') THEN
        RAISE EXCEPTION E'\n\n========================================\nDEPENDENCY MISSING: Table "carriers" not found.\nPlease run migration 008b_create_carriers.sql first.\n========================================\n';
    END IF;

    -- Check stores table exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'stores') THEN
        RAISE EXCEPTION E'\n\n========================================\nDEPENDENCY MISSING: Table "stores" not found.\nPlease run the base migrations (000_MASTER_MIGRATION.sql) first.\n========================================\n';
    END IF;

    -- Check orders table exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'orders') THEN
        RAISE EXCEPTION E'\n\n========================================\nDEPENDENCY MISSING: Table "orders" not found.\nPlease run the base migrations first.\n========================================\n';
    END IF;

    RAISE NOTICE 'Dependency check passed: carriers, stores, orders tables exist';
END $$;

-- =============================================
-- 1. ADD CARRIER CONFIGURATION FIELDS
-- =============================================

-- Settlement type determines how payments are handled
ALTER TABLE carriers
ADD COLUMN IF NOT EXISTS settlement_type VARCHAR(20) DEFAULT 'gross'
CHECK (settlement_type IN (
    'net',      -- Courier deducts fees from COD and delivers net amount
    'gross',    -- Courier delivers full COD, store pays fees separately
    'salary'    -- Courier on fixed salary, no per-delivery fees
));

COMMENT ON COLUMN carriers.settlement_type IS
'How this carrier handles settlements: net (deducts fees), gross (full COD), salary (fixed pay)';

-- Whether carrier charges for failed delivery attempts
ALTER TABLE carriers
ADD COLUMN IF NOT EXISTS charges_failed_attempts BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN carriers.charges_failed_attempts IS
'If true, carrier charges 50% fee for failed delivery attempts';

-- Default payment schedule (for reference, not enforced)
ALTER TABLE carriers
ADD COLUMN IF NOT EXISTS payment_schedule VARCHAR(20) DEFAULT 'weekly'
CHECK (payment_schedule IN ('daily', 'weekly', 'biweekly', 'monthly', 'on_demand'));

COMMENT ON COLUMN carriers.payment_schedule IS
'Default payment schedule for this carrier (informational)';

-- =============================================
-- 2. CARRIER ACCOUNT MOVEMENTS TABLE
-- =============================================
-- Central table tracking ALL money flows with carriers

CREATE TABLE IF NOT EXISTS carrier_account_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    carrier_id UUID NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,

    -- Movement type determines the sign of the amount
    movement_type VARCHAR(30) NOT NULL CHECK (movement_type IN (
        'cod_collected',        -- Courier collected COD (they owe us) → positive
        'delivery_fee',         -- Fee for successful delivery (we owe them) → negative
        'failed_attempt_fee',   -- Fee for failed attempt (we owe them) → negative
        'payment_received',     -- Courier paid us (reduces their debt) → negative adjustment
        'payment_sent',         -- We paid courier (reduces our debt) → positive adjustment
        'adjustment_credit',    -- Manual credit to carrier → negative
        'adjustment_debit',     -- Manual debit to carrier → positive
        'discount',             -- Discount applied → negative
        'refund'                -- Refund of previous charge → varies
    )),

    -- Amount interpretation:
    -- Positive = Carrier owes store (COD collected, debit adjustments)
    -- Negative = Store owes carrier (fees, credits, payments sent)
    amount DECIMAL(12,2) NOT NULL,

    -- Reference to source order (if applicable)
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    order_number VARCHAR(50),

    -- Reference to dispatch session (if from dispatch flow)
    -- FK added conditionally below if table exists
    dispatch_session_id UUID,

    -- Reference to settlement (if part of formal settlement)
    -- FK added conditionally below if table exists
    settlement_id UUID,

    -- Reference to payment record (if this is a payment)
    payment_record_id UUID,  -- FK added after payment_records table created

    -- Description for audit
    description TEXT,

    -- Additional metadata (e.g., zone used for fee calculation)
    metadata JSONB DEFAULT '{}',

    -- Timestamps
    movement_date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMP DEFAULT NOW(),
    created_by UUID REFERENCES users(id),

    -- Prevent duplicate movements for same order
    CONSTRAINT unique_order_movement UNIQUE(order_id, movement_type)
);

-- Add FK to dispatch_sessions if table exists (from migration 045)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dispatch_sessions') THEN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.table_constraints
            WHERE constraint_name = 'fk_movements_dispatch_session'
        ) THEN
            ALTER TABLE carrier_account_movements
            ADD CONSTRAINT fk_movements_dispatch_session
            FOREIGN KEY (dispatch_session_id) REFERENCES dispatch_sessions(id) ON DELETE SET NULL;
            RAISE NOTICE 'Added FK to dispatch_sessions';
        END IF;
    ELSE
        RAISE NOTICE 'dispatch_sessions table not found, FK skipped (run migration 045 later)';
    END IF;
END $$;

-- Add FK to daily_settlements if table exists (from migration 045)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'daily_settlements') THEN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.table_constraints
            WHERE constraint_name = 'fk_movements_settlement'
        ) THEN
            ALTER TABLE carrier_account_movements
            ADD CONSTRAINT fk_movements_settlement
            FOREIGN KEY (settlement_id) REFERENCES daily_settlements(id) ON DELETE SET NULL;
            RAISE NOTICE 'Added FK to daily_settlements';
        END IF;
    ELSE
        RAISE NOTICE 'daily_settlements table not found, FK skipped (run migration 045 later)';
    END IF;
END $$;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_carrier_movements_store ON carrier_account_movements(store_id);
CREATE INDEX IF NOT EXISTS idx_carrier_movements_carrier ON carrier_account_movements(carrier_id);
CREATE INDEX IF NOT EXISTS idx_carrier_movements_date ON carrier_account_movements(movement_date DESC);
CREATE INDEX IF NOT EXISTS idx_carrier_movements_order ON carrier_account_movements(order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_carrier_movements_settlement ON carrier_account_movements(settlement_id) WHERE settlement_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_carrier_movements_type ON carrier_account_movements(movement_type);
CREATE INDEX IF NOT EXISTS idx_carrier_movements_unsettled ON carrier_account_movements(carrier_id, settlement_id) WHERE settlement_id IS NULL;

COMMENT ON TABLE carrier_account_movements IS
'Tracks ALL money flows between store and carriers. Positive = carrier owes store, Negative = store owes carrier.';

-- =============================================
-- 3. CARRIER PAYMENT RECORDS TABLE
-- =============================================
-- Formal record of payments made to/from carriers

CREATE TABLE IF NOT EXISTS carrier_payment_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    carrier_id UUID NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,

    -- Payment code for reference
    payment_code VARCHAR(30) NOT NULL,  -- Format: PAG-DDMMYYYY-NNN

    -- Payment direction
    direction VARCHAR(20) NOT NULL CHECK (direction IN (
        'from_carrier',  -- Carrier paying store (COD remittance)
        'to_carrier'     -- Store paying carrier (fees/salary)
    )),

    -- Amounts
    amount DECIMAL(12,2) NOT NULL,

    -- What this payment covers
    period_start DATE,
    period_end DATE,

    -- Settlements included in this payment
    settlement_ids UUID[] DEFAULT '{}',

    -- Movements covered by this payment (for direct QR deliveries)
    movement_ids UUID[] DEFAULT '{}',

    -- Payment method and reference
    payment_method VARCHAR(50) NOT NULL CHECK (payment_method IN (
        'cash',
        'bank_transfer',
        'mobile_payment',  -- Tigo Money, etc.
        'check',
        'deduction',       -- Deducted from COD
        'other'
    )),
    payment_reference VARCHAR(255),  -- Transaction ID, check number, etc.

    -- Status
    status VARCHAR(20) DEFAULT 'completed' CHECK (status IN (
        'pending',
        'completed',
        'cancelled',
        'disputed'
    )),

    -- Notes
    notes TEXT,

    -- Timestamps
    payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMP DEFAULT NOW(),
    created_by UUID REFERENCES users(id),

    -- Ensure unique payment codes per store
    CONSTRAINT unique_payment_code UNIQUE(store_id, payment_code)
);

-- Now add FK from movements to payment_records (idempotent)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'fk_movements_payment_record'
    ) THEN
        ALTER TABLE carrier_account_movements
        ADD CONSTRAINT fk_movements_payment_record
        FOREIGN KEY (payment_record_id) REFERENCES carrier_payment_records(id) ON DELETE SET NULL;
        RAISE NOTICE 'Added FK fk_movements_payment_record';
    END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_payment_records_store ON carrier_payment_records(store_id);
CREATE INDEX IF NOT EXISTS idx_payment_records_carrier ON carrier_payment_records(carrier_id);
CREATE INDEX IF NOT EXISTS idx_payment_records_date ON carrier_payment_records(payment_date DESC);
CREATE INDEX IF NOT EXISTS idx_payment_records_status ON carrier_payment_records(status);

COMMENT ON TABLE carrier_payment_records IS
'Formal record of payments between store and carriers';

-- =============================================
-- 4. FUNCTION: Generate Payment Code
-- =============================================

CREATE OR REPLACE FUNCTION generate_payment_code(p_store_id UUID, p_date DATE DEFAULT CURRENT_DATE)
RETURNS VARCHAR(30)
LANGUAGE plpgsql
AS $$
DECLARE
    v_count INT;
    v_date_str VARCHAR(8);
    v_lock_key BIGINT;
BEGIN
    v_date_str := TO_CHAR(p_date, 'DDMMYYYY');

    -- Generate lock key from store_id + date (prevents race conditions)
    v_lock_key := abs(hashtext(p_store_id::text || p_date::text));

    -- Acquire advisory lock for this store+date combination
    PERFORM pg_advisory_xact_lock(v_lock_key);

    SELECT COUNT(*) + 1 INTO v_count
    FROM carrier_payment_records
    WHERE store_id = p_store_id
      AND payment_date = p_date;

    RETURN 'PAG-' || v_date_str || '-' || LPAD(v_count::TEXT, 3, '0');
END;
$$;

COMMENT ON FUNCTION generate_payment_code(UUID, DATE) IS
'Generates payment code in format PAG-DDMMYYYY-NNN (with advisory lock for race-condition safety)';

-- =============================================
-- 5. FUNCTION: Get Carrier Fee for Order
-- =============================================
-- Gets the appropriate carrier fee based on order zone

CREATE OR REPLACE FUNCTION get_carrier_fee_for_order(
    p_carrier_id UUID,
    p_zone_name TEXT,
    p_city TEXT DEFAULT NULL
)
RETURNS DECIMAL(12,2)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_rate DECIMAL(12,2);
    v_fallback_zones TEXT[] := ARRAY['default', 'otros', 'interior', 'general'];
    v_zone TEXT;
    v_has_carrier_zones BOOLEAN;
    v_has_carrier_coverage BOOLEAN;
BEGIN
    -- Check if carrier_zones table exists
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'carrier_zones'
    ) INTO v_has_carrier_zones;

    -- Check if carrier_coverage table exists (from migration 090)
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'carrier_coverage'
    ) INTO v_has_carrier_coverage;

    -- If neither table exists, return 0
    IF NOT v_has_carrier_zones AND NOT v_has_carrier_coverage THEN
        RAISE WARNING 'Neither carrier_zones nor carrier_coverage tables exist. Returning 0 fee.';
        RETURN 0;
    END IF;

    -- Try carrier_coverage first (city-based rates from migration 090)
    IF v_has_carrier_coverage THEN
        SELECT rate INTO v_rate
        FROM carrier_coverage
        WHERE carrier_id = p_carrier_id
          AND is_active = TRUE
          AND LOWER(TRIM(city)) = LOWER(TRIM(COALESCE(p_city, '')))
        LIMIT 1;

        IF v_rate IS NOT NULL THEN
            RETURN v_rate;
        END IF;
    END IF;

    -- If carrier_zones doesn't exist, return 0 here
    IF NOT v_has_carrier_zones THEN
        RETURN 0;
    END IF;

    -- Try exact zone match first
    SELECT rate INTO v_rate
    FROM carrier_zones
    WHERE carrier_id = p_carrier_id
      AND is_active = true
      AND (
          LOWER(TRIM(zone_name)) = LOWER(TRIM(COALESCE(p_zone_name, '')))
          OR LOWER(TRIM(zone_name)) = LOWER(TRIM(COALESCE(p_city, '')))
      )
    LIMIT 1;

    IF v_rate IS NOT NULL THEN
        RETURN v_rate;
    END IF;

    -- Try fallback zones
    FOREACH v_zone IN ARRAY v_fallback_zones
    LOOP
        SELECT rate INTO v_rate
        FROM carrier_zones
        WHERE carrier_id = p_carrier_id
          AND is_active = true
          AND LOWER(TRIM(zone_name)) = v_zone
        LIMIT 1;

        IF v_rate IS NOT NULL THEN
            RETURN v_rate;
        END IF;
    END LOOP;

    -- Last resort: first active zone rate
    SELECT rate INTO v_rate
    FROM carrier_zones
    WHERE carrier_id = p_carrier_id
      AND is_active = true
    ORDER BY created_at
    LIMIT 1;

    RETURN COALESCE(v_rate, 0);
END;
$$;

COMMENT ON FUNCTION get_carrier_fee_for_order(UUID, TEXT, TEXT) IS
'Returns carrier fee for an order based on zone/city, with intelligent fallback.
Checks carrier_coverage (migration 090) first, then carrier_zones (migration 045).';

-- =============================================
-- 6. FUNCTION: Create Movement for Delivered Order
-- =============================================
-- Called when order is marked as delivered (any method)

CREATE OR REPLACE FUNCTION create_delivery_movements(
    p_order_id UUID,
    p_amount_collected DECIMAL(12,2) DEFAULT NULL,
    p_dispatch_session_id UUID DEFAULT NULL,
    p_created_by UUID DEFAULT NULL
)
RETURNS TABLE(
    cod_movement_id UUID,
    fee_movement_id UUID,
    total_cod DECIMAL(12,2),
    total_fee DECIMAL(12,2)
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order RECORD;
    v_carrier RECORD;
    v_carrier_fee DECIMAL(12,2);
    v_is_cod BOOLEAN;
    v_cod_amount DECIMAL(12,2);
    v_cod_movement_id UUID;
    v_fee_movement_id UUID;
BEGIN
    -- Get order details
    SELECT
        o.id, o.store_id, o.courier_id, o.order_number,
        o.total_price, o.payment_method, o.delivery_zone,
        o.shipping_city, o.sleeves_status
    INTO v_order
    FROM orders o
    WHERE o.id = p_order_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Order not found: %', p_order_id;
    END IF;

    IF v_order.courier_id IS NULL THEN
        RAISE EXCEPTION 'Order has no carrier assigned: %', p_order_id;
    END IF;

    -- Get carrier config
    SELECT c.id, c.settlement_type, c.charges_failed_attempts
    INTO v_carrier
    FROM carriers c
    WHERE c.id = v_order.courier_id;

    -- Determine if COD
    v_is_cod := COALESCE(v_order.payment_method, 'CONTRA ENTREGA') IN
                ('CONTRA ENTREGA', 'COD', 'CASH', 'EFECTIVO', 'contra entrega');

    -- Calculate COD amount
    IF v_is_cod THEN
        v_cod_amount := COALESCE(p_amount_collected, v_order.total_price);
    ELSE
        v_cod_amount := 0;
    END IF;

    -- Get carrier fee
    v_carrier_fee := get_carrier_fee_for_order(
        v_order.courier_id,
        v_order.delivery_zone,
        v_order.shipping_city
    );

    -- Create COD movement (if COD order and amount > 0)
    IF v_is_cod AND v_cod_amount > 0 THEN
        INSERT INTO carrier_account_movements (
            store_id, carrier_id, movement_type, amount,
            order_id, order_number, dispatch_session_id,
            description, movement_date, created_by,
            metadata
        ) VALUES (
            v_order.store_id, v_order.courier_id, 'cod_collected', v_cod_amount,
            p_order_id, v_order.order_number, p_dispatch_session_id,
            'COD cobrado en entrega de pedido ' || v_order.order_number,
            CURRENT_DATE, p_created_by,
            jsonb_build_object(
                'payment_method', v_order.payment_method,
                'original_total', v_order.total_price,
                'is_cod', true
            )
        )
        ON CONFLICT (order_id, movement_type) DO UPDATE
        SET amount = EXCLUDED.amount,
            description = EXCLUDED.description,
            metadata = EXCLUDED.metadata
        RETURNING id INTO v_cod_movement_id;
    END IF;

    -- Create fee movement (carrier earns fee for delivery)
    IF v_carrier_fee > 0 THEN
        INSERT INTO carrier_account_movements (
            store_id, carrier_id, movement_type, amount,
            order_id, order_number, dispatch_session_id,
            description, movement_date, created_by,
            metadata
        ) VALUES (
            v_order.store_id, v_order.courier_id, 'delivery_fee', -v_carrier_fee,
            p_order_id, v_order.order_number, p_dispatch_session_id,
            'Tarifa de entrega para pedido ' || v_order.order_number,
            CURRENT_DATE, p_created_by,
            jsonb_build_object(
                'zone', COALESCE(v_order.delivery_zone, v_order.shipping_city),
                'fee_rate', v_carrier_fee,
                'is_cod', v_is_cod
            )
        )
        ON CONFLICT (order_id, movement_type) DO UPDATE
        SET amount = EXCLUDED.amount,
            description = EXCLUDED.description,
            metadata = EXCLUDED.metadata
        RETURNING id INTO v_fee_movement_id;
    END IF;

    RETURN QUERY SELECT v_cod_movement_id, v_fee_movement_id, v_cod_amount, v_carrier_fee;
END;
$$;

COMMENT ON FUNCTION create_delivery_movements(UUID, DECIMAL, UUID, UUID) IS
'Creates account movements when an order is delivered. Handles COD collection and delivery fees.';

-- =============================================
-- 7. FUNCTION: Create Movement for Failed Delivery
-- =============================================

CREATE OR REPLACE FUNCTION create_failed_delivery_movement(
    p_order_id UUID,
    p_dispatch_session_id UUID DEFAULT NULL,
    p_created_by UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order RECORD;
    v_carrier RECORD;
    v_carrier_fee DECIMAL(12,2);
    v_movement_id UUID;
BEGIN
    -- Get order details
    SELECT
        o.id, o.store_id, o.courier_id, o.order_number,
        o.delivery_zone, o.shipping_city
    INTO v_order
    FROM orders o
    WHERE o.id = p_order_id;

    IF NOT FOUND OR v_order.courier_id IS NULL THEN
        RETURN NULL;  -- No movement for orders without carrier
    END IF;

    -- Check if carrier charges for failed attempts
    SELECT c.charges_failed_attempts
    INTO v_carrier
    FROM carriers c
    WHERE c.id = v_order.courier_id;

    IF NOT v_carrier.charges_failed_attempts THEN
        RETURN NULL;  -- Carrier doesn't charge for failed attempts
    END IF;

    -- Get carrier fee (50% for failed attempt)
    v_carrier_fee := get_carrier_fee_for_order(
        v_order.courier_id,
        v_order.delivery_zone,
        v_order.shipping_city
    ) * 0.5;

    IF v_carrier_fee <= 0 THEN
        RETURN NULL;
    END IF;

    -- Create failed attempt fee movement
    INSERT INTO carrier_account_movements (
        store_id, carrier_id, movement_type, amount,
        order_id, order_number, dispatch_session_id,
        description, movement_date, created_by,
        metadata
    ) VALUES (
        v_order.store_id, v_order.courier_id, 'failed_attempt_fee', -v_carrier_fee,
        p_order_id, v_order.order_number, p_dispatch_session_id,
        'Tarifa por intento fallido de entrega - pedido ' || v_order.order_number,
        CURRENT_DATE, p_created_by,
        jsonb_build_object(
            'zone', COALESCE(v_order.delivery_zone, v_order.shipping_city),
            'full_fee_rate', v_carrier_fee * 2,
            'applied_rate', v_carrier_fee
        )
    )
    ON CONFLICT (order_id, movement_type) DO UPDATE
    SET amount = EXCLUDED.amount,
        description = EXCLUDED.description,
        metadata = EXCLUDED.metadata
    RETURNING id INTO v_movement_id;

    RETURN v_movement_id;
END;
$$;

COMMENT ON FUNCTION create_failed_delivery_movement(UUID, UUID, UUID) IS
'Creates account movement for failed delivery attempt (50% fee if carrier charges for failures)';

-- =============================================
-- 8. TRIGGER: Auto-create movements on order delivery
-- =============================================
-- This handles the "direct marking" flow (QR, manual status change, etc.)
-- SECURITY DEFINER is required to bypass RLS when trigger runs

CREATE OR REPLACE FUNCTION trigger_create_delivery_movement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_result RECORD;
BEGIN
    -- Only trigger on status change TO delivered
    IF NEW.sleeves_status = 'delivered' AND
       (OLD.sleeves_status IS NULL OR OLD.sleeves_status != 'delivered') THEN

        -- Check if order has carrier
        IF NEW.courier_id IS NOT NULL THEN
            -- Check if movement already exists (from dispatch flow)
            IF NOT EXISTS (
                SELECT 1 FROM carrier_account_movements
                WHERE order_id = NEW.id
                  AND movement_type IN ('cod_collected', 'delivery_fee')
            ) THEN
                -- Create movements with error handling
                BEGIN
                    SELECT * INTO v_result
                    FROM create_delivery_movements(
                        NEW.id,
                        NEW.amount_collected,
                        NULL,  -- No dispatch session
                        NULL   -- No user context in trigger
                    );

                    IF v_result.cod_movement_id IS NOT NULL OR v_result.fee_movement_id IS NOT NULL THEN
                        RAISE NOTICE '[M065] Created delivery movements for order %: COD=%, Fee=%',
                            COALESCE(NEW.order_number, NEW.id::text),
                            COALESCE(v_result.total_cod, 0),
                            COALESCE(v_result.total_fee, 0);
                    END IF;
                EXCEPTION WHEN OTHERS THEN
                    -- Log error but don't fail the transaction
                    RAISE WARNING '[M065] Error creating delivery movements for order %: %',
                        COALESCE(NEW.order_number, NEW.id::text), SQLERRM;
                END;
            END IF;
        END IF;
    END IF;

    -- Handle failed delivery status changes
    IF NEW.sleeves_status IN ('cancelled', 'returned') AND
       OLD.sleeves_status = 'shipped' AND
       NEW.courier_id IS NOT NULL THEN
        -- Check if this was a delivery failure (not a pre-dispatch cancellation)
        IF NOT EXISTS (
            SELECT 1 FROM carrier_account_movements
            WHERE order_id = NEW.id
              AND movement_type = 'failed_attempt_fee'
        ) THEN
            BEGIN
                PERFORM create_failed_delivery_movement(NEW.id, NULL, NULL);
            EXCEPTION WHEN OTHERS THEN
                RAISE WARNING '[M065] Error creating failed delivery movement for order %: %',
                    COALESCE(NEW.order_number, NEW.id::text), SQLERRM;
            END;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_order_delivery_movement ON orders;
CREATE TRIGGER trigger_order_delivery_movement
    AFTER UPDATE ON orders
    FOR EACH ROW
    WHEN (OLD.sleeves_status IS DISTINCT FROM NEW.sleeves_status)
    EXECUTE FUNCTION trigger_create_delivery_movement();

COMMENT ON TRIGGER trigger_order_delivery_movement ON orders IS
'Automatically creates carrier account movements when orders are delivered or failed';

-- =============================================
-- 9. VIEW: Carrier Account Balance
-- =============================================
-- Shows current balance for each carrier

CREATE OR REPLACE VIEW v_carrier_account_balance AS
SELECT
    c.id as carrier_id,
    c.store_id,
    c.name as carrier_name,
    c.settlement_type,
    c.charges_failed_attempts,
    c.payment_schedule,

    -- Total COD collected (carrier owes us)
    COALESCE(SUM(m.amount) FILTER (WHERE m.movement_type = 'cod_collected'), 0) as total_cod_collected,

    -- Total delivery fees (we owe carrier)
    ABS(COALESCE(SUM(m.amount) FILTER (WHERE m.movement_type = 'delivery_fee'), 0)) as total_delivery_fees,

    -- Total failed attempt fees (we owe carrier)
    ABS(COALESCE(SUM(m.amount) FILTER (WHERE m.movement_type = 'failed_attempt_fee'), 0)) as total_failed_fees,

    -- Total payments received from carrier
    ABS(COALESCE(SUM(m.amount) FILTER (WHERE m.movement_type = 'payment_received'), 0)) as total_payments_received,

    -- Total payments sent to carrier
    ABS(COALESCE(SUM(m.amount) FILTER (WHERE m.movement_type = 'payment_sent'), 0)) as total_payments_sent,

    -- Total adjustments (net)
    COALESCE(SUM(m.amount) FILTER (WHERE m.movement_type IN ('adjustment_credit', 'adjustment_debit', 'discount', 'refund')), 0) as total_adjustments,

    -- Net balance (positive = carrier owes store, negative = store owes carrier)
    COALESCE(SUM(m.amount), 0) as net_balance,

    -- Unsettled balance (movements not yet in a formal settlement)
    COALESCE(SUM(m.amount) FILTER (WHERE m.settlement_id IS NULL AND m.payment_record_id IS NULL), 0) as unsettled_balance,

    -- Count of unsettled orders
    COUNT(DISTINCT m.order_id) FILTER (WHERE m.settlement_id IS NULL AND m.payment_record_id IS NULL) as unsettled_orders,

    -- Last movement date
    MAX(m.movement_date) as last_movement_date,

    -- Last payment date
    MAX(m.movement_date) FILTER (WHERE m.movement_type IN ('payment_received', 'payment_sent')) as last_payment_date

FROM carriers c
LEFT JOIN carrier_account_movements m ON m.carrier_id = c.id
WHERE c.is_active = true
GROUP BY c.id, c.store_id, c.name, c.settlement_type, c.charges_failed_attempts, c.payment_schedule
ORDER BY ABS(COALESCE(SUM(m.amount), 0)) DESC;

COMMENT ON VIEW v_carrier_account_balance IS
'Current account balance for each carrier. Positive = carrier owes store, Negative = store owes carrier.';

-- =============================================
-- 10. VIEW: Unsettled Movements by Carrier
-- =============================================
-- Shows movements pending settlement/payment
-- Created conditionally based on dispatch_sessions table existence

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dispatch_sessions') THEN
        -- Full version with dispatch session code
        EXECUTE $view$
            CREATE OR REPLACE VIEW v_unsettled_carrier_movements AS
            SELECT
                m.id,
                m.store_id,
                m.carrier_id,
                c.name as carrier_name,
                m.movement_type,
                m.amount,
                m.order_id,
                m.order_number,
                m.dispatch_session_id,
                ds.session_code as dispatch_session_code,
                m.description,
                m.movement_date,
                m.created_at,
                CURRENT_DATE - m.movement_date as days_pending
            FROM carrier_account_movements m
            JOIN carriers c ON c.id = m.carrier_id
            LEFT JOIN dispatch_sessions ds ON ds.id = m.dispatch_session_id
            WHERE m.settlement_id IS NULL
              AND m.payment_record_id IS NULL
            ORDER BY m.carrier_id, m.movement_date
        $view$;
        RAISE NOTICE 'Created v_unsettled_carrier_movements with dispatch_sessions join';
    ELSE
        -- Simplified version without dispatch sessions
        EXECUTE $view$
            CREATE OR REPLACE VIEW v_unsettled_carrier_movements AS
            SELECT
                m.id,
                m.store_id,
                m.carrier_id,
                c.name as carrier_name,
                m.movement_type,
                m.amount,
                m.order_id,
                m.order_number,
                m.dispatch_session_id,
                NULL::TEXT as dispatch_session_code,
                m.description,
                m.movement_date,
                m.created_at,
                CURRENT_DATE - m.movement_date as days_pending
            FROM carrier_account_movements m
            JOIN carriers c ON c.id = m.carrier_id
            WHERE m.settlement_id IS NULL
              AND m.payment_record_id IS NULL
            ORDER BY m.carrier_id, m.movement_date
        $view$;
        RAISE NOTICE 'Created v_unsettled_carrier_movements without dispatch_sessions (table not found)';
    END IF;
END $$;

COMMENT ON VIEW v_unsettled_carrier_movements IS
'All carrier movements not yet included in a settlement or payment';

-- =============================================
-- 11. FUNCTION: Calculate Carrier Balance Summary
-- =============================================
-- Returns detailed balance breakdown for a carrier

CREATE OR REPLACE FUNCTION get_carrier_balance_summary(
    p_carrier_id UUID,
    p_from_date DATE DEFAULT NULL,
    p_to_date DATE DEFAULT NULL
)
RETURNS TABLE(
    carrier_id UUID,
    carrier_name VARCHAR,
    settlement_type VARCHAR,
    period_start DATE,
    period_end DATE,
    cod_collected DECIMAL,
    delivery_fees DECIMAL,
    failed_fees DECIMAL,
    payments_received DECIMAL,
    payments_sent DECIMAL,
    adjustments DECIMAL,
    gross_balance DECIMAL,
    net_balance DECIMAL,
    orders_count INT,
    delivered_count INT,
    failed_count INT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        c.id,
        c.name,
        c.settlement_type,
        COALESCE(p_from_date, MIN(m.movement_date)),
        COALESCE(p_to_date, MAX(m.movement_date)),

        COALESCE(SUM(m.amount) FILTER (WHERE m.movement_type = 'cod_collected'), 0),
        ABS(COALESCE(SUM(m.amount) FILTER (WHERE m.movement_type = 'delivery_fee'), 0)),
        ABS(COALESCE(SUM(m.amount) FILTER (WHERE m.movement_type = 'failed_attempt_fee'), 0)),
        ABS(COALESCE(SUM(m.amount) FILTER (WHERE m.movement_type = 'payment_received'), 0)),
        ABS(COALESCE(SUM(m.amount) FILTER (WHERE m.movement_type = 'payment_sent'), 0)),
        COALESCE(SUM(m.amount) FILTER (WHERE m.movement_type IN ('adjustment_credit', 'adjustment_debit', 'discount', 'refund')), 0),

        -- Gross balance (before payments)
        COALESCE(SUM(m.amount) FILTER (WHERE m.movement_type NOT IN ('payment_received', 'payment_sent')), 0),

        -- Net balance (after payments)
        COALESCE(SUM(m.amount), 0),

        -- Order counts
        COUNT(DISTINCT m.order_id)::INT,
        COUNT(DISTINCT m.order_id) FILTER (WHERE m.movement_type = 'cod_collected' OR
            (m.movement_type = 'delivery_fee' AND NOT EXISTS (
                SELECT 1 FROM carrier_account_movements m2
                WHERE m2.order_id = m.order_id AND m2.movement_type = 'cod_collected'
            )))::INT,
        COUNT(DISTINCT m.order_id) FILTER (WHERE m.movement_type = 'failed_attempt_fee')::INT

    FROM carriers c
    LEFT JOIN carrier_account_movements m ON m.carrier_id = c.id
        AND (p_from_date IS NULL OR m.movement_date >= p_from_date)
        AND (p_to_date IS NULL OR m.movement_date <= p_to_date)
    WHERE c.id = p_carrier_id
    GROUP BY c.id, c.name, c.settlement_type;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_carrier_balance_summary(UUID, DATE, DATE) IS
'Returns detailed balance breakdown for a carrier, optionally filtered by date range';

-- =============================================
-- 12. FUNCTION: Register Carrier Payment
-- =============================================
-- Creates a payment record and updates movements

CREATE OR REPLACE FUNCTION register_carrier_payment(
    p_store_id UUID,
    p_carrier_id UUID,
    p_amount DECIMAL(12,2),
    p_direction VARCHAR(20),
    p_payment_method VARCHAR(50),
    p_payment_reference VARCHAR(255) DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_settlement_ids UUID[] DEFAULT NULL,
    p_movement_ids UUID[] DEFAULT NULL,
    p_created_by UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_payment_id UUID;
    v_payment_code VARCHAR(30);
    v_movement_type VARCHAR(30);
    v_period_start DATE;
    v_period_end DATE;
BEGIN
    -- Generate payment code
    v_payment_code := generate_payment_code(p_store_id);

    -- Determine movement type based on direction
    IF p_direction = 'from_carrier' THEN
        v_movement_type := 'payment_received';
    ELSE
        v_movement_type := 'payment_sent';
    END IF;

    -- Get period from movements
    IF p_movement_ids IS NOT NULL AND array_length(p_movement_ids, 1) > 0 THEN
        SELECT MIN(movement_date), MAX(movement_date)
        INTO v_period_start, v_period_end
        FROM carrier_account_movements
        WHERE id = ANY(p_movement_ids);
    END IF;

    -- Create payment record
    INSERT INTO carrier_payment_records (
        store_id, carrier_id, payment_code, direction,
        amount, period_start, period_end,
        settlement_ids, movement_ids,
        payment_method, payment_reference, notes,
        status, payment_date, created_by
    ) VALUES (
        p_store_id, p_carrier_id, v_payment_code, p_direction,
        p_amount, v_period_start, v_period_end,
        COALESCE(p_settlement_ids, '{}'), COALESCE(p_movement_ids, '{}'),
        p_payment_method, p_payment_reference, p_notes,
        'completed', CURRENT_DATE, p_created_by
    )
    RETURNING id INTO v_payment_id;

    -- Create payment movement
    INSERT INTO carrier_account_movements (
        store_id, carrier_id, movement_type, amount,
        payment_record_id, description, movement_date, created_by
    ) VALUES (
        p_store_id, p_carrier_id, v_movement_type,
        CASE WHEN p_direction = 'from_carrier' THEN -p_amount ELSE p_amount END,
        v_payment_id,
        CASE WHEN p_direction = 'from_carrier'
             THEN 'Pago recibido del transportista - ' || v_payment_code
             ELSE 'Pago enviado al transportista - ' || v_payment_code
        END,
        CURRENT_DATE, p_created_by
    );

    -- Update covered movements
    IF p_movement_ids IS NOT NULL AND array_length(p_movement_ids, 1) > 0 THEN
        UPDATE carrier_account_movements
        SET payment_record_id = v_payment_id
        WHERE id = ANY(p_movement_ids);
    END IF;

    -- Update covered settlements (if table exists)
    IF p_settlement_ids IS NOT NULL AND array_length(p_settlement_ids, 1) > 0 THEN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'daily_settlements') THEN
            UPDATE daily_settlements
            SET status = 'paid',
                payment_date = CURRENT_DATE,
                payment_method = p_payment_method,
                payment_reference = p_payment_reference,
                amount_paid = amount_paid + p_amount
            WHERE id = ANY(p_settlement_ids);
        END IF;
    END IF;

    RETURN v_payment_id;
END;
$$;

COMMENT ON FUNCTION register_carrier_payment IS
'Registers a payment to/from a carrier and updates related movements and settlements';

-- =============================================
-- 13. BACKFILL: Create movements for existing delivered orders
-- =============================================
-- Run this once to populate movements for historical orders

CREATE OR REPLACE FUNCTION backfill_carrier_movements(p_store_id UUID DEFAULT NULL)
RETURNS TABLE(orders_processed INT, movements_created INT) AS $$
DECLARE
    v_orders_processed INT := 0;
    v_movements_created INT := 0;
    v_order RECORD;
    v_result RECORD;
BEGIN
    FOR v_order IN
        SELECT o.id, o.store_id
        FROM orders o
        WHERE o.sleeves_status = 'delivered'
          AND o.courier_id IS NOT NULL
          AND (p_store_id IS NULL OR o.store_id = p_store_id)
          AND NOT EXISTS (
              SELECT 1 FROM carrier_account_movements m
              WHERE m.order_id = o.id
          )
        ORDER BY o.delivered_at DESC
        LIMIT 1000  -- Process in batches
    LOOP
        BEGIN
            SELECT * INTO v_result
            FROM create_delivery_movements(v_order.id, NULL, NULL, NULL);

            v_orders_processed := v_orders_processed + 1;
            IF v_result.cod_movement_id IS NOT NULL THEN
                v_movements_created := v_movements_created + 1;
            END IF;
            IF v_result.fee_movement_id IS NOT NULL THEN
                v_movements_created := v_movements_created + 1;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'Error processing order %: %', v_order.id, SQLERRM;
        END;
    END LOOP;

    RETURN QUERY SELECT v_orders_processed, v_movements_created;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION backfill_carrier_movements(UUID) IS
'Backfills carrier movements for existing delivered orders. Run once after migration.';

-- =============================================
-- 14. RLS POLICIES
-- =============================================

-- Enable RLS
ALTER TABLE carrier_account_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE carrier_payment_records ENABLE ROW LEVEL SECURITY;

-- Movements policies
DROP POLICY IF EXISTS "carrier_movements_store_access" ON carrier_account_movements;
CREATE POLICY "carrier_movements_store_access" ON carrier_account_movements
    FOR ALL USING (
        store_id IN (SELECT store_id FROM user_stores WHERE user_id = auth.uid())
    );

-- Payment records policies
DROP POLICY IF EXISTS "payment_records_store_access" ON carrier_payment_records;
CREATE POLICY "payment_records_store_access" ON carrier_payment_records
    FOR ALL USING (
        store_id IN (SELECT store_id FROM user_stores WHERE user_id = auth.uid())
    );

-- =============================================
-- 15. GRANTS
-- =============================================

-- Table grants
GRANT ALL ON carrier_account_movements TO postgres;
GRANT SELECT, INSERT, UPDATE, DELETE ON carrier_account_movements TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON carrier_account_movements TO service_role;

GRANT ALL ON carrier_payment_records TO postgres;
GRANT SELECT, INSERT, UPDATE, DELETE ON carrier_payment_records TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON carrier_payment_records TO service_role;

-- View grants
GRANT SELECT ON v_carrier_account_balance TO authenticated;
GRANT SELECT ON v_carrier_account_balance TO service_role;
GRANT SELECT ON v_unsettled_carrier_movements TO authenticated;
GRANT SELECT ON v_unsettled_carrier_movements TO service_role;

-- Function grants (both authenticated and service_role for backend access)
GRANT EXECUTE ON FUNCTION generate_payment_code(UUID, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION generate_payment_code(UUID, DATE) TO service_role;
GRANT EXECUTE ON FUNCTION get_carrier_fee_for_order(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_carrier_fee_for_order(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION create_delivery_movements(UUID, DECIMAL, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION create_delivery_movements(UUID, DECIMAL, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION create_failed_delivery_movement(UUID, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION create_failed_delivery_movement(UUID, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION get_carrier_balance_summary(UUID, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_carrier_balance_summary(UUID, DATE, DATE) TO service_role;
GRANT EXECUTE ON FUNCTION register_carrier_payment(UUID, UUID, DECIMAL, VARCHAR, VARCHAR, VARCHAR, TEXT, UUID[], UUID[], UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION register_carrier_payment(UUID, UUID, DECIMAL, VARCHAR, VARCHAR, VARCHAR, TEXT, UUID[], UUID[], UUID) TO service_role;
GRANT EXECUTE ON FUNCTION backfill_carrier_movements(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION backfill_carrier_movements(UUID) TO service_role;

-- =============================================
-- VERIFICATION
-- =============================================

DO $$
DECLARE
    v_has_dispatch_sessions BOOLEAN;
    v_has_daily_settlements BOOLEAN;
    v_has_carrier_zones BOOLEAN;
BEGIN
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Migration 065 Verification';
    RAISE NOTICE '========================================';

    -- Check dependency tables
    SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dispatch_sessions') INTO v_has_dispatch_sessions;
    SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'daily_settlements') INTO v_has_daily_settlements;
    SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'carrier_zones') INTO v_has_carrier_zones;

    -- Verify carrier columns
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'carriers' AND column_name = 'settlement_type') THEN
        RAISE NOTICE 'OK: carriers.settlement_type column exists';
    ELSE
        RAISE EXCEPTION 'FAILED: carriers.settlement_type not created';
    END IF;

    -- Verify movements table
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'carrier_account_movements') THEN
        RAISE NOTICE 'OK: carrier_account_movements table exists';
    ELSE
        RAISE EXCEPTION 'FAILED: carrier_account_movements not created';
    END IF;

    -- Verify payment records table
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'carrier_payment_records') THEN
        RAISE NOTICE 'OK: carrier_payment_records table exists';
    ELSE
        RAISE EXCEPTION 'FAILED: carrier_payment_records not created';
    END IF;

    -- Verify trigger
    IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_order_delivery_movement') THEN
        RAISE NOTICE 'OK: Order delivery movement trigger exists';
    ELSE
        RAISE EXCEPTION 'FAILED: Order delivery movement trigger not created';
    END IF;

    -- Verify views
    IF EXISTS (SELECT 1 FROM information_schema.views WHERE table_name = 'v_carrier_account_balance') THEN
        RAISE NOTICE 'OK: v_carrier_account_balance view exists';
    ELSE
        RAISE EXCEPTION 'FAILED: v_carrier_account_balance view not created';
    END IF;

    -- Report optional dependencies
    RAISE NOTICE '';
    RAISE NOTICE 'Optional Dependencies:';
    IF v_has_dispatch_sessions THEN
        RAISE NOTICE '  OK: dispatch_sessions table found (FK enabled)';
    ELSE
        RAISE NOTICE '  WARN: dispatch_sessions not found (run migration 045)';
    END IF;

    IF v_has_daily_settlements THEN
        RAISE NOTICE '  OK: daily_settlements table found (FK enabled)';
    ELSE
        RAISE NOTICE '  WARN: daily_settlements not found (run migration 045)';
    END IF;

    IF v_has_carrier_zones THEN
        RAISE NOTICE '  OK: carrier_zones table found (fee calculation enabled)';
    ELSE
        RAISE NOTICE '  WARN: carrier_zones not found (fee calculation will return 0)';
    END IF;

    RAISE NOTICE '========================================';
    RAISE NOTICE 'Migration 065 Complete!';
    RAISE NOTICE '========================================';
    RAISE NOTICE '';
    RAISE NOTICE 'Features Enabled:';
    RAISE NOTICE '  1. Carrier configuration (settlement_type, charges_failed_attempts)';
    RAISE NOTICE '  2. carrier_account_movements table for ALL money flows';
    RAISE NOTICE '  3. carrier_payment_records table for payment tracking';
    RAISE NOTICE '  4. Auto-trigger for delivery movements (QR/direct marking)';
    RAISE NOTICE '  5. Balance views and summary functions';
    RAISE NOTICE '  6. Payment registration function';
    RAISE NOTICE '';
    RAISE NOTICE 'Production Hardening (v1.1):';
    RAISE NOTICE '  - SECURITY DEFINER on trigger functions';
    RAISE NOTICE '  - Error handling in triggers (won''t crash transactions)';
    RAISE NOTICE '  - Advisory lock on payment code generation';
    RAISE NOTICE '  - service_role grants for backend access';
    RAISE NOTICE '  - Optional FK references (runs without migration 045)';
    RAISE NOTICE '';
    RAISE NOTICE 'NEXT STEPS:';
    RAISE NOTICE '  1. Run migration 045 (dispatch & settlements) if not done';
    RAISE NOTICE '  2. Run migration 077 (configurable failed attempt fee)';
    RAISE NOTICE '  3. Run migration 119 (prepaid detection fix)';
    RAISE NOTICE '  4. Run: SELECT * FROM backfill_carrier_movements();';
    RAISE NOTICE '========================================';
END $$;

-- Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';

COMMIT;

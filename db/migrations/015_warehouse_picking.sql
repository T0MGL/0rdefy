-- Migration 015: Warehouse Picking and Packing System
-- Adds tables and statuses for managing warehouse workflow without barcode scanners

-- ============================================================================
-- 1. Update orders table to add new statuses
-- ============================================================================

-- Check if order_status type exists, if not create it with all statuses
DO $$
BEGIN
    -- Check if the type exists
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_status') THEN
        -- Create the type with all possible statuses
        CREATE TYPE order_status AS ENUM (
            'pending',
            'confirmed',
            'in_preparation',
            'ready_to_ship',
            'in_transit',
            'delivered',
            'cancelled',
            'rejected'
        );
    ELSE
        -- Type exists, try to add new values if they don't exist
        -- Note: PostgreSQL doesn't support IF NOT EXISTS for ALTER TYPE ADD VALUE
        -- So we need to check manually

        -- Add 'in_preparation' if it doesn't exist
        IF NOT EXISTS (
            SELECT 1 FROM pg_enum
            WHERE enumtypid = 'order_status'::regtype
            AND enumlabel = 'in_preparation'
        ) THEN
            ALTER TYPE order_status ADD VALUE 'in_preparation';
        END IF;

        -- Add 'ready_to_ship' if it doesn't exist
        IF NOT EXISTS (
            SELECT 1 FROM pg_enum
            WHERE enumtypid = 'order_status'::regtype
            AND enumlabel = 'ready_to_ship'
        ) THEN
            ALTER TYPE order_status ADD VALUE 'ready_to_ship';
        END IF;
    END IF;
END $$;

-- ============================================================================
-- 2. Create picking_sessions table
-- ============================================================================

CREATE TABLE IF NOT EXISTS picking_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) UNIQUE NOT NULL, -- Human-readable reference (e.g., "PREP-2505-01")
    status VARCHAR(20) NOT NULL CHECK (status IN ('picking', 'packing', 'completed')),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    picking_started_at TIMESTAMP WITH TIME ZONE,
    picking_completed_at TIMESTAMP WITH TIME ZONE,
    packing_started_at TIMESTAMP WITH TIME ZONE,
    packing_completed_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE
);

-- Indexes for performance
CREATE INDEX idx_picking_sessions_store_id ON picking_sessions(store_id);
CREATE INDEX idx_picking_sessions_status ON picking_sessions(status);
CREATE INDEX idx_picking_sessions_created_at ON picking_sessions(created_at DESC);

-- ============================================================================
-- 3. Create picking_session_orders junction table
-- ============================================================================

CREATE TABLE IF NOT EXISTS picking_session_orders (
    picking_session_id UUID NOT NULL REFERENCES picking_sessions(id) ON DELETE CASCADE,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    added_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (picking_session_id, order_id)
);

-- Indexes
CREATE INDEX idx_picking_session_orders_session ON picking_session_orders(picking_session_id);
CREATE INDEX idx_picking_session_orders_order ON picking_session_orders(order_id);

-- ============================================================================
-- 4. Create picking_session_items table (aggregated picking list)
-- ============================================================================

CREATE TABLE IF NOT EXISTS picking_session_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    picking_session_id UUID NOT NULL REFERENCES picking_sessions(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    total_quantity_needed INTEGER NOT NULL CHECK (total_quantity_needed > 0),
    quantity_picked INTEGER NOT NULL DEFAULT 0 CHECK (quantity_picked >= 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (picking_session_id, product_id)
);

-- Indexes
CREATE INDEX idx_picking_session_items_session ON picking_session_items(picking_session_id);
CREATE INDEX idx_picking_session_items_product ON picking_session_items(product_id);

-- ============================================================================
-- 5. Create packing_progress table (tracks packing per order line item)
-- ============================================================================

CREATE TABLE IF NOT EXISTS packing_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    picking_session_id UUID NOT NULL REFERENCES picking_sessions(id) ON DELETE CASCADE,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    quantity_needed INTEGER NOT NULL CHECK (quantity_needed > 0),
    quantity_packed INTEGER NOT NULL DEFAULT 0 CHECK (quantity_packed >= 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (picking_session_id, order_id, product_id)
);

-- Indexes
CREATE INDEX idx_packing_progress_session ON packing_progress(picking_session_id);
CREATE INDEX idx_packing_progress_order ON packing_progress(order_id);

-- ============================================================================
-- 6. Function to generate unique session code
-- ============================================================================

CREATE OR REPLACE FUNCTION generate_session_code()
RETURNS VARCHAR(50) AS $$
DECLARE
    new_code VARCHAR(50);
    code_exists BOOLEAN;
    attempt INTEGER := 0;
    max_attempts INTEGER := 100;
    date_part VARCHAR(10);
    sequence_num INTEGER;
BEGIN
    -- Get current date in DDMMYYYY format (Latin American format)
    date_part := TO_CHAR(NOW(), 'DDMMYYYY');

    LOOP
        -- Get the next sequence number for this day
        SELECT COALESCE(MAX(
            CAST(
                SUBSTRING(code FROM 'PREP-[0-9]{8}-([0-9]+)') AS INTEGER
            )
        ), 0) + 1
        INTO sequence_num
        FROM picking_sessions
        WHERE code LIKE 'PREP-' || date_part || '-%';

        -- Generate code: PREP-DDMMYYYY-NN (e.g., PREP-02122025-01 for Dec 2, 2025)
        new_code := 'PREP-' || date_part || '-' || LPAD(sequence_num::TEXT, 2, '0');

        -- Check if code exists
        SELECT EXISTS(SELECT 1 FROM picking_sessions WHERE code = new_code) INTO code_exists;

        EXIT WHEN NOT code_exists OR attempt >= max_attempts;

        attempt := attempt + 1;
    END LOOP;

    IF attempt >= max_attempts THEN
        RAISE EXCEPTION 'Failed to generate unique session code after % attempts', max_attempts;
    END IF;

    RETURN new_code;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 7. Trigger to update updated_at timestamp
-- ============================================================================

CREATE OR REPLACE FUNCTION update_picking_session_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_picking_sessions_updated_at
    BEFORE UPDATE ON picking_sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_picking_session_timestamp();

CREATE TRIGGER trigger_picking_session_items_updated_at
    BEFORE UPDATE ON picking_session_items
    FOR EACH ROW
    EXECUTE FUNCTION update_picking_session_timestamp();

CREATE TRIGGER trigger_packing_progress_updated_at
    BEFORE UPDATE ON packing_progress
    FOR EACH ROW
    EXECUTE FUNCTION update_picking_session_timestamp();

-- ============================================================================
-- 8. Add comments for documentation
-- ============================================================================

COMMENT ON TABLE picking_sessions IS 'Tracks batches of orders being prepared for shipment';
COMMENT ON TABLE picking_session_orders IS 'Links orders to picking sessions (many-to-many)';
COMMENT ON TABLE picking_session_items IS 'Aggregated list of products to pick for a session';
COMMENT ON TABLE packing_progress IS 'Tracks packing progress for each order line item';

COMMENT ON COLUMN picking_sessions.code IS 'Human-readable session reference (e.g., PREP-02122025-01 for Dec 2, 2025)';
COMMENT ON COLUMN picking_sessions.status IS 'Current workflow stage: picking, packing, or completed';
COMMENT ON COLUMN picking_session_items.total_quantity_needed IS 'Total units needed across all orders';
COMMENT ON COLUMN picking_session_items.quantity_picked IS 'Units collected so far';
COMMENT ON COLUMN packing_progress.quantity_needed IS 'Units needed for this specific order';
COMMENT ON COLUMN packing_progress.quantity_packed IS 'Units assigned to this order';

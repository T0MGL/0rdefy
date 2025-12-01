-- ================================================================
-- Migration 017: Fix orders schema for warehouse compatibility
-- Adds order_number, customer_name, and status fields
-- ================================================================

-- 0. Create order_status enum type if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_status') THEN
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
        -- Add new values if they don't exist
        IF NOT EXISTS (
            SELECT 1 FROM pg_enum
            WHERE enumtypid = 'order_status'::regtype
            AND enumlabel = 'in_preparation'
        ) THEN
            ALTER TYPE order_status ADD VALUE 'in_preparation';
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_enum
            WHERE enumtypid = 'order_status'::regtype
            AND enumlabel = 'ready_to_ship'
        ) THEN
            ALTER TYPE order_status ADD VALUE 'ready_to_ship';
        END IF;
    END IF;
END $$;

-- 1. Add status column (main order status for warehouse workflow)
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS status order_status DEFAULT 'pending';

-- 2. Add order_number column (internal order number, fallback to shopify_order_number)
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS order_number VARCHAR(100);

-- 3. Add customer_name column (denormalized for performance)
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS customer_name VARCHAR(255);

-- 4. Create indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_orders_order_number ON orders(order_number);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(store_id, status, created_at DESC);

-- 5. Backfill status from sleeves_status for existing orders
UPDATE orders
SET status = CASE sleeves_status
  WHEN 'pending' THEN 'pending'::order_status
  WHEN 'confirmed' THEN 'confirmed'::order_status
  WHEN 'in_transit' THEN 'in_transit'::order_status
  WHEN 'delivered' THEN 'delivered'::order_status
  WHEN 'cancelled' THEN 'cancelled'::order_status
  WHEN 'rejected' THEN 'rejected'::order_status
  ELSE 'pending'::order_status
END
WHERE status = 'pending'::order_status AND sleeves_status IS NOT NULL;

-- 6. Backfill order_number for existing orders
-- Use shopify_order_number if available, otherwise generate from ID
UPDATE orders
SET order_number = COALESCE(
  shopify_order_number::text,
  'ORD-' || SUBSTRING(id::text, 1, 8)
)
WHERE order_number IS NULL;

-- 7. Backfill customer_name from customer names or email
UPDATE orders
SET customer_name = CASE
  WHEN customer_first_name IS NOT NULL AND customer_last_name IS NOT NULL
    THEN customer_first_name || ' ' || customer_last_name
  WHEN customer_first_name IS NOT NULL
    THEN customer_first_name
  WHEN customer_last_name IS NOT NULL
    THEN customer_last_name
  WHEN customer_email IS NOT NULL
    THEN customer_email
  ELSE 'Unknown Customer'
END
WHERE customer_name IS NULL;

-- 8. Create function to auto-generate order_number and sync status for new orders
CREATE OR REPLACE FUNCTION generate_order_number()
RETURNS TRIGGER AS $$
BEGIN
  -- If order_number is not set, generate one
  IF NEW.order_number IS NULL THEN
    NEW.order_number := COALESCE(
      NEW.shopify_order_number,
      'ORD-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || SUBSTRING(NEW.id::text, 1, 6)
    );
  END IF;

  -- If customer_name is not set, generate from customer info
  IF NEW.customer_name IS NULL THEN
    NEW.customer_name := COALESCE(
      NULLIF(TRIM(NEW.customer_first_name || ' ' || NEW.customer_last_name), ''),
      NEW.customer_email,
      'Unknown Customer'
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 9. Create trigger to auto-populate order_number and customer_name
DROP TRIGGER IF EXISTS trigger_generate_order_number ON orders;
CREATE TRIGGER trigger_generate_order_number
  BEFORE INSERT OR UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION generate_order_number();

-- 10. Add comments
COMMENT ON COLUMN orders.status IS 'Main order status for warehouse workflow (pending → confirmed → in_preparation → ready_to_ship → in_transit → delivered)';
COMMENT ON COLUMN orders.order_number IS 'Internal order number for display (uses shopify_order_number or auto-generated)';
COMMENT ON COLUMN orders.customer_name IS 'Denormalized customer name for performance';

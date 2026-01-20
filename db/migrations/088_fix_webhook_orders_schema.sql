-- ================================================================
-- MIGRATION 088: Fix Webhook Orders Schema
-- ================================================================
-- Adds missing columns required by the External Webhook Service.
-- Specifically 'notes' (metadata) which was causing PGRST204 errors.
-- Also ensures 'delivery_notes' and address fields exist safely.
-- ================================================================

-- 1. Add 'notes' column (Metadata/JSON) - PRIMARY FIX
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'orders' AND column_name = 'notes'
    ) THEN
        ALTER TABLE orders ADD COLUMN notes TEXT;
        COMMENT ON COLUMN orders.notes IS 'Internal notes or metadata (JSON) from external webhooks/sources';
        RAISE NOTICE '✅ Added notes column to orders table';
    ELSE
        RAISE NOTICE 'ℹ️  notes column already exists in orders table';
    END IF;
END $$;

-- 2. Add 'delivery_notes' column (Shipping Instructions) - SAFETY CHECK
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'orders' AND column_name = 'delivery_notes'
    ) THEN
        ALTER TABLE orders ADD COLUMN delivery_notes TEXT;
        COMMENT ON COLUMN orders.delivery_notes IS 'Shipping instructions for the carrier/driver';
        RAISE NOTICE '✅ Added delivery_notes column to orders table';
    ELSE
        RAISE NOTICE 'ℹ️  delivery_notes column already exists in orders table';
    END IF;
END $$;

-- 3. Add 'customer_address' column (Denormalized) - SAFETY CHECK
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'orders' AND column_name = 'customer_address'
    ) THEN
        ALTER TABLE orders ADD COLUMN customer_address TEXT;
        COMMENT ON COLUMN orders.customer_address IS 'Full address string for display/search';
        RAISE NOTICE '✅ Added customer_address column to orders table';
    ELSE
        RAISE NOTICE 'ℹ️  customer_address column already exists in orders table';
    END IF;
END $$;

-- 4. Add 'address_reference' column (Landmarks) - SAFETY CHECK
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'orders' AND column_name = 'address_reference'
    ) THEN
        ALTER TABLE orders ADD COLUMN address_reference TEXT;
        COMMENT ON COLUMN orders.address_reference IS 'Nearby landmarks or reference points';
        RAISE NOTICE '✅ Added address_reference column to orders table';
    ELSE
        RAISE NOTICE 'ℹ️  address_reference column already exists in orders table';
    END IF;
END $$;

-- 5. Add 'neighborhood' column - SAFETY CHECK
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'orders' AND column_name = 'neighborhood'
    ) THEN
        ALTER TABLE orders ADD COLUMN neighborhood VARCHAR(100);
        COMMENT ON COLUMN orders.neighborhood IS 'Neighborhood/Barrio name';
        RAISE NOTICE '✅ Added neighborhood column to orders table';
    ELSE
        RAISE NOTICE 'ℹ️  neighborhood column already exists in orders table';
    END IF;
END $$;

-- 6. Add 'phone_backup' column - SAFETY CHECK
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'orders' AND column_name = 'phone_backup'
    ) THEN
        ALTER TABLE orders ADD COLUMN phone_backup VARCHAR(20);
        COMMENT ON COLUMN orders.phone_backup IS 'Secondary contact number';
        RAISE NOTICE '✅ Added phone_backup column to orders table';
    ELSE
        RAISE NOTICE 'ℹ️  phone_backup column already exists in orders table';
    END IF;
END $$;

-- 7. Add 'google_maps_link' column - SAFETY CHECK
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'orders' AND column_name = 'google_maps_link'
    ) THEN
        ALTER TABLE orders ADD COLUMN google_maps_link TEXT;
        COMMENT ON COLUMN orders.google_maps_link IS 'Direct Google Maps URL link';
        CREATE INDEX IF NOT EXISTS idx_orders_google_maps_link ON orders(google_maps_link) WHERE google_maps_link IS NOT NULL;
        RAISE NOTICE '✅ Added google_maps_link column to orders table';
    ELSE
        RAISE NOTICE 'ℹ️  google_maps_link column already exists in orders table';
    END IF;
END $$;

-- 8. Add 'payment_method' column - SAFETY CHECK (Used by webhook, missing from base schema)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'orders' AND column_name = 'payment_method'
    ) THEN
        ALTER TABLE orders ADD COLUMN payment_method VARCHAR(50);
        COMMENT ON COLUMN orders.payment_method IS 'Payment method (online, cod, cash, etc.)';
        RAISE NOTICE '✅ Added payment_method column to orders table';
    ELSE
        RAISE NOTICE 'ℹ️  payment_method column already exists in orders table';
    END IF;
END $$;

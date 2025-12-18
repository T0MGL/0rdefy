-- ================================================================
-- MIGRATION 030: Add customer address and metadata fields
-- ================================================================
-- Adds missing address fields and metadata columns to customers table
-- These fields are required for Shopify customer import
-- ================================================================

-- Add address field if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'customers'
    AND column_name = 'address'
  ) THEN
    ALTER TABLE customers ADD COLUMN address TEXT;
    RAISE NOTICE 'Added address column to customers';
  ELSE
    RAISE NOTICE 'Column address already exists in customers';
  END IF;
END $$;

-- Add city field if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'customers'
    AND column_name = 'city'
  ) THEN
    ALTER TABLE customers ADD COLUMN city VARCHAR(100);
    RAISE NOTICE 'Added city column to customers';
  ELSE
    RAISE NOTICE 'Column city already exists in customers';
  END IF;
END $$;

-- Add state field if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'customers'
    AND column_name = 'state'
  ) THEN
    ALTER TABLE customers ADD COLUMN state VARCHAR(100);
    RAISE NOTICE 'Added state column to customers';
  ELSE
    RAISE NOTICE 'Column state already exists in customers';
  END IF;
END $$;

-- Add postal_code field if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'customers'
    AND column_name = 'postal_code'
  ) THEN
    ALTER TABLE customers ADD COLUMN postal_code VARCHAR(20);
    RAISE NOTICE 'Added postal_code column to customers';
  ELSE
    RAISE NOTICE 'Column postal_code already exists in customers';
  END IF;
END $$;

-- Add country field if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'customers'
    AND column_name = 'country'
  ) THEN
    ALTER TABLE customers ADD COLUMN country VARCHAR(100);
    RAISE NOTICE 'Added country column to customers';
  ELSE
    RAISE NOTICE 'Column country already exists in customers';
  END IF;
END $$;

-- Add notes field if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'customers'
    AND column_name = 'notes'
  ) THEN
    ALTER TABLE customers ADD COLUMN notes TEXT;
    RAISE NOTICE 'Added notes column to customers';
  ELSE
    RAISE NOTICE 'Column notes already exists in customers';
  END IF;
END $$;

-- Add tags field if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'customers'
    AND column_name = 'tags'
  ) THEN
    ALTER TABLE customers ADD COLUMN tags TEXT;
    RAISE NOTICE 'Added tags column to customers';
  ELSE
    RAISE NOTICE 'Column tags already exists in customers';
  END IF;
END $$;

-- Add name field if it doesn't exist (for full name)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'customers'
    AND column_name = 'name'
  ) THEN
    ALTER TABLE customers ADD COLUMN name VARCHAR(255);
    RAISE NOTICE 'Added name column to customers';
  ELSE
    RAISE NOTICE 'Column name already exists in customers';
  END IF;
END $$;

-- Create indexes for commonly searched fields
CREATE INDEX IF NOT EXISTS idx_customers_city ON customers(store_id, city);
CREATE INDEX IF NOT EXISTS idx_customers_country ON customers(store_id, country);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(store_id, name);

COMMENT ON COLUMN customers.address IS 'Customer primary address line';
COMMENT ON COLUMN customers.city IS 'Customer city';
COMMENT ON COLUMN customers.state IS 'Customer state/province';
COMMENT ON COLUMN customers.postal_code IS 'Customer postal/ZIP code';
COMMENT ON COLUMN customers.country IS 'Customer country';
COMMENT ON COLUMN customers.notes IS 'Internal notes about the customer';
COMMENT ON COLUMN customers.tags IS 'Customer tags from Shopify';
COMMENT ON COLUMN customers.name IS 'Customer full name (first + last)';

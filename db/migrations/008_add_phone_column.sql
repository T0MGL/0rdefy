-- ================================================================
-- ADD PHONE COLUMN TO USERS TABLE
-- ================================================================
-- This migration ensures the phone column exists
-- ================================================================

-- Add phone column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'users'
        AND column_name = 'phone'
    ) THEN
        ALTER TABLE users ADD COLUMN phone VARCHAR(20);
        RAISE NOTICE 'Added phone column to users table';
    ELSE
        RAISE NOTICE 'Phone column already exists in users table';
    END IF;
END $$;

-- Add comment
COMMENT ON COLUMN users.phone IS 'User phone number for contact and profile';

-- ================================================================
-- MIGRATION COMPLETE
-- ================================================================

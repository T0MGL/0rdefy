-- ================================================================
-- NEONFLOW - ADD USERS AND USER_STORES TABLES
-- ================================================================
-- Authentication and multi-user support for SaaS
-- ================================================================

-- ================================================================
-- TABLE: users
-- ================================================================
-- User accounts for authentication and profile management
-- ================================================================

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);

COMMENT ON TABLE users IS 'NeonFlow: User accounts for authentication';
COMMENT ON COLUMN users.phone IS 'User phone number for contact and profile';

-- ================================================================
-- TABLE: user_stores
-- ================================================================
-- Many-to-many relationship between users and stores
-- Enables multi-user access per store with role-based permissions
-- ================================================================

CREATE TABLE IF NOT EXISTS user_stores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    role VARCHAR(50) DEFAULT 'admin',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, store_id)
);

CREATE INDEX idx_user_stores_user ON user_stores(user_id);
CREATE INDEX idx_user_stores_store ON user_stores(store_id);

COMMENT ON TABLE user_stores IS 'NeonFlow: User-Store relationship with roles';
COMMENT ON COLUMN user_stores.role IS 'owner, admin, staff, viewer';

-- ================================================================
-- ADD PHONE COLUMN IF NOT EXISTS (for existing deployments)
-- ================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'users'
        AND column_name = 'phone'
    ) THEN
        ALTER TABLE users ADD COLUMN phone VARCHAR(20);
    END IF;
END $$;

-- ================================================================
-- ADD TAX_RATE AND ADMIN_FEE TO STORES (for onboarding)
-- ================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'stores'
        AND column_name = 'tax_rate'
    ) THEN
        ALTER TABLE stores ADD COLUMN tax_rate DECIMAL(5,2) DEFAULT 10.00;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'stores'
        AND column_name = 'admin_fee'
    ) THEN
        ALTER TABLE stores ADD COLUMN admin_fee DECIMAL(5,2) DEFAULT 0.00;
    END IF;
END $$;

COMMENT ON COLUMN stores.tax_rate IS 'Tax rate percentage for orders (e.g., 10.00 for 10%)';
COMMENT ON COLUMN stores.admin_fee IS 'Administrative fee percentage (e.g., 2.50 for 2.5%)';

-- ================================================================
-- GRANT PERMISSIONS
-- ================================================================

GRANT ALL ON users TO postgres;
GRANT SELECT, INSERT, UPDATE ON users TO authenticated;
GRANT ALL ON user_stores TO postgres;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_stores TO authenticated;

-- ================================================================
-- MIGRATION COMPLETE
-- ================================================================

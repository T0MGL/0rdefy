-- ================================================================
-- SHOPIFY OAUTH INTEGRATION
-- ================================================================
-- Tables for Shopify OAuth flow and access token storage
-- ================================================================

-- ================================================================
-- TABLE: shopify_oauth_states
-- ================================================================
-- Temporary storage for OAuth state parameter validation
-- States expire after 10 minutes for security
-- ================================================================

CREATE TABLE IF NOT EXISTS shopify_oauth_states (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    state VARCHAR(255) UNIQUE NOT NULL,
    shop_domain VARCHAR(255) NOT NULL,
    user_id UUID,
    store_id UUID,
    expires_at TIMESTAMP NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oauth_states_state ON shopify_oauth_states(state);
CREATE INDEX IF NOT EXISTS idx_oauth_states_shop ON shopify_oauth_states(shop_domain);
CREATE INDEX IF NOT EXISTS idx_oauth_states_user ON shopify_oauth_states(user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_states_store ON shopify_oauth_states(store_id);
CREATE INDEX IF NOT EXISTS idx_oauth_states_expires ON shopify_oauth_states(expires_at);

-- Add foreign keys if the tables exist
DO $$
BEGIN
    -- Add foreign key to users table if it exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users') THEN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.table_constraints
            WHERE constraint_name = 'shopify_oauth_states_user_id_fkey'
        ) THEN
            ALTER TABLE shopify_oauth_states
            ADD CONSTRAINT shopify_oauth_states_user_id_fkey
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
        END IF;
    END IF;

    -- Add foreign key to stores table if it exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'stores') THEN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.table_constraints
            WHERE constraint_name = 'shopify_oauth_states_store_id_fkey'
        ) THEN
            ALTER TABLE shopify_oauth_states
            ADD CONSTRAINT shopify_oauth_states_store_id_fkey
            FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE;
        END IF;
    END IF;
END $$;

COMMENT ON TABLE shopify_oauth_states IS 'Temporary OAuth state storage for CSRF protection';
COMMENT ON COLUMN shopify_oauth_states.state IS 'Random state parameter for OAuth flow validation';
COMMENT ON COLUMN shopify_oauth_states.shop_domain IS 'Shopify store domain (e.g., mystore.myshopify.com)';
COMMENT ON COLUMN shopify_oauth_states.user_id IS 'Optional user ID for association';
COMMENT ON COLUMN shopify_oauth_states.store_id IS 'Optional store ID for association';
COMMENT ON COLUMN shopify_oauth_states.used IS 'Whether this state has been used (prevents replay attacks)';
COMMENT ON COLUMN shopify_oauth_states.expires_at IS 'State expires after 10 minutes';

-- ================================================================
-- UPDATE: shopify_integrations (OAuth fields)
-- ================================================================
-- Add OAuth-specific columns to existing shopify_integrations table
-- Table was created in migration 005_shopify_integration.sql
-- ================================================================

-- Add OAuth-specific columns if they don't exist
DO $$
BEGIN
    -- Add user_id column for OAuth flow
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'shopify_integrations'
        AND column_name = 'user_id'
    ) THEN
        ALTER TABLE shopify_integrations ADD COLUMN user_id UUID;
    END IF;

    -- Add shop column (alias for shop_domain)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'shopify_integrations'
        AND column_name = 'shop'
    ) THEN
        ALTER TABLE shopify_integrations ADD COLUMN shop VARCHAR(255);
    END IF;

    -- Add scope column for OAuth scopes
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'shopify_integrations'
        AND column_name = 'scope'
    ) THEN
        ALTER TABLE shopify_integrations ADD COLUMN scope TEXT;
    END IF;

    -- Add installed_at column
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'shopify_integrations'
        AND column_name = 'installed_at'
    ) THEN
        ALTER TABLE shopify_integrations ADD COLUMN installed_at TIMESTAMP DEFAULT NOW();
    END IF;
END $$;

-- Add user_id foreign key if users table exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users') THEN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.table_constraints
            WHERE constraint_name = 'shopify_integrations_user_id_fkey'
        ) THEN
            ALTER TABLE shopify_integrations
            ADD CONSTRAINT shopify_integrations_user_id_fkey
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
        END IF;
    END IF;
END $$;

-- Create indexes if they don't exist
CREATE INDEX IF NOT EXISTS idx_shopify_integrations_user ON shopify_integrations(user_id);
CREATE INDEX IF NOT EXISTS idx_shopify_integrations_shop ON shopify_integrations(shop);

COMMENT ON COLUMN shopify_integrations.user_id IS 'User who connected this Shopify integration (OAuth)';
COMMENT ON COLUMN shopify_integrations.shop IS 'Shopify store domain (e.g., mystore.myshopify.com) - same as shop_domain';
COMMENT ON COLUMN shopify_integrations.scope IS 'Granted OAuth scopes (comma-separated)';
COMMENT ON COLUMN shopify_integrations.installed_at IS 'Timestamp when OAuth app was installed';

-- ================================================================
-- CLEANUP FUNCTION: Remove expired OAuth states
-- ================================================================
-- Run this periodically via cron job or scheduled task
-- ================================================================

CREATE OR REPLACE FUNCTION cleanup_expired_oauth_states()
RETURNS void AS $$
BEGIN
    DELETE FROM shopify_oauth_states
    WHERE expires_at < NOW() OR (used = TRUE AND created_at < NOW() - INTERVAL '1 hour');
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_expired_oauth_states IS 'Removes expired OAuth states (run hourly)';

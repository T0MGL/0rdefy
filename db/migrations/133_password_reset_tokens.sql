-- Migration: 133_password_reset_tokens
-- Purpose: Create table for storing hashed password reset tokens
-- Security: Tokens stored as SHA-256 hashes, not plaintext

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast lookups by token hash (primary query path)
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token_hash ON password_reset_tokens (token_hash);

-- Index for rate limiting queries (count by email in time window)
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_email_created ON password_reset_tokens (email, created_at);

-- Index for cleanup of expired tokens
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_at ON password_reset_tokens (expires_at);

-- RLS: Only service role can access this table (backend only, no frontend access)
ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;

-- No RLS policies needed for anon/authenticated roles.
-- The service_role key bypasses RLS, which is what the backend uses.
-- This effectively makes the table inaccessible from the frontend client.

COMMENT ON TABLE password_reset_tokens IS 'Stores hashed password reset tokens with expiration. Tokens are SHA-256 hashes for security.';
COMMENT ON COLUMN password_reset_tokens.token_hash IS 'SHA-256 hash of the reset token sent to the user via email.';
COMMENT ON COLUMN password_reset_tokens.used_at IS 'Set when token is consumed. Prevents reuse.';

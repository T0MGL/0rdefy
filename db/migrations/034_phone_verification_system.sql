-- Migration 034: Phone Verification System (WhatsApp)
-- Purpose: Add phone verification to prevent multi-account creation
-- Date: 2025-12-30

-- Add phone verification fields to users table
ALTER TABLE users
ADD COLUMN IF NOT EXISTS phone VARCHAR(20) UNIQUE,
ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMP;

-- Create verification codes table
CREATE TABLE IF NOT EXISTS phone_verification_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone VARCHAR(20) NOT NULL,
  code VARCHAR(6) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  verified BOOLEAN DEFAULT false,
  verified_at TIMESTAMP,
  attempts INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT max_attempts CHECK (attempts <= 5)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_verification_codes_user_id ON phone_verification_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_verification_codes_phone ON phone_verification_codes(phone);
CREATE INDEX IF NOT EXISTS idx_verification_codes_expires_at ON phone_verification_codes(expires_at);

-- Create index for unique phone constraint on users
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_unique ON users(phone) WHERE phone IS NOT NULL;

-- Function to clean up expired verification codes (run daily)
CREATE OR REPLACE FUNCTION cleanup_expired_verification_codes()
RETURNS void AS $$
BEGIN
  DELETE FROM phone_verification_codes
  WHERE expires_at < NOW() - INTERVAL '24 hours';
END;
$$ LANGUAGE plpgsql;

-- Function to generate 6-digit verification code
CREATE OR REPLACE FUNCTION generate_verification_code()
RETURNS VARCHAR(6) AS $$
BEGIN
  RETURN LPAD(FLOOR(RANDOM() * 1000000)::TEXT, 6, '0');
END;
$$ LANGUAGE plpgsql;

-- Function to check if user can request new code (rate limiting)
CREATE OR REPLACE FUNCTION can_request_verification_code(p_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  last_request TIMESTAMP;
BEGIN
  -- Get last code request time
  SELECT created_at INTO last_request
  FROM phone_verification_codes
  WHERE user_id = p_user_id
  ORDER BY created_at DESC
  LIMIT 1;

  -- Allow if no previous request or last request was more than 60 seconds ago
  RETURN (last_request IS NULL OR last_request < NOW() - INTERVAL '60 seconds');
END;
$$ LANGUAGE plpgsql;

-- Add comments
COMMENT ON TABLE phone_verification_codes IS 'Stores WhatsApp verification codes for phone number validation';
COMMENT ON COLUMN users.phone IS 'User phone number (unique, used for WhatsApp verification)';
COMMENT ON COLUMN users.phone_verified IS 'Whether phone number has been verified via WhatsApp';
COMMENT ON COLUMN users.phone_verified_at IS 'Timestamp when phone was verified';

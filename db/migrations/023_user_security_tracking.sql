-- Migration 023: User Security Tracking (Sessions & Activity Log)
-- Description: Add user session management and activity logging for security monitoring
-- Date: 2025-12-03

-- ============================================
-- USER SESSIONS TABLE
-- ============================================
-- Tracks active user sessions across devices
CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) NOT NULL UNIQUE, -- SHA-256 hash of JWT token
  device_info JSONB DEFAULT '{}', -- { device, browser, os, version }
  ip_address INET,
  last_activity TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  is_active BOOLEAN DEFAULT true,

  CONSTRAINT chk_expires_after_created CHECK (expires_at > created_at)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_token_hash ON user_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_user_sessions_is_active ON user_sessions(is_active);

-- ============================================
-- ACTIVITY LOG TABLE
-- ============================================
-- Comprehensive audit log for user actions
CREATE TABLE IF NOT EXISTS activity_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  store_id UUID REFERENCES stores(id) ON DELETE SET NULL,
  action_type VARCHAR(50) NOT NULL, -- 'login', 'logout', 'password_change', etc.
  description TEXT NOT NULL,
  metadata JSONB DEFAULT '{}', -- Additional context (e.g., affected resource IDs)
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_activity_log_user_id ON activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_store_id ON activity_log(store_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_action_type ON activity_log(action_type);
CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log(created_at DESC);

-- ============================================
-- CLEANUP FUNCTION
-- ============================================
-- Function to clean up expired sessions (should be called by cron)
CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM user_sessions
  WHERE expires_at < NOW() OR (is_active = false AND last_activity < NOW() - INTERVAL '30 days');

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- CLEANUP FUNCTION FOR OLD ACTIVITY LOGS
-- ============================================
-- Keep only last 90 days of activity logs
CREATE OR REPLACE FUNCTION cleanup_old_activity_logs()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM activity_log
  WHERE created_at < NOW() - INTERVAL '90 days';

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- TRIGGER TO UPDATE LAST ACTIVITY
-- ============================================
-- Automatically update last_activity timestamp when token is verified
CREATE OR REPLACE FUNCTION update_session_activity()
RETURNS TRIGGER AS $$
BEGIN
  NEW.last_activity = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Note: This trigger will be used when we update sessions programmatically
-- Not needed for automatic updates since we'll handle it in the API

-- ============================================
-- HELPER FUNCTION TO LOG ACTIVITY
-- ============================================
CREATE OR REPLACE FUNCTION log_user_activity(
  p_user_id UUID,
  p_store_id UUID,
  p_action_type VARCHAR(50),
  p_description TEXT,
  p_metadata JSONB DEFAULT '{}',
  p_ip_address INET DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_log_id UUID;
BEGIN
  INSERT INTO activity_log (user_id, store_id, action_type, description, metadata, ip_address, user_agent)
  VALUES (p_user_id, p_store_id, p_action_type, p_description, p_metadata, p_ip_address, p_user_agent)
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- COMMENTS
-- ============================================
COMMENT ON TABLE user_sessions IS 'Tracks active user sessions across devices for security monitoring';
COMMENT ON TABLE activity_log IS 'Comprehensive audit log of user actions and security events';
COMMENT ON FUNCTION cleanup_expired_sessions() IS 'Removes expired and old inactive sessions (run daily via cron)';
COMMENT ON FUNCTION cleanup_old_activity_logs() IS 'Removes activity logs older than 90 days (run daily via cron)';
COMMENT ON FUNCTION log_user_activity IS 'Helper function to insert activity log entries with standard fields';

-- ============================================
-- ACTION TYPES REFERENCE
-- ============================================
-- Common action_type values:
-- - 'login': User logged in
-- - 'logout': User logged out
-- - 'logout_all': User logged out from all devices
-- - 'session_terminated': Session terminated remotely
-- - 'password_change': Password changed
-- - 'password_reset': Password reset requested/completed
-- - 'email_change': Email address changed
-- - 'account_deleted': User account deleted
-- - 'store_created': New store created
-- - 'store_deleted': Store deleted
-- - 'store_settings_updated': Store settings modified
-- - 'user_settings_updated': User preferences modified
-- - 'integration_connected': External integration connected (e.g., Shopify)
-- - 'integration_disconnected': External integration removed
-- - 'failed_login': Failed login attempt
-- - 'suspicious_activity': Suspicious activity detected

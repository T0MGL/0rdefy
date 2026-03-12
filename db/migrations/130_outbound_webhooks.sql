-- ================================================================
-- Migration 130: Outbound Webhooks System
-- ================================================================
-- Allows stores (Professional plan) to configure outbound webhooks
-- that fire on order status changes (e.g., order.delivered → n8n).
--
-- Features:
--   - Multiple webhook configs per store (max 5)
--   - HMAC-SHA256 payload signing
--   - Event filtering (order.delivered, order.confirmed, etc.)
--   - Delivery logging with retry tracking
--   - Auto-stats via trigger
--   - SSRF protection enforced at application layer
--
-- Depends on: stores, users
-- ================================================================

-- ================================================================
-- 1. Outbound Webhook Configurations
-- ================================================================
CREATE TABLE IF NOT EXISTS outbound_webhook_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL DEFAULT 'Mi Webhook',
    url TEXT NOT NULL,
    signing_secret VARCHAR(256) NOT NULL,
    events TEXT[] NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    custom_headers JSONB NOT NULL DEFAULT '{}',
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_triggered_at TIMESTAMPTZ,
    total_deliveries INTEGER NOT NULL DEFAULT 0,
    total_failures INTEGER NOT NULL DEFAULT 0,

    -- URL must be http or https with a host
    CONSTRAINT chk_outbound_url_format CHECK (url ~ '^https?://[a-zA-Z0-9]'),
    -- Must subscribe to at least one event
    CONSTRAINT chk_outbound_events_not_empty CHECK (array_length(events, 1) > 0),
    -- Events must be from allowed list
    CONSTRAINT chk_outbound_events_valid CHECK (
        events <@ ARRAY[
            'order.status_changed','order.confirmed','order.in_preparation',
            'order.ready_to_ship','order.shipped','order.delivered',
            'order.cancelled','order.returned'
        ]::TEXT[]
    ),
    -- Custom headers size limit (4KB logical text length)
    CONSTRAINT chk_outbound_headers_size CHECK (length(custom_headers::text) <= 4096)
);

-- Index for fast lookup by store
CREATE INDEX IF NOT EXISTS idx_outbound_webhook_configs_store
    ON outbound_webhook_configs(store_id);

-- ================================================================
-- Limit: max 5 webhook configs per store (race-safe with advisory lock)
-- ================================================================
CREATE OR REPLACE FUNCTION check_outbound_webhook_limit()
RETURNS TRIGGER AS $$
BEGIN
    -- Advisory lock prevents race condition (two concurrent INSERTs both passing COUNT check)
    PERFORM pg_advisory_xact_lock(hashtext('outbound_webhook_limit_' || NEW.store_id::text));

    IF (SELECT COUNT(*) FROM outbound_webhook_configs WHERE store_id = NEW.store_id) >= 5 THEN
        RAISE EXCEPTION 'Maximum of 5 outbound webhook configurations per store';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_check_outbound_webhook_limit ON outbound_webhook_configs;
CREATE TRIGGER trigger_check_outbound_webhook_limit
    BEFORE INSERT ON outbound_webhook_configs
    FOR EACH ROW
    EXECUTE FUNCTION check_outbound_webhook_limit();

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_outbound_webhook_config_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_outbound_webhook_timestamp ON outbound_webhook_configs;
CREATE TRIGGER trigger_update_outbound_webhook_timestamp
    BEFORE UPDATE ON outbound_webhook_configs
    FOR EACH ROW
    EXECUTE FUNCTION update_outbound_webhook_config_timestamp();

-- ================================================================
-- 2. Outbound Webhook Delivery Log
-- ================================================================
CREATE TABLE IF NOT EXISTS outbound_webhook_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    config_id UUID NOT NULL REFERENCES outbound_webhook_configs(id) ON DELETE CASCADE,
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    event VARCHAR(50) NOT NULL,
    payload JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'success', 'failed')),
    response_status INTEGER,
    response_body TEXT,
    error_message TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),

    -- Limit response_body size at DB level
    CONSTRAINT chk_response_body_size CHECK (response_body IS NULL OR length(response_body) <= 8192)
);

-- Indexes for delivery log queries
CREATE INDEX IF NOT EXISTS idx_outbound_deliveries_config
    ON outbound_webhook_deliveries(config_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outbound_deliveries_store
    ON outbound_webhook_deliveries(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outbound_deliveries_status
    ON outbound_webhook_deliveries(status)
    WHERE status = 'pending';
-- Index for cleanup function
CREATE INDEX IF NOT EXISTS idx_outbound_deliveries_created_at
    ON outbound_webhook_deliveries(created_at);

-- ================================================================
-- 3. Stats Update Trigger
-- ================================================================
-- Auto-increment total_deliveries / total_failures on the config.
-- Only handles pending → success and pending → failed transitions.
CREATE OR REPLACE FUNCTION update_outbound_webhook_stats()
RETURNS TRIGGER AS $$
BEGIN
    -- Only count transitions FROM pending (prevents double-counting on re-updates)
    IF OLD IS NOT NULL AND OLD.status != 'pending' THEN
        RETURN NEW;
    END IF;

    IF NEW.status = 'success' THEN
        UPDATE outbound_webhook_configs
        SET total_deliveries = total_deliveries + 1,
            last_triggered_at = NEW.completed_at
        WHERE id = NEW.config_id;
    ELSIF NEW.status = 'failed' THEN
        UPDATE outbound_webhook_configs
        SET total_failures = total_failures + 1,
            last_triggered_at = NEW.completed_at
        WHERE id = NEW.config_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_outbound_webhook_stats ON outbound_webhook_deliveries;
CREATE TRIGGER trigger_update_outbound_webhook_stats
    AFTER INSERT OR UPDATE ON outbound_webhook_deliveries
    FOR EACH ROW
    EXECUTE FUNCTION update_outbound_webhook_stats();

-- ================================================================
-- 4. Cleanup Function (deliveries older than 30 days)
-- ================================================================
CREATE OR REPLACE FUNCTION cleanup_outbound_webhook_deliveries(p_days INTEGER DEFAULT 30)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM outbound_webhook_deliveries
    WHERE (created_at < NOW() - (p_days || ' days')::INTERVAL AND status IN ('success', 'failed'))
       OR (created_at < NOW() - INTERVAL '7 days' AND status = 'pending');

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- 5. Row Level Security
-- ================================================================
ALTER TABLE outbound_webhook_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbound_webhook_deliveries ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS (used by the backend)
-- No anon policies needed — these tables are only accessed via authenticated API

-- ================================================================
-- 6. View: Webhook Config Summary
-- ================================================================
CREATE OR REPLACE VIEW v_outbound_webhook_summary AS
SELECT
    c.id,
    c.store_id,
    c.name,
    c.url,
    c.events,
    c.is_active,
    c.total_deliveries,
    c.total_failures,
    c.last_triggered_at,
    c.created_at,
    CASE
        WHEN c.total_deliveries + c.total_failures = 0 THEN 0
        ELSE ROUND(c.total_deliveries::NUMERIC / (c.total_deliveries + c.total_failures) * 100, 1)
    END AS success_rate_pct,
    COALESCE(d.pending_deliveries, 0) AS pending_deliveries
FROM outbound_webhook_configs c
LEFT JOIN (
    SELECT config_id, COUNT(*) AS pending_deliveries
    FROM outbound_webhook_deliveries
    WHERE status = 'pending'
    GROUP BY config_id
) d ON d.config_id = c.id;

-- ================================================================
-- 7. Supported Events Reference (comment only)
-- ================================================================
-- order.status_changed  → fires on ANY status change
-- order.confirmed       → fires when status → confirmed
-- order.in_preparation  → fires when status → in_preparation
-- order.ready_to_ship   → fires when status → ready_to_ship
-- order.shipped         → fires when status → shipped / in_transit
-- order.delivered        → fires when status → delivered
-- order.cancelled       → fires when status → cancelled / rejected
-- order.returned        → fires when status → returned

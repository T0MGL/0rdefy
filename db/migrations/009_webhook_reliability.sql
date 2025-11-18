-- Migration: Webhook Reliability Improvements
-- Adds idempotency, retry queue, and monitoring for production-grade webhook handling

-- Webhook idempotency keys table
-- Prevents duplicate processing of webhooks (Shopify can send duplicates)
CREATE TABLE IF NOT EXISTS shopify_webhook_idempotency (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    integration_id UUID NOT NULL REFERENCES shopify_integrations(id) ON DELETE CASCADE,

    -- Idempotency key (composite of webhook ID + topic + timestamp)
    idempotency_key VARCHAR(500) NOT NULL UNIQUE,

    -- Event details
    shopify_event_id VARCHAR(255) NOT NULL,
    shopify_topic VARCHAR(255) NOT NULL,

    -- Processing status
    processed BOOLEAN DEFAULT FALSE,
    processed_at TIMESTAMP,
    response_status INTEGER,
    response_body TEXT,

    -- TTL: expires after 24 hours (Shopify retry window)
    expires_at TIMESTAMP NOT NULL,

    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_webhook_idempotency_key ON shopify_webhook_idempotency(idempotency_key);
CREATE INDEX idx_webhook_idempotency_expires ON shopify_webhook_idempotency(expires_at);
CREATE INDEX idx_webhook_idempotency_created ON shopify_webhook_idempotency(created_at DESC);

-- Auto-delete expired idempotency records (runs daily)
CREATE OR REPLACE FUNCTION cleanup_expired_idempotency_keys()
RETURNS void AS $$
BEGIN
    DELETE FROM shopify_webhook_idempotency
    WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- Webhook retry queue table
-- Stores failed webhook deliveries for automatic retry
CREATE TABLE IF NOT EXISTS shopify_webhook_retry_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    integration_id UUID NOT NULL REFERENCES shopify_integrations(id) ON DELETE CASCADE,
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,

    -- Original webhook data
    webhook_event_id UUID REFERENCES shopify_webhook_events(id) ON DELETE CASCADE,
    shopify_topic VARCHAR(255) NOT NULL,
    payload JSONB NOT NULL,

    -- Retry configuration
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 5,
    next_retry_at TIMESTAMP NOT NULL,

    -- Error tracking
    last_error TEXT,
    last_error_code VARCHAR(50),
    error_history JSONB DEFAULT '[]'::jsonb,

    -- Status
    status VARCHAR(50) DEFAULT 'pending', -- pending, processing, failed, success

    -- Backoff tracking
    backoff_seconds INTEGER DEFAULT 60, -- exponential backoff

    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP
);

CREATE INDEX idx_webhook_retry_integration ON shopify_webhook_retry_queue(integration_id);
CREATE INDEX idx_webhook_retry_store ON shopify_webhook_retry_queue(store_id);
CREATE INDEX idx_webhook_retry_status ON shopify_webhook_retry_queue(status);
CREATE INDEX idx_webhook_retry_next ON shopify_webhook_retry_queue(next_retry_at) WHERE status = 'pending';

-- Webhook health metrics table
-- Tracks webhook processing statistics for monitoring
CREATE TABLE IF NOT EXISTS shopify_webhook_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    integration_id UUID NOT NULL REFERENCES shopify_integrations(id) ON DELETE CASCADE,
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,

    -- Time window
    metric_date DATE NOT NULL,
    metric_hour INTEGER NOT NULL, -- 0-23

    -- Metrics
    webhooks_received INTEGER DEFAULT 0,
    webhooks_processed INTEGER DEFAULT 0,
    webhooks_failed INTEGER DEFAULT 0,
    webhooks_retried INTEGER DEFAULT 0,
    webhooks_duplicates INTEGER DEFAULT 0,

    -- Performance metrics
    avg_processing_time_ms INTEGER DEFAULT 0,
    max_processing_time_ms INTEGER DEFAULT 0,
    min_processing_time_ms INTEGER DEFAULT 0,

    -- Error breakdown
    error_401_count INTEGER DEFAULT 0, -- Authentication
    error_404_count INTEGER DEFAULT 0, -- Not found
    error_500_count INTEGER DEFAULT 0, -- Server error
    error_timeout_count INTEGER DEFAULT 0,
    error_other_count INTEGER DEFAULT 0,

    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),

    UNIQUE(integration_id, metric_date, metric_hour)
);

CREATE INDEX idx_webhook_metrics_integration ON shopify_webhook_metrics(integration_id);
CREATE INDEX idx_webhook_metrics_date ON shopify_webhook_metrics(metric_date DESC);
CREATE INDEX idx_webhook_metrics_store ON shopify_webhook_metrics(store_id);

-- Add idempotency tracking to webhook events
ALTER TABLE shopify_webhook_events ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(500);
ALTER TABLE shopify_webhook_events ADD COLUMN IF NOT EXISTS is_duplicate BOOLEAN DEFAULT FALSE;
ALTER TABLE shopify_webhook_events ADD COLUMN IF NOT EXISTS original_event_id UUID REFERENCES shopify_webhook_events(id);
ALTER TABLE shopify_webhook_events ADD COLUMN IF NOT EXISTS processing_time_ms INTEGER;

CREATE INDEX IF NOT EXISTS idx_webhook_events_idempotency ON shopify_webhook_events(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Function to record webhook metric
CREATE OR REPLACE FUNCTION record_webhook_metric(
    p_integration_id UUID,
    p_store_id UUID,
    p_metric_type VARCHAR(50),
    p_processing_time_ms INTEGER DEFAULT 0,
    p_error_code VARCHAR(50) DEFAULT NULL
)
RETURNS void AS $$
DECLARE
    v_date DATE := CURRENT_DATE;
    v_hour INTEGER := EXTRACT(HOUR FROM NOW());
BEGIN
    -- Insert or update metric for current hour
    INSERT INTO shopify_webhook_metrics (
        integration_id,
        store_id,
        metric_date,
        metric_hour,
        webhooks_received,
        webhooks_processed,
        webhooks_failed,
        webhooks_retried,
        webhooks_duplicates,
        avg_processing_time_ms,
        max_processing_time_ms,
        min_processing_time_ms,
        error_401_count,
        error_404_count,
        error_500_count,
        error_timeout_count,
        error_other_count
    )
    VALUES (
        p_integration_id,
        p_store_id,
        v_date,
        v_hour,
        CASE WHEN p_metric_type = 'received' THEN 1 ELSE 0 END,
        CASE WHEN p_metric_type = 'processed' THEN 1 ELSE 0 END,
        CASE WHEN p_metric_type = 'failed' THEN 1 ELSE 0 END,
        CASE WHEN p_metric_type = 'retried' THEN 1 ELSE 0 END,
        CASE WHEN p_metric_type = 'duplicate' THEN 1 ELSE 0 END,
        p_processing_time_ms,
        p_processing_time_ms,
        p_processing_time_ms,
        CASE WHEN p_error_code = '401' THEN 1 ELSE 0 END,
        CASE WHEN p_error_code = '404' THEN 1 ELSE 0 END,
        CASE WHEN p_error_code = '500' THEN 1 ELSE 0 END,
        CASE WHEN p_error_code = 'timeout' THEN 1 ELSE 0 END,
        CASE WHEN p_error_code NOT IN ('401', '404', '500', 'timeout') AND p_error_code IS NOT NULL THEN 1 ELSE 0 END
    )
    ON CONFLICT (integration_id, metric_date, metric_hour) DO UPDATE SET
        webhooks_received = shopify_webhook_metrics.webhooks_received + CASE WHEN p_metric_type = 'received' THEN 1 ELSE 0 END,
        webhooks_processed = shopify_webhook_metrics.webhooks_processed + CASE WHEN p_metric_type = 'processed' THEN 1 ELSE 0 END,
        webhooks_failed = shopify_webhook_metrics.webhooks_failed + CASE WHEN p_metric_type = 'failed' THEN 1 ELSE 0 END,
        webhooks_retried = shopify_webhook_metrics.webhooks_retried + CASE WHEN p_metric_type = 'retried' THEN 1 ELSE 0 END,
        webhooks_duplicates = shopify_webhook_metrics.webhooks_duplicates + CASE WHEN p_metric_type = 'duplicate' THEN 1 ELSE 0 END,
        avg_processing_time_ms = CASE
            WHEN p_processing_time_ms > 0 THEN
                ((shopify_webhook_metrics.avg_processing_time_ms * shopify_webhook_metrics.webhooks_processed) + p_processing_time_ms) /
                (shopify_webhook_metrics.webhooks_processed + 1)
            ELSE shopify_webhook_metrics.avg_processing_time_ms
        END,
        max_processing_time_ms = GREATEST(shopify_webhook_metrics.max_processing_time_ms, p_processing_time_ms),
        min_processing_time_ms = CASE
            WHEN shopify_webhook_metrics.min_processing_time_ms = 0 THEN p_processing_time_ms
            ELSE LEAST(shopify_webhook_metrics.min_processing_time_ms, p_processing_time_ms)
        END,
        error_401_count = shopify_webhook_metrics.error_401_count + CASE WHEN p_error_code = '401' THEN 1 ELSE 0 END,
        error_404_count = shopify_webhook_metrics.error_404_count + CASE WHEN p_error_code = '404' THEN 1 ELSE 0 END,
        error_500_count = shopify_webhook_metrics.error_500_count + CASE WHEN p_error_code = '500' THEN 1 ELSE 0 END,
        error_timeout_count = shopify_webhook_metrics.error_timeout_count + CASE WHEN p_error_code = 'timeout' THEN 1 ELSE 0 END,
        error_other_count = shopify_webhook_metrics.error_other_count +
            CASE WHEN p_error_code NOT IN ('401', '404', '500', 'timeout') AND p_error_code IS NOT NULL THEN 1 ELSE 0 END,
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- Trigger to update updated_at on retry queue
CREATE TRIGGER update_webhook_retry_queue_updated_at
    BEFORE UPDATE ON shopify_webhook_retry_queue
    FOR EACH ROW
    EXECUTE FUNCTION update_shopify_updated_at();

-- Comments
COMMENT ON TABLE shopify_webhook_idempotency IS 'Prevents duplicate webhook processing using idempotency keys';
COMMENT ON TABLE shopify_webhook_retry_queue IS 'Queue for failed webhooks with exponential backoff retry logic';
COMMENT ON TABLE shopify_webhook_metrics IS 'Hourly webhook health metrics for monitoring and alerting';
COMMENT ON FUNCTION record_webhook_metric IS 'Records webhook processing metrics for monitoring dashboard';

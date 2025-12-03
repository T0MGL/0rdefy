-- Migration 024: Webhook Queue System
-- Description: Sistema de cola para webhooks de Shopify para manejar picos de tráfico
-- Date: 2025-12-03
-- CRÍTICO: Requerido por Shopify para apps production-ready

-- ============================================
-- WEBHOOK QUEUE TABLE
-- ============================================
-- Cola persistente para procesar webhooks asincrónicamente
-- Garantiza respuesta < 5 segundos a Shopify incluso bajo alta carga

CREATE TABLE IF NOT EXISTS webhook_queue (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  integration_id UUID NOT NULL REFERENCES shopify_integrations(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,

  -- Webhook metadata
  topic VARCHAR(100) NOT NULL, -- 'orders/create', 'products/update', etc.
  payload JSONB NOT NULL,
  headers JSONB NOT NULL, -- Store X-Shopify headers for verification
  idempotency_key VARCHAR(255) NOT NULL,

  -- Queue management
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 5,
  next_retry_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  -- Timestamps and error tracking
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  processed_at TIMESTAMP WITH TIME ZONE,
  error TEXT, -- Error message if failed

  -- Constraints
  CONSTRAINT chk_webhook_queue_status CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  CONSTRAINT chk_webhook_queue_retry_count CHECK (retry_count >= 0 AND retry_count <= max_retries)
);

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================

-- Índice principal para procesar pending webhooks
CREATE INDEX IF NOT EXISTS idx_webhook_queue_processing
  ON webhook_queue(status, next_retry_at)
  WHERE status = 'pending';

-- Índice para buscar por idempotency key (evitar duplicados)
CREATE INDEX IF NOT EXISTS idx_webhook_queue_idempotency
  ON webhook_queue(idempotency_key);

-- Índice para limpieza de webhooks antiguos
CREATE INDEX IF NOT EXISTS idx_webhook_queue_cleanup
  ON webhook_queue(status, created_at)
  WHERE status = 'completed';

-- Índice para estadísticas por integración
CREATE INDEX IF NOT EXISTS idx_webhook_queue_integration
  ON webhook_queue(integration_id, created_at DESC);

-- Índice para estadísticas por topic
CREATE INDEX IF NOT EXISTS idx_webhook_queue_topic
  ON webhook_queue(topic, created_at DESC);

-- ============================================
-- WEBHOOK QUEUE STATISTICS VIEW
-- ============================================
-- Vista para obtener estadísticas rápidas de la cola

CREATE OR REPLACE VIEW webhook_queue_stats AS
SELECT
  integration_id,
  store_id,
  topic,
  status,
  COUNT(*) as count,
  AVG(retry_count) as avg_retries,
  MIN(created_at) as oldest,
  MAX(created_at) as newest
FROM webhook_queue
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY integration_id, store_id, topic, status;

-- ============================================
-- FUNCTION: Cleanup Old Webhooks
-- ============================================
-- Función para limpiar webhooks completados antiguos (> 7 días)
-- Ejecutar diariamente como cron job

CREATE OR REPLACE FUNCTION cleanup_old_webhook_queue()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM webhook_queue
  WHERE status = 'completed'
    AND created_at < NOW() - INTERVAL '7 days';

  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON TABLE webhook_queue IS
'Cola de webhooks de Shopify para procesamiento asíncrono.
Crítico para manejar picos de tráfico (Black Friday, flash sales)
sin exceder el timeout de 5 segundos de Shopify.';

COMMENT ON COLUMN webhook_queue.status IS
'Estado del webhook: pending (esperando), processing (procesando),
completed (exitoso), failed (fallido después de max_retries)';

COMMENT ON COLUMN webhook_queue.idempotency_key IS
'Clave única generada por ShopifyWebhookManager para evitar duplicados.
Formato: {event_id}:{topic}:{timestamp_hash}';

COMMENT ON COLUMN webhook_queue.next_retry_at IS
'Timestamp para el siguiente intento. Usa exponential backoff:
60s, 120s, 240s, 480s, 960s (max 1 hora)';

COMMENT ON FUNCTION cleanup_old_webhook_queue IS
'Limpia webhooks completados > 7 días.
Ejecutar diariamente: SELECT cleanup_old_webhook_queue();';

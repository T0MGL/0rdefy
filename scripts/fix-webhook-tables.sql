-- Fix: Crear tablas necesarias para sistema de webhooks

-- 1. Tabla de idempotencia (evita duplicados)
CREATE TABLE IF NOT EXISTS shopify_webhook_idempotency (
  webhook_id VARCHAR(255) PRIMARY KEY,
  processed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  response_status INTEGER
);

CREATE INDEX IF NOT EXISTS idx_webhook_idempotency_processed_at
  ON shopify_webhook_idempotency(processed_at);

-- 2. Tabla de cola de webhooks (procesamiento asíncrono)
CREATE TABLE IF NOT EXISTS shopify_webhook_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id UUID NOT NULL REFERENCES shopify_integrations(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  topic VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,
  headers JSONB NOT NULL,
  idempotency_key VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 5,
  next_retry_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  processed_at TIMESTAMP WITH TIME ZONE,
  error TEXT,
  CONSTRAINT chk_webhook_queue_status CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  CONSTRAINT chk_webhook_queue_retry_count CHECK (retry_count >= 0 AND retry_count <= max_retries)
);

CREATE INDEX IF NOT EXISTS idx_webhook_queue_processing
  ON shopify_webhook_queue(status, next_retry_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_webhook_queue_idempotency
  ON shopify_webhook_queue(idempotency_key);

-- 3. Verificar tablas creadas
SELECT 'shopify_webhook_idempotency' as tabla, COUNT(*) as registros FROM shopify_webhook_idempotency
UNION ALL
SELECT 'shopify_webhook_queue' as tabla, COUNT(*) as registros FROM shopify_webhook_queue;

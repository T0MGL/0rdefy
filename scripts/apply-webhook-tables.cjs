#!/usr/bin/env node
// Script para crear tablas necesarias del sistema de webhooks
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function applyMigrations() {
  console.log('🔧 APLICANDO TABLAS DE WEBHOOKS\n');

  // SQL para crear las tablas
  const sql = `
-- 1. Tabla de idempotencia
CREATE TABLE IF NOT EXISTS shopify_webhook_idempotency (
  webhook_id VARCHAR(255) PRIMARY KEY,
  processed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  response_status INTEGER
);

CREATE INDEX IF NOT EXISTS idx_webhook_idempotency_processed_at
  ON shopify_webhook_idempotency(processed_at);

-- 2. Tabla de cola
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
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_webhook_queue_processing
  ON shopify_webhook_queue(status, next_retry_at)
  WHERE status = 'pending';
  `;

  try {
    // Execute each statement separately
    const statements = sql.split(';').filter(s => s.trim());

    for (const statement of statements) {
      if (!statement.trim()) continue;

      console.log('Ejecutando:', statement.substring(0, 50) + '...');

      const { error } = await supabase.rpc('exec_sql', { query: statement }).catch(() => ({
        error: { message: 'RPC not available, usando client directamente' }
      }));

      if (error && error.message.includes('not available')) {
        // Fallback: usar supabase directamente (aunque no funcione para DDL)
        console.log('⚠️  No se puede ejecutar DDL vía Supabase client');
        console.log('');
        console.log('❌ DEBES EJECUTAR ESTE SQL MANUALMENTE EN SUPABASE SQL EDITOR:');
        console.log('https://supabase.com/dashboard/project/_/sql');
        console.log('');
        console.log(sql);
        return;
      }

      if (error) {
        console.error('   ❌ Error:', error.message);
      } else {
        console.log('   ✅ OK');
      }
    }

    console.log('\n✅ Tablas creadas exitosamente');

    // Verificar
    const { count: idempotencyCount } = await supabase
      .from('shopify_webhook_idempotency')
      .select('*', { count: 'exact', head: true });

    const { count: queueCount } = await supabase
      .from('shopify_webhook_queue')
      .select('*', { count: 'exact', head: true });

    console.log('\n📊 Verificación:');
    console.log(`   shopify_webhook_idempotency: ${idempotencyCount || 0} registros`);
    console.log(`   shopify_webhook_queue: ${queueCount || 0} registros`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.log('\n💡 SOLUCIÓN: Ejecuta este SQL en Supabase SQL Editor manualmente:\n');
    console.log(sql);
  }
}

applyMigrations();

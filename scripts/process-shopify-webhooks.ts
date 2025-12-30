#!/usr/bin/env node
/**
 * Process Shopify webhook retry queue using ShopifyWebhookManager
 * Run: npx tsx scripts/process-shopify-webhooks.ts
 */

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { ShopifyWebhookManager } from '../api/services/shopify-webhook-manager.service.js';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  console.log('🚀 Starting Shopify webhook retry queue processor...\n');

  try {
    const manager = new ShopifyWebhookManager(supabase);
    const result = await manager.processRetryQueue();

    console.log('\n✅ Queue processing complete:');
    console.log(`   Processed: ${result.processed}`);
    console.log(`   Succeeded: ${result.succeeded}`);
    console.log(`   Failed: ${result.failed}`);
    console.log(`   Still Pending: ${result.still_pending}`);

  } catch (error) {
    console.error('❌ Error processing queue:', error);
    process.exit(1);
  }
}

main().catch(console.error);

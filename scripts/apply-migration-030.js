#!/usr/bin/env node

/**
 * Apply Migration 030: Add order_status_url to orders table
 *
 * This migration adds the missing order_status_url column that Shopify webhooks need
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get Supabase credentials from environment
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Error: Missing Supabase credentials');
  console.error('   Required: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// Create Supabase client with service role key
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function applyMigration() {
  try {
    console.log('🔄 Applying Migration 030: Add order_status_url to orders table...\n');

    // Read migration file
    const migrationPath = path.join(__dirname, '../db/migrations/030_add_order_status_url.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    // Execute migration
    const { data, error } = await supabase.rpc('exec_sql', { sql: migrationSQL });

    if (error) {
      console.error('❌ Migration failed:', error.message);
      process.exit(1);
    }

    console.log('✅ Migration 030 applied successfully!\n');
    console.log('📋 Summary:');
    console.log('   - Added order_status_url column to orders table');
    console.log('   - Added index idx_orders_order_status_url');
    console.log('   - Shopify webhooks can now create orders with order_status_url\n');

  } catch (error) {
    console.error('❌ Unexpected error:', error.message);
    process.exit(1);
  }
}

applyMigration();

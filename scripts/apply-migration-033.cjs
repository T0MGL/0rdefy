#!/usr/bin/env node

/**
 * Apply Migration 033: Add all missing Shopify order fields
 *
 * This migration adds all missing columns that Shopify webhooks need:
 * - total_discounts (discount amount)
 * - order_status_url (tracking URL)
 * - tags (order tags)
 * - processed_at (processing timestamp)
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Get Supabase credentials from environment
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Error: Missing Supabase credentials');
  console.error('   Required: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// Create Supabase client with service role key
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function applyMigration() {
  try {
    console.log('🔄 Applying Migration 033: Add missing Shopify order fields...\n');

    // Read migration file
    const migrationPath = path.join(__dirname, '../db/migrations/033_add_missing_shopify_order_fields.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    console.log('📄 Migration SQL loaded\n');
    console.log('📋 SQL to execute:');
    console.log('---------------------------------------------------');
    console.log(migrationSQL);
    console.log('---------------------------------------------------\n');

    console.log('⚠️  Please run this SQL manually in Supabase SQL Editor\n');
    console.log('This is the safest way to apply the migration.\n');

    console.log('🔧 FIELDS TO BE ADDED:');
    console.log('   1. total_discounts (DECIMAL) - Order discount total');
    console.log('   2. order_status_url (TEXT) - Customer tracking URL');
    console.log('   3. tags (TEXT) - Order tags from Shopify');
    console.log('   4. processed_at (TIMESTAMP) - Processing timestamp\n');

    process.exit(0);

  } catch (error) {
    console.error('\n❌ Error reading migration file:', error.message);
    process.exit(1);
  }
}

applyMigration();

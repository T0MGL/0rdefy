#!/usr/bin/env node

/**
 * Apply Migration 032: Add tags column to orders table
 *
 * This migration adds the missing tags column that Shopify webhooks need
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
    console.log('🔄 Applying Migration 032: Add tags column to orders table...\n');

    // Read migration file
    const migrationPath = path.join(__dirname, '../db/migrations/032_add_tags_to_orders.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    console.log('📄 Migration SQL loaded\n');
    console.log('📋 SQL to execute:');
    console.log('---------------------------------------------------');
    console.log(migrationSQL);
    console.log('---------------------------------------------------\n');

    console.log('⚠️  Please run this SQL manually in Supabase SQL Editor\n');
    console.log('This is the safest way to apply the migration.\n');

    process.exit(0);

  } catch (error) {
    console.error('\n❌ Error reading migration file:', error.message);
    process.exit(1);
  }
}

applyMigration();

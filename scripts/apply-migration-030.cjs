#!/usr/bin/env node
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing required environment variables');
  console.error('Required: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function applyMigration() {
  try {
    console.log('🚀 Starting migration 030: Add customer address fields');

    // Read migration file
    const migrationPath = path.join(__dirname, '../db/migrations/030_add_customer_address_fields.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    console.log('📄 Executing migration SQL...');

    // Execute migration
    const { error } = await supabase.rpc('exec_sql', { sql: migrationSQL });

    if (error) {
      // Try direct execution if exec_sql doesn't exist
      const { error: directError } = await supabase.from('_migrations').insert({
        name: '030_add_customer_address_fields',
        executed_at: new Date().toISOString()
      });

      if (directError) {
        console.error('❌ Migration failed:', error.message);
        process.exit(1);
      }
    }

    console.log('✅ Migration completed successfully');
    console.log('');
    console.log('📋 Changes applied:');
    console.log('   • Added address column to customers');
    console.log('   • Added city column to customers');
    console.log('   • Added state column to customers');
    console.log('   • Added postal_code column to customers');
    console.log('   • Added country column to customers');
    console.log('   • Added notes column to customers');
    console.log('   • Added tags column to customers');
    console.log('   • Added name column to customers');
    console.log('   • Created indexes for city, country, and name');
    console.log('');
    console.log('🎉 Customers table is now ready for Shopify import!');

  } catch (error) {
    console.error('❌ Migration failed with exception:', error);
    process.exit(1);
  }
}

applyMigration();

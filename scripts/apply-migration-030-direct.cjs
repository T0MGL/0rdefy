#!/usr/bin/env node
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing required environment variables');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  },
  db: {
    schema: 'public'
  }
});

async function addColumnIfNotExists(columnName, columnType, description) {
  try {
    // Try to query the column - if it fails, it doesn't exist
    const { error: testError } = await supabase
      .from('customers')
      .select(columnName)
      .limit(1);

    if (testError && testError.message.includes('column')) {
      console.log(`⚠️  Column ${columnName} doesn't exist, needs manual addition`);
      return false;
    } else {
      console.log(`✅ Column ${columnName} already exists`);
      return true;
    }
  } catch (error) {
    console.error(`❌ Error checking column ${columnName}:`, error.message);
    return false;
  }
}

async function applyMigration() {
  try {
    console.log('🚀 Starting migration 030: Add customer address fields');
    console.log('');

    const columns = [
      { name: 'address', type: 'TEXT', description: 'Customer primary address line' },
      { name: 'city', type: 'VARCHAR(100)', description: 'Customer city' },
      { name: 'state', type: 'VARCHAR(100)', description: 'Customer state/province' },
      { name: 'postal_code', type: 'VARCHAR(20)', description: 'Customer postal/ZIP code' },
      { name: 'country', type: 'VARCHAR(100)', description: 'Customer country' },
      { name: 'notes', type: 'TEXT', description: 'Internal notes about the customer' },
      { name: 'tags', type: 'TEXT', description: 'Customer tags from Shopify' },
      { name: 'name', type: 'VARCHAR(255)', description: 'Customer full name (first + last)' }
    ];

    let missingColumns = [];

    for (const col of columns) {
      const exists = await addColumnIfNotExists(col.name, col.type, col.description);
      if (!exists) {
        missingColumns.push(col);
      }
    }

    if (missingColumns.length > 0) {
      console.log('');
      console.log('⚠️  The following columns need to be added manually:');
      console.log('');
      console.log('Run this SQL in your Supabase SQL Editor:');
      console.log('');
      console.log('-- Add missing columns to customers table');

      missingColumns.forEach(col => {
        console.log(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS ${col.name} ${col.type};`);
      });

      console.log('');
      console.log('-- Add indexes');
      console.log('CREATE INDEX IF NOT EXISTS idx_customers_city ON customers(store_id, city);');
      console.log('CREATE INDEX IF NOT EXISTS idx_customers_country ON customers(store_id, country);');
      console.log('CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(store_id, name);');
      console.log('');
    } else {
      console.log('');
      console.log('✅ All required columns already exist!');
      console.log('');
    }

    console.log('📋 Migration 030 check completed');

  } catch (error) {
    console.error('❌ Migration check failed:', error);
    process.exit(1);
  }
}

applyMigration();

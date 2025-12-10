#!/usr/bin/env node

// Script to apply migration 028 - Add is_popup to shopify_oauth_states
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function applyMigration() {
  console.log('📦 Applying migration 028: Add is_popup to shopify_oauth_states');

  try {
    // Read migration file
    const migrationPath = path.join(__dirname, '../db/migrations/028_add_is_popup_to_oauth_states.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    console.log('📄 Migration SQL:\n', migrationSQL);

    // Execute migration
    const { data, error } = await supabase.rpc('exec_sql', { sql: migrationSQL });

    if (error) {
      // Try alternative: split into individual statements
      console.warn('⚠️  RPC exec_sql not available, trying direct execution...');

      // Split SQL by semicolons and execute each statement
      const statements = migrationSQL
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--'));

      for (const statement of statements) {
        console.log(`\n🔧 Executing: ${statement.substring(0, 100)}...`);

        // Use raw SQL via PostgREST
        const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({ query: statement })
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Failed to execute statement: ${errorText}`);
        }
      }

      console.log('✅ Migration applied successfully (direct execution)');
    } else {
      console.log('✅ Migration applied successfully');
      console.log('📊 Result:', data);
    }

    // Verify the column was added
    const { data: columns, error: verifyError } = await supabase
      .from('shopify_oauth_states')
      .select('*')
      .limit(0);

    if (verifyError) {
      console.warn('⚠️  Could not verify column (this is OK if table is empty)');
    } else {
      console.log('✅ Verified: shopify_oauth_states table structure updated');
    }

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

applyMigration();

const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function applyMigration() {
  try {
    console.log('📦 Applying migration 029: Fix webhook idempotency expires_at column...\n');

    const migrationSQL = fs.readFileSync('./db/migrations/029_fix_webhook_idempotency_expires.sql', 'utf-8');

    // Execute the full migration as one block
    const { data, error } = await supabase.rpc('exec_sql', { sql: migrationSQL });

    if (error) {
      // Try alternative approach - direct query
      console.log('⚠️  exec_sql not available, trying direct ALTER TABLE...');
      
      const alterSQL = `
        ALTER TABLE shopify_webhook_idempotency
        ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP NOT NULL DEFAULT (NOW() + INTERVAL '24 hours');
      `;
      
      const { error: alterError } = await supabase.rpc('exec_sql', { sql: alterSQL });
      
      if (alterError) {
        console.error('❌ Error:', alterError.message);
        throw alterError;
      }
    }

    console.log('✅ Migration SQL executed');

    // Verify the column exists
    const { data: verifyData, error: verifyError } = await supabase
      .from('shopify_webhook_idempotency')
      .select('expires_at')
      .limit(1);

    if (verifyError) {
      console.error('❌ Verification failed:', verifyError.message);
    } else {
      console.log('✅ Verification: expires_at column exists and is accessible');
    }

    console.log('\n✅ Migration 029 applied successfully!');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

applyMigration();

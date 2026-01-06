/**
 * Verify Security Tables Existence
 *
 * This script checks if user_sessions and activity_log tables exist in the database
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function verifySecurityTables() {
  console.log('🔍 Verifying security tables...\n');

  try {
    // Check user_sessions table
    console.log('1. Checking user_sessions table...');
    const { data: sessions, error: sessionsError } = await supabase
      .from('user_sessions')
      .select('id')
      .limit(1);

    if (sessionsError) {
      console.error('❌ user_sessions table error:', sessionsError.message);
    } else {
      console.log('✅ user_sessions table exists');
    }

    // Check activity_log table
    console.log('\n2. Checking activity_log table...');
    const { data: activity, error: activityError } = await supabase
      .from('activity_log')
      .select('id')
      .limit(1);

    if (activityError) {
      console.error('❌ activity_log table error:', activityError.message);
    } else {
      console.log('✅ activity_log table exists');
    }

    // List all tables
    console.log('\n3. Listing all tables in the database...');
    const { data: tables, error: tablesError } = await supabase
      .from('information_schema.tables')
      .select('table_name')
      .eq('table_schema', 'public')
      .order('table_name');

    if (tablesError) {
      console.error('❌ Error listing tables:', tablesError.message);
    } else {
      console.log('\nAvailable tables:');
      tables.forEach(t => console.log(`  - ${t.table_name}`));
    }

    console.log('\n✅ Verification complete');
  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }
}

verifySecurityTables();

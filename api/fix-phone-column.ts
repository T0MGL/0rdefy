/**
 * Fix Phone Column - Add phone column to users table
 */

import { supabaseAdmin } from './db/connection';

async function fixPhoneColumn() {
  console.log('🔧 [FIX] Adding phone column to users table...');

  try {
    // Execute the migration SQL directly
    const { data, error } = await supabaseAdmin.rpc('exec_sql', {
      sql_query: `
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = 'public'
                AND table_name = 'users'
                AND column_name = 'phone'
            ) THEN
                ALTER TABLE users ADD COLUMN phone VARCHAR(20);
                RAISE NOTICE 'Added phone column to users table';
            ELSE
                RAISE NOTICE 'Phone column already exists in users table';
            END IF;
        END $$;
      `
    });

    if (error) {
      console.error('❌ [FIX] Error executing migration:', error);

      // Try alternative method - using raw SQL
      console.log('🔄 [FIX] Trying alternative method...');

      const result = await supabaseAdmin
        .from('users')
        .select('phone')
        .limit(1);

      console.log('📋 [FIX] Current users table structure check:', result);

      return;
    }

    console.log('✅ [FIX] Migration executed successfully');
    console.log('📋 [FIX] Result:', data);

  } catch (err) {
    console.error('💥 [FIX] Unexpected error:', err);
  }

  process.exit(0);
}

fixPhoneColumn();

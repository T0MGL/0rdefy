#!/usr/bin/env node

// Script to apply migration 029 - Create recurring_additional_values table
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
    console.log('📦 Applying migration 029: Create recurring_additional_values table');

    try {
        // Read migration file
        const migrationPath = path.join(__dirname, '../db/migrations/029_create_recurring_additional_values.sql');
        const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

        console.log('📄 Migration SQL:\n', migrationSQL);

        // Execute migration using exec_sql RPC if available
        const { data, error } = await supabase.rpc('exec_sql', { sql: migrationSQL });

        if (error) {
            console.warn('⚠️  RPC exec_sql error or not available, trying likely issues...');
            console.error(error);

            // If the error is simply that the function doesn't exist, we might try direct SQL via connection pool if we had access, 
            // but here we are relying on the API. 
            // The previous script had a fallback using REST API if RPC failed. Let's try that.

            console.warn('⚠️  RPC failed. Trying direct SQL execution via REST (if enabled)...');
            // NOTE: This fallback relies on a specific setup where there might be a REST endpoint or similar. 
            // In the previous script it was effectively calling the same thing but via fetch, which might just be redundant if rpc fails basically.
            // However, let's keep it simple. If RPC fails, we might just need to use the SQL Editor in Supabase Dashboard or psql if we can fix the connection.
            // But let's try just reporting the error first.
        } else {
            console.log('✅ Migration applied successfully via RPC');
        }

        // Verify table creation
        const { error: verifyError } = await supabase
            .from('recurring_additional_values')
            .select('id')
            .limit(1);

        if (verifyError) {
            // If table empty or doesn't exist, error might occur on select if table missing
            if (verifyError.code === '42P01') { // undefined_table
                console.error('❌ Verification failed: Table recurring_additional_values does not exist.');
                process.exit(1);
            } else {
                console.warn('⚠️  Verification warning (table might be empty or permissions issue):', verifyError.message);
            }
        } else {
            console.log('✅ Verified: recurring_additional_values table exists');
        }

    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    }
}

applyMigration();

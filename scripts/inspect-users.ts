/**
 * Inspect User Columns
 * 
 * Lists all columns in the users table.
 * Run with: npx tsx scripts/inspect-users.ts
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load env from root
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
    process.exit(1);
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function inspectUsers() {
    console.log('🚀 Inspecting users table columns...');

    // Query information_schema via RPC or raw query if possible
    // Since we can't run raw SQL easily without RPC, let's try a trick:
    // select one user and see what keys the object has
    const { data: user, error } = await supabaseAdmin
        .from('users')
        .select('*')
        .limit(1)
        .single();

    if (error) {
        console.error('❌ Error fetching user:', error.message);
        return;
    }

    console.log('✅ Found user sample. Columns:');
    console.log(Object.keys(user));
}

inspectUsers().catch(err => {
    console.error('💥 Fatal error:', err);
    process.exit(1);
});

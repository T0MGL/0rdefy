// Script to apply migration 024 - order_line_items table
// This adds the missing table that's causing the 500 error

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

async function testTableExists() {
    const { data, error } = await supabase
        .from('order_line_items')
        .select('id')
        .limit(1);

    if (error && error.code === '42P01') {
        // Table doesn't exist
        return false;
    }
    return true;
}

async function runMigration() {
    try {
        console.log('🔍 Checking if order_line_items table exists...');
        const exists = await testTableExists();

        if (exists) {
            console.log('✅ Table order_line_items already exists!');
            console.log('ℹ️  Migration may have already been applied.');
            return;
        }

        console.log('❌ Table order_line_items does NOT exist');
        console.log('\n📦 You need to apply migration 024 manually via Supabase SQL Editor:');
        console.log('\n1. Go to Supabase Dashboard → SQL Editor');
        console.log('2. Copy and paste the content from: db/migrations/024_order_line_items.sql');
        console.log('3. Click "Run"');
        console.log('\nAlternatively, if you have database URL with proper credentials:');
        console.log('psql "postgresql://..." -f db/migrations/024_order_line_items.sql');

        console.log('\n⚠️  This migration is REQUIRED to fix the 500 error on /api/orders endpoint\n');

    } catch (error) {
        console.error('❌ Check failed:', error.message);
        process.exit(1);
    }
}

runMigration();

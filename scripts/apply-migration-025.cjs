// Script to apply migration 025 - Add Shopify order display fields
// Adds shopify_order_name and payment_gateway columns to orders table

const { createClient } = require('@supabase/supabase-js');
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

async function checkColumnExists(tableName, columnName) {
    try {
        // Try to select the column - if it doesn't exist, it will error
        const { error } = await supabase
            .from(tableName)
            .select(columnName)
            .limit(1);

        // If error code is 42703, column doesn't exist
        if (error && error.code === '42703') {
            return false;
        }

        return true;
    } catch (error) {
        return false;
    }
}

async function runMigration() {
    try {
        console.log('🔍 Checking if migration 025 columns exist...\n');

        const hasOrderName = await checkColumnExists('orders', 'shopify_order_name');
        const hasPaymentGateway = await checkColumnExists('orders', 'payment_gateway');

        console.log(`shopify_order_name: ${hasOrderName ? '✅ EXISTS' : '❌ MISSING'}`);
        console.log(`payment_gateway: ${hasPaymentGateway ? '✅ EXISTS' : '❌ MISSING'}`);

        if (hasOrderName && hasPaymentGateway) {
            console.log('\n✅ Migration 025 already applied!');
            return;
        }

        console.log('\n❌ Migration 025 NOT applied');
        console.log('\n📦 You need to apply migration 025 manually via Supabase SQL Editor:');
        console.log('\n1. Go to Supabase Dashboard → SQL Editor');
        console.log('2. Copy and paste the content from: db/migrations/025_add_shopify_order_display_fields.sql');
        console.log('3. Click "Run"');
        console.log('\n⚠️  This migration adds shopify_order_name and payment_gateway columns');
        console.log('    These fields are required to show Shopify order numbers in the UI\n');

    } catch (error) {
        console.error('❌ Check failed:', error.message);
        process.exit(1);
    }
}

runMigration();

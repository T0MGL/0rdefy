/**
 * Verify Upgrade
 * 
 * Verifies that the stores associated with hanselechague6@gmail.com are on the professional plan.
 * Run with: npx tsx scripts/verify-upgrade.ts
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

async function verifyUpgrade() {
    const email = 'hanselechague6@gmail.com';
    console.log(`🚀 Verifying upgrade for ${email}...`);

    // 1. Get User
    const { data: user, error: userError } = await supabaseAdmin
        .from('users')
        .select('id, name')
        .eq('email', email)
        .single();

    if (userError || !user) {
        console.error('❌ User not found');
        return;
    }

    console.log(`✅ User: ${user.name} (${user.id})`);

    // 2. Get User Stores and Subscriptions
    const { data: stores, error: storesError } = await supabaseAdmin
        .from('user_stores')
        .select(`
            store_id,
            stores (name),
            role
        `)
        .eq('user_id', user.id);

    if (storesError) {
        console.error('❌ Error fetching stores:', storesError.message);
        return;
    }

    console.log(`\n📋 Store Subscription Status:`);
    for (const item of (stores as any[])) {
        const { data: sub } = await supabaseAdmin
            .from('subscriptions')
            .select('plan, status')
            .eq('store_id', item.store_id)
            .single();

        console.log(`- Store: ${item.stores?.name || item.store_id}`);
        console.log(`  Role: ${item.role}`);
        console.log(`  Plan: ${sub?.plan || 'None'}`);
        console.log(`  Status: ${sub?.status || 'None'}`);
        console.log('---');
    }
}

verifyUpgrade().catch(err => {
    console.error('💥 Fatal error:', err);
    process.exit(1);
});

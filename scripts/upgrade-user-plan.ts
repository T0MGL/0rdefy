/**
 * Upgrade User Plan Script
 * 
 * Upgrades hanselechague6@gmail.com and all their stores to 'professional' plan.
 * Run with: npx tsx scripts/upgrade-user-plan.ts
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

async function upgradeUser() {
    const email = 'hanselechague6@gmail.com';
    const plan = 'professional';

    console.log(`🚀 Starting upgrade for ${email}...`);

    // 1. Find user
    const { data: user, error: userError } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('email', email)
        .single();

    if (userError || !user) {
        console.error('❌ User not found:', email, userError?.message);
        return;
    }

    const userId = user.id;
    console.log(`✅ Found user ID: ${userId}`);

    // 2. Update user plan
    const { error: updateError } = await supabaseAdmin
        .from('users')
        .update({ 
            subscription_plan: plan,
            updated_at: new Date().toISOString()
        })
        .eq('id', userId);

    if (updateError) {
        console.error('❌ Failed to update user plan:', updateError.message);
    } else {
        console.log(`✅ Updated user ${email} to ${plan} plan.`);
    }

    // 3. Find stores owned by user or associated with user
    const { data: userStores, error: storesError } = await supabaseAdmin
        .from('user_stores')
        .select('store_id')
        .eq('user_id', userId);

    if (storesError) {
        console.error('❌ Failed to fetch user stores:', storesError.message);
        return;
    }

    if (!userStores || userStores.length === 0) {
        console.log('⚠️ No stores found for this user.');
        return;
    }

    console.log(`📦 Found ${userStores.length} stores. Upgrading subscriptions...`);

    // 4. Update subscriptions for each store
    for (const item of userStores) {
        const { error: subError } = await supabaseAdmin
            .from('subscriptions')
            .upsert({
                store_id: item.store_id,
                plan: plan,
                status: 'active',
                updated_at: new Date().toISOString()
            }, { 
                onConflict: 'store_id' 
            });

        if (subError) {
            console.error(`❌ Failed to upgrade store ${item.store_id}:`, subError.message);
        } else {
            console.log(`✅ Upgraded store ${item.store_id} to ${plan}.`);
        }
    }

    console.log('\n✨ Upgrade complete!');
}

upgradeUser().catch(err => {
    console.error('💥 Fatal error:', err);
    process.exit(1);
});

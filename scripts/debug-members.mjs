#!/usr/bin/env node

/**
 * Debug script to investigate why members are not showing
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false }
});

async function debugMembers() {
  console.log('🔍 Debugging member list issue...\n');

  try {
    // 1. Get all stores
    console.log('1️⃣ Fetching all stores...');
    const { data: stores, error: storesError } = await supabaseAdmin
      .from('stores')
      .select('id, name')
      .limit(5);

    if (storesError) {
      console.error('❌ Error fetching stores:', storesError);
      return;
    }

    console.log(`✅ Found ${stores.length} stores`);

    // Use first store
    const testStore = stores[0];
    console.log(`\n📋 Using store: ${testStore.name} (${testStore.id})\n`);

    // 2. Get user_stores for this store (raw, no joins)
    console.log('2️⃣ Fetching user_stores (no joins)...');
    const { data: userStoresRaw, error: rawError } = await supabaseAdmin
      .from('user_stores')
      .select('*')
      .eq('store_id', testStore.id);

    if (rawError) {
      console.error('❌ Error:', rawError);
      return;
    }

    console.log(`✅ Found ${userStoresRaw.length} user_stores relationships`);
    console.log('   Details:');
    userStoresRaw.forEach(us => {
      console.log(`   - User: ${us.user_id} | Role: ${us.role} | Active: ${us.is_active}`);
    });

    // 3. Get user_stores WITH user join (same as endpoint)
    console.log('\n3️⃣ Fetching user_stores WITH user join (as endpoint does)...');
    const { data: members, error: joinError } = await supabaseAdmin
      .from('user_stores')
      .select(`
        *,
        user:users!user_stores_user_id_fkey(id, name, email, phone),
        invited_by_user:users!user_stores_invited_by_fkey(name)
      `)
      .eq('store_id', testStore.id)
      .eq('is_active', true);

    if (joinError) {
      console.error('❌ JOIN ERROR:', joinError);
      console.error('   Code:', joinError.code);
      console.error('   Message:', joinError.message);
      console.error('   Details:', joinError.details);
      console.error('   Hint:', joinError.hint);

      console.log('\n🔍 Diagnosis:');
      console.log('   This error suggests RLS on users table is blocking the join.');
      console.log('   SERVICE_ROLE_KEY should bypass RLS.');
      return;
    }

    console.log(`✅ Found ${members.length} members with join`);

    if (members.length === 0) {
      console.log('\n⚠️  No members found! This is the problem.');
      console.log('   Possible causes:');
      console.log('   1. All user_stores have is_active = false');
      console.log('   2. RLS is blocking the join to users table');
      console.log('   3. Users were deleted but user_stores relationships remain');
    } else {
      console.log('   Members found:');
      members.forEach(m => {
        console.log(`   - ${m.user?.name || 'NULL'} (${m.user?.email || 'NULL'}) - ${m.role}`);
      });
    }

    // 4. Check if users exist
    console.log('\n4️⃣ Checking if users exist...');
    const userIds = userStoresRaw.map(us => us.user_id);
    const { data: users, error: usersError } = await supabaseAdmin
      .from('users')
      .select('id, name, email')
      .in('id', userIds);

    if (usersError) {
      console.error('❌ Error fetching users:', usersError);
      return;
    }

    console.log(`✅ Found ${users.length} users`);
    users.forEach(u => {
      console.log(`   - ${u.name} (${u.email})`);
    });

    // 5. Cross-check
    console.log('\n5️⃣ Cross-checking user_stores vs users...');
    userStoresRaw.forEach(us => {
      const userExists = users.find(u => u.id === us.user_id);
      if (!userExists) {
        console.log(`   ⚠️  User ${us.user_id} in user_stores but NOT in users table!`);
      } else {
        console.log(`   ✅ User ${userExists.name} exists (active: ${us.is_active})`);
      }
    });

  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }
}

debugMembers();

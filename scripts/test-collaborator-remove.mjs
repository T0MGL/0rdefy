#!/usr/bin/env node

/**
 * Test script to debug collaborator removal
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

async function testCollaboratorRemove() {
  console.log('🧪 Testing collaborator removal with supabaseAdmin...\n');

  try {
    // 1. List all user_stores relationships
    console.log('1️⃣ Fetching user_stores relationships...');
    const { data: userStores, error: fetchError } = await supabaseAdmin
      .from('user_stores')
      .select('*, user:users!user_stores_user_id_fkey(name, email)')
      .eq('is_active', true)
      .limit(10);

    if (fetchError) {
      console.error('❌ Error fetching user_stores:', fetchError);
      return;
    }

    console.log(`✅ Found ${userStores.length} active user-store relationships`);

    if (userStores.length === 0) {
      console.log('ℹ️  No active user_stores to test');
      return;
    }

    // Find a non-owner to test with, or use the first user_store
    let testMember = userStores.find(us => us.role !== 'owner');

    if (!testMember) {
      console.log('⚠️  No non-owner members found. Creating test member...');

      // Get first store
      const testStore = userStores[0];

      // Create a test user
      const { data: testUser, error: userError } = await supabaseAdmin
        .from('users')
        .insert({
          email: `test-collab-${Date.now()}@example.com`,
          name: 'Test Collaborator',
          password_hash: '$2b$10$TESTHASHDUMMYVALUE',
          is_active: true
        })
        .select()
        .single();

      if (userError) {
        console.error('❌ Failed to create test user:', userError);
        return;
      }

      // Create user_store relationship
      const { data: userStoreData, error: userStoreError } = await supabaseAdmin
        .from('user_stores')
        .insert({
          user_id: testUser.id,
          store_id: testStore.store_id,
          role: 'confirmador',
          is_active: true
        })
        .select('*, user:users!user_stores_user_id_fkey(name, email)')
        .single();

      if (userStoreError) {
        console.error('❌ Failed to create user_store:', userStoreError);
        // Cleanup test user
        await supabaseAdmin.from('users').delete().eq('id', testUser.id);
        return;
      }

      testMember = userStoreData;
      console.log('✅ Test member created');
    }

    console.log('\n📋 Test member details:');
    console.log(`   User ID: ${testMember.user_id}`);
    console.log(`   Store ID: ${testMember.store_id}`);
    console.log(`   Role: ${testMember.role}`);
    console.log(`   Name: ${testMember.user?.name}`);
    console.log(`   Email: ${testMember.user?.email}`);
    console.log(`   Active: ${testMember.is_active}`);

    // 2. Try to update (deactivate) the member
    console.log('\n2️⃣ Attempting to UPDATE user_stores (set is_active=false)...');
    const { data: updateResult, error: updateError } = await supabaseAdmin
      .from('user_stores')
      .update({ is_active: false })
      .eq('user_id', testMember.user_id)
      .eq('store_id', testMember.store_id)
      .select();

    if (updateError) {
      console.error('❌ UPDATE FAILED:', updateError);
      console.error('   Code:', updateError.code);
      console.error('   Message:', updateError.message);
      console.error('   Details:', updateError.details);
      console.error('   Hint:', updateError.hint);

      console.log('\n🔍 Diagnosis:');
      console.log('   This error suggests RLS is blocking the UPDATE operation.');
      console.log('   SERVICE_ROLE_KEY should bypass RLS, but may not be working.');
      console.log('   Solution: Add UPDATE policy for user_stores table.');
    } else {
      console.log('✅ UPDATE SUCCESS!');
      console.log('   Updated rows:', updateResult?.length || 0);

      // If test member was created, clean up
      if (testMember.user?.email?.startsWith('test-collab-')) {
        console.log('\n3️⃣ Cleanup: Deleting test member...');
        await supabaseAdmin.from('user_stores').delete()
          .eq('user_id', testMember.user_id)
          .eq('store_id', testMember.store_id);
        await supabaseAdmin.from('users').delete()
          .eq('id', testMember.user_id);
        console.log('✅ Test member deleted');
      } else {
        // Rollback for real member
        console.log('\n3️⃣ Rollback: Reactivating member...');
        await supabaseAdmin
          .from('user_stores')
          .update({ is_active: true })
          .eq('user_id', testMember.user_id)
          .eq('store_id', testMember.store_id);
        console.log('✅ Member reactivated');
      }
    }

  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }
}

testCollaboratorRemove();

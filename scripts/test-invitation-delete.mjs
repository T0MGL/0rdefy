#!/usr/bin/env node

/**
 * Test script to debug invitation deletion
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

async function testInvitationDelete() {
  console.log('🧪 Testing invitation deletion with supabaseAdmin...\n');

  try {
    // 1. List all pending invitations
    console.log('1️⃣ Fetching pending invitations...');
    const { data: invitations, error: fetchError } = await supabaseAdmin
      .from('collaborator_invitations')
      .select('*')
      .eq('used', false)
      .limit(5);

    if (fetchError) {
      console.error('❌ Error fetching invitations:', fetchError);
      return;
    }

    console.log(`✅ Found ${invitations.length} pending invitations`);

    if (invitations.length === 0) {
      console.log('ℹ️  No pending invitations to test deletion');
      return;
    }

    // Show first invitation details
    const testInvitation = invitations[0];
    console.log('\n📋 Test invitation details:');
    console.log(`   ID: ${testInvitation.id}`);
    console.log(`   Email: ${testInvitation.invited_email}`);
    console.log(`   Store ID: ${testInvitation.store_id}`);
    console.log(`   Used: ${testInvitation.used}`);

    // 2. Check RLS policies
    console.log('\n2️⃣ Checking RLS policies on collaborator_invitations...');
    const { data: policies, error: policyError } = await supabaseAdmin
      .from('pg_policies')
      .select('*')
      .eq('tablename', 'collaborator_invitations');

    if (policyError) {
      console.log('⚠️  Could not fetch policies (this is OK):', policyError.message);
    } else {
      console.log(`✅ Found ${policies?.length || 0} RLS policies`);
      policies?.forEach(p => {
        console.log(`   - ${p.policyname} (${p.cmd}): ${p.qual || p.with_check || 'N/A'}`);
      });
    }

    // 3. Try to delete the invitation
    console.log('\n3️⃣ Attempting to DELETE invitation (using SERVICE_ROLE_KEY)...');
    const { data: deleteResult, error: deleteError } = await supabaseAdmin
      .from('collaborator_invitations')
      .delete()
      .eq('id', testInvitation.id)
      .eq('store_id', testInvitation.store_id)
      .eq('used', false)
      .select();

    if (deleteError) {
      console.error('❌ DELETE FAILED:', deleteError);
      console.error('   Code:', deleteError.code);
      console.error('   Message:', deleteError.message);
      console.error('   Details:', deleteError.details);
      console.error('   Hint:', deleteError.hint);
    } else {
      console.log('✅ DELETE SUCCESS!');
      console.log('   Deleted rows:', deleteResult?.length || 0);
    }

  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }
}

testInvitationDelete();

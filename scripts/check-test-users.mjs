#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

async function checkTestUsers() {
  console.log('🔍 Checking test users...\n');

  // Find test users
  const { data: testUsers } = await supabaseAdmin
    .from('users')
    .select('id, name, email')
    .like('email', 'test-%@example.com');

  console.log(`Found ${testUsers?.length || 0} test users:`);
  testUsers?.forEach(u => console.log(`  - ${u.name} (${u.email})`));

  if (testUsers && testUsers.length > 0) {
    console.log('\n🗑️  Cleaning up test users...');

    for (const user of testUsers) {
      // Delete user_stores first
      await supabaseAdmin
        .from('user_stores')
        .delete()
        .eq('user_id', user.id);

      // Delete user
      await supabaseAdmin
        .from('users')
        .delete()
        .eq('id', user.id);

      console.log(`  ✅ Deleted ${user.name}`);
    }
  }

  // Check for accepted invitations from test users
  const { data: testInvites } = await supabaseAdmin
    .from('collaborator_invitations')
    .select('*')
    .like('invited_email', 'test-%@example.com')
    .eq('used', true);

  if (testInvites && testInvites.length > 0) {
    console.log(`\n🗑️  Cleaning up ${testInvites.length} accepted test invitations...`);

    for (const invite of testInvites) {
      await supabaseAdmin
        .from('collaborator_invitations')
        .delete()
        .eq('id', invite.id);

      console.log(`  ✅ Deleted invitation for ${invite.invited_email}`);
    }
  }

  console.log('\n✅ Cleanup complete!');
}

checkTestUsers();

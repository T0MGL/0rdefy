#!/usr/bin/env node
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false }}
);

async function finalCleanup() {
  console.log('🧹 Limpieza final...\n');

  // 1. Delete all test invitations first
  const { data: invitations } = await supabase
    .from('collaborator_invitations')
    .select('id, invited_email, used_by_user_id')
    .like('invited_email', 'test-%@example.com');

  if (invitations && invitations.length > 0) {
    console.log(`Eliminando ${invitations.length} invitaciones...`);
    for (const inv of invitations) {
      await supabase.from('collaborator_invitations').delete().eq('id', inv.id);
    }
    console.log('✓ Invitaciones eliminadas\n');
  }

  // 2. Delete test users
  const { data: users } = await supabase
    .from('users')
    .select('id, email')
    .like('email', 'test-%@example.com');

  if (users && users.length > 0) {
    console.log(`Eliminando ${users.length} usuarios de prueba...`);
    for (const user of users) {
      // Delete user_stores first
      await supabase.from('user_stores').delete().eq('user_id', user.id);

      // Delete user
      const { error } = await supabase.from('users').delete().eq('id', user.id);

      if (error) {
        console.log(`  ❌ ${user.email}: ${error.message}`);
      } else {
        console.log(`  ✓ ${user.email}`);
      }
    }
  }

  console.log('\n✅ Limpieza completada!\n');

  // Verify
  const { data: finalUsers } = await supabase
    .from('user_stores')
    .select('*, user:users(email)')
    .eq('store_id', '9d0e1983-7f1c-426a-8ed6-7a6cbebdbcd9'); // Bright Idea store ID

  console.log(`Usuarios activos en Bright Idea: ${finalUsers?.length || 0}`);
  if (finalUsers) {
    finalUsers.forEach(u => console.log(`  - ${u.user.email} (${u.role})`));
  }
}

finalCleanup();

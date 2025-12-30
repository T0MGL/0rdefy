#!/usr/bin/env node
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false }}
);

async function forceCleanup() {
  console.log('🧹 Limpieza forzada de usuarios de prueba...\n');

  // Get all users
  const { data: allUsers } = await supabase
    .from('users')
    .select('id, email, name');

  const testUsers = allUsers.filter(u =>
    u.email.startsWith('test-') && u.email.includes('@example.com')
  );

  if (testUsers.length === 0) {
    console.log('✓ No hay usuarios de prueba');
    return;
  }

  console.log(`Eliminando ${testUsers.length} usuarios de prueba:\n`);

  for (const user of testUsers) {
    console.log(`Eliminando: ${user.email} (${user.id})`);

    // Delete relations first
    await supabase.from('user_stores').delete().eq('user_id', user.id);
    await supabase.from('collaborator_invitations').delete().eq('inviting_user_id', user.id);
    await supabase.from('collaborator_invitations').delete().eq('used_by_user_id', user.id);

    // Delete user
    const { error } = await supabase.from('users').delete().eq('id', user.id);

    if (error) {
      console.log(`  ❌ Error: ${error.message}`);
    } else {
      console.log(`  ✓ Eliminado`);
    }
  }

  // Clean orphaned invitations
  await supabase
    .from('collaborator_invitations')
    .delete()
    .like('invited_email', 'test-%@example.com');

  console.log('\n✅ Limpieza completada!\n');
}

forceCleanup();

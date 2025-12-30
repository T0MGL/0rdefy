#!/usr/bin/env node
/**
 * Cleanup: Eliminar usuarios de prueba
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false }}
);

async function cleanup() {
  console.log('🧹 Limpiando usuarios de prueba...\n');

  // Delete test users (emails starting with "test-")
  const { data: testUsers } = await supabase
    .from('users')
    .select('id, email, name')
    .like('email', 'test-%@example.com');

  if (!testUsers || testUsers.length === 0) {
    console.log('✓ No hay usuarios de prueba para eliminar');
    return;
  }

  console.log(`Encontrados ${testUsers.length} usuarios de prueba:`);
  testUsers.forEach(u => console.log(`  - ${u.email}`));
  console.log('');

  for (const user of testUsers) {
    console.log(`Eliminando ${user.email}...`);

    // Delete from user_stores
    await supabase
      .from('user_stores')
      .delete()
      .eq('user_id', user.id);

    // Delete from users
    await supabase
      .from('users')
      .delete()
      .eq('id', user.id);

    console.log(`  ✓ Eliminado`);
  }

  // Delete test invitations
  const { data: testInvitations } = await supabase
    .from('collaborator_invitations')
    .select('id, invited_email')
    .like('invited_email', 'test-%@example.com');

  if (testInvitations && testInvitations.length > 0) {
    console.log(`\nEliminando ${testInvitations.length} invitaciones de prueba...`);

    for (const inv of testInvitations) {
      await supabase
        .from('collaborator_invitations')
        .delete()
        .eq('id', inv.id);
    }

    console.log('✓ Invitaciones eliminadas');
  }

  console.log('\n✅ Limpieza completada!\n');
}

cleanup();

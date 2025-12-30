#!/usr/bin/env node
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false }}
);

async function listUsers() {
  console.log('📋 Listando usuarios...\n');

  // Get all users
  const { data: users, error } = await supabase
    .from('users')
    .select('id, email, name, is_active')
    .limit(10);

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log(`Total usuarios: ${users.length}\n`);

  for (const user of users) {
    console.log(`👤 ${user.name || 'Sin nombre'}`);
    console.log(`   Email: ${user.email}`);
    console.log(`   ID: ${user.id}`);
    console.log(`   Activo: ${user.is_active ? '✓' : '✗'}`);

    // Get stores for this user
    const { data: stores } = await supabase
      .from('user_stores')
      .select('role, is_active, store:stores(name)')
      .eq('user_id', user.id);

    if (stores && stores.length > 0) {
      stores.forEach(s => {
        console.log(`   └─ Store: ${s.store.name} (${s.role}) ${s.is_active ? '✓' : '✗'}`);
      });
    }
    console.log('');
  }
}

listUsers();

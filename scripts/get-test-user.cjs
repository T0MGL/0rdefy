#!/usr/bin/env node
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false }}
);

async function getTestUser() {
  // Get first user with owner role
  const { data: userStores } = await supabase
    .from('user_stores')
    .select('*, user:users(email, name), store:stores(id, name)')
    .eq('role', 'owner')
    .eq('is_active', true)
    .limit(1);

  if (userStores && userStores.length > 0) {
    console.log('TEST_EMAIL=' + userStores[0].user.email);
    console.log('TEST_STORE_ID=' + userStores[0].store.id);
    console.log('TEST_STORE_NAME=' + userStores[0].store.name);
  } else {
    console.error('No owner user found');
    process.exit(1);
  }
}

getTestUser();

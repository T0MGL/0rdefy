/**
 * Create Test User - Create a complete test user with store
 */

import bcrypt from 'bcrypt';
import { supabaseAdmin } from './db/connection';

const SALT_ROUNDS = 10;

async function createTestUser() {
  const email = 'gastonlpza@gmail.com';
  const password = 'test123456';
  const name = 'Gastón López';

  console.log('👤 [CREATE] Creating test user...');
  console.log('📧 Email:', email);
  console.log('🔑 Password:', password);
  console.log('👤 Name:', name);
  console.log('');

  try {
    // Check if user already exists
    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('id, email, name')
      .eq('email', email)
      .maybeSingle();

    if (existingUser) {
      console.log('⚠️ [CREATE] User already exists:', existingUser);
      console.log('');
      console.log('🔄 [CREATE] Updating password instead...');

      const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

      const { error: updateError } = await supabaseAdmin
        .from('users')
        .update({ password_hash })
        .eq('email', email);

      if (updateError) {
        console.error('❌ [CREATE] Error updating password:', updateError);
        return;
      }

      console.log('✅ [CREATE] Password updated successfully!');
      console.log('');
      console.log('=============================================');
      console.log('   LOGIN CREDENTIALS:');
      console.log('   Email:', email);
      console.log('   Password:', password);
      console.log('=============================================');

      process.exit(0);
      return;
    }

    // Hash password
    console.log('🔐 [CREATE] Hashing password...');
    const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

    // Create user
    console.log('👤 [CREATE] Creating user...');
    const { data: newUser, error: userError } = await supabaseAdmin
      .from('users')
      .insert([{
        email,
        password_hash,
        name,
        is_active: true
      }])
      .select()
      .single();

    if (userError) {
      console.error('❌ [CREATE] Failed to create user:', userError);
      return;
    }

    console.log('✅ [CREATE] User created:', newUser.id);

    // Create store
    console.log('🏪 [CREATE] Creating store...');
    const { data: newStore, error: storeError } = await supabaseAdmin
      .from('stores')
      .insert([{
        name: `${name}'s Store`,
        country: 'PY',
        timezone: 'America/Asuncion',
        currency: 'USD',
        is_active: true
      }])
      .select()
      .single();

    if (storeError) {
      console.error('❌ [CREATE] Failed to create store:', storeError);
      return;
    }

    console.log('✅ [CREATE] Store created:', newStore.id);

    // Link user to store
    console.log('🔗 [CREATE] Linking user to store...');
    const { error: userStoreError } = await supabaseAdmin
      .from('user_stores')
      .insert([{
        user_id: newUser.id,
        store_id: newStore.id,
        role: 'owner'
      }]);

    if (userStoreError) {
      console.error('❌ [CREATE] Failed to link user to store:', userStoreError);
      return;
    }

    console.log('✅ [CREATE] User linked to store');
    console.log('');
    console.log('🎉 [CREATE] Test user created successfully!');
    console.log('');
    console.log('=============================================');
    console.log('   LOGIN CREDENTIALS:');
    console.log('   Email:', email);
    console.log('   Password:', password);
    console.log('');
    console.log('   User ID:', newUser.id);
    console.log('   Store ID:', newStore.id);
    console.log('   Store Name:', newStore.name);
    console.log('=============================================');

  } catch (err) {
    console.error('💥 [CREATE] Unexpected error:', err);
  }

  process.exit(0);
}

createTestUser();

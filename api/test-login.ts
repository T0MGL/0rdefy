/**
 * Test Login - Debug password validation
 */

import bcrypt from 'bcrypt';
import { supabaseAdmin } from './db/connection';

async function testLogin() {
  const email = 'gastonlpza@gmail.com';
  const testPassword = 'test123456';

  console.log('🔐 [TEST] Testing login for:', email);
  console.log('🔑 [TEST] Test password:', testPassword);

  try {
    // Get user from database
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (error) {
      console.error('❌ [TEST] Error fetching user:', error);
      return;
    }

    if (!user) {
      console.error('❌ [TEST] User not found');
      return;
    }

    console.log('✅ [TEST] User found:', {
      id: user.id,
      email: user.email,
      name: user.name,
      is_active: user.is_active,
      created_at: user.created_at
    });

    console.log('');
    console.log('🔑 [TEST] Password hash from DB:', user.password_hash);
    console.log('');

    // Test password comparison
    console.log('🔐 [TEST] Testing password comparison...');
    const isPasswordValid = await bcrypt.compare(testPassword, user.password_hash);

    console.log('');
    if (isPasswordValid) {
      console.log('✅ [TEST] ✅ ✅ ✅ PASSWORD IS VALID! ✅ ✅ ✅');
      console.log('');
      console.log('=============================================');
      console.log('   LOGIN SHOULD WORK WITH:');
      console.log('   Email:', email);
      console.log('   Password:', testPassword);
      console.log('=============================================');
    } else {
      console.log('❌ [TEST] ❌ ❌ ❌ PASSWORD IS INVALID! ❌ ❌ ❌');
      console.log('');
      console.log('🔧 [TEST] Creating new password hash...');

      const newHash = await bcrypt.hash(testPassword, 10);
      console.log('🔑 [TEST] New hash:', newHash);

      // Update the password
      const { error: updateError } = await supabaseAdmin
        .from('users')
        .update({ password_hash: newHash })
        .eq('email', email);

      if (updateError) {
        console.error('❌ [TEST] Error updating password:', updateError);
      } else {
        console.log('✅ [TEST] Password updated successfully!');
        console.log('');
        console.log('=============================================');
        console.log('   NEW LOGIN CREDENTIALS:');
        console.log('   Email:', email);
        console.log('   Password:', testPassword);
        console.log('=============================================');
      }
    }

  } catch (err) {
    console.error('💥 [TEST] Unexpected error:', err);
  }

  process.exit(0);
}

testLogin();

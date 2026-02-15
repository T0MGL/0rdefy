/**
 * Reset User Password - Script to update user password
 * Usage: ts-node reset-password.ts <email> <newPassword>
 */

import bcrypt from 'bcrypt';
import { supabaseAdmin } from './db/connection';

const SALT_ROUNDS = 10;

async function resetPassword() {
  const email = process.argv[2];
  const newPassword = process.argv[3];

  if (!email || !newPassword) {
    console.error('❌ Usage: ts-node reset-password.ts <email> <newPassword>');
    console.error('   Example: ts-node reset-password.ts user@example.com newpass123');
    process.exit(1);
  }

  console.log('🔐 [RESET] Resetting password for user...');

  try {
    // Hash the new password
    const password_hash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    // Update the password in the database
    const { data, error } = await supabaseAdmin
      .from('users')
      .update({ password_hash })
      .eq('email', email)
      .select('id, email, name');

    if (error) {
      console.error('❌ [RESET] Error updating password:', error);
      return;
    }

    if (!data || data.length === 0) {
      console.error('❌ [RESET] User not found with email:', email);
      return;
    }

    console.log('✅ [RESET] Password reset successfully!');
    console.log('📋 [RESET] User:', data[0].name || 'Unknown');
    console.log('📧 [RESET] Email:', data[0].email);

    // Log audit trail
    await supabaseAdmin.from('audit_log').insert({
      action: 'password_reset',
      user_id: data[0].id,
      performed_by: 'admin_script',
      timestamp: new Date().toISOString()
    }).catch(() => {
      // Audit log table might not exist, ignore
    });

  } catch (err) {
    console.error('💥 [RESET] Unexpected error:', err);
  }

  process.exit(0);
}

resetPassword();

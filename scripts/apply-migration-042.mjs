#!/usr/bin/env node

/**
 * Apply Migration 042: Fix Invitation DELETE Policy
 *
 * Solves: 500 error when deleting/canceling collaborator invitations
 * Root cause: RLS policy only allowed 'owner', but backend allows 'owner' and 'admin'
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment
dotenv.config({ path: join(__dirname, '..', '.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false }
});

async function applyMigration() {
  console.log('🚀 Applying Migration 042: Fix Invitation DELETE Policy\n');

  try {
    // Read migration file
    const migrationPath = join(__dirname, '..', 'db', 'migrations', '042_fix_invitation_delete_policy.sql');
    const migrationSQL = readFileSync(migrationPath, 'utf8');

    console.log('📝 Executing migration SQL...');

    // Execute migration
    const { error } = await supabase.rpc('exec_sql', { sql: migrationSQL });

    if (error) {
      // If exec_sql doesn't exist, try direct execution
      const statements = migrationSQL
        .split(';')
        .map(s => s.trim())
        .filter(s => s && !s.startsWith('--'));

      for (const statement of statements) {
        const { error: stmtError } = await supabase.rpc('exec', { query: statement });
        if (stmtError) {
          console.error('❌ Error executing statement:', stmtError);
          throw stmtError;
        }
      }
    }

    console.log('✅ Migration 042 applied successfully!\n');
    console.log('Changes:');
    console.log('  - Dropped restrictive policy: "Owners can delete invitations"');
    console.log('  - Created new policy: "Owners and admins can delete invitations"');
    console.log('  - Now both owners AND admins can cancel pending invitations');
    console.log('\n🎉 Invitation deletion should now work without 500 errors!');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

applyMigration();

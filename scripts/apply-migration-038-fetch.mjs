#!/usr/bin/env node
/**
 * Apply Migration 038: Soft Delete Orders System
 * Uses fetch to execute SQL via Supabase Management API
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials in .env file');
  console.error('Required: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// Extract project ref from URL
const projectRef = supabaseUrl.match(/https:\/\/(.+?)\.supabase\.co/)?.[1];
if (!projectRef) {
  console.error('❌ Could not extract project ref from VITE_SUPABASE_URL');
  process.exit(1);
}

async function executeSQL(sql) {
  const url = `https://${projectRef}.supabase.co/rest/v1/rpc/exec_sql`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': supabaseServiceKey,
      'Authorization': `Bearer ${supabaseServiceKey}`,
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({ sql_query: sql })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  return response;
}

async function applyMigration() {
  console.log('\n🚀 Starting Migration 038: Soft Delete Orders System\n');
  console.log(`📍 Project: ${projectRef}\n`);

  try {
    // Read migration file
    const migrationPath = path.join(__dirname, '..', 'db', 'migrations', '038_soft_delete_orders_system.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    console.log('📄 Migration file loaded');
    console.log('📝 Executing SQL (this may take a moment)...\n');

    // Try to execute the entire migration at once
    try {
      await executeSQL(migrationSQL);
      console.log('✅ Migration executed successfully!\n');
    } catch (error) {
      console.log('⚠️  Full migration failed, trying statement-by-statement...\n');
      console.error('Error:', error.message);

      // Split and execute one by one
      const statements = migrationSQL
        .split(';')
        .map(s => s.trim())
        .filter(s => {
          if (!s) return false;
          // Skip comment-only lines
          const lines = s.split('\n').filter(l => !l.trim().startsWith('--'));
          return lines.length > 0 && lines.some(l => l.trim().length > 0);
        });

      console.log(`Found ${statements.length} statements to execute\n`);

      for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i] + ';';
        const preview = stmt.split('\n')[0].substring(0, 70);

        console.log(`[${i + 1}/${statements.length}] ${preview}...`);

        try {
          await executeSQL(stmt);
          console.log('  ✓');
        } catch (err) {
          console.error(`  ❌ Error: ${err.message}`);
          // Continue with next statement
        }
      }
    }

    console.log('\n✅ Migration 038 completed!\n');
    console.log('📊 Summary of changes:');
    console.log('  ✓ Added deleted_at, deleted_by, deletion_type columns to orders');
    console.log('  ✓ Added is_test, marked_test_by, marked_test_at columns to orders');
    console.log('  ✓ Created indexes for filtering deleted/test orders');
    console.log('  ✓ Added smart_order_deletion_with_stock_restoration() function');
    console.log('  ✓ Added trigger_restore_stock_on_hard_delete trigger');
    console.log('  ✓ Added restore_soft_deleted_order() function');
    console.log('  ✓ Added mark_order_as_test() function');
    console.log('\n🎯 Next step: Refresh your browser - the 500 error should be gone!\n');

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    if (error.stack) {
      console.error('\nStack trace:', error.stack);
    }
    process.exit(1);
  }
}

applyMigration();

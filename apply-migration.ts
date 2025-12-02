#!/usr/bin/env ts-node

import { supabaseAdmin } from './api/db/connection';
import * as fs from 'fs';
import * as path from 'path';

async function applyMigration(migrationFile: string) {
  console.log(`📁 Reading migration file: ${migrationFile}`);

  const migrationPath = path.join(__dirname, migrationFile);
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  console.log(`📝 SQL to execute:\n${sql}\n`);
  console.log(`🚀 Applying migration...`);

  try {
    // Execute the SQL
    const { data, error } = await supabaseAdmin.rpc('exec_sql', { sql_text: sql });

    if (error) {
      console.error(`❌ Migration failed:`, error);
      process.exit(1);
    }

    console.log(`✅ Migration applied successfully!`);
    console.log('Result:', data);
  } catch (err) {
    console.error(`❌ Error applying migration:`, err);
    process.exit(1);
  }
}

const migrationFile = process.argv[2] || 'db/migrations/018_fix_cod_amount_type.sql';
applyMigration(migrationFile);

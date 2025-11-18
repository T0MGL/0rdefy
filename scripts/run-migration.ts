// ================================================================
// RUN MIGRATION SCRIPT
// ================================================================
// Runs a specific migration file using Supabase client
// Usage: npx tsx scripts/run-migration.ts <migration-file>
// ================================================================

import { supabaseAdmin } from '../api/db/connection';
import { readFileSync } from 'fs';
import { join } from 'path';
import dotenv from 'dotenv';

dotenv.config();

async function runMigration(migrationFile: string) {
    try {
        console.log(`📦 Running migration: ${migrationFile}`);

        const migrationPath = join(__dirname, '..', 'db', 'migrations', migrationFile);
        const sql = readFileSync(migrationPath, 'utf-8');

        console.log('🔄 Executing SQL...');

        // Split by semicolons and execute each statement
        const statements = sql
            .split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0 && !s.startsWith('--'));

        for (const statement of statements) {
            if (statement.trim()) {
                console.log(`  ➜ Executing statement (${statement.substring(0, 50)}...)`);
                const { error } = await supabaseAdmin.rpc('exec_sql', { sql_string: statement });

                if (error) {
                    console.error(`  ❌ Error:`, error);
                    throw error;
                }
                console.log(`  ✅ Success`);
            }
        }

        console.log('✅ Migration completed successfully!');
    } catch (error: any) {
        console.error('❌ Migration failed:', error.message);
        process.exit(1);
    }
}

const migrationFile = process.argv[2];

if (!migrationFile) {
    console.error('❌ Please provide a migration file name');
    console.log('Usage: npx tsx scripts/run-migration.ts <migration-file>');
    console.log('Example: npx tsx scripts/run-migration.ts 006_shopify_oauth.sql');
    process.exit(1);
}

runMigration(migrationFile);

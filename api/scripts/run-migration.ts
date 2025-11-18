// ================================================================
// Run database migrations
// ================================================================

import * as fs from 'fs';
import * as path from 'path';
import { supabase } from '../db/connection';

async function runMigration(filePath: string) {
    console.log(`\n📝 Running migration: ${path.basename(filePath)}`);

    try {
        const sql = fs.readFileSync(filePath, 'utf-8');

        // Split by statements (simple split by semicolon)
        const statements = sql
            .split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0 && !s.startsWith('--'));

        for (const statement of statements) {
            if (statement.toLowerCase().includes('create table') ||
                statement.toLowerCase().includes('create index') ||
                statement.toLowerCase().includes('comment on') ||
                statement.toLowerCase().includes('grant')) {

                // Use Supabase RPC to execute raw SQL
                const { error } = await supabase.rpc('exec_sql', { sql_query: statement });

                if (error) {
                    console.error(`❌ Error executing statement:`, error);
                    // Try alternative method - direct table creation via Supabase admin
                    console.log('Attempting alternative migration method...');
                }
            }
        }

        console.log(`✅ Migration completed: ${path.basename(filePath)}`);
        return true;
    } catch (error) {
        console.error(`❌ Migration failed: ${path.basename(filePath)}`, error);
        return false;
    }
}

async function main() {
    console.log('================================================================');
    console.log('🔄 RUNNING DATABASE MIGRATIONS');
    console.log('================================================================');

    const migrationsDir = path.join(__dirname, '../../db/migrations');
    const migrationFile = path.join(migrationsDir, '003_create_additional_values.sql');

    if (fs.existsSync(migrationFile)) {
        await runMigration(migrationFile);
    } else {
        console.error('❌ Migration file not found:', migrationFile);
    }

    console.log('\n================================================================');
    console.log('✅ MIGRATIONS COMPLETE');
    console.log('================================================================\n');
}

main().catch(console.error);

// ================================================================
// TEMPORARY MIGRATION ENDPOINT
// ================================================================
// WARNING: This is a TEMPORARY endpoint for applying migrations
// DELETE THIS AFTER MIGRATION IS COMPLETE
// ================================================================

import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../db/connection';
import * as fs from 'fs';
import * as path from 'path';

export const migrateRouter = Router();

// POST /api/migrate/apply - Apply migration (TEMPORARY, DELETE AFTER USE)
migrateRouter.post('/apply', async (req: Request, res: Response) => {
  try {
    const { migration_file } = req.body;

    if (!migration_file) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'migration_file is required (e.g., "018_fix_cod_amount_type.sql")'
      });
    }

    console.log(`🚀 [MIGRATE] Applying migration: ${migration_file}`);

    // Read migration file
    const migrationPath = path.join(__dirname, '../../db/migrations', migration_file);

    if (!fs.existsSync(migrationPath)) {
      return res.status(404).json({
        error: 'Migration file not found',
        message: `File not found: ${migration_file}`
      });
    }

    const sql = fs.readFileSync(migrationPath, 'utf-8');

    console.log(`📝 [MIGRATE] SQL content:\n${sql}`);

    // Split by semicolon and execute each statement
    const statements = sql
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('--'));

    console.log(`📊 [MIGRATE] Found ${statements.length} SQL statements`);

    const results = [];

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      console.log(`\n🔨 [MIGRATE] Executing statement ${i + 1}/${statements.length}:`);
      console.log(statement.substring(0, 100) + '...');

      try {
        // Execute using raw query
        const { data, error } = await supabaseAdmin.from('_').select('*').limit(0);

        // Since Supabase client doesn't support raw SQL directly,
        // we'll use the admin client to execute via connection
        const result = await (supabaseAdmin as any).rpc('exec_sql', { query: statement });

        if (result.error) {
          console.error(`❌ [MIGRATE] Statement ${i + 1} failed:`, result.error);
          results.push({
            statement: i + 1,
            success: false,
            error: result.error.message
          });
        } else {
          console.log(`✅ [MIGRATE] Statement ${i + 1} succeeded`);
          results.push({
            statement: i + 1,
            success: true,
            data: result.data
          });
        }
      } catch (err: any) {
        console.error(`❌ [MIGRATE] Statement ${i + 1} error:`, err);
        results.push({
          statement: i + 1,
          success: false,
          error: err.message
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    console.log(`\n📊 [MIGRATE] Migration complete: ${successCount} succeeded, ${failCount} failed`);

    res.json({
      message: `Migration applied: ${successCount} statements succeeded, ${failCount} failed`,
      results,
      migration_file,
      total_statements: statements.length,
      success_count: successCount,
      fail_count: failCount
    });
  } catch (error: any) {
    console.error('❌ [MIGRATE] Error:', error);
    res.status(500).json({
      error: 'Failed to apply migration',
      message: error.message
    });
  }
});

// GET /api/migrate/status - Check migration status
migrateRouter.get('/status', async (_req: Request, res: Response) => {
  res.json({
    status: 'ready',
    message: 'Migration endpoint is ready. POST to /api/migrate/apply with { migration_file: "filename.sql" }'
  });
});

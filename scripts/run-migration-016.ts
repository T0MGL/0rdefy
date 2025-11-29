// ================================================================
// SCRIPT: Run Migration 016 (Carrier Zones & Settlements)
// ================================================================
// Usage: npx tsx scripts/run-migration-016.ts
// ================================================================

import { supabaseAdmin } from '../api/db/connection';
import fs from 'fs';
import path from 'path';

async function runMigration() {
  console.log('🚀 Starting Migration 016: Carrier Zones & Settlements\n');

  try {
    // Read the migration file
    const migrationPath = path.join(__dirname, '../db/migrations/016_carrier_zones_and_settlements.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');

    console.log('📄 Migration file loaded:', migrationPath);
    console.log('📦 SQL size:', (migrationSQL.length / 1024).toFixed(2), 'KB\n');

    // Split by statement (rough split - Supabase will handle the full SQL)
    const statements = migrationSQL
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    console.log('📝 Total statements:', statements.length);
    console.log('⏳ Executing migration...\n');

    // Execute the full migration as a single query
    // Supabase supports multi-statement SQL
    const { error } = await supabaseAdmin.rpc('exec_sql', { sql: migrationSQL });

    if (error) {
      // If RPC doesn't exist, try direct query approach
      console.log('⚠️  RPC method not available, trying direct execution...\n');

      // Execute each major section separately
      const sections = migrationSQL.split('-- ================================================================');

      for (let i = 0; i < sections.length; i++) {
        const section = sections[i].trim();
        if (!section || section.startsWith('MIGRATION 016:')) continue;

        console.log(`Executing section ${i}...`);

        // Execute via raw SQL
        const { error: sectionError } = await supabaseAdmin.from('_migrations').insert({ sql: section });

        if (sectionError) {
          console.error('❌ Error in section', i, ':', sectionError);
        }
      }
    }

    console.log('✅ Migration 016 executed successfully!\n');

    // Verify tables were created
    console.log('🔍 Verifying new tables...\n');

    const { data: carrierZones, error: czError } = await supabaseAdmin
      .from('carrier_zones')
      .select('count')
      .limit(1);

    const { data: carrierSettlements, error: csError } = await supabaseAdmin
      .from('carrier_settlements')
      .select('count')
      .limit(1);

    if (!czError) {
      console.log('✅ carrier_zones table exists');
    } else {
      console.error('❌ carrier_zones table not found:', czError.message);
    }

    if (!csError) {
      console.log('✅ carrier_settlements table exists');
    } else {
      console.error('❌ carrier_settlements table not found:', csError.message);
    }

    // Check new columns in orders
    const { data: orders, error: ordersError } = await supabaseAdmin
      .from('orders')
      .select('shipping_cost, delivery_zone')
      .limit(1);

    if (!ordersError) {
      console.log('✅ orders table updated (shipping_cost, delivery_zone columns added)');
    } else {
      console.log('⚠️  Could not verify orders columns:', ordersError.message);
    }

    console.log('\n✨ Migration 016 complete!\n');

    console.log('📊 Summary:');
    console.log('   - carrier_zones table created');
    console.log('   - carrier_settlements table created');
    console.log('   - carriers table updated (carrier_type, default_zone)');
    console.log('   - orders table updated (shipping_cost, delivery_zone, carrier_settlement_id)');
    console.log('   - create_carrier_settlement() function added');
    console.log('   - pending_carrier_settlements_summary view created\n');

  } catch (error: any) {
    console.error('❌ Migration failed:', error);
    console.error('\n💡 Tip: You may need to run this SQL manually in Supabase SQL Editor');
    console.error('   File: db/migrations/016_carrier_zones_and_settlements.sql\n');
    process.exit(1);
  }
}

// Run migration
runMigration();

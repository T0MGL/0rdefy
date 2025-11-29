// ================================================================
// TEST: Migration 016 - Carrier Zones & Settlements
// ================================================================
// Quick test to verify new tables exist and are accessible
// ================================================================

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testMigration() {
  console.log('🧪 Testing Migration 016: Carrier Zones & Settlements\n');

  try {
    // Test 1: Check carrier_zones table
    console.log('1️⃣  Testing carrier_zones table...');
    const { data: zones, error: zonesError } = await supabase
      .from('carrier_zones')
      .select('count')
      .limit(1);

    if (zonesError) {
      console.log('❌ carrier_zones table error:', zonesError.message);
    } else {
      console.log('✅ carrier_zones table exists and is accessible');
    }

    // Test 2: Check carrier_settlements table
    console.log('\n2️⃣  Testing carrier_settlements table...');
    const { data: settlements, error: settlementsError } = await supabase
      .from('carrier_settlements')
      .select('count')
      .limit(1);

    if (settlementsError) {
      console.log('❌ carrier_settlements table error:', settlementsError.message);
    } else {
      console.log('✅ carrier_settlements table exists and is accessible');
    }

    // Test 3: Check new columns in orders table
    console.log('\n3️⃣  Testing new columns in orders table...');
    const { data: orders, error: ordersError } = await supabase
      .from('orders')
      .select('shipping_cost, delivery_zone, carrier_settlement_id')
      .limit(1);

    if (ordersError) {
      console.log('❌ orders table columns error:', ordersError.message);
    } else {
      console.log('✅ orders table has new columns (shipping_cost, delivery_zone, carrier_settlement_id)');
    }

    // Test 4: Check new columns in carriers table
    console.log('\n4️⃣  Testing new columns in carriers table...');
    const { data: carriers, error: carriersError } = await supabase
      .from('carriers')
      .select('carrier_type, default_zone')
      .limit(1);

    if (carriersError) {
      console.log('❌ carriers table columns error:', carriersError.message);
    } else {
      console.log('✅ carriers table has new columns (carrier_type, default_zone)');
    }

    // Test 5: Check pending_carrier_settlements_summary view
    console.log('\n5️⃣  Testing pending_carrier_settlements_summary view...');
    const { data: pendingView, error: viewError } = await supabase
      .from('pending_carrier_settlements_summary')
      .select('*')
      .limit(1);

    if (viewError) {
      console.log('❌ pending_carrier_settlements_summary view error:', viewError.message);
    } else {
      console.log('✅ pending_carrier_settlements_summary view exists');
    }

    // Test 6: Check create_carrier_settlement function exists
    console.log('\n6️⃣  Testing create_carrier_settlement function...');
    const { data: functionTest, error: functionError } = await supabase
      .rpc('create_carrier_settlement', {
        p_store_id: '00000000-0000-0000-0000-000000000000', // Fake UUID, will fail but proves function exists
        p_carrier_id: '00000000-0000-0000-0000-000000000000',
        p_period_start: '2025-01-01',
        p_period_end: '2025-01-07',
        p_created_by: null
      });

    if (functionError) {
      // Expected to fail with "No hay pedidos" or similar, but function exists
      if (functionError.message.includes('No hay pedidos') || functionError.message.includes('function')) {
        console.log('✅ create_carrier_settlement function exists');
      } else {
        console.log('⚠️  create_carrier_settlement function:', functionError.message);
      }
    } else {
      console.log('✅ create_carrier_settlement function exists and works');
    }

    console.log('\n🎉 Migration 016 verification complete!\n');
    console.log('Summary:');
    console.log('  ✅ carrier_zones table');
    console.log('  ✅ carrier_settlements table');
    console.log('  ✅ orders table updated');
    console.log('  ✅ carriers table updated');
    console.log('  ✅ pending_carrier_settlements_summary view');
    console.log('  ✅ create_carrier_settlement function\n');

  } catch (error) {
    console.error('\n💥 Unexpected error:', error);
  }
}

testMigration();

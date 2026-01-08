const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/Users/gastonlopez/Documents/Code/ORDEFY/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testSchema() {
  console.log('🔍 Testing settlements schema...\n');

  // 1. Check dispatch_sessions table exists
  console.log('1. Checking dispatch_sessions table...');
  const { data: sessions, error: sessionsError } = await supabase
    .from('dispatch_sessions')
    .select('*')
    .limit(1);

  if (sessionsError) {
    console.log('❌ dispatch_sessions table error:', sessionsError.message);
  } else {
    console.log('✅ dispatch_sessions table exists');
  }

  // 2. Check dispatch_session_orders table
  console.log('\n2. Checking dispatch_session_orders table...');
  const { data: sessionOrders, error: soError } = await supabase
    .from('dispatch_session_orders')
    .select('*')
    .limit(1);

  if (soError) {
    console.log('❌ dispatch_session_orders table error:', soError.message);
  } else {
    console.log('✅ dispatch_session_orders table exists');
  }

  // 3. Check carrier_zones table
  console.log('\n3. Checking carrier_zones table...');
  const { data: zones, error: zonesError } = await supabase
    .from('carrier_zones')
    .select('*')
    .limit(1);

  if (zonesError) {
    console.log('❌ carrier_zones table error:', zonesError.message);
  } else {
    console.log('✅ carrier_zones table exists');
  }

  // 4. Check daily_settlements has new columns
  console.log('\n4. Checking daily_settlements columns...');
  const { data: settlements, error: settlementsError } = await supabase
    .from('daily_settlements')
    .select('settlement_code, dispatch_session_id, total_dispatched, total_delivered, net_receivable, balance_due')
    .limit(1);

  if (settlementsError) {
    console.log('❌ daily_settlements new columns error:', settlementsError.message);
  } else {
    console.log('✅ daily_settlements has new columns (settlement_code, dispatch_session_id, net_receivable, etc.)');
  }

  // 5. Check if any carriers exist to test with
  console.log('\n5. Checking for existing carriers...');
  const { data: carriers, count: carrierCount } = await supabase
    .from('carriers')
    .select('id, name, store_id', { count: 'exact' })
    .limit(5);

  console.log('   Found ' + (carrierCount || 0) + ' carriers');
  if (carriers && carriers.length > 0) {
    carriers.forEach(c => console.log('   - ' + c.name + ' (' + c.id + ')'));
  }

  // 6. Check if any orders exist to test dispatching
  console.log('\n6. Checking for orders ready to dispatch (confirmed status)...');
  const { data: orders, count: orderCount } = await supabase
    .from('orders')
    .select('id, reference_number, status, carrier_id', { count: 'exact' })
    .eq('status', 'confirmed')
    .limit(5);

  console.log('   Found ' + (orderCount || 0) + ' confirmed orders');
  if (orders && orders.length > 0) {
    orders.forEach(o => console.log('   - ' + o.reference_number + ' (carrier: ' + (o.carrier_id || 'none') + ')'));
  }

  console.log('\n✅ Schema verification complete!');
}

testSchema().catch(console.error);

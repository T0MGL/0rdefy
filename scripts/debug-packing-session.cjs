require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY
);

async function debugPackingSession(sessionId) {
  console.log(`\n🔍 Debugging Packing Session: ${sessionId}\n`);

  // 1. Get session info
  const { data: session } = await supabase
    .from('picking_sessions')
    .select('*')
    .eq('id', sessionId)
    .single();

  console.log('📦 Session:', session);

  // 2. Get packing progress
  const { data: packingProgress } = await supabase
    .from('packing_progress')
    .select('*')
    .eq('picking_session_id', sessionId);

  console.log('\n📊 Packing Progress:');
  packingProgress?.forEach(p => {
    console.log(`  Product: ${p.product_id}`);
    console.log(`  Order: ${p.order_id}`);
    console.log(`  Needed: ${p.quantity_needed}`);
    console.log(`  Packed: ${p.quantity_packed}`);
    console.log(`  Complete: ${p.quantity_packed >= p.quantity_needed ? '✅ YES' : '❌ NO'}`);
    console.log('');
  });

  // 3. Get orders in session
  const { data: sessionOrders } = await supabase
    .from('picking_session_orders')
    .select('order_id')
    .eq('picking_session_id', sessionId);

  const orderIds = sessionOrders?.map(so => so.order_id) || [];

  // 4. Get order line items
  const { data: lineItems } = await supabase
    .from('order_line_items')
    .select('*')
    .in('order_id', orderIds);

  console.log('\n📋 Order Line Items:');
  lineItems?.forEach(li => {
    console.log(`  Order: ${li.order_id}`);
    console.log(`  Product: ${li.product_id}`);
    console.log(`  Product Name: ${li.product_name}`);
    console.log(`  Quantity: ${li.quantity}`);
    console.log('');
  });

  // 5. Check for mismatches
  console.log('\n🔍 Checking for mismatches...\n');

  const notFullyPacked = packingProgress?.filter(
    p => p.quantity_packed < p.quantity_needed
  );

  if (notFullyPacked && notFullyPacked.length > 0) {
    console.log(`❌ Found ${notFullyPacked.length} items NOT fully packed:`);
    notFullyPacked.forEach(p => {
      console.log(`  - Product ${p.product_id}: ${p.quantity_packed}/${p.quantity_needed}`);
    });
  } else {
    console.log('✅ All items fully packed!');
  }

  // 6. Check if all line items have packing progress
  const missingProgress = [];
  lineItems?.forEach(li => {
    const hasProgress = packingProgress?.find(
      p => p.order_id === li.order_id && p.product_id === li.product_id
    );
    if (!hasProgress) {
      missingProgress.push(li);
    }
  });

  if (missingProgress.length > 0) {
    console.log(`\n⚠️  Found ${missingProgress.length} line items WITHOUT packing progress:`);
    missingProgress.forEach(li => {
      console.log(`  - Order ${li.order_id}, Product ${li.product_id} (${li.product_name})`);
    });
  } else {
    console.log('\n✅ All line items have packing progress');
  }
}

// Get session ID from command line
const sessionId = process.argv[2];

if (!sessionId) {
  console.error('Usage: node scripts/debug-packing-session.cjs <session_id>');
  process.exit(1);
}

debugPackingSession(sessionId)
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });

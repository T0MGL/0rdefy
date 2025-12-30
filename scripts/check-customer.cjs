#!/usr/bin/env node
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  // Get integration first
  const { data: integration } = await supabase
    .from('shopify_integrations')
    .select('store_id, shop_domain')
    .eq('shop_domain', 's17fez-rb.myshopify.com')
    .single();

  if (!integration) {
    console.log('❌ Integration not found');
    return;
  }

  console.log(`\n🏪 Store ID: ${integration.store_id}\n`);

  // Check for recent customers
  const { data: customers, error } = await supabase
    .from('customers')
    .select('*')
    .eq('store_id', integration.store_id)
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) {
    console.error('❌ Error:', error);
    return;
  }

  if (!customers || customers.length === 0) {
    console.log('❌ No customers found for this store');
    return;
  }

  console.log(`👥 Recent customers:\n`);
  for (const customer of customers) {
    console.log(`Customer ID: ${customer.id}`);
    console.log(`  Name: ${customer.name}`);
    console.log(`  Email: ${customer.email || 'N/A'}`);
    console.log(`  Phone: ${customer.phone || 'N/A'}`);
    console.log(`  Created: ${customer.created_at}`);
    console.log('');
  }
}

main().catch(console.error);

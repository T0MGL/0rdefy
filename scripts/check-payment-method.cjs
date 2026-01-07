#!/usr/bin/env node
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkPaymentMethod() {
  console.log('🔍 Checking recent orders payment methods...\n');

  const { data, error } = await supabase
    .from('orders')
    .select('id, customer_id, payment_method, payment_gateway, cod_amount, financial_status')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    console.error('❌ Error:', error);
    return;
  }

  console.log('Recent orders:');
  console.table(data);
}

checkPaymentMethod();

// Check which columns exist in orders table
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkColumns() {
  // Get one order with all columns
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .limit(1);

  if (error) {
    console.log('Error:', error.message);
    return;
  }

  if (data && data[0]) {
    const columns = Object.keys(data[0]).sort();
    console.log('Columnas existentes en orders (' + columns.length + '):\n');
    columns.forEach(col => console.log('  - ' + col));

    // Check for specific columns we need
    const needed = ['city', 'neighborhood', 'address_reference', 'customer_address'];
    console.log('\n\nColumnas que necesitamos:');
    needed.forEach(col => {
      const exists = columns.includes(col);
      console.log(`  ${exists ? '✅' : '❌'} ${col}`);
    });
  }
}

checkColumns();

// Check which columns exist in orders table
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://vgqecqqleuowvoimcoxg.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZncWVjcXFsZXVvd3ZvaW1jb3hnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzA1Njk3NywiZXhwIjoyMDgyNjMyOTc3fQ.IjLDyb3WCjddkszPyXgDblfi3Pyfq8wb3C9blZOaZO4';

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

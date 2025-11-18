// ================================================================
// SCHEMA STRUCTURE CHECKER
// ================================================================
import { supabaseAdmin } from '../api/db/connection.js';

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
};

async function checkTableStructure(tableName: string) {
  console.log(`\n${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
  console.log(`${colors.cyan}TABLE: ${tableName}${colors.reset}`);
  console.log(`${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);

  try {
    // Get one record to inspect columns
    const { data, error } = await supabaseAdmin
      .from(tableName)
      .select('*')
      .limit(1);

    if (error) {
      console.log(`${colors.red}❌ Error: ${error.message}${colors.reset}`);
      return;
    }

    if (!data || data.length === 0) {
      console.log(`${colors.yellow}⚠️  Table exists but has no data${colors.reset}`);
      console.log(`${colors.yellow}   Cannot determine columns from empty table${colors.reset}`);
      return;
    }

    const columns = Object.keys(data[0]);
    console.log(`${colors.green}✅ Found ${columns.length} columns:${colors.reset}`);
    columns.forEach(col => {
      const value = data[0][col];
      const type = value === null ? 'null' : typeof value;
      console.log(`   - ${col} (${type})`);
    });

  } catch (err: any) {
    console.log(`${colors.red}❌ Exception: ${err.message}${colors.reset}`);
  }
}

async function listAllTables() {
  console.log(`\n${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
  console.log(`${colors.cyan}ALL TABLES IN DATABASE${colors.reset}`);
  console.log(`${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);

  const tables = [
    'users',
    'stores',
    'store_config',
    'user_stores',
    'customers',
    'products',
    'orders',
    'order_items',
    'additional_values',
    'suppliers',
    'campaigns',
    'carriers',
    'shopify_oauth',
    'shopify_sync_status',
    'delivery_ratings'
  ];

  for (const table of tables) {
    try {
      const { count, error } = await supabaseAdmin
        .from(table)
        .select('*', { count: 'exact', head: true });

      if (error) {
        if (error.message.includes('does not exist')) {
          console.log(`${colors.red}❌ ${table} - DOES NOT EXIST${colors.reset}`);
        } else {
          console.log(`${colors.red}❌ ${table} - Error: ${error.message}${colors.reset}`);
        }
      } else {
        console.log(`${colors.green}✅ ${table} - ${count || 0} records${colors.reset}`);
      }
    } catch (err: any) {
      console.log(`${colors.red}❌ ${table} - Exception: ${err.message}${colors.reset}`);
    }
  }
}

async function main() {
  console.log(`${colors.cyan}╔════════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.cyan}║          DATABASE SCHEMA CHECKER                   ║${colors.reset}`);
  console.log(`${colors.cyan}╚════════════════════════════════════════════════════╝${colors.reset}`);

  await listAllTables();

  // Check critical tables
  await checkTableStructure('customers');
  await checkTableStructure('products');
  await checkTableStructure('orders');

  console.log(`\n${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}\n`);
}

main().catch(console.error);

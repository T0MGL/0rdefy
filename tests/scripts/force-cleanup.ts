#!/usr/bin/env tsx
/**
 * Force Cleanup Script
 *
 * Use this script to manually clean up all test data from production.
 * Run with: npx tsx scripts/force-cleanup.ts
 *
 * WARNING: This will delete ALL data matching the TEST_E2E_ prefix!
 */

import { ProductionApiClient } from '../utils/api-client';
import { cleanupOrphanedTestData, verifyCleanProduction } from '../utils/cleanup';
import { CONFIG } from '../e2e/config';

async function main() {
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                                                              ║');
  console.log('║     🧹  FORCE CLEANUP - PRODUCTION                           ║');
  console.log('║                                                              ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  API URL:    ${CONFIG.apiUrl.padEnd(46)}║`);
  console.log(`║  Prefix:     ${CONFIG.testPrefix.padEnd(46)}║`);
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║                                                              ║');
  console.log('║  ⚠️   THIS WILL DELETE ALL TEST DATA FROM PRODUCTION        ║');
  console.log('║                                                              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('\n');

  // Create API client and login
  const api = new ProductionApiClient();

  console.log('🔑 Authenticating...');
  await api.login();
  console.log('   ✓ Authenticated\n');

  // Run cleanup
  console.log('🧹 Starting cleanup...\n');
  const report = await cleanupOrphanedTestData(api);

  // Verify clean
  console.log('🔍 Verifying cleanup...\n');
  const { clean, remainingItems } = await verifyCleanProduction(api);

  // Final report
  console.log('\n');
  console.log('═'.repeat(60));
  console.log('CLEANUP COMPLETE');
  console.log('═'.repeat(60));
  console.log(`Total Found:   ${report.totalFound}`);
  console.log(`Total Deleted: ${report.totalDeleted}`);
  console.log(`Total Failed:  ${report.totalFailed}`);
  console.log(`Duration:      ${report.duration}ms`);
  console.log('─'.repeat(60));

  if (clean) {
    console.log('✅ Production is clean!');
  } else {
    console.log('⚠️  Some items could not be deleted:');
    for (const item of remainingItems) {
      console.log(`   - ${item}`);
    }
    console.log('\n   Manual intervention may be required.');
  }

  console.log('═'.repeat(60));
  console.log('\n');

  process.exit(clean ? 0 : 1);
}

main().catch((error) => {
  console.error('\n❌ Cleanup failed:', error.message);
  process.exit(1);
});

/**
 * Migration Script: Update Stripe Customer Metadata
 *
 * After migrating subscriptions from store-level to user-level,
 * we need to update Stripe customer metadata to use user_id instead of store_id.
 *
 * Run this AFTER running migration 052.
 *
 * Usage:
 *   tsx scripts/migrate-stripe-customers.ts
 *   tsx scripts/migrate-stripe-customers.ts --dry-run  (preview without changes)
 */

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-11-20.acacia',
});

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!  // Admin key for migration
);

interface SubscriptionRecord {
  user_id: string;
  stripe_customer_id: string;
  plan: string;
  status: string;
  created_at: string;
}

async function migrateStripeCustomers(dryRun: boolean = false) {
  console.log('🔄 Starting Stripe customer metadata migration...\n');

  if (dryRun) {
    console.log('⚠️  DRY RUN MODE - No changes will be made to Stripe\n');
  }

  // Step 1: Get all subscriptions with Stripe customer IDs
  const { data: subscriptions, error } = await supabase
    .from('subscriptions')
    .select('user_id, stripe_customer_id, plan, status, created_at')
    .not('stripe_customer_id', 'is', null)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('❌ Error fetching subscriptions:', error);
    process.exit(1);
  }

  if (!subscriptions || subscriptions.length === 0) {
    console.log('✅ No subscriptions found with Stripe customer IDs');
    return;
  }

  console.log(`📊 Found ${subscriptions.length} subscriptions to migrate\n`);

  let successCount = 0;
  let errorCount = 0;
  let skippedCount = 0;

  // Step 2: Update each Stripe customer
  for (const sub of subscriptions as SubscriptionRecord[]) {
    try {
      // Check if customer exists in Stripe
      const customer = await stripe.customers.retrieve(sub.stripe_customer_id);

      if (customer.deleted) {
        console.log(`⚠️  Customer ${sub.stripe_customer_id} is deleted, skipping`);
        skippedCount++;
        continue;
      }

      // Check current metadata
      const currentMetadata = customer.metadata || {};

      if (currentMetadata.user_id === sub.user_id) {
        console.log(`✓ Customer ${sub.stripe_customer_id} already has correct user_id, skipping`);
        skippedCount++;
        continue;
      }

      if (dryRun) {
        console.log(`[DRY RUN] Would update customer ${sub.stripe_customer_id}:`);
        console.log(`  Current metadata:`, JSON.stringify(currentMetadata));
        console.log(`  New metadata:`, JSON.stringify({
          ...currentMetadata,
          user_id: sub.user_id,
          migrated_at: new Date().toISOString(),
          migration_version: '052'
        }));
        successCount++;
        continue;
      }

      // Update customer metadata
      await stripe.customers.update(sub.stripe_customer_id, {
        metadata: {
          ...currentMetadata,
          user_id: sub.user_id,
          migrated_at: new Date().toISOString(),
          migration_version: '052'
        }
      });

      console.log(`✅ Updated customer ${sub.stripe_customer_id} (user: ${sub.user_id}, plan: ${sub.plan})`);
      successCount++;

      // Rate limiting: Wait 100ms between requests to avoid hitting Stripe limits
      await new Promise(resolve => setTimeout(resolve, 100));

    } catch (error: any) {
      console.error(`❌ Failed to update customer ${sub.stripe_customer_id}:`, error.message);
      errorCount++;
    }
  }

  // Step 3: Summary
  console.log('\n' + '='.repeat(60));
  console.log('Migration Summary:');
  console.log('='.repeat(60));
  console.log(`Total subscriptions: ${subscriptions.length}`);
  console.log(`✅ Successfully updated: ${successCount}`);
  console.log(`⚠️  Skipped (already migrated or deleted): ${skippedCount}`);
  console.log(`❌ Errors: ${errorCount}`);
  console.log('='.repeat(60));

  if (dryRun) {
    console.log('\n⚠️  This was a DRY RUN. Run without --dry-run to apply changes.');
  } else if (errorCount > 0) {
    console.log('\n⚠️  Some customers failed to migrate. Check errors above.');
    process.exit(1);
  } else {
    console.log('\n🎉 Migration completed successfully!');
  }
}

// Run migration
const dryRun = process.argv.includes('--dry-run');
migrateStripeCustomers(dryRun)
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });

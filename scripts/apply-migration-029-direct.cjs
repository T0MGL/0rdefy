#!/usr/bin/env node
/**
 * Aplica la migración 029 usando Supabase client directamente
 */

const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

// Load .env
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing environment variables!');
  process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function applyMigration() {
  console.log('\n=== APPLYING MIGRATION 029 ===\n');

  try {
    // Step 1: Populate user_id for integrations missing it
    console.log('📝 Step 1: Populating user_id from user_stores...');

    const { data: integrations, error: fetchError } = await supabaseAdmin
      .from('shopify_integrations')
      .select('id, store_id, user_id, shop_domain')
      .is('user_id', null);

    if (fetchError) {
      throw new Error(`Failed to fetch integrations: ${fetchError.message}`);
    }

    console.log(`   Found ${integrations?.length || 0} integrations without user_id`);

    if (integrations && integrations.length > 0) {
      for (const integration of integrations) {
        // Get first admin user for this store
        const { data: userStore, error: userError } = await supabaseAdmin
          .from('user_stores')
          .select('user_id')
          .eq('store_id', integration.store_id)
          .eq('role', 'admin')
          .limit(1)
          .single();

        if (!userError && userStore) {
          // Update integration with user_id
          const { error: updateError } = await supabaseAdmin
            .from('shopify_integrations')
            .update({ user_id: userStore.user_id })
            .eq('id', integration.id);

          if (updateError) {
            console.error(`   ⚠️  Failed to update ${integration.shop_domain}: ${updateError.message}`);
          } else {
            console.log(`   ✅ Updated ${integration.shop_domain} with user_id`);
          }
        } else {
          console.warn(`   ⚠️  No admin user found for store ${integration.store_id}`);
        }
      }
    }

    // Step 2: Populate shop field (extract from shop_domain)
    console.log('\n📝 Step 2: Populating shop field from shop_domain...');

    const { data: integrations2, error: fetch2Error } = await supabaseAdmin
      .from('shopify_integrations')
      .select('id, shop_domain, shop')
      .or('shop.is.null,shop.eq.');

    if (fetch2Error) {
      throw new Error(`Failed to fetch integrations for shop update: ${fetch2Error.message}`);
    }

    console.log(`   Found ${integrations2?.length || 0} integrations without shop`);

    if (integrations2 && integrations2.length > 0) {
      for (const integration of integrations2) {
        // Extract shop name from shop_domain
        const shop = integration.shop_domain.replace('.myshopify.com', '');

        const { error: updateError } = await supabaseAdmin
          .from('shopify_integrations')
          .update({ shop })
          .eq('id', integration.id);

        if (updateError) {
          console.error(`   ⚠️  Failed to update shop for ${integration.shop_domain}: ${updateError.message}`);
        } else {
          console.log(`   ✅ Updated ${integration.shop_domain} -> shop: ${shop}`);
        }
      }
    }

    // Step 3: Verify results
    console.log('\n📊 Step 3: Verifying migration results...');

    const { data: finalCheck, error: checkError } = await supabaseAdmin
      .from('shopify_integrations')
      .select('id, shop_domain, shop, user_id');

    if (checkError) {
      throw new Error(`Failed to verify results: ${checkError.message}`);
    }

    console.log('\n=== FINAL STATE ===\n');
    finalCheck.forEach(int => {
      console.log(`Shop: ${int.shop_domain}`);
      console.log(`  - shop: ${int.shop || '❌ MISSING'}`);
      console.log(`  - user_id: ${int.user_id || '❌ MISSING'}`);
      console.log('');
    });

    const missingUserIdCount = finalCheck.filter(i => !i.user_id).length;
    const missingShopCount = finalCheck.filter(i => !i.shop).length;

    if (missingUserIdCount === 0 && missingShopCount === 0) {
      console.log('✅ Migration completed successfully! All integrations have user_id and shop.\n');
    } else {
      console.log('⚠️  Migration completed with warnings:');
      console.log(`   - Missing user_id: ${missingUserIdCount}`);
      console.log(`   - Missing shop: ${missingShopCount}\n`);
    }

    process.exit(0);

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

applyMigration();

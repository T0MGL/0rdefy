#!/usr/bin/env node
/**
 * Process Shopify webhook retry queue
 * Run: node scripts/process-webhook-queue.cjs
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function processQueue() {
  console.log('📦 Fetching pending webhooks from retry queue...\n');

  // 1. Fetch pending webhooks
  const { data: webhooks, error } = await supabase
    .from('shopify_webhook_retry_queue')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(10);

  if (error) {
    console.error('❌ Error fetching queue:', error);
    return;
  }

  if (!webhooks || webhooks.length === 0) {
    console.log('✅ No pending webhooks in queue');
    return;
  }

  console.log(`📋 Found ${webhooks.length} pending webhooks:\n`);

  for (const webhook of webhooks) {
    console.log(`\n🔄 Processing webhook ${webhook.id}`);
    console.log(`   Topic: ${webhook.topic}`);
    console.log(`   Shop: ${webhook.shop_domain}`);
    console.log(`   Attempt: ${webhook.attempt_count}`);

    // 2. Get integration
    const { data: integration, error: intError } = await supabase
      .from('shopify_integrations')
      .select('*')
      .eq('shop_domain', webhook.shop_domain)
      .eq('status', 'active')
      .single();

    if (intError || !integration) {
      console.error(`   ❌ Integration not found for ${webhook.shop_domain}`);

      // Mark as failed
      await supabase
        .from('shopify_webhook_retry_queue')
        .update({
          status: 'failed',
          last_error: 'Integration not found',
          processed_at: new Date().toISOString()
        })
        .eq('id', webhook.id);

      continue;
    }

    console.log(`   ✅ Integration found: ${integration.id}`);

    // 3. Process webhook based on topic
    try {
      let processedOrder = null;

      if (webhook.topic === 'orders/create') {
        // Parse webhook data
        const orderData = webhook.webhook_data;

        // Check if order already exists
        const { data: existingOrder } = await supabase
          .from('orders')
          .select('id')
          .eq('shopify_order_id', orderData.id.toString())
          .eq('store_id', integration.store_id)
          .single();

        if (existingOrder) {
          console.log(`   ℹ️  Order ${orderData.id} already exists (${existingOrder.id})`);

          // Mark as succeeded
          await supabase
            .from('shopify_webhook_retry_queue')
            .update({
              status: 'succeeded',
              processed_at: new Date().toISOString()
            })
            .eq('id', webhook.id);

          continue;
        }

        // Extract customer from order
        const customer = orderData.customer || {};
        const billingAddress = orderData.billing_address || {};
        const shippingAddress = orderData.shipping_address || {};

        // Find or create customer
        let customerId = null;

        if (customer.email) {
          const { data: existingCustomer } = await supabase
            .from('customers')
            .select('id')
            .eq('email', customer.email)
            .eq('store_id', integration.store_id)
            .single();

          if (existingCustomer) {
            customerId = existingCustomer.id;
          } else {
            // Create customer
            const { data: newCustomer } = await supabase
              .from('customers')
              .insert({
                store_id: integration.store_id,
                name: customer.first_name && customer.last_name
                  ? `${customer.first_name} ${customer.last_name}`.trim()
                  : billingAddress.name || shippingAddress.name || 'Cliente sin nombre',
                email: customer.email || orderData.email,
                phone: customer.phone || billingAddress.phone || shippingAddress.phone,
                address: shippingAddress.address1 || billingAddress.address1,
                city: shippingAddress.city || billingAddress.city,
                province: shippingAddress.province || billingAddress.province,
                country: shippingAddress.country || billingAddress.country,
                zip_code: shippingAddress.zip || billingAddress.zip
              })
              .select('id')
              .single();

            customerId = newCustomer?.id;
            console.log(`   ✅ Created customer: ${customerId}`);
          }
        }

        // Create order
        const { data: newOrder, error: orderError } = await supabase
          .from('orders')
          .insert({
            store_id: integration.store_id,
            customer_id: customerId,
            shopify_order_id: orderData.id.toString(),
            shopify_order_number: orderData.order_number?.toString(),
            status: 'pending',
            total_price: parseFloat(orderData.total_price || 0),
            currency: orderData.currency || 'USD',
            payment_method: orderData.payment_gateway_names?.[0] || 'unknown',
            delivery_notes: orderData.note || '',
            shipping_address: shippingAddress.address1 || billingAddress.address1,
            shipping_city: shippingAddress.city || billingAddress.city,
            shipping_province: shippingAddress.province || billingAddress.province,
            shipping_country: shippingAddress.country || billingAddress.country,
            shipping_zip: shippingAddress.zip || billingAddress.zip,
            created_at: orderData.created_at
          })
          .select('*')
          .single();

        if (orderError) {
          throw new Error(`Failed to create order: ${orderError.message}`);
        }

        processedOrder = newOrder;
        console.log(`   ✅ Created order: ${processedOrder.id}`);

        // Create line items
        if (orderData.line_items && orderData.line_items.length > 0) {
          const lineItems = orderData.line_items.map(item => ({
            order_id: processedOrder.id,
            store_id: integration.store_id,
            shopify_product_id: item.product_id?.toString(),
            shopify_variant_id: item.variant_id?.toString(),
            name: item.name,
            quantity: item.quantity,
            price: parseFloat(item.price || 0),
            total_discount: parseFloat(item.total_discount || 0),
            sku: item.sku
          }));

          const { error: lineItemsError } = await supabase
            .from('order_line_items')
            .insert(lineItems);

          if (lineItemsError) {
            console.warn(`   ⚠️  Failed to create line items: ${lineItemsError.message}`);
          } else {
            console.log(`   ✅ Created ${lineItems.length} line items`);
          }
        }
      }

      // Mark as succeeded
      await supabase
        .from('shopify_webhook_retry_queue')
        .update({
          status: 'succeeded',
          processed_at: new Date().toISOString()
        })
        .eq('id', webhook.id);

      console.log(`   ✅ Webhook processed successfully`);

    } catch (error) {
      console.error(`   ❌ Error processing webhook:`, error.message);

      // Update retry count
      const nextAttempt = webhook.attempt_count + 1;
      const maxAttempts = 5;

      if (nextAttempt >= maxAttempts) {
        // Mark as failed
        await supabase
          .from('shopify_webhook_retry_queue')
          .update({
            status: 'failed',
            attempt_count: nextAttempt,
            last_error: error.message,
            processed_at: new Date().toISOString()
          })
          .eq('id', webhook.id);

        console.log(`   ❌ Max attempts reached (${maxAttempts}), marked as failed`);
      } else {
        // Schedule retry
        const backoffSeconds = Math.min(60 * Math.pow(2, nextAttempt - 1), 960);
        const nextRetryAt = new Date(Date.now() + backoffSeconds * 1000);

        await supabase
          .from('shopify_webhook_retry_queue')
          .update({
            attempt_count: nextAttempt,
            last_error: error.message,
            next_retry_at: nextRetryAt.toISOString()
          })
          .eq('id', webhook.id);

        console.log(`   🔄 Scheduled retry #${nextAttempt} at ${nextRetryAt.toISOString()}`);
      }
    }
  }

  console.log('\n✅ Queue processing complete');
}

processQueue().catch(console.error);

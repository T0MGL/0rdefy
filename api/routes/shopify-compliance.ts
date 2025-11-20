// ================================================================
// Shopify GDPR Compliance Webhooks
// ================================================================
// Mandatory webhooks required by Shopify for GDPR compliance
// All endpoints verify HMAC signatures and respond with 200 OK
// Learn more: https://shopify.dev/docs/apps/webhooks/configuration/mandatory-webhooks
// ================================================================

import { Router, Response } from 'express';
import { validateShopifyWebhook, ShopifyWebhookRequest } from '../middleware/shopify-webhook';
import { supabaseAdmin } from '../db/connection';

export const shopifyComplianceRouter = Router();

/**
 * POST /api/shopify/compliance/customers/data_request
 *
 * Handles GDPR data access requests from customers.
 * When a customer requests their data through Shopify, this webhook is triggered.
 *
 * Response Requirements:
 * - Must verify HMAC signature (handled by middleware)
 * - Must return 401 if HMAC is invalid
 * - Must return 200 OK to acknowledge receipt
 *
 * Payload example:
 * {
 *   "shop_id": 954889,
 *   "shop_domain": "example.myshopify.com",
 *   "orders_requested": [299938, 280263],
 *   "customer": {
 *     "id": 191167,
 *     "email": "customer@example.com",
 *     "phone": "555-625-1199"
 *   },
 *   "data_request": {
 *     "id": 9999
 *   }
 * }
 */
shopifyComplianceRouter.post(
  '/customers/data_request',
  validateShopifyWebhook,
  async (req: ShopifyWebhookRequest, res: Response) => {
    try {
      const shopDomain = req.shopDomain;
      const integration = req.integration;
      const payload = req.body;

      console.log('================================================================');
      console.log('📋 GDPR: Customer Data Request Received');
      console.log('================================================================');
      console.log(`Shop Domain: ${shopDomain}`);
      console.log(`Customer ID: ${payload.customer?.id}`);
      console.log(`Customer Email: ${payload.customer?.email}`);
      console.log(`Data Request ID: ${payload.data_request?.id}`);
      console.log(`Orders Requested: ${payload.orders_requested?.length || 0}`);
      console.log('================================================================');

      // Log the request to database for audit trail
      if (integration) {
        const { error: logError } = await supabaseAdmin
          .from('shopify_webhook_events')
          .insert({
            integration_id: integration.id,
            topic: 'customers/data_request',
            shopify_order_id: null,
            payload: payload,
            processed: true,
            error: null,
          });

        if (logError) {
          console.error('❌ Error logging webhook event:', logError);
        }
      }

      // TODO: Implement actual data export logic here
      // This should:
      // 1. Retrieve all customer data from your database
      // 2. Format it according to Shopify's requirements
      // 3. Send it to the customer via email or make it available for download
      // 4. Track the request in your system

      console.log('✅ Customer data request logged successfully');
      console.log('⚠️  NOTE: Implement data export logic in production');

      // Return 200 OK to acknowledge receipt
      res.status(200).json({
        received: true,
        message: 'Customer data request received and logged',
        shop: shopDomain,
        request_id: payload.data_request?.id,
      });

    } catch (error: any) {
      console.error('❌ Error processing customers/data_request webhook:', error);
      console.error(error.stack);

      // Always return 200 to Shopify to prevent retries
      // Log the error for investigation
      res.status(200).json({
        received: true,
        error: 'Internal error processing request',
      });
    }
  }
);

/**
 * POST /api/shopify/compliance/customers/redact
 *
 * Handles GDPR data deletion requests (right to be forgotten).
 * When a customer requests their data to be deleted, this webhook is triggered.
 *
 * Response Requirements:
 * - Must verify HMAC signature (handled by middleware)
 * - Must return 401 if HMAC is invalid
 * - Must return 200 OK to acknowledge receipt
 *
 * Payload example:
 * {
 *   "shop_id": 954889,
 *   "shop_domain": "example.myshopify.com",
 *   "customer": {
 *     "id": 191167,
 *     "email": "customer@example.com",
 *     "phone": "555-625-1199"
 *   },
 *   "orders_to_redact": [299938, 280263]
 * }
 */
shopifyComplianceRouter.post(
  '/customers/redact',
  validateShopifyWebhook,
  async (req: ShopifyWebhookRequest, res: Response) => {
    try {
      const shopDomain = req.shopDomain;
      const integration = req.integration;
      const payload = req.body;

      console.log('================================================================');
      console.log('🗑️  GDPR: Customer Redaction Request Received');
      console.log('================================================================');
      console.log(`Shop Domain: ${shopDomain}`);
      console.log(`Customer ID: ${payload.customer?.id}`);
      console.log(`Customer Email: ${payload.customer?.email}`);
      console.log(`Orders to Redact: ${payload.orders_to_redact?.length || 0}`);
      console.log('================================================================');

      // Log the request to database for audit trail
      if (integration) {
        const { error: logError } = await supabaseAdmin
          .from('shopify_webhook_events')
          .insert({
            integration_id: integration.id,
            topic: 'customers/redact',
            shopify_order_id: null,
            payload: payload,
            processed: true,
            error: null,
          });

        if (logError) {
          console.error('❌ Error logging webhook event:', logError);
        }
      }

      // TODO: Implement actual data redaction logic here
      // This should:
      // 1. Find all customer data in your database (customers, orders, etc.)
      // 2. Anonymize or delete PII (Personally Identifiable Information)
      // 3. Keep transaction records for legal/accounting purposes (anonymized)
      // 4. Log the redaction action for compliance audit

      // Example redaction logic (implement in production):
      // const customerId = payload.customer?.id;
      // if (customerId && integration) {
      //   // Redact customer PII
      //   await supabaseAdmin
      //     .from('customers')
      //     .update({
      //       name: 'REDACTED',
      //       email: `redacted-${customerId}@deleted.local`,
      //       phone: 'REDACTED',
      //       address: 'REDACTED',
      //     })
      //     .eq('shopify_customer_id', customerId.toString())
      //     .eq('store_id', integration.store_id);
      //
      //   // Anonymize order customer info
      //   await supabaseAdmin
      //     .from('orders')
      //     .update({
      //       customer_name: 'REDACTED',
      //       customer_email: `redacted-${customerId}@deleted.local`,
      //       customer_phone: 'REDACTED',
      //     })
      //     .eq('shopify_customer_id', customerId.toString())
      //     .eq('store_id', integration.store_id);
      // }

      console.log('✅ Customer redaction request logged successfully');
      console.log('⚠️  NOTE: Implement data redaction logic in production');

      // Return 200 OK to acknowledge receipt
      res.status(200).json({
        received: true,
        message: 'Customer redaction request received and logged',
        shop: shopDomain,
        customer_id: payload.customer?.id,
      });

    } catch (error: any) {
      console.error('❌ Error processing customers/redact webhook:', error);
      console.error(error.stack);

      // Always return 200 to Shopify to prevent retries
      res.status(200).json({
        received: true,
        error: 'Internal error processing request',
      });
    }
  }
);

/**
 * POST /api/shopify/compliance/shop/redact
 *
 * Handles shop data deletion requests (when merchant uninstalls app).
 * 48 hours after app uninstallation, Shopify sends this webhook.
 *
 * Response Requirements:
 * - Must verify HMAC signature (handled by middleware)
 * - Must return 401 if HMAC is invalid
 * - Must return 200 OK to acknowledge receipt
 *
 * Payload example:
 * {
 *   "shop_id": 954889,
 *   "shop_domain": "example.myshopify.com"
 * }
 */
shopifyComplianceRouter.post(
  '/shop/redact',
  validateShopifyWebhook,
  async (req: ShopifyWebhookRequest, res: Response) => {
    try {
      const shopDomain = req.shopDomain;
      const integration = req.integration;
      const payload = req.body;

      console.log('================================================================');
      console.log('🏪 GDPR: Shop Redaction Request Received');
      console.log('================================================================');
      console.log(`Shop Domain: ${shopDomain}`);
      console.log(`Shop ID: ${payload.shop_id}`);
      console.log('================================================================');

      // Log the request to database for audit trail
      if (integration) {
        const { error: logError } = await supabaseAdmin
          .from('shopify_webhook_events')
          .insert({
            integration_id: integration.id,
            topic: 'shop/redact',
            shopify_order_id: null,
            payload: payload,
            processed: true,
            error: null,
          });

        if (logError) {
          console.error('❌ Error logging webhook event:', logError);
        }
      }

      // Delete the Shopify integration and all associated data
      // This webhook is sent 48 hours after app uninstallation
      if (integration) {
        console.log(`🗑️  Deleting shop data for: ${shopDomain}`);

        // Delete integration (CASCADE will handle related data)
        const { error: deleteError } = await supabaseAdmin
          .from('shopify_integrations')
          .delete()
          .eq('shop_domain', shopDomain);

        if (deleteError) {
          console.error('❌ Error deleting integration:', deleteError);
        } else {
          console.log(`✅ Successfully deleted integration for: ${shopDomain}`);
        }

        // Optionally: Delete or anonymize products/orders synced from this shop
        // This depends on your data retention policy
        // await supabaseAdmin
        //   .from('products')
        //   .delete()
        //   .eq('store_id', integration.store_id)
        //   .not('shopify_product_id', 'is', null);
      }

      console.log('✅ Shop redaction request processed successfully');

      // Return 200 OK to acknowledge receipt
      res.status(200).json({
        received: true,
        message: 'Shop redaction request processed',
        shop: shopDomain,
        shop_id: payload.shop_id,
      });

    } catch (error: any) {
      console.error('❌ Error processing shop/redact webhook:', error);
      console.error(error.stack);

      // Always return 200 to Shopify to prevent retries
      res.status(200).json({
        received: true,
        error: 'Internal error processing request',
      });
    }
  }
);

/**
 * GET /api/shopify/compliance/health
 * Health check endpoint for GDPR compliance webhooks
 */
shopifyComplianceRouter.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    webhooks: {
      'customers/data_request': 'active',
      'customers/redact': 'active',
      'shop/redact': 'active',
    },
    hmac_verification: 'enabled',
    timestamp: new Date().toISOString(),
  });
});

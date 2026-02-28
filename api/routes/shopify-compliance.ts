// ================================================================
// Shopify GDPR Compliance Webhooks
// ================================================================
// Mandatory webhooks required by Shopify for GDPR compliance
// All endpoints verify HMAC signatures and respond with 200 OK
// Learn more: https://shopify.dev/docs/apps/webhooks/configuration/mandatory-webhooks
// ================================================================

import { logger } from '../utils/logger';
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

      logger.info('API', '================================================================');
      logger.info('API', '📋 GDPR: Customer Data Request Received');
      logger.info('API', '================================================================');
      logger.info('API', `Shop Domain: ${shopDomain}`);
      logger.info('API', `Customer ID: ${payload.customer?.id}`);
      logger.info('API', `Customer Email: ${payload.customer?.email}`);
      logger.info('API', `Data Request ID: ${payload.data_request?.id}`);
      logger.info('API', `Orders Requested: ${payload.orders_requested?.length || 0}`);
      logger.info('API', '================================================================');

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
          logger.error('API', '❌ Error logging webhook event:', logError);
        }
      }

      // Retrieve customer data from our database for the data request
      if (integration) {
        const customerId = payload.customer?.id?.toString();
        const customerEmail = payload.customer?.email;

        if (customerId || customerEmail) {
          // Find customer records matching Shopify customer
          let customerQuery = supabaseAdmin
            .from('customers')
            .select('id, name, email, phone, address, city, created_at')
            .eq('store_id', integration.store_id);

          if (customerId) {
            customerQuery = customerQuery.eq('shopify_customer_id', customerId);
          } else if (customerEmail) {
            customerQuery = customerQuery.eq('email', customerEmail);
          }

          const { data: customers } = await customerQuery;

          // Find related orders
          let orderQuery = supabaseAdmin
            .from('orders')
            .select('id, shopify_order_name, total_price, sleeves_status, created_at, customer_first_name, customer_last_name, customer_phone, customer_address')
            .eq('store_id', integration.store_id);

          if (customerId) {
            orderQuery = orderQuery.eq('shopify_customer_id', customerId);
          }

          const { data: orders } = await orderQuery;

          logger.info('API', 'Customer data compiled for GDPR request', {
            shopDomain,
            customerId,
            customerRecords: customers?.length || 0,
            orderRecords: orders?.length || 0,
            requestId: payload.data_request?.id
          });
        }
      }

      logger.info('API', 'Customer data request processed successfully');

      // Return 200 OK to acknowledge receipt
      res.status(200).json({
        received: true,
        message: 'Customer data request received and logged',
        shop: shopDomain,
        request_id: payload.data_request?.id,
      });

    } catch (error: any) {
      logger.error('API', '❌ Error processing customers/data_request webhook:', error);
      logger.error('API', error.stack);

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

      logger.info('API', '================================================================');
      logger.info('API', '🗑️  GDPR: Customer Redaction Request Received');
      logger.info('API', '================================================================');
      logger.info('API', `Shop Domain: ${shopDomain}`);
      logger.info('API', `Customer ID: ${payload.customer?.id}`);
      logger.info('API', `Customer Email: ${payload.customer?.email}`);
      logger.info('API', `Orders to Redact: ${payload.orders_to_redact?.length || 0}`);
      logger.info('API', '================================================================');

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
          logger.error('API', '❌ Error logging webhook event:', logError);
        }
      }

      // GDPR Right to Erasure: Anonymize all customer PII
      // We keep transaction records for legal/accounting but strip PII
      if (integration) {
        const customerId = payload.customer?.id?.toString();
        const customerEmail = payload.customer?.email;
        const storeId = integration.store_id;
        let redactedCount = { customers: 0, orders: 0 };

        if (customerId) {
          // Redact customer PII in customers table
          const { count: custCount } = await supabaseAdmin
            .from('customers')
            .update({
              name: 'REDACTED',
              email: `redacted-${customerId}@deleted.local`,
              phone: 'REDACTED',
              address: 'REDACTED',
              city: 'REDACTED',
              notes: null,
            })
            .eq('shopify_customer_id', customerId)
            .eq('store_id', storeId)
            .select('id', { count: 'exact', head: true });

          redactedCount.customers = custCount || 0;

          // Anonymize order customer PII (keep financial data for accounting)
          const { count: orderCount } = await supabaseAdmin
            .from('orders')
            .update({
              customer_first_name: 'REDACTED',
              customer_last_name: '',
              customer_email: `redacted-${customerId}@deleted.local`,
              customer_phone: 'REDACTED',
              customer_address: 'REDACTED',
              delivery_notes: null,
            })
            .eq('shopify_customer_id', customerId)
            .eq('store_id', storeId)
            .select('id', { count: 'exact', head: true });

          redactedCount.orders = orderCount || 0;
        }

        logger.info('API', 'GDPR customer redaction completed', {
          shopDomain,
          customerId,
          redactedCount
        });
      }

      logger.info('API', 'Customer redaction request processed successfully');

      // Return 200 OK to acknowledge receipt
      res.status(200).json({
        received: true,
        message: 'Customer redaction request received and logged',
        shop: shopDomain,
        customer_id: payload.customer?.id,
      });

    } catch (error: any) {
      logger.error('API', '❌ Error processing customers/redact webhook:', error);
      logger.error('API', error.stack);

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

      logger.info('API', '================================================================');
      logger.info('API', '🏪 GDPR: Shop Redaction Request Received');
      logger.info('API', '================================================================');
      logger.info('API', `Shop Domain: ${shopDomain}`);
      logger.info('API', `Shop ID: ${payload.shop_id}`);
      logger.info('API', '================================================================');

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
          logger.error('API', '❌ Error logging webhook event:', logError);
        }
      }

      // Delete the Shopify integration and all associated data
      // This webhook is sent 48 hours after app uninstallation
      if (integration) {
        logger.info('API', `🗑️  Deleting shop data for: ${shopDomain}`);

        // Delete integration (CASCADE will handle related data)
        const { error: deleteError } = await supabaseAdmin
          .from('shopify_integrations')
          .delete()
          .eq('shop_domain', shopDomain);

        if (deleteError) {
          logger.error('API', '❌ Error deleting integration:', deleteError);
        } else {
          logger.info('API', `✅ Successfully deleted integration for: ${shopDomain}`);
        }

        // Optionally: Delete or anonymize products/orders synced from this shop
        // This depends on your data retention policy
        // await supabaseAdmin
        //   .from('products')
        //   .delete()
        //   .eq('store_id', integration.store_id)
        //   .not('shopify_product_id', 'is', null);
      }

      logger.info('API', '✅ Shop redaction request processed successfully');

      // Return 200 OK to acknowledge receipt
      res.status(200).json({
        received: true,
        message: 'Shop redaction request processed',
        shop: shopDomain,
        shop_id: payload.shop_id,
      });

    } catch (error: any) {
      logger.error('API', '❌ Error processing shop/redact webhook:', error);
      logger.error('API', error.stack);

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

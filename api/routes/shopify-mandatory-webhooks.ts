import { Router, Response } from 'express';
import { supabaseAdmin } from '../db/connection';
import { validateShopifyWebhook, ShopifyWebhookRequest } from '../middleware/shopify-webhook';

export const shopifyMandatoryWebhooksRouter = Router();

/**
 * POST /api/shopify/webhooks/app-uninstalled
 * Shopify App Store mandatory webhook
 * Called when merchant uninstalls the app
 * Must delete all store data
 */
shopifyMandatoryWebhooksRouter.post(
  '/app-uninstalled',
  validateShopifyWebhook,
  async (req: ShopifyWebhookRequest, res: Response) => {
    try {
      const shopDomain = req.shopDomain;
      const integration = req.integration;

      console.log(`🗑️  App uninstalled webhook received for: ${shopDomain}`);

      if (!integration) {
        console.error('❌ Integration not found in request');
        return res.status(200).json({ received: true, message: 'Integration not found' });
      }

      // Delete integration (CASCADE will handle related data)
      // This will automatically delete:
      // - shopify_import_jobs
      // - shopify_webhook_events
      // - shopify_sync_conflicts
      // - Products, customers, orders with shopify_* fields will remain but lose sync
      const { error: deleteError } = await supabaseAdmin
        .from('shopify_integrations')
        .delete()
        .eq('shop_domain', shopDomain);

      if (deleteError) {
        console.error('❌ Error deleting integration:', deleteError);
        // Still return 200 to Shopify
        return res.status(200).json({
          received: true,
          error: 'Failed to delete integration',
        });
      }

      console.log(`✅ Successfully deleted integration for: ${shopDomain}`);
      console.log(`   - Store ID: ${integration.store_id}`);
      console.log(`   - Integration ID: ${integration.id}`);

      // Shopify requires 200 response
      res.status(200).json({
        received: true,
        message: 'App uninstalled successfully',
        shop: shopDomain,
      });

    } catch (error: any) {
      console.error('❌ Error processing app/uninstalled webhook:', error);
      // Always return 200 to Shopify to prevent retries
      res.status(200).json({
        received: true,
        error: 'Internal error',
      });
    }
  }
);

/**
 * POST /api/shopify/webhooks/app-subscriptions-update
 * Shopify App Store mandatory webhook
 * Called when subscription status changes (cancelled, declined, etc.)
 * Must deactivate store when subscription is cancelled
 */
shopifyMandatoryWebhooksRouter.post(
  '/app-subscriptions-update',
  validateShopifyWebhook,
  async (req: ShopifyWebhookRequest, res: Response) => {
    try {
      const shopDomain = req.shopDomain;
      const integration = req.integration;
      const payload = req.body;

      console.log(`📋 App subscription update webhook received for: ${shopDomain}`);
      console.log(`   Status: ${payload.status}`);

      if (!integration) {
        console.error('❌ Integration not found in request');
        return res.status(200).json({ received: true, message: 'Integration not found' });
      }

      // Check if subscription is cancelled or declined
      const deactivateStatuses = ['cancelled', 'declined', 'expired', 'frozen'];
      const shouldDeactivate = deactivateStatuses.includes(payload.status?.toLowerCase());

      if (shouldDeactivate) {
        console.log(`⚠️  Deactivating integration due to status: ${payload.status}`);

        // Mark integration as inactive
        const { error: updateError } = await supabaseAdmin
          .from('shopify_integrations')
          .update({
            status: 'inactive',
            sync_error: `Subscription ${payload.status} - ${new Date().toISOString()}`,
          })
          .eq('shop_domain', shopDomain);

        if (updateError) {
          console.error('❌ Error deactivating integration:', updateError);
          return res.status(200).json({
            received: true,
            error: 'Failed to deactivate integration',
          });
        }

        console.log(`✅ Successfully deactivated integration for: ${shopDomain}`);
      } else {
        console.log(`ℹ️  No action needed for status: ${payload.status}`);
      }

      // Shopify requires 200 response
      res.status(200).json({
        received: true,
        message: 'Subscription update processed',
        shop: shopDomain,
        status: payload.status,
        action: shouldDeactivate ? 'deactivated' : 'no_action',
      });

    } catch (error: any) {
      console.error('❌ Error processing app/subscriptions-update webhook:', error);
      // Always return 200 to Shopify to prevent retries
      res.status(200).json({
        received: true,
        error: 'Internal error',
      });
    }
  }
);

/**
 * GET /api/shopify/webhooks/mandatory/health
 * Health check endpoint for mandatory webhooks
 */
shopifyMandatoryWebhooksRouter.get('/mandatory/health', (req, res) => {
  res.json({
    status: 'healthy',
    webhooks: {
      'app/uninstalled': 'active',
      'app/subscriptions:update': 'active',
    },
    timestamp: new Date().toISOString(),
  });
});

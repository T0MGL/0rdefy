import { logger } from '../utils/logger';
import { Router, Response } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../db/connection';
import { validateShopifyWebhook, ShopifyWebhookRequest } from '../middleware/shopify-webhook';
import { parsePlanFromSubscriptionName } from '../services/shopify-billing.service';

export const shopifyMandatoryWebhooksRouter = Router();

// Shopify subscription statuses that map to active Ordefy access
const ACTIVE_SHOPIFY_STATUSES = new Set(['active', 'pending']);

// Shopify subscription statuses that revoke Ordefy access
const DEACTIVATE_SHOPIFY_STATUSES = new Set(['cancelled', 'declined', 'expired', 'frozen']);

shopifyMandatoryWebhooksRouter.post(
  '/app-uninstalled',
  validateShopifyWebhook,
  async (req: ShopifyWebhookRequest, res: Response) => {
    try {
      const shopDomain = req.shopDomain;
      const integration = req.integration;

      logger.info('API', `App uninstalled webhook received for: ${shopDomain}`);

      if (!integration) {
        logger.error('API', 'Integration not found in request');
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
        logger.error('API', 'Error deleting integration', { deleteError });
        // Still return 200 to Shopify
        return res.status(200).json({
          received: true,
          error: 'Error al eliminar integración',
        });
      }

      logger.info('API', `Successfully deleted integration for: ${shopDomain}`);
      logger.info('API', `   - Store ID: ${integration.store_id}`);
      logger.info('API', `   - Integration ID: ${integration.id}`);

      // Shopify requires 200 response
      res.status(200).json({
        received: true,
        message: 'App uninstalled successfully',
        shop: shopDomain,
      });

    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      logger.error('API', 'Error processing app/uninstalled webhook', { error: msg });
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
 *
 * Shopify App Store mandatory webhook — fires whenever a subscription status changes.
 * Source of truth for Shopify-billed subscription state.
 *
 * Payload shape (relevant fields):
 *   { id: number, name: string, status: string, admin_graphql_api_id: string }
 *
 * Handles two independent concerns:
 *   1. Ordefy subscriptions table (billing_source = shopify)
 *   2. shopify_integrations status (active/inactive) — always updated
 */
shopifyMandatoryWebhooksRouter.post(
  '/app-subscriptions-update',
  validateShopifyWebhook,
  async (req: ShopifyWebhookRequest, res: Response) => {
    // Always return 200 to prevent Shopify retries regardless of internal errors
    const ack = () => res.status(200).json({ received: true });

    try {
      const shopDomain = req.shopDomain;
      const integration = req.integration;

      const PayloadSchema = z.object({
        id: z.number().optional(),
        name: z.string().optional(),
        status: z.string().optional(),
        admin_graphql_api_id: z.string().optional(),
      });
      const payload = PayloadSchema.parse(req.body);

      logger.info('SHOPIFY_BILLING', 'app/subscriptions/update received', {
        shopDomain,
        status: payload.status,
        chargeId: payload.admin_graphql_api_id,
      });

      if (!integration) {
        logger.warn('SHOPIFY_BILLING', 'Integration not found for shop', { shopDomain });
        return ack();
      }

      // Idempotency: use Shopify-Webhook-Id header stored by validateShopifyWebhook
      const webhookId = (req.headers['x-shopify-webhook-id'] as string | undefined) ?? `${shopDomain}-${payload.id ?? Date.now()}`;
      const chargeGid = payload.admin_graphql_api_id ?? null;

      const { data: insertedEvent, error: insertError } = await supabaseAdmin
        .from('shopify_billing_events')
        .insert({
          shopify_event_id: webhookId,
          event_type: 'app/subscriptions/update',
          shop_domain: shopDomain,
          charge_id: chargeGid,
          payload,
        })
        .select('id')
        .single();

      if (insertError) {
        if (insertError.code === '23505') {
          logger.info('SHOPIFY_BILLING', 'Duplicate billing event, skipping', { webhookId });
          return ack();
        }
        logger.error('SHOPIFY_BILLING', 'Failed to record billing event for idempotency', { insertError });
        return ack();
      }

      const status = (payload.status ?? '').toLowerCase();
      const shouldDeactivate = DEACTIVATE_SHOPIFY_STATUSES.has(status);
      const shouldActivate = ACTIVE_SHOPIFY_STATUSES.has(status);

      // --- Concern 1: Sync Ordefy subscription record ---
      if (shouldActivate && chargeGid) {
        const planName = parsePlanFromSubscriptionName(payload.name ?? '');

        const { error: subError } = await supabaseAdmin
          .from('subscriptions')
          .update({
            status: 'active',
            plan: planName ?? undefined,
            shopify_confirmation_url: null,
            updated_at: new Date().toISOString(),
          })
          .eq('shopify_charge_id', chargeGid)
          .eq('billing_source', 'shopify');

        if (subError) {
          logger.error('SHOPIFY_BILLING', 'Failed to activate subscription', { chargeGid, subError });
        } else {
          logger.info('SHOPIFY_BILLING', 'Subscription activated', { chargeGid, plan: planName });
        }
      }

      if (shouldDeactivate && chargeGid) {
        const { error: subError } = await supabaseAdmin
          .from('subscriptions')
          .update({
            status: 'canceled',
            plan: 'free',
            shopify_charge_id: null,
            shopify_confirmation_url: null,
            canceled_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('shopify_charge_id', chargeGid)
          .eq('billing_source', 'shopify');

        if (subError) {
          logger.error('SHOPIFY_BILLING', 'Failed to cancel subscription', { chargeGid, subError });
        } else {
          logger.info('SHOPIFY_BILLING', 'Subscription downgraded to free', { chargeGid });
        }
      }

      // --- Concern 2: Sync shopify_integrations status ---
      if (shouldDeactivate) {
        const { error: integrationError } = await supabaseAdmin
          .from('shopify_integrations')
          .update({
            status: 'inactive',
            sync_error: `Shopify subscription ${payload.status} at ${new Date().toISOString()}`,
          })
          .eq('shop_domain', shopDomain);

        if (integrationError) {
          logger.error('SHOPIFY_BILLING', 'Failed to deactivate integration', { shopDomain, integrationError });
        }
      } else if (shouldActivate) {
        await supabaseAdmin
          .from('shopify_integrations')
          .update({ status: 'active', sync_error: null })
          .eq('shop_domain', shopDomain);
      }

      // Mark event as processed
      await supabaseAdmin
        .from('shopify_billing_events')
        .update({ processed: true, processed_at: new Date().toISOString() })
        .eq('id', insertedEvent.id);

      return ack();
    } catch (error: unknown) {
      logger.error('SHOPIFY_BILLING', 'Error processing app/subscriptions/update', { error });
      return ack();
    }
  }
);

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

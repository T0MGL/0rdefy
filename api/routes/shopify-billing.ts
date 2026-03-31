/**
 * Shopify Billing Routes
 *
 * Handles the Shopify Billing API flow for merchants who install Ordefy
 * through the Shopify App Store. Required for App Store approval:
 *   Req 1.2.2: Correctly implement the Shopify Billing API
 *   Req 1.2.3: Charges appear in the application charge history page
 *
 * Flow:
 *   1. POST /subscribe — creates AppSubscription, returns confirmationUrl
 *   2. Merchant visits confirmationUrl in Shopify admin
 *   3. GET  /confirm   — Shopify redirects here after merchant approves
 *   4. POST /cancel    — cancel active Shopify subscription
 *
 * Webhook app/subscriptions/update is handled in shopify-mandatory-webhooks.ts
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { verifyToken, extractStoreId, AuthRequest } from '../middleware/auth';
import { extractUserRole, requireRole, PermissionRequest } from '../middleware/permissions';
import { Role } from '../permissions';
import { supabaseAdmin } from '../db/connection';
import { logger } from '../utils/logger';
import {
  createAppSubscription,
  cancelAppSubscription,
  getShopifyAccessToken,
  buildBillingReturnUrl,
  parsePlanFromSubscriptionName,
  ShopifyPlanType,
  ShopifyBillingCycle,
} from '../services/shopify-billing.service';

export const shopifyBillingRouter = Router();

const APP_URL = process.env.APP_URL || 'https://app.ordefy.io';

// ============================================================================
// POST /api/shopify-billing/subscribe
// ============================================================================
// Creates a Shopify AppSubscription for an Ordefy plan.
// Returns the Shopify confirmation URL the merchant must visit to approve.
// Called from the Ordefy plan selection UI when billing_source = shopify.
// ============================================================================

shopifyBillingRouter.post(
  '/subscribe',
  verifyToken,
  extractStoreId,
  extractUserRole,
  requireRole(Role.OWNER),
  async (req: PermissionRequest, res: Response) => {
    try {
      const storeId = (req as AuthRequest).storeId;
      const userId = (req as AuthRequest).userId;

      if (!storeId || !userId) {
        return res.status(400).json({ error: 'Store ID and user ID are required' });
      }

      const body = z.object({
        plan: z.enum(['starter', 'growth', 'professional']),
        billingCycle: z.enum(['monthly', 'annual']),
        shopDomain: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/),
      }).parse(req.body);

      const accessToken = await getShopifyAccessToken(body.shopDomain);
      if (!accessToken) {
        return res.status(400).json({
          error: 'No active Shopify integration found for this shop domain',
          code: 'NO_SHOPIFY_INTEGRATION',
        });
      }

      // Cancel any existing pending Shopify subscription for this store
      // (prevents duplicate pending charges if the merchant abandons confirmation)
      const { data: existingSub } = await supabaseAdmin
        .from('subscriptions')
        .select('shopify_charge_id, shopify_confirmation_url')
        .eq('user_id', userId)
        .eq('is_primary', true)
        .eq('billing_source', 'shopify')
        .single();

      if (existingSub?.shopify_charge_id && !existingSub.shopify_confirmation_url) {
        // Active (confirmed) subscription exists — must cancel first
        try {
          await cancelAppSubscription({
            shopDomain: body.shopDomain,
            accessToken,
            appSubscriptionId: existingSub.shopify_charge_id,
          });
        } catch (cancelErr) {
          logger.warn('SHOPIFY_BILLING', 'Could not cancel existing subscription before creating new one', {
            error: cancelErr instanceof Error ? cancelErr.message : String(cancelErr),
          });
        }
      }

      const isTest = process.env.NODE_ENV !== 'production';
      const returnUrl = buildBillingReturnUrl(storeId);

      const { appSubscriptionId, confirmationUrl } = await createAppSubscription({
        shopDomain: body.shopDomain,
        accessToken,
        plan: body.plan as ShopifyPlanType,
        billingCycle: body.billingCycle as ShopifyBillingCycle,
        returnUrl,
        isTest,
      });

      // Persist pending subscription in our DB
      // Status stays 'incomplete' until Shopify confirms via webhook
      await supabaseAdmin
        .from('subscriptions')
        .upsert(
          {
            user_id: userId,
            is_primary: true,
            plan: body.plan,
            billing_cycle: body.billingCycle,
            status: 'incomplete',
            billing_source: 'shopify',
            shopify_charge_id: appSubscriptionId,
            shopify_confirmation_url: confirmationUrl,
            shopify_shop_domain: body.shopDomain,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,is_primary' }
        );

      logger.info('SHOPIFY_BILLING', 'Subscription pending merchant confirmation', {
        userId,
        storeId,
        plan: body.plan,
        shopDomain: body.shopDomain,
      });

      res.json({ confirmationUrl });
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid request body', details: error.issues });
      }
      logger.error('SHOPIFY_BILLING', 'Subscribe error', { error });
      res.status(500).json({ error: 'Failed to create Shopify subscription' });
    }
  }
);

// ============================================================================
// GET /api/shopify-billing/confirm
// ============================================================================
// Shopify redirects here after the merchant approves (or declines) the charge.
// Query params: charge_id (Shopify numeric charge ID), store_id
//
// Shopify also sends an app/subscriptions/update webhook — that webhook is the
// source of truth for subscription status. This endpoint only handles the
// redirect and updates the confirmation URL field.
// ============================================================================

shopifyBillingRouter.get('/confirm', async (req: Request, res: Response) => {
  try {
    const { charge_id, store_id } = z.object({
      charge_id: z.string().optional(),
      store_id: z.string().uuid(),
    }).parse(req.query);

    if (!charge_id) {
      logger.warn('SHOPIFY_BILLING', 'Confirmation callback received without charge_id', { store_id });
      return res.redirect(`${APP_URL}/settings?tab=subscription&billing=declined`);
    }

    // Clear the confirmation_url now that the merchant has acted on it
    const { error } = await supabaseAdmin
      .from('subscriptions')
      .update({
        shopify_confirmation_url: null,
        updated_at: new Date().toISOString(),
      })
      .eq('shopify_charge_id', charge_id);

    if (error) {
      logger.error('SHOPIFY_BILLING', 'Failed to clear confirmation URL', { charge_id, error });
    }

    logger.info('SHOPIFY_BILLING', 'Merchant confirmed billing', { charge_id, store_id });

    // Redirect to settings — the app/subscriptions/update webhook will activate the subscription
    res.redirect(`${APP_URL}/settings?tab=subscription&billing=confirmed`);
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.redirect(`${APP_URL}/settings?tab=subscription&billing=error`);
    }
    logger.error('SHOPIFY_BILLING', 'Confirmation callback error', { error });
    res.redirect(`${APP_URL}/settings?tab=subscription&billing=error`);
  }
});

// ============================================================================
// POST /api/shopify-billing/cancel
// ============================================================================
// Cancel the active Shopify app subscription.
// This mirrors the Stripe cancel flow in billing.ts.
// ============================================================================

shopifyBillingRouter.post(
  '/cancel',
  verifyToken,
  extractStoreId,
  extractUserRole,
  requireRole(Role.OWNER),
  async (req: PermissionRequest, res: Response) => {
    try {
      const userId = (req as AuthRequest).userId;

      if (!userId) {
        return res.status(400).json({ error: 'User ID is required' });
      }

      const { reason } = z.object({
        reason: z.string().max(500).optional(),
      }).parse(req.body);

      const { data: subscription } = await supabaseAdmin
        .from('subscriptions')
        .select('shopify_charge_id, shopify_shop_domain, plan, status')
        .eq('user_id', userId)
        .eq('is_primary', true)
        .eq('billing_source', 'shopify')
        .single();

      if (!subscription?.shopify_charge_id || !subscription.shopify_shop_domain) {
        return res.status(400).json({ error: 'No active Shopify subscription found' });
      }

      const accessToken = await getShopifyAccessToken(subscription.shopify_shop_domain);
      if (!accessToken) {
        return res.status(400).json({ error: 'Shopify integration not found or inactive' });
      }

      await cancelAppSubscription({
        shopDomain: subscription.shopify_shop_domain,
        accessToken,
        appSubscriptionId: subscription.shopify_charge_id,
      });

      // Update local record — webhook will also fire and confirm
      await supabaseAdmin
        .from('subscriptions')
        .update({
          status: 'canceled',
          plan: 'free',
          canceled_at: new Date().toISOString(),
          cancellation_reason: reason ?? null,
          shopify_charge_id: null,
          shopify_confirmation_url: null,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId)
        .eq('is_primary', true);

      res.json({ success: true, message: 'Shopify subscription cancelled' });
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid request body' });
      }
      logger.error('SHOPIFY_BILLING', 'Cancel error', { error });
      res.status(500).json({ error: 'Failed to cancel Shopify subscription' });
    }
  }
);

// ============================================================================
// GET /api/shopify-billing/status
// ============================================================================
// Returns the current Shopify billing subscription status for a store.
// ============================================================================

shopifyBillingRouter.get(
  '/status',
  verifyToken,
  extractStoreId,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.userId;

      if (!userId) {
        return res.status(400).json({ error: 'User ID is required' });
      }

      const { data: subscription } = await supabaseAdmin
        .from('subscriptions')
        .select('plan, status, billing_source, shopify_charge_id, shopify_confirmation_url, shopify_shop_domain, current_period_end')
        .eq('user_id', userId)
        .eq('is_primary', true)
        .single();

      if (!subscription) {
        return res.json({ billingSource: 'none', plan: 'free', status: 'active' });
      }

      res.json({
        billingSource: subscription.billing_source,
        plan: subscription.plan,
        status: subscription.status,
        shopifyChargeId: subscription.shopify_charge_id,
        pendingConfirmation: !!subscription.shopify_confirmation_url,
        confirmationUrl: subscription.shopify_confirmation_url ?? null,
        currentPeriodEnd: subscription.current_period_end ?? null,
      });
    } catch (error: unknown) {
      logger.error('SHOPIFY_BILLING', 'Status check error', { error });
      res.status(500).json({ error: 'Failed to retrieve billing status' });
    }
  }
);

import express, { Request, Response } from 'express';
import { z } from 'zod';
import Stripe from 'stripe';
import { verifyToken, extractStoreId, AuthRequest } from '../middleware/auth';
import { extractUserRole, requireModule, requireRole, PermissionRequest } from '../middleware/permissions';
import { Module, Role } from '../permissions';
import { supabaseAdmin } from '../db/connection';
import stripeService, { PlanType, BillingCycle, PLANS, getPlanFromPriceId } from '../services/stripe.service';
import { logger } from '../utils/logger';
import { WEBHOOK_ERRORS } from '../constants/webhook-errors';

const router = express.Router();

const getStripe = (): Stripe => stripeService.getStripe();

router.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  async (req: Request, res: Response) => {
    const sig = req.headers['stripe-signature'] as string;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
      logger.error('BILLING', 'Missing webhook secret - STRIPE_WEBHOOK_SECRET not set');
      return res.status(500).json({ error: WEBHOOK_ERRORS.INTERNAL_ERROR });
    }

    let event: Stripe.Event;

    try {
      event = getStripe().webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err: unknown) {
      // SECURITY: Log error details internally but never expose to client
      logger.error('BILLING', 'Webhook signature verification failed', {
        errorType: err instanceof Error ? err.name : 'unknown',
        // Do NOT log err.message as it may contain sensitive details
      });
      return res.status(400).json({ error: WEBHOOK_ERRORS.VERIFICATION_FAILED });
    }

    // SECURITY: Atomic idempotency check using INSERT-first approach
    // This prevents race conditions where two concurrent requests both pass SELECT check
    const { data: insertedEvent, error: insertError } = await supabaseAdmin
      .from('stripe_billing_events')
      .insert({
        stripe_event_id: event.id,
        event_type: event.type,
        payload: event.data,
      })
      .select('id')
      .single();

    // If insert failed with unique constraint violation, this is a duplicate
    if (insertError) {
      if (insertError.code === '23505') { // PostgreSQL unique violation
        logger.info('BILLING', 'Duplicate event detected (race-safe), skipping', { eventId: event.id });
        return res.json({ received: true, duplicate: true });
      }
      // CRITICAL FIX: ALL other insert errors MUST abort processing
      // Without idempotency protection, we risk duplicate charges/credits
      logger.error('BILLING', 'Failed to record event for idempotency protection', {
        eventId: event.id,
        eventType: event.type,
        error: insertError.message,
        code: insertError.code
      });
      return res.status(500).json({
        error: 'Cannot process event safely without idempotency protection',
        retryable: true
      });
    }

    // If we get here, we successfully acquired the lock (inserted first)

    logger.info('BILLING', 'Processing event', { eventType: event.type });

    try {
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object as Stripe.Checkout.Session;
          await handleCheckoutCompleted(session);
          break;
        }

        case 'customer.subscription.created': {
          const subscription = event.data.object as Stripe.Subscription;
          await handleSubscriptionCreated(subscription);
          break;
        }

        case 'customer.subscription.updated': {
          const subscription = event.data.object as Stripe.Subscription;
          await handleSubscriptionUpdated(subscription);
          break;
        }

        case 'customer.subscription.deleted': {
          const subscription = event.data.object as Stripe.Subscription;
          await handleSubscriptionDeleted(subscription);
          break;
        }

        case 'invoice.paid': {
          const invoice = event.data.object as Stripe.Invoice;
          await handleInvoicePaid(invoice);
          break;
        }

        case 'invoice.payment_failed': {
          const invoice = event.data.object as Stripe.Invoice;
          await handleInvoiceFailed(invoice);
          break;
        }

        case 'customer.subscription.trial_will_end': {
          const subscription = event.data.object as Stripe.Subscription;
          await handleTrialWillEnd(subscription);
          break;
        }

        default:
          logger.info('BILLING', 'Unhandled event type', { eventType: event.type });
      }

      // Mark event as processed
      await supabaseAdmin
        .from('stripe_billing_events')
        .update({ processed: true, processed_at: new Date().toISOString() })
        .eq('stripe_event_id', event.id);

      res.json({ received: true });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Internal error';
      logger.error('BILLING', 'Error processing event', { err: error });

      await supabaseAdmin
        .from('stripe_billing_events')
        .update({ error: msg })
        .eq('stripe_event_id', event.id);

      res.status(500).json({ error: 'Webhook processing failed' });
    }
  }
);

router.get('/referral/:code/validate', async (req: Request, res: Response) => {
  try {
    const { code } = z.object({ code: z.string().min(1).max(64) }).parse(req.params);
    const result = await stripeService.validateReferralCode(code);
    res.json(result);
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid referral code format' });
    }
    logger.error('BILLING', 'Validate referral code error', { err: error });
    res.status(500).json({ error: 'An error occurred' });
  }
});

router.post('/discount/validate', async (req: Request, res: Response) => {
  try {
    const { code, plan } = z.object({
      code: z.string().min(1).max(64),
      plan: z.enum(['free', 'starter', 'growth', 'professional']),
    }).parse(req.body);
    const result = await stripeService.validateDiscountCode(code, plan);
    res.json(result);
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request: code and plan are required' });
    }
    logger.error('BILLING', 'Validate discount code error', { err: error });
    res.status(500).json({ error: 'An error occurred' });
  }
});

router.get('/plans', async (req: Request, res: Response) => {
  try {
    const plans = await stripeService.getAllPlanLimits();

    const formattedPlans = plans.map((plan) => ({
      ...plan,
      priceMonthly: plan.price_monthly_cents / 100,
      priceAnnual: plan.price_annual_cents / 100,
      priceAnnualMonthly: Math.round(plan.price_annual_cents / 12) / 100,
      annualSavings: plan.price_monthly_cents > 0
        ? Math.round(
            ((plan.price_monthly_cents * 12 - plan.price_annual_cents) /
              (plan.price_monthly_cents * 12)) * 100
          )
        : undefined,
    }));

    res.json(formattedPlans);
  } catch (error: unknown) {
    logger.error('BILLING', 'Get plans error', { err: error });
    res.status(500).json({ error: 'An error occurred' });
  }
});

router.get(
  '/store-plan',
  verifyToken,
  extractStoreId,
  async (req: AuthRequest, res: Response) => {
    try {
      const storeId = req.storeId;

      if (!storeId) {
        return res.status(400).json({ error: 'Store ID is required' });
      }

      const subscription = await stripeService.getStorePlan(storeId);
      const usage = await stripeService.getStoreUsage(storeId);
      const planLimits = await stripeService.getAllPlanLimits();

      const currentPlanLimits = planLimits.find((p) => p.plan === subscription.plan);

      res.json({
        subscription: {
          plan: subscription.plan,
          status: subscription.status,
          billingCycle: subscription.billingCycle,
          currentPeriodEnd: subscription.currentPeriodEnd,
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
          trialEndsAt: subscription.trialEndsAt,
          planDetails: currentPlanLimits,
        },
        usage,
        allPlans: planLimits.map((plan) => ({
          ...plan,
          priceMonthly: plan.price_monthly_cents / 100,
          priceAnnual: plan.price_annual_cents / 100,
          annualSavings: plan.price_monthly_cents > 0
            ? Math.round(
                ((plan.price_monthly_cents * 12 - plan.price_annual_cents) /
                  (plan.price_monthly_cents * 12)) * 100
              )
            : undefined,
        })),
      });
    } catch (error: unknown) {
      logger.error('BILLING', 'Store plan error', { err: error });
      // SECURITY: Fail-closed - return error instead of defaulting to free plan
      // Defaulting to free could allow feature bypass if DB is down
      // Frontend should handle this error and show appropriate message
      return res.status(503).json({
        error: 'Unable to verify subscription status',
        code: 'SUBSCRIPTION_CHECK_FAILED',
        retryable: true
      });
    }
  }
);

router.use(verifyToken);
router.use(extractStoreId);
router.use(extractUserRole);
router.use(requireModule(Module.BILLING));

router.get('/subscription', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id || req.userId;

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const [subscription, usage, planLimits] = await Promise.all([
      stripeService.getUserSubscription(userId),
      stripeService.getUserUsage(userId),
      stripeService.getAllPlanLimits(),
    ]);

    // Fetch Shopify billing fields that the Stripe service doesn't expose
    const { data: subRow } = await supabaseAdmin
      .from('subscriptions')
      .select('billing_source, shopify_shop_domain, shopify_confirmation_url')
      .eq('user_id', userId)
      .eq('is_primary', true)
      .maybeSingle();

    const currentPlanLimits = planLimits.find((p) => p.plan === (subscription?.plan || 'free'));

    res.json({
      subscription: {
        ...subscription,
        billingSource: (subRow?.billing_source as 'stripe' | 'shopify') ?? 'stripe',
        shopifyShopDomain: subRow?.shopify_shop_domain ?? null,
        shopifyPendingConfirmation: !!subRow?.shopify_confirmation_url,
        planDetails: currentPlanLimits,
      },
      usage,
      allPlans: planLimits.map((plan) => ({
        ...plan,
        priceMonthly: plan.price_monthly_cents / 100,
        priceAnnual: plan.price_annual_cents / 100,
        annualSavings: plan.price_monthly_cents > 0
          ? Math.round(
              ((plan.price_monthly_cents * 12 - plan.price_annual_cents) /
                (plan.price_monthly_cents * 12)) * 100
            )
          : undefined,
      })),
    });
  } catch (error: unknown) {
    logger.error('BILLING', 'Subscription error', { err: error });
    res.status(500).json({ error: 'An error occurred' });
  }
});

router.get('/feature/:feature', async (req: AuthRequest, res: Response) => {
  try {
    const storeId = req.storeId;
    const { feature } = req.params;

    if (!storeId) {
      return res.status(400).json({ error: 'Store ID is required' });
    }

    const hasAccess = await stripeService.hasFeatureAccess(storeId, feature);

    res.json({ hasAccess });
  } catch (error: unknown) {
    logger.error('BILLING', 'Feature access check error', { err: error });
    res.status(500).json({ error: 'An error occurred' });
  }
});

router.post('/checkout', requireRole(Role.OWNER), async (req: PermissionRequest, res: Response) => {
  try {
    const userId = req.user?.id || req.userId;
    const userEmail = req.user?.email;

    const body = z.object({
      plan: z.enum(['starter', 'growth', 'professional']),
      billingCycle: z.enum(['monthly', 'annual']),
      referralCode: z.string().max(64).optional(),
      discountCode: z.string().max(64).optional(),
      fromOnboarding: z.boolean().optional(),
    }).parse(req.body);

    logger.info('BILLING', 'Checkout request', { userId, userEmail, plan: body.plan, billingCycle: body.billingCycle });

    if (!userId || !userEmail) {
      logger.error('BILLING', 'Missing user info', { userId, userEmail });
      return res.status(400).json({ error: 'User information is required' });
    }

    const appUrl = process.env.APP_URL || 'https://app.ordefy.io';

    const successParams = new URLSearchParams({
      tab: 'subscription',
      success: 'true',
    });
    if (body.fromOnboarding) {
      successParams.set('from_onboarding', 'true');
    }

    logger.info('BILLING', 'Creating checkout session...');
    const session = await stripeService.createCheckoutSession({
      userId,
      email: userEmail,
      plan: body.plan as PlanType,
      billingCycle: body.billingCycle as BillingCycle,
      successUrl: `${appUrl}/settings?${successParams.toString()}`,
      cancelUrl: `${appUrl}/settings?tab=subscription&canceled=true`,
      referralCode: body.referralCode,
      discountCode: body.discountCode,
    });

    logger.info('BILLING', 'Checkout session created', { sessionId: session.id });
    res.json({ sessionId: session.id, url: session.url });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid plan or billing cycle' });
    }
    logger.error('BILLING', 'Checkout error', { err: error });
    res.status(500).json({ error: 'An error occurred' });
  }
});

router.post('/portal', requireRole(Role.OWNER), async (req: PermissionRequest, res: Response) => {
  try {
    const userId = req.user?.id || req.userId;
    const appUrl = process.env.APP_URL || 'https://app.ordefy.io';

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const { data: subscription } = await supabaseAdmin
      .from('subscriptions')
      .select('stripe_customer_id, stripe_subscription_id, plan')
      .eq('user_id', userId)
      .eq('is_primary', true)
      .single();

    if (!subscription?.stripe_customer_id) {
      return res.status(400).json({
        error: 'No active subscription found. Subscribe to a plan first.',
        noSubscription: true,
      });
    }

    const session = await stripeService.createBillingPortalSession(
      userId,
      `${appUrl}/settings?tab=subscription`
    );

    res.json({ url: session.url });
  } catch (error: unknown) {
    logger.error('BILLING', 'Portal error', { err: error });
    const isNoCustomer = error instanceof Error && error.message?.includes('No Stripe customer');
    if (isNoCustomer) {
      return res.status(400).json({
        error: 'No active subscription found. Subscribe to a plan first.',
        noSubscription: true,
      });
    }
    res.status(500).json({ error: 'Failed to open billing portal. Please try again.' });
  }
});

router.post('/cancel', requireRole(Role.OWNER), async (req: PermissionRequest, res: Response) => {
  try {
    const userId = req.user?.id || req.userId;
    const { reason } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const { data: subscription } = await supabaseAdmin
      .from('subscriptions')
      .select('stripe_subscription_id')
      .eq('user_id', userId)  // ⬅️ Changed from store_id to user_id
      .eq('is_primary', true)
      .single();

    if (!subscription?.stripe_subscription_id) {
      return res.status(400).json({ error: 'No active subscription found' });
    }

    await stripeService.cancelSubscription(subscription.stripe_subscription_id, reason);

    // Update local subscription
    await supabaseAdmin
      .from('subscriptions')
      .update({
        cancel_at_period_end: true,
        canceled_at: new Date().toISOString(),
        cancellation_reason: reason,
      })
      .eq('user_id', userId)  // ⬅️ Changed from store_id to user_id
      .eq('is_primary', true);

    res.json({
      success: true,
      message: 'Subscription will be canceled at period end. This affects all your stores.'
    });
  } catch (error: unknown) {
    logger.error('BILLING', 'Cancel error', { err: error });
    res.status(500).json({ error: 'An error occurred' });
  }
});

router.post('/reactivate', requireRole(Role.OWNER), async (req: PermissionRequest, res: Response) => {
  try {
    const userId = req.user?.id || req.userId;

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const { data: subscription } = await supabaseAdmin
      .from('subscriptions')
      .select('stripe_subscription_id')
      .eq('user_id', userId)  // ⬅️ Changed from store_id to user_id
      .eq('is_primary', true)
      .single();

    if (!subscription?.stripe_subscription_id) {
      return res.status(400).json({ error: 'No subscription found' });
    }

    await stripeService.reactivateSubscription(subscription.stripe_subscription_id);

    // Update local subscription
    await supabaseAdmin
      .from('subscriptions')
      .update({
        cancel_at_period_end: false,
        canceled_at: null,
        cancellation_reason: null,
      })
      .eq('user_id', userId)  // ⬅️ Changed from store_id to user_id
      .eq('is_primary', true);

    res.json({
      success: true,
      message: 'Subscription reactivated. This applies to all your stores.'
    });
  } catch (error: unknown) {
    logger.error('BILLING', 'Reactivate error', { err: error });
    res.status(500).json({ error: 'An error occurred' });
  }
});

router.post('/change-plan', requireRole(Role.OWNER), async (req: PermissionRequest, res: Response) => {
  try {
    const userId = req.user?.id || req.userId;

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const { plan, billingCycle } = z.object({
      plan: z.enum(['starter', 'growth', 'professional', 'free']),
      billingCycle: z.enum(['monthly', 'annual']).optional(),
    }).parse(req.body);

    const { data: subscription } = await supabaseAdmin
      .from('subscriptions')
      .select('stripe_subscription_id')
      .eq('user_id', userId)  // ⬅️ Changed from store_id to user_id
      .eq('is_primary', true)
      .single();

    if (!subscription?.stripe_subscription_id) {
      if (plan === 'free') {
        // Already on free or no subscription: nothing to do
        return res.json({ success: true, message: 'Already on free plan.' });
      }
      return res.status(400).json({
        error: 'No active subscription found. Use checkout to subscribe.',
        useCheckout: true,
      });
    }

    if (plan === 'free') {
      // Downgrade to free = cancel subscription at period end
      await stripeService.cancelSubscription(subscription.stripe_subscription_id, 'downgrade_to_free');
      await supabaseAdmin
        .from('subscriptions')
        .update({
          cancel_at_period_end: true,
          canceled_at: new Date().toISOString(),
          cancellation_reason: 'downgrade_to_free',
        })
        .eq('user_id', userId)
        .eq('is_primary', true);

      return res.json({
        success: true,
        message: 'Your subscription will downgrade to Free at the end of the current billing period.',
      });
    }

    await stripeService.changeSubscriptionPlan(
      subscription.stripe_subscription_id,
      plan as PlanType,
      billingCycle as BillingCycle,
      userId
    );

    res.json({
      success: true,
      message: 'Plan changed successfully. This applies to all your stores.',
    });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid plan or billing cycle' });
    }
    logger.error('BILLING', 'Change plan error', { err: error });
    res.status(500).json({ error: 'An error occurred' });
  }
});


router.get('/referrals', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id || req.userId;
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }
    const stats = await stripeService.getReferralStats(userId);

    res.json(stats);
  } catch (error: unknown) {
    logger.error('BILLING', 'Referrals error', { err: error });
    res.status(500).json({ error: 'An error occurred' });
  }
});

router.post('/referrals/generate', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id || req.userId;
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }
    const code = await stripeService.generateReferralCode(userId);

    res.json({ code, link: `${process.env.APP_URL}/r/${code}` });
  } catch (error: unknown) {
    logger.error('BILLING', 'Generate referral code error', { err: error });
    res.status(500).json({ error: 'An error occurred' });
  }
});

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  logger.info('BILLING', 'Checkout completed', { sessionId: session.id });

  const userId = session.metadata?.user_id;  // ⬅️ Only userId now
  const plan = session.metadata?.plan as PlanType;
  const billingCycle = session.metadata?.billing_cycle as BillingCycle;
  const referralCode = session.metadata?.referral_code;
  const discountCode = session.metadata?.discount_code;

  if (!userId || !plan) {
    logger.error('BILLING', 'Missing metadata in checkout session');
    return;
  }

  // SECURITY: Process discount code redemption using atomic RPC with row-level locking
  // This prevents race conditions where two concurrent requests could both redeem
  // the same code, exceeding max_uses
  if (discountCode) {
    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 100;
    let redemptionSuccess = false;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const { data: result, error: rpcError } = await supabaseAdmin.rpc(
        'redeem_discount_code_atomic',
        {
          p_code: discountCode,
          p_user_id: userId,
          p_store_id: null,
          p_stripe_subscription_id: session.subscription as string,
        }
      );

      if (rpcError) {
        logger.error('BILLING', 'Discount redemption RPC error', rpcError);
        break; // Don't retry on RPC errors (likely a bug, not a lock)
      }

      if (result && result.success) {
        logger.info('BILLING', 'Discount code redeemed atomically', { discountCode });
        redemptionSuccess = true;
        break; // Success, exit retry loop
      }

      if (result && !result.success) {
        if (result.retry && attempt < MAX_RETRIES) {
          // Row was locked, wait and retry
          logger.info('BILLING', `Discount code locked, retry ${attempt}/${MAX_RETRIES}`, { discountCode });
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * attempt));
          continue;
        }
        // Note: Stripe already processed the discount, so we just log this anomaly
        // The discount was technically used in Stripe, but we couldn't record it
        logger.warn('BILLING', 'Discount code redemption failed', { error: result.error, discountCode });
        break;
      }
    }

    // CRITICAL FIX (Bug #15): Validate redemption success after retry loop
    // If redemption failed but Stripe already charged with discount, we have a discrepancy
    if (!redemptionSuccess) {
      logger.error('BILLING', 'CRITICAL: Discount code failed to record after all retries', {
        discountCode,
        userId,
        sessionId: session.id,
        subscriptionId: session.subscription,
        message: 'Stripe charged with discount but DB did not record usage. Manual review required.'
      });
      // TODO: Send alert to admin (Slack, email, etc.)
      // TODO: Consider queuing for manual reconciliation
    }
  }

  // Record trial if applicable
  if (session.subscription) {
    const subscription = await getStripe().subscriptions.retrieve(
      session.subscription as string
    );

    if (subscription.trial_end) {
      await supabaseAdmin.from('subscription_trials').insert({
        user_id: userId,
        plan_tried: plan,
        trial_ends_at: new Date(subscription.trial_end * 1000).toISOString(),
      });
    }
  }

  // Update referral with trial started (if exists from signup)
  if (referralCode && userId) {
    const { data: refCode } = await supabaseAdmin
      .from('referral_codes')
      .select('user_id')
      .eq('code', referralCode)
      .single();

    if (refCode && refCode.user_id !== userId) {
      // Check if referral already exists (created during signup)
      const { data: existingReferral } = await supabaseAdmin
        .from('referrals')
        .select('id')
        .eq('referred_user_id', userId)
        .single();

      if (existingReferral) {
        // Update existing referral with trial start
        await supabaseAdmin
          .from('referrals')
          .update({
            trial_started_at: new Date().toISOString(),
            referred_plan: plan,
            referred_discount_applied: true,
          })
          .eq('id', existingReferral.id);

        logger.info('BILLING', 'Updated referral with trial start', { referralId: existingReferral.id });
      } else {
        // Create new referral (fallback if not created during signup)
        await supabaseAdmin.from('referrals').insert({
          referrer_user_id: refCode.user_id,
          referred_user_id: userId,
          referral_code: referralCode,
          trial_started_at: new Date().toISOString(),
          referred_plan: plan,
          referred_discount_applied: true,
        });

        logger.info('BILLING', 'Created new referral with trial start');
      }
    }
  }
}

async function handleSubscriptionCreated(subscription: Stripe.Subscription) {
  logger.info('BILLING', 'Subscription created', { subscriptionId: subscription.id });

  const userId = subscription.metadata?.user_id;  // ⬅️ Changed from store_id to user_id
  const plan = subscription.metadata?.plan as PlanType;

  if (!userId) {
    // Try to get from customer
    const customer = await getStripe().customers.retrieve(
      subscription.customer as string
    );
    if ('metadata' in customer && customer.metadata?.user_id) {
      await updateSubscriptionInDB(subscription, customer.metadata.user_id as string, plan);
    }
    return;
  }

  await updateSubscriptionInDB(subscription, userId, plan);
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  logger.info('BILLING', 'Subscription updated', { subscriptionId: subscription.id });

  const { data: localSub } = await supabaseAdmin
    .from('subscriptions')
    .select('user_id')  // ⬅️ Changed from store_id to user_id
    .eq('stripe_subscription_id', subscription.id)
    .single();

  if (localSub) {
    await updateSubscriptionInDB(subscription, localSub.user_id);  // ⬅️ Changed from store_id to user_id
  }
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  logger.info('BILLING', 'Subscription deleted', { subscriptionId: subscription.id });

  await supabaseAdmin
    .from('subscriptions')
    .update({
      status: 'canceled',
      plan: 'free',
      canceled_at: new Date().toISOString(),
    })
    .eq('stripe_subscription_id', subscription.id);
}

async function handleInvoicePaid(invoice: Stripe.Invoice) {
  logger.info('BILLING', 'Invoice paid', { invoiceId: invoice.id });

  // Process referral conversion on first payment
  if (invoice.billing_reason === 'subscription_create') {
    const customerId = invoice.customer as string;
    const customer = await getStripe().customers.retrieve(customerId);

    if ('metadata' in customer && customer.metadata?.user_id) {
      const userId = customer.metadata.user_id;

      // Get subscription plan
      const { data: sub } = await supabaseAdmin
        .from('subscriptions')
        .select('plan')
        .eq('user_id', userId)  // ⬅️ Changed from store_id to user_id
        .eq('is_primary', true)
        .single();

      if (sub) {
        await stripeService.processReferralConversion(
          userId,
          sub.plan as PlanType
        );
      }
    }
  }

  // Mark trial as converted if applicable
  if (invoice.subscription) {
    const { data: localSub } = await supabaseAdmin
      .from('subscriptions')
      .select('user_id')  // ⬅️ Changed from store_id to user_id
      .eq('stripe_subscription_id', invoice.subscription)
      .single();

    if (localSub) {
      await supabaseAdmin
        .from('subscription_trials')
        .update({ converted: true, converted_at: new Date().toISOString() })
        .eq('user_id', localSub.user_id)  // ⬅️ Changed from store_id to user_id
        .is('converted', false);
    }
  }
}

async function handleInvoiceFailed(invoice: Stripe.Invoice) {
  logger.info('BILLING', 'Invoice failed', { invoiceId: invoice.id });

  if (invoice.subscription) {
    await supabaseAdmin
      .from('subscriptions')
      .update({ status: 'past_due' })
      .eq('stripe_subscription_id', invoice.subscription);

    // TODO: Send email notification about failed payment
  }
}

async function handleTrialWillEnd(subscription: Stripe.Subscription) {
  logger.info('BILLING', 'Trial will end', { subscriptionId: subscription.id });

  // TODO: Send email reminder about trial ending
  // This fires 3 days before trial ends
}

async function updateSubscriptionInDB(
  subscription: Stripe.Subscription,
  userId: string,  // ⬅️ Changed from storeId to userId
  _plan?: PlanType // Ignored for security - we derive plan from priceId
) {
  const priceId = subscription.items.data[0]?.price.id;

  if (!priceId) {
    logger.error('BILLING', 'SECURITY: No price ID in subscription');
    throw new Error('No se encontró ID de precio en la suscripción');
  }

  // SECURITY: Get plan from priceId mapping - NEVER trust metadata
  const subscriptionPlan = getPlanFromPriceId(priceId);

  if (!subscriptionPlan) {
    // SECURITY: Unknown priceId is a critical error - could be manipulation attempt
    // DO NOT default to free - this would give paid features without payment
    logger.error('BILLING', 'SECURITY ALERT: Unknown priceId rejected', { priceId, userId, subscriptionId: subscription.id });
    throw new Error(`SECURITY: Unrecognized priceId "${priceId}" - subscription rejected. Contact support if this is legitimate.`);
  }

  // Get billing cycle from Stripe API (trusted source)
  const price = await getStripe().prices.retrieve(priceId);
  const billingCycle = price.recurring?.interval === 'year' ? 'annual' : 'monthly';

  // Map Stripe status to our status
  let status = subscription.status;
  if (status === 'active' && subscription.cancel_at_period_end) {
    status = 'active'; // Still active but will cancel
  }

  // SECURITY: Plan is verified from priceId mapping (never from metadata)
  const verifiedPlan = subscriptionPlan;

  await supabaseAdmin
    .from('subscriptions')
    .upsert({
      user_id: userId,  // ⬅️ Changed from store_id to user_id
      plan: verifiedPlan,
      billing_cycle: billingCycle,
      status: status,
      stripe_customer_id: subscription.customer as string,
      stripe_subscription_id: subscription.id,
      stripe_price_id: priceId,
      is_primary: true,  // ⬅️ Added for user-level subscriptions
      trial_started_at: subscription.trial_start
        ? new Date(subscription.trial_start * 1000).toISOString()
        : null,
      trial_ends_at: subscription.trial_end
        ? new Date(subscription.trial_end * 1000).toISOString()
        : null,
      current_period_start: new Date(
        subscription.current_period_start * 1000
      ).toISOString(),
      current_period_end: new Date(
        subscription.current_period_end * 1000
      ).toISOString(),
      cancel_at_period_end: subscription.cancel_at_period_end,
    }, {
      onConflict: 'user_id,is_primary'  // ⬅️ Use composite unique constraint
    });
}

/**
 * Validate cron request - supports multiple auth methods:
 * 1. Railway Cron (internal): No auth needed from private network
 * 2. External caller: Requires X-Cron-Secret header
 *
 * SECURITY: Returns generic 'unauthorized' to avoid information disclosure
 */
function validateCronAuth(req: Request): { valid: boolean; source: string } {
  // SECURITY: Only trust CRON_SECRET header, never trust spoofable headers like x-railway-cron
  const cronSecret = req.headers['x-cron-secret'];
  const expectedSecret = process.env.CRON_SECRET;

  // Railway cron jobs: configured via railway.json, Railway injects the secret automatically
  // External callers: must provide X-Cron-Secret header
  if (!expectedSecret || !cronSecret || cronSecret !== expectedSecret) {
    return { valid: false, source: 'unauthorized' };
  }

  return { valid: true, source: 'cron-secret' };
}

/**
 * Process expiring trials - fallback for trial_will_end webhook
 * Should be called daily by cron job
 * Sends reminder emails for trials expiring in 3 days
 */
router.post('/cron/expiring-trials', async (req: Request, res: Response) => {
  const auth = validateCronAuth(req);
  if (!auth.valid) {
    logger.warn('BILLING', 'Unauthorized cron attempt');
    return res.status(401).json({ error: 'Unauthorized' });
  }
  logger.info('BILLING', `expiring-trials called via ${auth.source}`);

  try {
    // Find trials expiring in the next 3 days that haven't been notified
    const threeDaysFromNow = new Date();
    threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);

    const { data: expiringTrials, error } = await supabaseAdmin
      .from('subscriptions')
      .select(`
        id,
        user_id,
        plan,
        trial_ends_at,
        stripe_subscription_id,
        users:user_id (email, name)
      `)
      .eq('status', 'trialing')
      .lte('trial_ends_at', threeDaysFromNow.toISOString())
      .gt('trial_ends_at', new Date().toISOString())
      .is('trial_reminder_sent', null);

    if (error) {
      logger.error('BILLING', 'Error fetching expiring trials', error);
      return res.status(500).json({ error: 'Error al obtener pruebas por vencer' });
    }

    logger.info('BILLING', `Found ${expiringTrials?.length || 0} expiring trials`);

    // Batch update all expiring trials at once instead of N+1 sequential updates
    const trialIds = (expiringTrials || []).map(t => t.id);

    if (trialIds.length > 0) {
      const { error: updateError } = await supabaseAdmin
        .from('subscriptions')
        .update({ trial_reminder_sent: new Date().toISOString() })
        .in('id', trialIds);

      if (updateError) {
        logger.error('BILLING', 'Error batch updating trial reminders', updateError);
        return res.status(500).json({ error: 'Error al actualizar recordatorios de prueba' });
      }

      // TODO: Send email notifications
      // for (const trial of expiringTrials || []) {
      //   await sendTrialExpiringEmail({
      //     email: trial.users?.email,
      //     name: trial.users?.name,
      //     plan: trial.plan,
      //     expiresAt: trial.trial_ends_at,
      //   });
      // }

      for (const trial of expiringTrials || []) {
        logger.info('BILLING', `Processed trial reminder for user ${trial.user_id}`);
      }
    }

    res.json({
      success: true,
      processed: trialIds.length,
      failed: 0,
      details: { processed: trialIds, failed: [] },
    });
  } catch (error: unknown) {
    logger.error('BILLING', 'Unexpected error in expiring-trials', { err: error });
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

/**
 * Process past due subscriptions - grace period enforcement
 * Should be called daily by cron job
 * Downgrades subscriptions past_due for more than 7 days
 */
router.post('/cron/past-due-enforcement', async (req: Request, res: Response) => {
  const auth = validateCronAuth(req);
  if (!auth.valid) {
    logger.warn('BILLING', 'Unauthorized cron attempt');
    return res.status(401).json({ error: 'Unauthorized' });
  }
  logger.info('BILLING', `past-due-enforcement called via ${auth.source}`);

  try {
    const gracePeriodDays = 7;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - gracePeriodDays);

    // Find subscriptions past_due for more than grace period
    const { data: overdueSubscriptions, error } = await supabaseAdmin
      .from('subscriptions')
      .select('id, user_id, plan, status, updated_at')
      .eq('status', 'past_due')
      .lt('updated_at', cutoffDate.toISOString());

    if (error) {
      logger.error('BILLING', 'Error fetching overdue subscriptions', error);
      return res.status(500).json({ error: 'Error al obtener suscripciones vencidas' });
    }

    logger.info('BILLING', `Found ${overdueSubscriptions?.length || 0} overdue subscriptions`);

    const overdueIds = (overdueSubscriptions || []).map(s => s.id);

    if (overdueIds.length > 0) {
      // Batch downgrade all overdue subscriptions at once
      const { error: updateError } = await supabaseAdmin
        .from('subscriptions')
        .update({
          plan: 'free',
          status: 'canceled',
          canceled_at: new Date().toISOString(),
          cancellation_reason: 'payment_failed_grace_period_exceeded',
        })
        .in('id', overdueIds);

      if (updateError) {
        logger.error('BILLING', 'Error batch downgrading subscriptions', updateError);
        return res.status(500).json({ error: 'Error al degradar suscripciones' });
      }

      // Batch insert history records
      const historyRecords = (overdueSubscriptions || []).map(sub => ({
        subscription_id: sub.id,
        event_type: 'downgraded_payment_failed',
        from_plan: sub.plan,
        to_plan: 'free',
        metadata: {
          reason: 'Grace period exceeded after payment failure',
          grace_period_days: gracePeriodDays,
        },
      }));

      const { error: historyError } = await supabaseAdmin
        .from('subscription_history')
        .insert(historyRecords);

      if (historyError) {
        logger.error('BILLING', 'Error batch inserting subscription history', historyError);
      }

      for (const sub of overdueSubscriptions || []) {
        logger.info('BILLING', `Downgraded subscription ${sub.id} to free after grace period`);
      }

      // TODO: Send email notifications about downgrade
    }

    res.json({
      success: true,
      downgraded: overdueIds.length,
      failed: 0,
      gracePeriodDays,
      details: { downgraded: overdueIds, failed: [] },
    });
  } catch (error: unknown) {
    logger.error('BILLING', 'Unexpected error in past-due-enforcement', { err: error });
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

/**
 * Process pending referral credits - 30 day waiting period
 * Should be called daily by cron job
 * Applies credits for referrals where referred user has been paying for 30+ days
 */
router.post('/cron/process-referral-credits', async (req: Request, res: Response) => {
  const auth = validateCronAuth(req);
  if (!auth.valid) {
    logger.warn('BILLING', 'Unauthorized cron attempt');
    return res.status(401).json({ error: 'Unauthorized' });
  }
  logger.info('BILLING', `process-referral-credits called via ${auth.source}`);

  try {
    const waitingPeriodDays = 30;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - waitingPeriodDays);

    // Find referrals that:
    // 1. Have first payment date older than 30 days
    // 2. Haven't had credit applied yet
    // 3. Referred user still has active subscription
    const { data: eligibleReferrals, error } = await supabaseAdmin
      .from('referrals')
      .select(`
        id,
        referrer_user_id,
        referred_user_id,
        referral_code,
        referrer_credit_amount_cents,
        first_payment_at
      `)
      .lt('first_payment_at', cutoffDate.toISOString())
      .eq('referrer_credit_applied', false)
      .not('first_payment_at', 'is', null);

    if (error) {
      logger.error('BILLING', 'Error fetching eligible referrals', error);
      return res.status(500).json({ error: 'Error al obtener referidos elegibles' });
    }

    logger.info('BILLING', `Found ${eligibleReferrals?.length || 0} referrals eligible for credit`);

    const processed: string[] = [];
    const skipped: string[] = [];
    const failed: string[] = [];

    for (const referral of eligibleReferrals || []) {
      try {
        // Verify referred user still has active paid subscription
        const { data: referredSub } = await supabaseAdmin
          .from('subscriptions')
          .select('status, plan')
          .eq('user_id', referral.referred_user_id)
          .eq('is_primary', true)
          .single();

        // Skip if referred user canceled or downgraded to free
        if (!referredSub || referredSub.status === 'canceled' || referredSub.plan === 'free') {
          logger.info('BILLING', `Skipping referral ${referral.id} - referred user no longer active`);
          skipped.push(referral.id);
          continue;
        }

        // Get referrer's Stripe customer ID
        const { data: referrerSub } = await supabaseAdmin
          .from('subscriptions')
          .select('stripe_customer_id')
          .eq('user_id', referral.referrer_user_id)
          .eq('is_primary', true)
          .single();

        if (referrerSub?.stripe_customer_id) {
          // Apply credit to referrer's Stripe account
          await stripeService.applyReferralCredit(
            referrerSub.stripe_customer_id,
            referral.referrer_credit_amount_cents || 1000,
            referral.id
          );
        }

        // Create credit record
        await supabaseAdmin.from('referral_credits').insert({
          user_id: referral.referrer_user_id,
          amount_cents: referral.referrer_credit_amount_cents || 1000,
          source_referral_id: referral.id,
        });

        // Mark referral as credit applied
        await supabaseAdmin
          .from('referrals')
          .update({
            referrer_credit_applied: true,
            referrer_credit_applied_at: new Date().toISOString(),
          })
          .eq('id', referral.id);

        // Update referral code stats
        await supabaseAdmin.rpc('increment_referral_conversion', {
          p_referral_code: referral.referral_code,
          p_credit_amount: referral.referrer_credit_amount_cents || 1000,
        });

        processed.push(referral.id);
        logger.info('BILLING', `Applied credit for referral ${referral.id}`);
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : 'unknown error';
        logger.error('BILLING', `Error al procesar referido ${referral.id}`, { error: errMsg });
        failed.push(referral.id);
      }
    }

    res.json({
      success: true,
      processed: processed.length,
      skipped: skipped.length,
      failed: failed.length,
      waitingPeriodDays,
      details: { processed, skipped, failed },
    });
  } catch (error: unknown) {
    logger.error('BILLING', 'Unexpected error in process-referral-credits', { err: error });
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

export default router;

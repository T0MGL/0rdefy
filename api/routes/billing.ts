/**
 * Billing Routes
 *
 * Handles subscription management, checkout, billing portal,
 * referrals, and Stripe webhooks
 */

import express, { Request, Response } from 'express';
import Stripe from 'stripe';
import { verifyToken, extractStoreId } from '../middleware/auth';
import { supabaseAdmin } from '../db/connection';
import stripeService, { PlanType, BillingCycle, PLANS } from '../services/stripe.service';

const router = express.Router();

// Helper to get Stripe instance from service
const getStripe = (): Stripe => stripeService.getStripe();

// =============================================
// PUBLIC ROUTES (No auth required)
// =============================================

/**
 * Stripe Webhook Handler
 * Processes events from Stripe
 */
router.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  async (req: Request, res: Response) => {
    const sig = req.headers['stripe-signature'] as string;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.error('[Billing Webhook] Missing webhook secret');
      return res.status(500).json({ error: 'Webhook secret not configured' });
    }

    let event: Stripe.Event;

    try {
      event = getStripe().webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err: any) {
      console.error('[Billing Webhook] Signature verification failed:', err.message);
      return res.status(400).json({ error: `Webhook Error: ${err.message}` });
    }

    // Check for idempotency
    const { data: existingEvent } = await supabaseAdmin
      .from('stripe_billing_events')
      .select('id')
      .eq('stripe_event_id', event.id)
      .single();

    if (existingEvent) {
      console.log('[Billing Webhook] Duplicate event, skipping:', event.id);
      return res.json({ received: true, duplicate: true });
    }

    // Store event for idempotency
    await supabaseAdmin.from('stripe_billing_events').insert({
      stripe_event_id: event.id,
      event_type: event.type,
      payload: event.data,
    });

    console.log('[Billing Webhook] Processing event:', event.type);

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
          console.log('[Billing Webhook] Unhandled event type:', event.type);
      }

      // Mark event as processed
      await supabaseAdmin
        .from('stripe_billing_events')
        .update({ processed: true, processed_at: new Date().toISOString() })
        .eq('stripe_event_id', event.id);

      res.json({ received: true });
    } catch (error: any) {
      console.error('[Billing Webhook] Error processing event:', error);

      // Store error
      await supabaseAdmin
        .from('stripe_billing_events')
        .update({ error: error.message })
        .eq('stripe_event_id', event.id);

      res.status(500).json({ error: 'Webhook processing failed' });
    }
  }
);

/**
 * Validate referral code (public)
 */
router.get('/referral/:code/validate', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const result = await stripeService.validateReferralCode(code);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Validate discount code (public)
 */
router.post('/discount/validate', async (req: Request, res: Response) => {
  try {
    const { code, plan } = req.body;
    const result = await stripeService.validateDiscountCode(code, plan);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get all plans (public)
 */
router.get('/plans', async (req: Request, res: Response) => {
  try {
    const plans = await stripeService.getAllPlanLimits();

    // Format plans for frontend
    const formattedPlans = plans.map((plan) => ({
      ...plan,
      priceMonthly: plan.price_monthly_cents / 100,
      priceAnnual: plan.price_annual_cents / 100,
      priceAnnualMonthly: Math.round(plan.price_annual_cents / 12) / 100,
      annualSavings: Math.round(
        ((plan.price_monthly_cents * 12 - plan.price_annual_cents) / (plan.price_monthly_cents * 12)) * 100
      ),
    }));

    res.json(formattedPlans);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// PROTECTED ROUTES (Auth required)
// =============================================

router.use(verifyToken);
router.use(extractStoreId);

/**
 * Get current subscription
 */
router.get('/subscription', async (req: Request, res: Response) => {
  try {
    const storeId = (req as any).storeId;

    const subscription = await stripeService.getStorePlan(storeId);
    const usage = await stripeService.getStoreUsage(storeId);
    const planLimits = await stripeService.getAllPlanLimits();

    const currentPlanLimits = planLimits.find((p) => p.plan === subscription.plan);

    res.json({
      subscription: {
        ...subscription,
        planDetails: currentPlanLimits,
      },
      usage,
      allPlans: planLimits.map((plan) => ({
        ...plan,
        priceMonthly: plan.price_monthly_cents / 100,
        priceAnnual: plan.price_annual_cents / 100,
      })),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Check feature access
 */
router.get('/feature/:feature', async (req: Request, res: Response) => {
  try {
    const storeId = (req as any).storeId;
    const { feature } = req.params;

    const hasAccess = await stripeService.hasFeatureAccess(storeId, feature);

    res.json({ hasAccess });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Create checkout session
 */
router.post('/checkout', async (req: Request, res: Response) => {
  try {
    const storeId = (req as any).storeId;
    const userId = (req as any).user?.id || (req as any).userId;
    const userEmail = (req as any).user?.email;
    const { plan, billingCycle, referralCode, discountCode } = req.body;

    console.log('[Billing] Checkout request:', { storeId, userId, userEmail, plan, billingCycle, referralCode, discountCode });

    if (!plan || !billingCycle) {
      return res.status(400).json({ error: 'Plan and billing cycle are required' });
    }

    if (!storeId) {
      console.error('[Billing] Missing storeId');
      return res.status(400).json({ error: 'Store ID is required' });
    }

    if (!userId || !userEmail) {
      console.error('[Billing] Missing user info:', { userId, userEmail });
      return res.status(400).json({ error: 'User information is required' });
    }

    const appUrl = process.env.APP_URL || 'https://app.ordefy.io';

    console.log('[Billing] Creating checkout session...');
    const session = await stripeService.createCheckoutSession({
      storeId,
      userId,
      email: userEmail,
      plan: plan as PlanType,
      billingCycle: billingCycle as BillingCycle,
      successUrl: `${appUrl}/settings?tab=subscription&success=true`,
      cancelUrl: `${appUrl}/settings?tab=subscription&canceled=true`,
      referralCode,
      discountCode,
    });

    console.log('[Billing] Checkout session created:', session.id);
    res.json({ sessionId: session.id, url: session.url });
  } catch (error: any) {
    console.error('[Billing] Checkout error:', error.message);
    console.error('[Billing] Checkout error stack:', error.stack);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Create billing portal session
 */
router.post('/portal', async (req: Request, res: Response) => {
  try {
    const storeId = (req as any).storeId;
    const appUrl = process.env.APP_URL || 'https://app.ordefy.io';

    const session = await stripeService.createBillingPortalSession(
      storeId,
      `${appUrl}/settings/billing`
    );

    res.json({ url: session.url });
  } catch (error: any) {
    console.error('[Billing] Portal error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Cancel subscription
 */
router.post('/cancel', async (req: Request, res: Response) => {
  try {
    const storeId = (req as any).storeId;
    const { reason } = req.body;

    const { data: subscription } = await supabaseAdmin
      .from('subscriptions')
      .select('stripe_subscription_id')
      .eq('store_id', storeId)
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
      .eq('store_id', storeId);

    res.json({ success: true, message: 'Subscription will be canceled at period end' });
  } catch (error: any) {
    console.error('[Billing] Cancel error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Reactivate subscription
 */
router.post('/reactivate', async (req: Request, res: Response) => {
  try {
    const storeId = (req as any).storeId;

    const { data: subscription } = await supabaseAdmin
      .from('subscriptions')
      .select('stripe_subscription_id')
      .eq('store_id', storeId)
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
      .eq('store_id', storeId);

    res.json({ success: true, message: 'Subscription reactivated' });
  } catch (error: any) {
    console.error('[Billing] Reactivate error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Change plan
 */
router.post('/change-plan', async (req: Request, res: Response) => {
  try {
    const storeId = (req as any).storeId;
    const { plan, billingCycle } = req.body;

    if (!plan || !billingCycle) {
      return res.status(400).json({ error: 'Plan and billing cycle are required' });
    }

    const { data: subscription } = await supabaseAdmin
      .from('subscriptions')
      .select('stripe_subscription_id')
      .eq('store_id', storeId)
      .single();

    if (!subscription?.stripe_subscription_id) {
      // No existing subscription, create checkout
      return res.status(400).json({
        error: 'No existing subscription. Use checkout instead.',
        useCheckout: true,
      });
    }

    await stripeService.changeSubscriptionPlan(
      subscription.stripe_subscription_id,
      plan as PlanType,
      billingCycle as BillingCycle
    );

    res.json({ success: true, message: 'Plan changed successfully' });
  } catch (error: any) {
    console.error('[Billing] Change plan error:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// REFERRAL ROUTES
// =============================================

/**
 * Get user's referral info
 */
router.get('/referrals', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id || (req as any).userId;
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }
    const stats = await stripeService.getReferralStats(userId);

    res.json(stats);
  } catch (error: any) {
    console.error('[Billing] Referrals error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Generate referral code
 */
router.post('/referrals/generate', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id || (req as any).userId;
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }
    const code = await stripeService.generateReferralCode(userId);

    res.json({ code, link: `${process.env.APP_URL}/r/${code}` });
  } catch (error: any) {
    console.error('[Billing] Generate referral code error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// WEBHOOK HANDLERS
// =============================================

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  console.log('[Billing Webhook] Checkout completed:', session.id);

  const storeId = session.metadata?.store_id;
  const userId = session.metadata?.user_id;
  const plan = session.metadata?.plan as PlanType;
  const billingCycle = session.metadata?.billing_cycle as BillingCycle;
  const referralCode = session.metadata?.referral_code;

  if (!storeId || !plan) {
    console.error('[Billing Webhook] Missing metadata in checkout session');
    return;
  }

  // Record trial if applicable
  if (session.subscription) {
    const subscription = await getStripe().subscriptions.retrieve(
      session.subscription as string
    );

    if (subscription.trial_end && userId) {
      await supabaseAdmin.from('subscription_trials').insert({
        user_id: userId,
        store_id: storeId,
        plan_tried: plan,
        trial_ends_at: new Date(subscription.trial_end * 1000).toISOString(),
      });
    }
  }

  // Record referral if applicable
  if (referralCode && userId) {
    const { data: refCode } = await supabaseAdmin
      .from('referral_codes')
      .select('user_id')
      .eq('code', referralCode)
      .single();

    if (refCode && refCode.user_id !== userId) {
      await supabaseAdmin.from('referrals').insert({
        referrer_user_id: refCode.user_id,
        referred_user_id: userId,
        referral_code: referralCode,
        referred_plan: plan,
        referred_discount_applied: true,
      });
    }
  }
}

async function handleSubscriptionCreated(subscription: Stripe.Subscription) {
  console.log('[Billing Webhook] Subscription created:', subscription.id);

  const storeId = subscription.metadata?.store_id;
  const plan = subscription.metadata?.plan as PlanType;

  if (!storeId) {
    // Try to get from customer
    const customer = await getStripe().customers.retrieve(
      subscription.customer as string
    );
    if ('metadata' in customer && customer.metadata?.store_id) {
      await updateSubscriptionInDB(subscription, customer.metadata.store_id as string, plan);
    }
    return;
  }

  await updateSubscriptionInDB(subscription, storeId, plan);
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  console.log('[Billing Webhook] Subscription updated:', subscription.id);

  const { data: localSub } = await supabaseAdmin
    .from('subscriptions')
    .select('store_id')
    .eq('stripe_subscription_id', subscription.id)
    .single();

  if (localSub) {
    await updateSubscriptionInDB(subscription, localSub.store_id);
  }
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  console.log('[Billing Webhook] Subscription deleted:', subscription.id);

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
  console.log('[Billing Webhook] Invoice paid:', invoice.id);

  // Process referral conversion on first payment
  if (invoice.billing_reason === 'subscription_create') {
    const customerId = invoice.customer as string;
    const customer = await getStripe().customers.retrieve(customerId);

    if ('metadata' in customer && customer.metadata?.store_id) {
      // Get user from store
      const { data: userStore } = await supabaseAdmin
        .from('user_stores')
        .select('user_id')
        .eq('store_id', customer.metadata.store_id)
        .eq('role', 'owner')
        .single();

      if (userStore) {
        // Get subscription plan
        const { data: sub } = await supabaseAdmin
          .from('subscriptions')
          .select('plan')
          .eq('store_id', customer.metadata.store_id)
          .single();

        if (sub) {
          await stripeService.processReferralConversion(
            userStore.user_id,
            sub.plan as PlanType
          );
        }
      }
    }
  }

  // Mark trial as converted if applicable
  if (invoice.subscription) {
    const { data: localSub } = await supabaseAdmin
      .from('subscriptions')
      .select('store_id')
      .eq('stripe_subscription_id', invoice.subscription)
      .single();

    if (localSub) {
      await supabaseAdmin
        .from('subscription_trials')
        .update({ converted: true, converted_at: new Date().toISOString() })
        .eq('store_id', localSub.store_id)
        .is('converted', false);
    }
  }
}

async function handleInvoiceFailed(invoice: Stripe.Invoice) {
  console.log('[Billing Webhook] Invoice failed:', invoice.id);

  if (invoice.subscription) {
    await supabaseAdmin
      .from('subscriptions')
      .update({ status: 'past_due' })
      .eq('stripe_subscription_id', invoice.subscription);

    // TODO: Send email notification about failed payment
  }
}

async function handleTrialWillEnd(subscription: Stripe.Subscription) {
  console.log('[Billing Webhook] Trial will end:', subscription.id);

  // TODO: Send email reminder about trial ending
  // This fires 3 days before trial ends
}

async function updateSubscriptionInDB(
  subscription: Stripe.Subscription,
  storeId: string,
  plan?: PlanType
) {
  const priceId = subscription.items.data[0]?.price.id;
  const price = await getStripe().prices.retrieve(priceId);

  // Determine plan from price metadata if not provided
  const subscriptionPlan = plan || (price.metadata?.ordefy_plan as PlanType) || 'starter';
  const billingCycle =
    price.recurring?.interval === 'year' ? 'annual' : 'monthly';

  // Map Stripe status to our status
  let status = subscription.status;
  if (status === 'active' && subscription.cancel_at_period_end) {
    status = 'active'; // Still active but will cancel
  }

  await supabaseAdmin
    .from('subscriptions')
    .upsert({
      store_id: storeId,
      plan: subscriptionPlan,
      billing_cycle: billingCycle,
      status: status,
      stripe_customer_id: subscription.customer as string,
      stripe_subscription_id: subscription.id,
      stripe_price_id: priceId,
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
    })
    .eq('store_id', storeId);
}

export default router;

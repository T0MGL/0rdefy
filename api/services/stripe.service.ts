/**
 * Stripe Billing Service
 *
 * Handles all Stripe-related operations:
 * - Products and Prices management
 * - Subscription lifecycle
 * - Checkout sessions
 * - Customer portal
 * - Webhooks
 * - Referrals and discounts
 */

import Stripe from 'stripe';
import { supabaseAdmin } from '../db/connection';

// Check if Stripe is configured
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const isStripeConfigured = !!STRIPE_SECRET_KEY;

// Initialize Stripe only if API key is provided
let stripe: Stripe | null = null;
if (isStripeConfigured) {
  stripe = new Stripe(STRIPE_SECRET_KEY, {
    apiVersion: '2024-12-18.acacia',
  });
  console.log('[Stripe] Initialized with API key');
} else {
  console.warn('[Stripe] STRIPE_SECRET_KEY not configured - billing features will be disabled');
}

/**
 * Get the Stripe instance, throwing if not configured
 */
function getStripe(): Stripe {
  if (!stripe) {
    throw new Error('Stripe is not configured. Set STRIPE_SECRET_KEY environment variable.');
  }
  return stripe;
}

// Plan configuration
export const PLANS = {
  free: {
    name: 'Free',
    description: 'Para empezar a probar Ordefy',
    priceMonthly: 0,
    priceAnnual: 0,
    hasTrial: false,
    trialDays: 0,
  },
  starter: {
    name: 'Starter',
    description: 'Para pequeños negocios en crecimiento',
    priceMonthly: 2900, // $29.00 in cents
    priceAnnual: 29580, // $295.80 (15% off = $24.65/mo)
    hasTrial: true,
    trialDays: 14,
  },
  growth: {
    name: 'Growth',
    description: 'Para negocios en expansión',
    priceMonthly: 7900, // $79.00 in cents
    priceAnnual: 80580, // $805.80 (15% off = $67.15/mo)
    hasTrial: true,
    trialDays: 14,
  },
  professional: {
    name: 'Professional',
    description: 'Para operaciones avanzadas',
    priceMonthly: 19900, // $199.00 in cents
    priceAnnual: 202980, // $2029.80 (15% off = $169.15/mo)
    hasTrial: false,
    trialDays: 0,
  },
} as const;

export type PlanType = keyof typeof PLANS;
export type BillingCycle = 'monthly' | 'annual';

// Stripe Product IDs (from dashboard)
const stripeProducts: Record<Exclude<PlanType, 'free'>, string> = {
  starter: 'prod_ThwaLgmNLSnw4x',
  growth: 'prod_ThwabJsjsok2HB',
  professional: 'prod_ThwaJfFZy2YehK',
};

// Stripe Price IDs (from dashboard)
const stripePrices: Record<Exclude<PlanType, 'free'>, { monthly: string; annual: string }> = {
  starter: {
    monthly: 'price_1SkWhi8jew17tEHtwMsLHYBE',
    annual: 'price_1SkWhj8jew17tEHtL44FObEw',
  },
  growth: {
    monthly: 'price_1SkWhk8jew17tEHt5dTb8ra5',
    annual: 'price_1SkWhl8jew17tEHtpom2hRPz',
  },
  professional: {
    monthly: 'price_1SkWhm8jew17tEHtyZ00TL43',
    annual: 'price_1SkWhn8jew17tEHt9F8Ga0xD',
  },
};

/**
 * Check if Stripe is available
 */
export function isStripeAvailable(): boolean {
  return isStripeConfigured;
}

/**
 * Initialize Stripe (verify connection)
 */
export async function initializeStripeProducts(): Promise<void> {
  if (!isStripeConfigured) {
    console.log('[Stripe] Skipping initialization - not configured');
    return;
  }

  console.log('[Stripe] Verifying Stripe connection...');
  try {
    // Just verify we can connect to Stripe
    const products = await getStripe().products.list({ limit: 1 });
    console.log('[Stripe] Connection verified. Products available.');
    console.log('[Stripe] Using hardcoded price IDs from dashboard.');
  } catch (error) {
    console.error('[Stripe] Error connecting to Stripe:', error);
  }
}

/**
 * Get or create a Stripe customer for a store
 */
export async function getOrCreateCustomer(
  storeId: string,
  email: string,
  name?: string
): Promise<string> {
  // Check if customer already exists
  const { data: subscription } = await supabaseAdmin
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('store_id', storeId)
    .single();

  if (subscription?.stripe_customer_id) {
    return subscription.stripe_customer_id;
  }

  // Create new customer
  const customer = await getStripe().customers.create({
    email,
    name,
    metadata: {
      store_id: storeId,
    },
  });

  // Update subscription with customer ID
  await supabaseAdmin
    .from('subscriptions')
    .update({ stripe_customer_id: customer.id })
    .eq('store_id', storeId);

  return customer.id;
}

/**
 * Check if user can start a trial for a plan
 */
export async function canStartTrial(
  userId: string,
  plan: PlanType
): Promise<boolean> {
  if (!PLANS[plan].hasTrial) {
    return false;
  }

  const { data: existingTrial } = await supabaseAdmin
    .from('subscription_trials')
    .select('id')
    .eq('user_id', userId)
    .eq('plan_tried', plan)
    .single();

  return !existingTrial;
}

/**
 * Create a checkout session for upgrading
 */
export async function createCheckoutSession(params: {
  storeId: string;
  userId: string;
  email: string;
  plan: PlanType;
  billingCycle: BillingCycle;
  successUrl: string;
  cancelUrl: string;
  referralCode?: string;
  discountCode?: string;
}): Promise<Stripe.Checkout.Session> {
  const {
    storeId,
    userId,
    email,
    plan,
    billingCycle,
    successUrl,
    cancelUrl,
    referralCode,
    discountCode,
  } = params;

  if (plan === 'free') {
    throw new Error('Cannot create checkout for free plan');
  }

  const priceId = stripePrices[plan]?.[billingCycle];
  if (!priceId) {
    throw new Error(`Price not found for ${plan} ${billingCycle}`);
  }

  // Get or create customer
  const customerId = await getOrCreateCustomer(storeId, email);

  // Check if user can start trial
  const canTrial = await canStartTrial(userId, plan);

  // Build session params
  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    customer: customerId,
    mode: 'subscription',
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: cancelUrl,
    metadata: {
      store_id: storeId,
      user_id: userId,
      plan,
      billing_cycle: billingCycle,
      referral_code: referralCode || '',
      discount_code: discountCode || '',
    },
    subscription_data: {
      metadata: {
        store_id: storeId,
        plan,
      },
    },
    allow_promotion_codes: true, // Allow Stripe promotion codes
  };

  // Add trial if eligible
  if (canTrial && PLANS[plan].hasTrial) {
    sessionParams.subscription_data!.trial_period_days = PLANS[plan].trialDays;
  }

  // Apply referral discount (20% off first payment)
  if (referralCode) {
    const { data: referral } = await supabaseAdmin
      .from('referral_codes')
      .select('*')
      .eq('code', referralCode)
      .eq('is_active', true)
      .single();

    if (referral) {
      // Create a one-time 20% coupon
      const coupon = await getStripe().coupons.create({
        percent_off: 20,
        duration: 'once',
        name: `Referral ${referralCode}`,
        metadata: {
          referral_code: referralCode,
          type: 'referral_discount',
        },
      });
      sessionParams.discounts = [{ coupon: coupon.id }];
    }
  }

  // Apply discount code (if provided and valid)
  if (discountCode && !referralCode) {
    const { data: discount } = await supabaseAdmin
      .from('discount_codes')
      .select('*')
      .eq('code', discountCode.toUpperCase())
      .eq('is_active', true)
      .single();

    if (discount) {
      // Validate discount
      const now = new Date();
      const validFrom = discount.valid_from ? new Date(discount.valid_from) : null;
      const validUntil = discount.valid_until ? new Date(discount.valid_until) : null;

      const isValid =
        (!validFrom || now >= validFrom) &&
        (!validUntil || now <= validUntil) &&
        (!discount.max_uses || discount.current_uses < discount.max_uses) &&
        (!discount.applicable_plans || discount.applicable_plans.includes(plan));

      if (isValid && discount.stripe_coupon_id) {
        sessionParams.discounts = [{ coupon: discount.stripe_coupon_id }];
      }
    }
  }

  const session = await getStripe().checkout.sessions.create(sessionParams);
  return session;
}

/**
 * Create a billing portal session for managing subscription
 */
export async function createBillingPortalSession(
  storeId: string,
  returnUrl: string
): Promise<Stripe.BillingPortal.Session> {
  const { data: subscription } = await supabaseAdmin
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('store_id', storeId)
    .single();

  if (!subscription?.stripe_customer_id) {
    throw new Error('No Stripe customer found for this store');
  }

  const session = await getStripe().billingPortal.sessions.create({
    customer: subscription.stripe_customer_id,
    return_url: returnUrl,
  });

  return session;
}

/**
 * Get subscription details from Stripe
 */
export async function getStripeSubscription(
  subscriptionId: string
): Promise<Stripe.Subscription | null> {
  try {
    return await getStripe().subscriptions.retrieve(subscriptionId);
  } catch (error) {
    console.error('[Stripe] Error fetching subscription:', error);
    return null;
  }
}

/**
 * Cancel subscription at period end
 */
export async function cancelSubscription(
  subscriptionId: string,
  reason?: string
): Promise<Stripe.Subscription> {
  const subscription = await getStripe().subscriptions.update(subscriptionId, {
    cancel_at_period_end: true,
    metadata: {
      cancellation_reason: reason || '',
    },
  });

  return subscription;
}

/**
 * Reactivate a canceled subscription
 */
export async function reactivateSubscription(
  subscriptionId: string
): Promise<Stripe.Subscription> {
  const subscription = await getStripe().subscriptions.update(subscriptionId, {
    cancel_at_period_end: false,
  });

  return subscription;
}

/**
 * Change subscription plan (upgrade/downgrade)
 */
export async function changeSubscriptionPlan(
  subscriptionId: string,
  newPlan: PlanType,
  billingCycle: BillingCycle
): Promise<Stripe.Subscription> {
  const priceId = stripePrices[newPlan]?.[billingCycle];
  if (!priceId) {
    throw new Error(`Price not found for ${newPlan} ${billingCycle}`);
  }

  const stripeClient = getStripe();
  const subscription = await stripeClient.subscriptions.retrieve(subscriptionId);

  const updatedSubscription = await stripeClient.subscriptions.update(subscriptionId, {
    items: [
      {
        id: subscription.items.data[0].id,
        price: priceId,
      },
    ],
    proration_behavior: 'create_prorations',
    metadata: {
      plan: newPlan,
    },
  });

  return updatedSubscription;
}

/**
 * Apply referral credit to next invoice
 */
export async function applyReferralCredit(
  customerId: string,
  creditAmountCents: number,
  referralId: string
): Promise<void> {
  // Create a credit balance for the customer
  await getStripe().customers.createBalanceTransaction(customerId, {
    amount: -creditAmountCents, // Negative amount = credit
    currency: 'usd',
    description: `Referral credit - ID: ${referralId}`,
  });
}

/**
 * Create discount code in Stripe
 */
export async function createStripeDiscount(params: {
  code: string;
  type: 'percentage' | 'fixed';
  value: number;
  duration: 'once' | 'forever' | 'repeating';
  durationInMonths?: number;
}): Promise<{ couponId: string; promotionCodeId: string }> {
  const { code, type, value, duration, durationInMonths } = params;

  // Create coupon
  const couponParams: Stripe.CouponCreateParams = {
    duration,
    name: code,
    metadata: { ordefy_code: code },
  };

  if (type === 'percentage') {
    couponParams.percent_off = value;
  } else {
    couponParams.amount_off = value;
    couponParams.currency = 'usd';
  }

  if (duration === 'repeating' && durationInMonths) {
    couponParams.duration_in_months = durationInMonths;
  }

  const stripeClient = getStripe();
  const coupon = await stripeClient.coupons.create(couponParams);

  // Create promotion code (the actual code customers enter)
  const promotionCode = await stripeClient.promotionCodes.create({
    coupon: coupon.id,
    code: code.toUpperCase(),
  });

  return {
    couponId: coupon.id,
    promotionCodeId: promotionCode.id,
  };
}

/**
 * Validate discount code
 */
export async function validateDiscountCode(
  code: string,
  plan: PlanType
): Promise<{
  valid: boolean;
  discount?: {
    type: string;
    value: number;
    description: string;
  };
  error?: string;
}> {
  const { data: discount } = await supabaseAdmin
    .from('discount_codes')
    .select('*')
    .eq('code', code.toUpperCase())
    .eq('is_active', true)
    .single();

  if (!discount) {
    return { valid: false, error: 'Codigo no valido' };
  }

  const now = new Date();
  const validFrom = discount.valid_from ? new Date(discount.valid_from) : null;
  const validUntil = discount.valid_until ? new Date(discount.valid_until) : null;

  if (validFrom && now < validFrom) {
    return { valid: false, error: 'Codigo aun no es valido' };
  }

  if (validUntil && now > validUntil) {
    return { valid: false, error: 'Codigo expirado' };
  }

  if (discount.max_uses && discount.current_uses >= discount.max_uses) {
    return { valid: false, error: 'Codigo agotado' };
  }

  if (discount.applicable_plans && !discount.applicable_plans.includes(plan)) {
    return { valid: false, error: 'Codigo no aplica a este plan' };
  }

  let description = '';
  if (discount.type === 'percentage') {
    description = `${discount.value}% de descuento`;
  } else if (discount.type === 'fixed') {
    description = `$${(discount.value / 100).toFixed(2)} de descuento`;
  } else if (discount.type === 'trial_extension') {
    description = `+${discount.value} dias de prueba`;
  }

  return {
    valid: true,
    discount: {
      type: discount.type,
      value: discount.value,
      description,
    },
  };
}

/**
 * Validate referral code
 */
export async function validateReferralCode(code: string): Promise<{
  valid: boolean;
  referrerName?: string;
  discount?: string;
  error?: string;
}> {
  const { data: referralCode } = await supabaseAdmin
    .from('referral_codes')
    .select(`
      *,
      users:user_id (name)
    `)
    .eq('code', code.toUpperCase())
    .eq('is_active', true)
    .single();

  if (!referralCode) {
    return { valid: false, error: 'Codigo de referido no valido' };
  }

  return {
    valid: true,
    referrerName: referralCode.users?.name || 'Un usuario',
    discount: '20% de descuento en tu primer mes',
  };
}

/**
 * Get current plan for a store
 */
export async function getStorePlan(storeId: string): Promise<{
  plan: PlanType;
  status: string;
  billingCycle: BillingCycle | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: Date | null;
}> {
  const { data: subscription } = await supabaseAdmin
    .from('subscriptions')
    .select('*')
    .eq('store_id', storeId)
    .single();

  if (!subscription) {
    return {
      plan: 'free',
      status: 'active',
      billingCycle: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      trialEndsAt: null,
    };
  }

  return {
    plan: subscription.plan as PlanType,
    status: subscription.status,
    billingCycle: subscription.billing_cycle as BillingCycle | null,
    currentPeriodEnd: subscription.current_period_end
      ? new Date(subscription.current_period_end)
      : null,
    cancelAtPeriodEnd: subscription.cancel_at_period_end || false,
    trialEndsAt: subscription.trial_ends_at
      ? new Date(subscription.trial_ends_at)
      : null,
  };
}

/**
 * Get store usage stats
 */
export async function getStoreUsage(storeId: string): Promise<{
  orders: { used: number; limit: number; percentage: number };
  products: { used: number; limit: number; percentage: number };
  users: { used: number; limit: number; percentage: number };
}> {
  try {
    const { data, error } = await supabaseAdmin.rpc('get_store_usage', {
      p_store_id: storeId,
    });

    if (error) {
      console.error('[Stripe] Error getting store usage:', error.message);
      // Return defaults if RPC doesn't exist yet
      return {
        orders: { used: 0, limit: 50, percentage: 0 },
        products: { used: 0, limit: 100, percentage: 0 },
        users: { used: 0, limit: 1, percentage: 0 },
      };
    }

    if (!data || data.length === 0) {
      return {
        orders: { used: 0, limit: 50, percentage: 0 },
        products: { used: 0, limit: 100, percentage: 0 },
        users: { used: 0, limit: 1, percentage: 0 },
      };
    }

    const usage = data[0];

    return {
      orders: {
        used: usage.orders_this_month,
        limit: usage.max_orders === -1 ? Infinity : usage.max_orders,
        percentage: usage.orders_percentage,
      },
      products: {
        used: usage.products_count,
        limit: usage.max_products === -1 ? Infinity : usage.max_products,
        percentage: usage.products_percentage,
      },
      users: {
        used: usage.users_count,
        limit: usage.max_users === -1 ? Infinity : usage.max_users,
        percentage: usage.users_percentage,
      },
    };
  } catch (error: any) {
    console.error('[Stripe] Exception getting store usage:', error.message);
    return {
      orders: { used: 0, limit: 50, percentage: 0 },
      products: { used: 0, limit: 100, percentage: 0 },
      users: { used: 0, limit: 1, percentage: 0 },
    };
  }
}

/**
 * Check if store has access to a feature
 */
export async function hasFeatureAccess(
  storeId: string,
  feature: string
): Promise<boolean> {
  const { data } = await supabaseAdmin.rpc('has_feature_access', {
    p_store_id: storeId,
    p_feature: feature,
  });

  return data === true;
}

/**
 * Get all plan limits
 */
export async function getAllPlanLimits(): Promise<any[]> {
  const { data } = await supabaseAdmin
    .from('plan_limits')
    .select('*')
    .order('price_monthly_cents', { ascending: true });

  return data || [];
}

/**
 * Generate referral code for user
 */
export async function generateReferralCode(userId: string): Promise<string> {
  // Check if user already has a code
  const { data: existingCode } = await supabaseAdmin
    .from('referral_codes')
    .select('code')
    .eq('user_id', userId)
    .single();

  if (existingCode) {
    return existingCode.code;
  }

  // Generate new code
  const { data: newCode } = await supabaseAdmin.rpc('generate_referral_code');

  // Insert new referral code
  await supabaseAdmin.from('referral_codes').insert({
    user_id: userId,
    code: newCode,
  });

  return newCode;
}

/**
 * Get user's referral stats
 */
export async function getReferralStats(userId: string): Promise<{
  code: string;
  totalSignups: number;
  totalConversions: number;
  totalCreditsEarned: number;
  availableCredits: number;
  referrals: any[];
}> {
  // Get referral code
  const { data: referralCode } = await supabaseAdmin
    .from('referral_codes')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (!referralCode) {
    const code = await generateReferralCode(userId);
    return {
      code,
      totalSignups: 0,
      totalConversions: 0,
      totalCreditsEarned: 0,
      availableCredits: 0,
      referrals: [],
    };
  }

  // Get referrals
  const { data: referrals } = await supabaseAdmin
    .from('referrals')
    .select(`
      *,
      referred:referred_user_id (name, email)
    `)
    .eq('referral_code', referralCode.code)
    .order('created_at', { ascending: false });

  // Get available credits
  const { data: availableCredits } = await supabaseAdmin.rpc(
    'get_available_credits',
    { p_user_id: userId }
  );

  return {
    code: referralCode.code,
    totalSignups: referralCode.total_signups || 0,
    totalConversions: referralCode.total_conversions || 0,
    totalCreditsEarned: (referralCode.total_credits_earned_cents || 0) / 100,
    availableCredits: (availableCredits || 0) / 100,
    referrals: referrals || [],
  };
}

/**
 * Process referral after first payment
 */
export async function processReferralConversion(
  referredUserId: string,
  plan: PlanType
): Promise<void> {
  // Find the referral
  const { data: referral } = await supabaseAdmin
    .from('referrals')
    .select('*')
    .eq('referred_user_id', referredUserId)
    .is('first_payment_at', null)
    .single();

  if (!referral) {
    return; // No referral to process
  }

  // Update referral with conversion
  await supabaseAdmin
    .from('referrals')
    .update({
      first_payment_at: new Date().toISOString(),
      referred_plan: plan,
      referrer_credit_applied: true,
      referrer_credit_applied_at: new Date().toISOString(),
    })
    .eq('id', referral.id);

  // Create credit for referrer
  await supabaseAdmin.from('referral_credits').insert({
    user_id: referral.referrer_user_id,
    amount_cents: referral.referrer_credit_amount_cents || 1000,
    source_referral_id: referral.id,
  });

  // Get referrer's subscription to apply credit
  const { data: referrerStore } = await supabaseAdmin
    .from('user_stores')
    .select('store_id')
    .eq('user_id', referral.referrer_user_id)
    .single();

  if (referrerStore) {
    const { data: subscription } = await supabaseAdmin
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('store_id', referrerStore.store_id)
      .single();

    if (subscription?.stripe_customer_id) {
      await applyReferralCredit(
        subscription.stripe_customer_id,
        referral.referrer_credit_amount_cents || 1000,
        referral.id
      );
    }
  }
}

export default {
  isStripeAvailable,
  initializeStripeProducts,
  getOrCreateCustomer,
  canStartTrial,
  createCheckoutSession,
  createBillingPortalSession,
  getStripeSubscription,
  cancelSubscription,
  reactivateSubscription,
  changeSubscriptionPlan,
  applyReferralCredit,
  createStripeDiscount,
  validateDiscountCode,
  validateReferralCode,
  getStorePlan,
  getStoreUsage,
  hasFeatureAccess,
  getAllPlanLimits,
  generateReferralCode,
  getReferralStats,
  processReferralConversion,
  PLANS,
  getStripe,
};

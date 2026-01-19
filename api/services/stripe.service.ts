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
    apiVersion: '2025-02-24.acacia',
  });
  logger.info('BACKEND', '[Stripe] Initialized with API key');
} else {
  logger.warn('BACKEND', '[Stripe] STRIPE_SECRET_KEY not configured - billing features will be disabled');
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
    priceAnnual: 28800, // $288.00 ($24/mo)
    hasTrial: true,
    trialDays: 14,
  },
  growth: {
    name: 'Growth',
    description: 'Para negocios en expansión',
    priceMonthly: 7900, // $79.00 in cents
    priceAnnual: 79200, // $792.00 ($66/mo)
    hasTrial: true,
    trialDays: 14,
  },
  professional: {
    name: 'Professional',
    description: 'Para operaciones avanzadas',
    priceMonthly: 16900, // $169.00 in cents
    priceAnnual: 170400, // $1704.00 ($142/mo)
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
    annual: 'price_1SlGbh8jew17tEHtNxuLQI7Y',
  },
  growth: {
    monthly: 'price_1SkWhk8jew17tEHt5dTb8ra5',
    annual: 'price_1SlGbi8jew17tEHtrNgekJLu',
  },
  professional: {
    monthly: 'price_1SlGWI8jew17tEHtmMXcP9zG',
    annual: 'price_1SlGbk8jew17tEHtKaxvPuBc',
  },
};

// SECURITY: Reverse mapping from priceId to plan
// This is the SOURCE OF TRUTH for determining what plan a user paid for
// NEVER trust metadata - always use this mapping
const priceIdToPlan: Record<string, PlanType> = {
  // Starter
  'price_1SkWhi8jew17tEHtwMsLHYBE': 'starter',
  'price_1SlGbh8jew17tEHtNxuLQI7Y': 'starter',
  // Growth
  'price_1SkWhk8jew17tEHt5dTb8ra5': 'growth',
  'price_1SlGbi8jew17tEHtrNgekJLu': 'growth',
  // Professional
  'price_1SlGWI8jew17tEHtmMXcP9zG': 'professional',
  'price_1SlGbk8jew17tEHtKaxvPuBc': 'professional',
};

/**
 * SECURITY: Get plan from Stripe price ID
 * This is the ONLY trusted source for determining what plan a user paid for
 */
export function getPlanFromPriceId(priceId: string): PlanType | null {
  return priceIdToPlan[priceId] || null;
}

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
    logger.info('BACKEND', '[Stripe] Skipping initialization - not configured');
    return;
  }

  logger.info('BACKEND', '[Stripe] Verifying Stripe connection...');
  try {
    // Just verify we can connect to Stripe
    const products = await getStripe().products.list({ limit: 1 });
    logger.info('BACKEND', '[Stripe] Connection verified. Products available.');
    logger.info('BACKEND', '[Stripe] Using hardcoded price IDs from dashboard.');
  } catch (error) {
    logger.error('BACKEND', '[Stripe] Error connecting to Stripe:', error);
  }
}

/**
 * Get or create a Stripe customer for a user
 * Note: Changed from store-level to user-level in migration 052
 */
export async function getOrCreateCustomer(
  userId: string,
  email: string,
  name?: string
): Promise<string> {
  logger.info('BACKEND', '[Stripe] getOrCreateCustomer:', { userId, email });

  // Check if subscription record exists for this user
  const { data: subscription, error: subError } = await supabaseAdmin
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', userId)
    .eq('is_primary', true)
    .single();

  logger.info('BACKEND', '[Stripe] Subscription lookup result:', { subscription, error: subError?.message });

  // If subscription exists and has customer ID, return it
  if (subscription?.stripe_customer_id) {
    logger.info('BACKEND', '[Stripe] Returning existing customer:', subscription.stripe_customer_id);
    return subscription.stripe_customer_id;
  }

  // Create new Stripe customer
  logger.info('BACKEND', '[Stripe] Creating new Stripe customer...');
  const customer = await getStripe().customers.create({
    email,
    name,
    metadata: {
      user_id: userId,  // ⬅️ Changed from store_id to user_id
    },
  });
  logger.info('BACKEND', '[Stripe] Created customer:', customer.id);

  // If subscription record doesn't exist, create it
  if (subError?.code === 'PGRST116' || !subscription) {
    logger.info('BACKEND', '[Stripe] Creating new subscription record...');
    const { error: insertError } = await supabaseAdmin.from('subscriptions').insert({
      user_id: userId,  // ⬅️ Changed from store_id to user_id
      plan: 'free',
      status: 'active',
      stripe_customer_id: customer.id,
      is_primary: true,
    });
    if (insertError) {
      logger.error('BACKEND', '[Stripe] Error creating subscription:', insertError.message);
    }
  } else {
    // Update existing subscription with customer ID
    logger.info('BACKEND', '[Stripe] Updating existing subscription with customer ID...');
    const { error: updateError } = await supabaseAdmin
      .from('subscriptions')
      .update({ stripe_customer_id: customer.id })
      .eq('user_id', userId);  // ⬅️ Changed from store_id to user_id
    if (updateError) {
      logger.error('BACKEND', '[Stripe] Error updating subscription:', updateError.message);
    }
  }

  return customer.id;
}

/**
 * Check if user can start a trial for a plan
 * SECURITY: Only ONE trial per user (any plan) to prevent trial abuse
 */
export async function canStartTrial(
  userId: string,
  plan: PlanType
): Promise<boolean> {
  if (!PLANS[plan].hasTrial) {
    return false;
  }

  // SECURITY FIX: Check if user has EVER had ANY trial (not just this specific plan)
  // This prevents users from cycling through Starter trial -> Growth trial -> etc.
  const { data: existingTrials, error } = await supabaseAdmin
    .from('subscription_trials')
    .select('id, plan_tried')
    .eq('user_id', userId)
    .limit(1);

  if (error) {
    logger.error('BACKEND', '[Stripe] Error checking trial eligibility:', error.message);
    // SECURITY: Fail closed - deny trial if we can't verify
    return false;
  }

  // If user has ANY previous trial, deny new trial
  if (existingTrials && existingTrials.length > 0) {
    logger.info('BACKEND', '[Stripe] User already used trial:', { userId, previousPlan: existingTrials[0].plan_tried });
    return false;
  }

  return true;
}

/**
 * Create a checkout session for upgrading
 * Note: Now user-level subscription (covers all user's stores)
 */
export async function createCheckoutSession(params: {
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
    userId,
    email,
    plan,
    billingCycle,
    successUrl,
    cancelUrl,
    referralCode,
    discountCode,
  } = params;

  logger.info('BACKEND', '[Stripe] createCheckoutSession called:', { userId, email, plan, billingCycle });

  if (plan === 'free') {
    throw new Error('Cannot create checkout for free plan');
  }

  const priceId = stripePrices[plan]?.[billingCycle];
  logger.info('BACKEND', '[Stripe] Price ID for', plan, billingCycle, ':', priceId);
  if (!priceId) {
    throw new Error(`Price not found for ${plan} ${billingCycle}`);
  }

  // Get or create customer (now user-level)
  logger.info('BACKEND', '[Stripe] Getting or creating customer for user:', userId);
  const customerId = await getOrCreateCustomer(userId, email);
  logger.info('BACKEND', '[Stripe] Customer ID:', customerId);

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
      user_id: userId,  // ⬅️ Only user_id now, no store_id
      plan,
      billing_cycle: billingCycle,
      referral_code: referralCode || '',
      discount_code: discountCode || '',
    },
    subscription_data: {
      metadata: {
        user_id: userId,  // ⬅️ Only user_id now, no store_id
        plan,
      },
    },
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

  // Only allow promotion codes if no discounts are applied
  // (Stripe doesn't allow both at the same time)
  if (!sessionParams.discounts) {
    sessionParams.allow_promotion_codes = true;
  }

  const session = await getStripe().checkout.sessions.create(sessionParams);
  return session;
}

/**
 * Create a billing portal session for managing subscription
 * Note: Now user-level subscription
 */
export async function createBillingPortalSession(
  userId: string,
  returnUrl: string
): Promise<Stripe.BillingPortal.Session> {
  const { data: subscription } = await supabaseAdmin
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', userId)  // ⬅️ Changed from store_id to user_id
    .eq('is_primary', true)
    .single();

  if (!subscription?.stripe_customer_id) {
    throw new Error('No Stripe customer found for this user');
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
    logger.error('BACKEND', '[Stripe] Error fetching subscription:', error);
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
 * Get plan limits from database
 */
export async function getPlanLimits(plan: PlanType): Promise<{
  maxUsers: number;
  maxOrdersPerMonth: number;
  maxProducts: number;
  maxStores: number;
}> {
  const { data } = await supabaseAdmin
    .from('plan_limits')
    .select('max_users, max_orders_per_month, max_products, max_stores')
    .eq('plan', plan)
    .single();

  return {
    maxUsers: data?.max_users ?? 1,
    maxOrdersPerMonth: data?.max_orders_per_month ?? 50,
    maxProducts: data?.max_products ?? 100,
    maxStores: data?.max_stores ?? 1,
  };
}

/**
 * Validate downgrade is allowed (user doesn't exceed new plan limits)
 * SECURITY: Prevents users from keeping more resources than their plan allows
 */
export async function validatePlanChange(
  userId: string,
  currentPlan: PlanType,
  newPlan: PlanType
): Promise<{ allowed: boolean; reason?: string; details?: Record<string, any> }> {
  // Upgrades are always allowed
  const planOrder = { free: 0, starter: 1, growth: 2, professional: 3 };
  if (planOrder[newPlan] >= planOrder[currentPlan]) {
    return { allowed: true };
  }

  // For downgrades, validate current usage against new plan limits
  const newLimits = await getPlanLimits(newPlan);
  const usage = await getUserUsage(userId);

  const violations: string[] = [];

  // Check users limit
  if (newLimits.maxUsers !== -1 && usage.users.used > newLimits.maxUsers) {
    violations.push(`usuarios (tienes ${usage.users.used}, el plan ${newPlan} permite ${newLimits.maxUsers})`);
  }

  // Check products limit
  if (newLimits.maxProducts !== -1 && usage.products.used > newLimits.maxProducts) {
    violations.push(`productos (tienes ${usage.products.used}, el plan ${newPlan} permite ${newLimits.maxProducts})`);
  }

  // Check stores limit (for multi-store users)
  if (newLimits.maxStores !== -1 && usage.stores > newLimits.maxStores) {
    violations.push(`tiendas (tienes ${usage.stores}, el plan ${newPlan} permite ${newLimits.maxStores})`);
  }

  if (violations.length > 0) {
    return {
      allowed: false,
      reason: `Debes reducir: ${violations.join(', ')} antes de cambiar al plan ${newPlan}`,
      details: {
        currentUsage: {
          users: usage.users.used,
          products: usage.products.used,
          stores: usage.stores,
        },
        newLimits: {
          users: newLimits.maxUsers,
          products: newLimits.maxProducts,
          stores: newLimits.maxStores,
        },
      },
    };
  }

  return { allowed: true };
}

/**
 * Change subscription plan (upgrade/downgrade)
 * SECURITY: Validates downgrade limits before allowing plan change
 */
export async function changeSubscriptionPlan(
  subscriptionId: string,
  newPlan: PlanType,
  billingCycle: BillingCycle,
  userId?: string
): Promise<Stripe.Subscription> {
  const priceId = stripePrices[newPlan]?.[billingCycle];
  if (!priceId) {
    throw new Error(`Price not found for ${newPlan} ${billingCycle}`);
  }

  const stripeClient = getStripe();
  const subscription = await stripeClient.subscriptions.retrieve(subscriptionId);

  // SECURITY: Validate downgrade limits if userId is provided
  if (userId) {
    const currentPlan = getPlanFromPriceId(subscription.items.data[0]?.price.id) || 'free';
    const validation = await validatePlanChange(userId, currentPlan, newPlan);

    if (!validation.allowed) {
      throw new Error(validation.reason || 'Plan change not allowed');
    }
  }

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
 * Get current plan for a store (via owner's subscription)
 * Note: Store inherits plan from owner's user-level subscription
 */
export async function getStorePlan(storeId: string): Promise<{
  plan: PlanType;
  status: string;
  billingCycle: BillingCycle | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: Date | null;
}> {
  // Get store owner
  const { data: userStore } = await supabaseAdmin
    .from('user_stores')
    .select('user_id')
    .eq('store_id', storeId)
    .eq('role', 'owner')
    .eq('is_active', true)
    .single();

  if (!userStore) {
    // No owner found, return free plan
    return {
      plan: 'free',
      status: 'active',
      billingCycle: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      trialEndsAt: null,
    };
  }

  // Get owner's subscription
  const { data: subscription } = await supabaseAdmin
    .from('subscriptions')
    .select('*')
    .eq('user_id', userStore.user_id)
    .eq('is_primary', true)
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
 * Get user's subscription (all stores covered)
 * Note: New function for user-level subscriptions
 */
export async function getUserSubscription(userId: string): Promise<{
  plan: PlanType;
  status: string;
  billingCycle: BillingCycle | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: Date | null;
  storeCount: number;
  maxStores: number;
} | null> {
  const { data } = await supabaseAdmin.rpc('get_user_subscription', {
    p_user_id: userId,
  });

  if (!data || data.length === 0) {
    return null;
  }

  const sub = data[0];
  return {
    plan: sub.plan as PlanType,
    status: sub.status,
    billingCycle: sub.billing_cycle as BillingCycle | null,
    currentPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end) : null,
    cancelAtPeriodEnd: sub.cancel_at_period_end || false,
    trialEndsAt: sub.trial_ends_at ? new Date(sub.trial_ends_at) : null,
    storeCount: sub.store_count || 0,
    maxStores: sub.max_stores || 1,
  };
}

/**
 * Get user's aggregated usage across all stores
 * Note: New function for user-level subscriptions
 */
export async function getUserUsage(userId: string): Promise<{
  stores: number;
  maxStores: number;
  orders: { used: number; limit: number; percentage: number };
  products: { used: number; limit: number; percentage: number };
  users: { used: number; limit: number; percentage: number };
  storeDetails?: Array<{
    storeId: string;
    storeName: string;
    usersCount: number;
    ordersCount: number;
    productsCount: number;
  }>;
}> {
  try {
    const { data, error } = await supabaseAdmin.rpc('get_user_usage', {
      p_user_id: userId,
    });

    if (error) {
      logger.error('BACKEND', '[Stripe] Error getting user usage:', error.message);
      // Return defaults if RPC doesn't exist yet
      return {
        stores: 0,
        maxStores: 1,
        orders: { used: 0, limit: 50, percentage: 0 },
        products: { used: 0, limit: 100, percentage: 0 },
        users: { used: 0, limit: 1, percentage: 0 },
      };
    }

    if (!data || data.length === 0) {
      return {
        stores: 0,
        maxStores: 1,
        orders: { used: 0, limit: 50, percentage: 0 },
        products: { used: 0, limit: 100, percentage: 0 },
        users: { used: 0, limit: 1, percentage: 0 },
      };
    }

    const usage = data[0];

    // Calculate percentages
    const ordersPercentage = usage.max_orders_per_month === -1
      ? 0
      : Math.round((usage.total_orders_this_month / usage.max_orders_per_month) * 100);

    const productsPercentage = usage.max_products === -1
      ? 0
      : Math.round((usage.total_products / usage.max_products) * 100);

    const usersPercentage = usage.max_users === -1
      ? 0
      : Math.round((usage.total_users / usage.max_users) * 100);

    // Parse store details from JSONB
    let storeDetails = [];
    if (usage.stores && Array.isArray(usage.stores)) {
      storeDetails = usage.stores.map((s: any) => ({
        storeId: s.store_id,
        storeName: s.store_name,
        usersCount: s.users_count,
        ordersCount: s.orders_count,
        productsCount: s.products_count,
      }));
    }

    return {
      stores: usage.store_count || 0,
      maxStores: usage.max_stores === -1 ? Infinity : usage.max_stores,
      orders: {
        used: usage.total_orders_this_month || 0,
        limit: usage.max_orders_per_month === -1 ? Infinity : usage.max_orders_per_month,
        percentage: ordersPercentage,
      },
      products: {
        used: usage.total_products || 0,
        limit: usage.max_products === -1 ? Infinity : usage.max_products,
        percentage: productsPercentage,
      },
      users: {
        used: usage.total_users || 0,
        limit: usage.max_users === -1 ? Infinity : usage.max_users,
        percentage: usersPercentage,
      },
      storeDetails,
    };
  } catch (error: any) {
    logger.error('BACKEND', '[Stripe] Exception getting user usage:', error.message);
    return {
      stores: 0,
      maxStores: 1,
      orders: { used: 0, limit: 50, percentage: 0 },
      products: { used: 0, limit: 100, percentage: 0 },
      users: { used: 0, limit: 1, percentage: 0 },
    };
  }
}

/**
 * Get store usage stats (kept for backwards compatibility)
 * Note: This now returns usage for the specific store only
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
      logger.error('BACKEND', '[Stripe] Error getting store usage:', error.message);
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
    logger.error('BACKEND', '[Stripe] Exception getting store usage:', error.message);
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
  logger.info('BACKEND', '[Stripe] generateReferralCode for user:', userId);

  // Check if user already has a code
  const { data: existingCode, error: lookupError } = await supabaseAdmin
    .from('referral_codes')
    .select('code')
    .eq('user_id', userId)
    .single();

  // Handle case where table doesn't exist (42P01 = undefined_table)
  if (lookupError && lookupError.code === '42P01') {
    logger.warn('BACKEND', '[Stripe] referral_codes table does not exist - migration 036 may not be applied');
    // Return a placeholder code - referrals won't work but won't crash
    return 'PENDING';
  }

  if (lookupError && lookupError.code !== 'PGRST116') {
    // PGRST116 = no rows found, which is expected for new users
    logger.error('BACKEND', '[Stripe] Error looking up referral code:', lookupError.message, lookupError.code);
  }

  if (existingCode) {
    logger.info('BACKEND', '[Stripe] Found existing referral code:', existingCode.code);
    return existingCode.code;
  }

  // Generate a simple 6-char code (fallback that always works)
  const fallbackCode = Math.random().toString(36).substring(2, 8).toUpperCase();
  logger.info('BACKEND', '[Stripe] Generating new referral code:', fallbackCode);

  // Try RPC first, fall back to direct insert
  const { data: newCode, error: rpcError } = await supabaseAdmin.rpc('generate_referral_code');

  const codeToUse = rpcError ? fallbackCode : newCode;
  if (rpcError) {
    logger.info('BACKEND', '[Stripe] RPC generate_referral_code failed, using fallback:', rpcError.message);
  }

  // Insert new referral code
  const { error: insertError } = await supabaseAdmin.from('referral_codes').insert({
    user_id: userId,
    code: codeToUse,
  });

  if (insertError) {
    // If table doesn't exist, return placeholder
    if (insertError.code === '42P01') {
      logger.warn('BACKEND', '[Stripe] referral_codes table does not exist');
      return 'PENDING';
    }
    logger.error('BACKEND', '[Stripe] Error inserting referral code:', insertError.message);
    throw new Error(`Error al crear código de referido: ${insertError.message}`);
  }

  logger.info('BACKEND', '[Stripe] Created new referral code:', codeToUse);
  return codeToUse;
}

/**
 * Get user's referral stats with funnel metrics
 */
export async function getReferralStats(userId: string): Promise<{
  code: string;
  totalSignups: number;
  totalConversions: number;
  totalCreditsEarned: number;
  availableCredits: number;
  referrals: any[];
  funnel?: {
    totalRegistered: number;
    totalTrialsStarted: number;
    totalPaid: number;
    signupToTrialRate: number;
    trialToPaidRate: number;
  };
}> {
  logger.info('BACKEND', '[Stripe] getReferralStats for user:', userId);

  // Default response for when referrals are not available
  const defaultResponse = {
    code: 'PENDING',
    totalSignups: 0,
    totalConversions: 0,
    totalCreditsEarned: 0,
    availableCredits: 0,
    referrals: [],
  };

  // Get referral code
  const { data: referralCode, error: codeError } = await supabaseAdmin
    .from('referral_codes')
    .select('*')
    .eq('user_id', userId)
    .single();

  // Handle case where table doesn't exist
  if (codeError && codeError.code === '42P01') {
    logger.warn('BACKEND', '[Stripe] referral_codes table does not exist - migration 036 may not be applied');
    return defaultResponse;
  }

  if (codeError && codeError.code !== 'PGRST116') {
    logger.error('BACKEND', '[Stripe] Error getting referral code:', codeError.message, codeError.code);
  }

  if (!referralCode) {
    logger.info('BACKEND', '[Stripe] No referral code found, generating one...');
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

  logger.info('BACKEND', '[Stripe] Found referral code:', referralCode.code);

  // Get referrals (may fail if table doesn't exist)
  const { data: referrals, error: refError } = await supabaseAdmin
    .from('referrals')
    .select(`
      *,
      referred:referred_user_id (name, email)
    `)
    .eq('referral_code', referralCode.code)
    .order('created_at', { ascending: false });

  if (refError && refError.code !== '42P01') {
    logger.error('BACKEND', '[Stripe] Error getting referrals:', refError.message);
  }

  // Get available credits (may fail if function doesn't exist)
  const { data: availableCredits, error: creditsError } = await supabaseAdmin.rpc(
    'get_available_credits',
    { p_user_id: userId }
  );

  if (creditsError) {
    logger.info('BACKEND', '[Stripe] get_available_credits not available:', creditsError.message);
  }

  // Get funnel analytics (new in migration 037)
  const { data: funnelData, error: funnelError } = await supabaseAdmin.rpc(
    'get_referral_funnel',
    { p_user_id: userId }
  );

  let funnel = undefined;
  if (funnelData && funnelData.length > 0) {
    const f = funnelData[0];
    funnel = {
      totalRegistered: parseInt(f.total_registered, 10) || 0,
      totalTrialsStarted: parseInt(f.total_trials_started, 10) || 0,
      totalPaid: parseInt(f.total_paid, 10) || 0,
      signupToTrialRate: parseFloat(f.signup_to_trial_rate) || 0,
      trialToPaidRate: parseFloat(f.trial_to_paid_rate) || 0,
    };
  } else if (funnelError) {
    logger.info('BACKEND', '[Stripe] get_referral_funnel not available:', funnelError.message);
  }

  return {
    code: referralCode.code,
    totalSignups: referralCode.total_signups || 0, // Now = trials started (after migration 037)
    totalConversions: referralCode.total_conversions || 0,
    totalCreditsEarned: (referralCode.total_credits_earned_cents || 0) / 100,
    availableCredits: (availableCredits || 0) / 100,
    referrals: referrals || [],
    funnel,
  };
}

/**
 * Process referral after first payment
 * SECURITY: Credit is NOT applied immediately - requires 30-day waiting period
 * The cron job /cron/process-referral-credits handles actual credit application
 * This prevents abuse from users who cancel immediately after first payment
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

  // SECURITY: Only record the first payment date
  // Credit will be applied after 30-day waiting period by cron job
  // This prevents abuse from users who cancel immediately
  await supabaseAdmin
    .from('referrals')
    .update({
      first_payment_at: new Date().toISOString(),
      referred_plan: plan,
      // NOTE: referrer_credit_applied remains FALSE until cron processes it
    })
    .eq('id', referral.id);

  logger.info('BACKEND', `[Stripe] Referral conversion recorded for user ${referredUserId}. Credit pending 30-day waiting period.`);
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
  getUserSubscription,
  getUserUsage,
  getStorePlan,
  getStoreUsage,
  hasFeatureAccess,
  getAllPlanLimits,
  generateReferralCode,
  getReferralStats,
  processReferralConversion,
  getPlanFromPriceId,
  getPlanLimits,           // New: Get limits for a specific plan
  validatePlanChange,      // New: Validate downgrade is allowed
  PLANS,
  getStripe,
};

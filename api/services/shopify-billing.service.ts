import { logger } from '../utils/logger';
import axios from 'axios';
import { supabaseAdmin } from '../db/connection';

const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-10';
const API_URL = process.env.API_URL || 'https://api.ordefy.io';

// Plan prices in USD — must match PLANS in stripe.service.ts
const SHOPIFY_PLAN_PRICES: Record<string, { monthly: number; annual: number; name: string; trialDays: number }> = {
  starter:      { monthly: 29,  annual: 288,  name: 'Starter',      trialDays: 14 },
  growth:       { monthly: 79,  annual: 792,  name: 'Growth',       trialDays: 14 },
  professional: { monthly: 169, annual: 1704, name: 'Professional', trialDays: 0  },
};

export type ShopifyPlanType = 'starter' | 'growth' | 'professional';
export type ShopifyBillingCycle = 'monthly' | 'annual';

interface AppSubscriptionCreateResult {
  confirmationUrl: string;
  appSubscriptionId: string;
}

interface ActiveShopifySubscription {
  id: string;
  status: string;
  name: string;
  currentPeriodEnd: string | null;
  trialDays: number;
}

async function shopifyGraphQL<T = Record<string, unknown>>(
  shopDomain: string,
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const url = `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;

  const response = await axios.post<{ data?: T; errors?: unknown[] }>(
    url,
    { query, variables },
    {
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    }
  );

  if (response.data.errors?.length) {
    throw new Error(`Shopify GraphQL errors: ${JSON.stringify(response.data.errors)}`);
  }

  if (!response.data.data) {
    throw new Error('Empty data returned from Shopify GraphQL');
  }

  return response.data.data;
}

export async function createAppSubscription(params: {
  shopDomain: string;
  accessToken: string;
  plan: ShopifyPlanType;
  billingCycle: ShopifyBillingCycle;
  returnUrl: string;
  isTest?: boolean;
}): Promise<AppSubscriptionCreateResult> {
  const { shopDomain, accessToken, plan, billingCycle, returnUrl, isTest = false } = params;
  const planConfig = SHOPIFY_PLAN_PRICES[plan];

  if (!planConfig) {
    throw new Error(`Unknown plan: ${plan}`);
  }

  // Annual billing = one charge of full annual price
  // Monthly billing = recurring monthly charge
  const isAnnual = billingCycle === 'annual';
  const amount = isAnnual ? planConfig.annual : planConfig.monthly;
  const interval = isAnnual ? 'ANNUAL' : 'EVERY_30_DAYS';
  const planName = `Ordefy ${planConfig.name} (${isAnnual ? 'Annual' : 'Monthly'})`;

  const mutation = `
    mutation appSubscriptionCreate(
      $name: String!
      $returnUrl: URL!
      $trialDays: Int
      $test: Boolean
      $lineItems: [AppSubscriptionLineItemInput!]!
    ) {
      appSubscriptionCreate(
        name: $name
        returnUrl: $returnUrl
        trialDays: $trialDays
        test: $test
        lineItems: $lineItems
      ) {
        appSubscription {
          id
          status
        }
        confirmationUrl
        userErrors {
          field
          message
        }
      }
    }
  `;

  const variables = {
    name: planName,
    returnUrl,
    trialDays: planConfig.trialDays > 0 ? planConfig.trialDays : null,
    test: isTest,
    lineItems: [
      {
        plan: {
          appRecurringPricingDetails: {
            price: { amount: amount.toString(), currencyCode: 'USD' },
            interval,
          },
        },
      },
    ],
  };

  type MutationResult = {
    appSubscriptionCreate: {
      appSubscription: { id: string; status: string } | null;
      confirmationUrl: string | null;
      userErrors: { field: string; message: string }[];
    };
  };

  const data = await shopifyGraphQL<MutationResult>(shopDomain, accessToken, mutation, variables);
  const result = data.appSubscriptionCreate;

  if (result.userErrors.length > 0) {
    const messages = result.userErrors.map(e => `${e.field}: ${e.message}`).join(', ');
    throw new Error(`Shopify appSubscriptionCreate failed: ${messages}`);
  }

  if (!result.appSubscription?.id || !result.confirmationUrl) {
    throw new Error('Shopify returned no subscription ID or confirmation URL');
  }

  const gid = result.appSubscription.id;
  logger.info('SHOPIFY_BILLING', 'App subscription created', {
    shopDomain,
    gid,
    plan,
    billingCycle,
    amount,
  });

  return {
    appSubscriptionId: gid,
    confirmationUrl: result.confirmationUrl,
  };
}

export async function cancelAppSubscription(params: {
  shopDomain: string;
  accessToken: string;
  appSubscriptionId: string;
}): Promise<void> {
  const { shopDomain, accessToken, appSubscriptionId } = params;

  const mutation = `
    mutation appSubscriptionCancel($id: ID!) {
      appSubscriptionCancel(id: $id) {
        appSubscription {
          id
          status
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  type CancelResult = {
    appSubscriptionCancel: {
      appSubscription: { id: string; status: string } | null;
      userErrors: { field: string; message: string }[];
    };
  };

  const data = await shopifyGraphQL<CancelResult>(shopDomain, accessToken, mutation, {
    id: appSubscriptionId,
  });

  const result = data.appSubscriptionCancel;

  if (result.userErrors.length > 0) {
    const messages = result.userErrors.map(e => `${e.field}: ${e.message}`).join(', ');
    throw new Error(`Shopify appSubscriptionCancel failed: ${messages}`);
  }

  logger.info('SHOPIFY_BILLING', 'App subscription cancelled', {
    shopDomain,
    appSubscriptionId,
    status: result.appSubscription?.status,
  });
}

export async function getActiveAppSubscription(params: {
  shopDomain: string;
  accessToken: string;
}): Promise<ActiveShopifySubscription | null> {
  const { shopDomain, accessToken } = params;

  const query = `
    query {
      currentAppInstallation {
        activeSubscriptions {
          id
          name
          status
          currentPeriodEnd
          trialDays
        }
      }
    }
  `;

  type QueryResult = {
    currentAppInstallation: {
      activeSubscriptions: {
        id: string;
        name: string;
        status: string;
        currentPeriodEnd: string | null;
        trialDays: number;
      }[];
    };
  };

  const data = await shopifyGraphQL<QueryResult>(shopDomain, accessToken, query);
  const subs = data.currentAppInstallation.activeSubscriptions;

  if (!subs.length) return null;

  return {
    id: subs[0].id,
    status: subs[0].status,
    name: subs[0].name,
    currentPeriodEnd: subs[0].currentPeriodEnd,
    trialDays: subs[0].trialDays,
  };
}

export function parsePlanFromSubscriptionName(name: string): ShopifyPlanType | null {
  const lower = name.toLowerCase();
  if (lower.includes('professional')) return 'professional';
  if (lower.includes('growth')) return 'growth';
  if (lower.includes('starter')) return 'starter';
  return null;
}

export async function getShopifyAccessToken(shopDomain: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('shopify_integrations')
    .select('access_token')
    .eq('shop_domain', shopDomain)
    .eq('status', 'active')
    .single();

  return data?.access_token ?? null;
}

export function buildBillingReturnUrl(storeId: string): string {
  return `${API_URL}/api/shopify-billing/confirm?store_id=${storeId}`;
}

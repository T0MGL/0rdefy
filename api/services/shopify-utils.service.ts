// ================================================================
// SHOPIFY UTILS
// ================================================================
// Stateless helpers shared between webhook handlers and other Shopify
// integration code. Lives in its own module so we can delete the
// (obsolete) shopify-billing.service.ts without orphaning these
// imports.
//
// Author: Bright Idea
// Date:   2026-05-16
// ================================================================

import { supabaseAdmin } from '../db/connection';

export type ShopifyPlanType = 'starter' | 'growth' | 'professional';

/**
 * Best-effort: extract a known Ordefy plan name from a free-form
 * Shopify subscription title. Used by the defensive
 * app/subscriptions/update webhook handler, which is wired in case
 * Shopify ever sends a billing event for this app even though we
 * publish as Free in the App Store.
 */
export function parsePlanFromSubscriptionName(name: string): ShopifyPlanType | null {
  const lower = name.toLowerCase();
  if (lower.includes('professional')) return 'professional';
  if (lower.includes('growth')) return 'growth';
  if (lower.includes('starter')) return 'starter';
  return null;
}

/**
 * Look up the active Shopify access token for a shop domain. Returns
 * null when no active integration is found. Caller is responsible for
 * handling the null case (typically: 404 or kick off Token Exchange).
 */
export async function getShopifyAccessToken(shopDomain: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('shopify_integrations')
    .select('access_token')
    .eq('shop_domain', shopDomain)
    .eq('status', 'active')
    .single();

  return data?.access_token ?? null;
}

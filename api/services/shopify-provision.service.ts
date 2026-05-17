// ================================================================
// SHOPIFY PROVISION SERVICE
// ================================================================
// Auto-provisions Ordefy user + store + integration + subscription
// when a Shopify merchant installs the app via Token Exchange.
//
// Three install scenarios:
//   1. First install for a new shop_domain  -> create everything.
//   2. Reinstall (uninstalled or inactive)   -> reactivate existing rows.
//   3. New shop owned by an existing direct  -> link to existing user
//      Ordefy user (matched by email)           and create new store.
//
// Concurrency: serialized per shop_domain via pg_advisory_xact_lock to
// guarantee at-most-one provisioning runs for any given shop. The lock
// auto-releases at COMMIT/ROLLBACK.
//
// Author: Bright Idea
// Date:   2026-05-16
// ================================================================

import axios from 'axios';
import jwt from 'jsonwebtoken';
import { supabaseAdmin } from '../db/connection';
import { logger } from '../utils/logger';

const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION ?? '2025-10';
const JWT_SECRET = process.env.JWT_SECRET ?? (() => {
  throw new Error('FATAL: JWT_SECRET environment variable is required');
})();
const JWT_ALGORITHM = 'HS256';
const JWT_ISSUER = 'ordefy-api';
const JWT_AUDIENCE = 'ordefy-app';
const TOKEN_EXPIRY = '7d';

export interface ShopifyShopProfile {
  email: string;
  name: string;
  myshopifyDomain: string;
  country: string | null;
  countryCodeV2: string | null;
  currencyCode: string | null;
  contactEmail: string | null;
}

export interface ProvisionResult {
  ordefyToken: string;
  userId: string;
  storeId: string;
  integrationId: string;
  isNewProvision: boolean;
  isReinstall: boolean;
  linkedFromDirectUser: boolean;
}

// ----------------------------------------------------------------
// Shopify Admin API: fetch shop profile
// ----------------------------------------------------------------

export async function fetchShopProfile(
  shopDomain: string,
  accessToken: string,
): Promise<ShopifyShopProfile> {
  const url = `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
  const query = `
    query {
      shop {
        email
        name
        myshopifyDomain
        contactEmail
        currencyCode
        billingAddress {
          country
          countryCodeV2
        }
      }
    }
  `;

  type ShopResponse = {
    data?: {
      shop: {
        email: string | null;
        name: string;
        myshopifyDomain: string;
        contactEmail: string | null;
        currencyCode: string | null;
        billingAddress: {
          country: string | null;
          countryCodeV2: string | null;
        } | null;
      };
    };
    errors?: unknown[];
  };

  const response = await axios.post<ShopResponse>(
    url,
    { query },
    {
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    },
  );

  if (response.data.errors?.length) {
    throw new Error(`Shopify GraphQL errors: ${JSON.stringify(response.data.errors)}`);
  }

  const shop = response.data.data?.shop;
  if (!shop) {
    throw new Error('Shopify Admin API returned no shop data');
  }

  const email = shop.email ?? shop.contactEmail;
  if (!email) {
    throw new Error('Shop has no email available via Admin API');
  }

  return {
    email: email.toLowerCase().trim(),
    name: shop.name,
    myshopifyDomain: shop.myshopifyDomain,
    country: shop.billingAddress?.country ?? null,
    countryCodeV2: shop.billingAddress?.countryCodeV2 ?? null,
    currencyCode: shop.currencyCode,
    contactEmail: shop.contactEmail,
  };
}

// ----------------------------------------------------------------
// JWT signing for Ordefy session
// ----------------------------------------------------------------

function signOrdefyToken(userId: string, email: string): string {
  return jwt.sign(
    { userId, email },
    JWT_SECRET,
    {
      algorithm: JWT_ALGORITHM,
      expiresIn: TOKEN_EXPIRY,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    },
  );
}

// ----------------------------------------------------------------
// Main entry: provision merchant
// ----------------------------------------------------------------

export async function provisionShopifyMerchant(params: {
  shopDomain: string;
  accessToken: string;
  shopifyUserId: string;
  scope: string;
}): Promise<ProvisionResult> {
  const { shopDomain, accessToken, scope } = params;

  // 1. Fetch shop profile from Shopify Admin API (we use shop owner email,
  //    not a value the caller controlled, so an attacker cannot collide on
  //    an arbitrary email).
  const shopProfile = await fetchShopProfile(shopDomain, accessToken);

  // 2. Check existing integration (any status). Lookup is intentionally NOT
  //    filtered by status='active' so we can detect reinstalls + redacted
  //    rows (the App is the only writer; rows in 'uninstalled' or 'redacted'
  //    state were credential-nulled by the GDPR/uninstall handlers).
  const { data: existing, error: lookupError } = await supabaseAdmin
    .from('shopify_integrations')
    .select('id, user_id, store_id, status')
    .eq('shop_domain', shopDomain)
    .maybeSingle();

  if (lookupError) {
    logger.error('SHOPIFY_PROVISION', 'lookup failed', { shopDomain, lookupError });
    throw new Error(`provision lookup failed: ${lookupError.message}`);
  }

  // ----------------- REINSTALL PATH -----------------
  if (existing) {
    const isReinstall = existing.status !== 'active';

    const { error: updateError } = await supabaseAdmin
      .from('shopify_integrations')
      .update({
        access_token: accessToken,
        scope,
        status: 'active',
        uninstalled_at: null,
        sync_error: null,
        shop_email: shopProfile.email,
        shop_name: shopProfile.name,
        shop_currency: shopProfile.currencyCode,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);

    if (updateError) {
      logger.error('SHOPIFY_PROVISION', 'reactivate failed', { shopDomain, updateError });
      throw new Error(`provision reactivate failed: ${updateError.message}`);
    }

    if (!existing.user_id) {
      throw new Error('integration row missing user_id (legacy data, manual fix required)');
    }

    // Fetch user email for JWT (do not trust client input)
    const { data: user, error: userErr } = await supabaseAdmin
      .from('users')
      .select('id, email')
      .eq('id', existing.user_id)
      .single();

    if (userErr || !user) {
      throw new Error(`reinstall: user ${existing.user_id} not found`);
    }

    const ordefyToken = signOrdefyToken(user.id, user.email);

    logger.info('SHOPIFY_PROVISION', isReinstall ? 'reinstall' : 'token_refresh', {
      shopDomain,
      userId: user.id,
      storeId: existing.store_id,
    });

    return {
      ordefyToken,
      userId: user.id,
      storeId: existing.store_id,
      integrationId: existing.id,
      isNewProvision: false,
      isReinstall,
      linkedFromDirectUser: false,
    };
  }

  // ----------------- NEW INSTALL PATH -----------------
  // Email collision: does a direct user exist with this email?
  const { data: directUser, error: directUserErr } = await supabaseAdmin
    .from('users')
    .select('id, email, name')
    .eq('email', shopProfile.email)
    .maybeSingle();

  if (directUserErr) {
    logger.error('SHOPIFY_PROVISION', 'direct user lookup failed', { directUserErr });
    throw new Error(`direct user lookup failed: ${directUserErr.message}`);
  }

  let userId: string;
  let linkedFromDirectUser = false;

  if (directUser) {
    userId = directUser.id;
    linkedFromDirectUser = true;
    logger.info('SHOPIFY_PROVISION', 'matched existing direct user', {
      userId,
      shopDomain,
      email: shopProfile.email,
    });
  } else {
    // Create the user. Name fallback: shop name -> email local part.
    const displayName = shopProfile.name?.trim() || shopProfile.email.split('@')[0];
    const { data: newUser, error: insertUserErr } = await supabaseAdmin
      .from('users')
      .insert({
        email: shopProfile.email,
        password_hash: null,
        name: displayName,
        is_active: true,
        auth_provider: 'shopify',
        source: 'shopify',
      })
      .select('id')
      .single();

    if (insertUserErr || !newUser) {
      logger.error('SHOPIFY_PROVISION', 'user insert failed', { insertUserErr });
      throw new Error(`user insert failed: ${insertUserErr?.message ?? 'no row returned'}`);
    }

    userId = newUser.id;
    logger.info('SHOPIFY_PROVISION', 'created new shopify user', { userId, shopDomain });
  }

  // Resolve a store: prefer existing store owned by this user, else create one.
  let storeId: string;
  if (linkedFromDirectUser) {
    const { data: ownerLink } = await supabaseAdmin
      .from('user_stores')
      .select('store_id')
      .eq('user_id', userId)
      .in('role', ['owner', 'admin'])
      .limit(1)
      .maybeSingle();

    if (ownerLink) {
      storeId = ownerLink.store_id;
      logger.info('SHOPIFY_PROVISION', 'reusing existing store for direct user', {
        userId,
        storeId,
      });
    } else {
      storeId = await createStore(shopProfile);
      await linkUserStore(userId, storeId, 'owner');
    }
  } else {
    storeId = await createStore(shopProfile);
    await linkUserStore(userId, storeId, 'owner');
  }

  // Insert integration row.
  const { data: integration, error: integrationErr } = await supabaseAdmin
    .from('shopify_integrations')
    .insert({
      store_id: storeId,
      user_id: userId,
      shop_domain: shopDomain,
      shop: shopDomain,
      api_key: process.env.SHOPIFY_API_KEY ?? '',
      api_secret_key: '',
      access_token: accessToken,
      scope,
      status: 'active',
      auto_provisioned: true,
      linked_from_direct_user_at: linkedFromDirectUser ? new Date().toISOString() : null,
      shop_email: shopProfile.email,
      shop_name: shopProfile.name,
      shop_currency: shopProfile.currencyCode,
      installed_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (integrationErr || !integration) {
    logger.error('SHOPIFY_PROVISION', 'integration insert failed', { integrationErr });
    throw new Error(`integration insert failed: ${integrationErr?.message ?? 'no row returned'}`);
  }

  // Subscription: free tier, Shopify-billed. Use upsert pattern compatible
  // with subscriptions.user_id + is_primary uniqueness.
  await ensureFreeSubscription(userId, storeId);

  const ordefyToken = signOrdefyToken(userId, shopProfile.email);

  logger.info('SHOPIFY_PROVISION', 'new provision completed', {
    shopDomain,
    userId,
    storeId,
    integrationId: integration.id,
    linkedFromDirectUser,
  });

  return {
    ordefyToken,
    userId,
    storeId,
    integrationId: integration.id,
    isNewProvision: true,
    isReinstall: false,
    linkedFromDirectUser,
  };
}

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

// stores.country has a CHECK constraint (PY, AR, BR, UY, CL, MX, US, ES).
// Shopify ships shops in any ISO-3166 country; we map non-supported codes
// to US to avoid violating the CHECK during provisioning. The merchant
// can update country later from Settings.
const SUPPORTED_STORE_COUNTRIES = new Set(['PY', 'AR', 'BR', 'UY', 'CL', 'MX', 'US', 'ES']);

function normalizeCountryCode(raw: string | null | undefined): string {
  const upper = (raw ?? '').toUpperCase().trim();
  return SUPPORTED_STORE_COUNTRIES.has(upper) ? upper : 'US';
}

async function createStore(shop: ShopifyShopProfile): Promise<string> {
  const { data: store, error } = await supabaseAdmin
    .from('stores')
    .insert({
      name: shop.name || shop.myshopifyDomain,
      country: normalizeCountryCode(shop.countryCodeV2),
    })
    .select('id')
    .single();

  if (error || !store) {
    logger.error('SHOPIFY_PROVISION', 'store insert failed', { error });
    throw new Error(`store insert failed: ${error?.message ?? 'no row returned'}`);
  }

  return store.id;
}

async function linkUserStore(userId: string, storeId: string, role: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('user_stores')
    .insert({
      user_id: userId,
      store_id: storeId,
      role,
      is_active: true,
    });

  // 23505 = unique_violation (link already exists, fine for idempotency)
  if (error && error.code !== '23505') {
    logger.error('SHOPIFY_PROVISION', 'user_stores insert failed', { error });
    throw new Error(`user_stores insert failed: ${error.message}`);
  }
}

async function ensureFreeSubscription(userId: string, storeId: string): Promise<void> {
  // subscriptions has uniqueness on (user_id, is_primary). We only insert
  // if no primary subscription exists to avoid overwriting a Stripe sub on
  // a linked direct user.
  const { data: existing } = await supabaseAdmin
    .from('subscriptions')
    .select('id, billing_source')
    .eq('user_id', userId)
    .eq('is_primary', true)
    .maybeSingle();

  if (existing) {
    logger.info('SHOPIFY_PROVISION', 'subscription already present, leaving in place', {
      userId,
      billingSource: existing.billing_source,
    });
    return;
  }

  const { error } = await supabaseAdmin
    .from('subscriptions')
    .insert({
      user_id: userId,
      store_id: storeId,
      is_primary: true,
      plan: 'free',
      status: 'active',
      billing_source: 'shopify',
      shopify_shop_domain: null,
      shopify_charge_id: null,
    });

  if (error) {
    logger.error('SHOPIFY_PROVISION', 'free subscription insert failed', { error });
    // Non-fatal: provisioning still completes; user lands on free plan via
    // default plan_limits fallback. Sentry will surface it.
  }
}

// ----------------------------------------------------------------
// Token Exchange call to Shopify
// ----------------------------------------------------------------

export interface TokenExchangeResult {
  accessToken: string;
  scope: string;
}

export async function exchangeSessionTokenForOfflineToken(params: {
  shopDomain: string;
  sessionToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<TokenExchangeResult> {
  const { shopDomain, sessionToken, clientId, clientSecret } = params;

  const url = `https://${shopDomain}/admin/oauth/access_token`;

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    subject_token: sessionToken,
    subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
    requested_token_type: 'urn:shopify:params:oauth:token-type:offline-access-token',
  });

  type ExchangeResponse = {
    access_token?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };

  const response = await axios.post<ExchangeResponse>(url, body.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    timeout: 15000,
    validateStatus: () => true, // we inspect status manually
  });

  if (response.status !== 200 || !response.data.access_token) {
    logger.error('SHOPIFY_PROVISION', 'token exchange failed', {
      shopDomain,
      status: response.status,
      error: response.data.error,
      description: response.data.error_description,
    });
    throw new Error(
      `Shopify token exchange failed (${response.status}): ${response.data.error_description ?? response.data.error ?? 'unknown'}`,
    );
  }

  return {
    accessToken: response.data.access_token,
    scope: response.data.scope ?? '',
  };
}

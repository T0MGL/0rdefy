// ================================================================
// SHOPIFY PROVISION SERVICE
// ================================================================
// Auto-provisions Ordefy user + store + integration + subscription
// when a Shopify merchant installs the app via Token Exchange.
//
// This module owns the two pieces that must run outside the database:
// the Shopify Admin API call (fetchShopProfile), the Token Exchange call,
// and signing the Ordefy JWT. The provisioning writes themselves
// (user + store + user_stores + integration + subscription across the
// three install scenarios) run atomically inside the Postgres function
// provision_shopify_merchant (migration 201), invoked here via a single
// supabaseAdmin.rpc(). That function serializes concurrent installs of
// the same shop with pg_advisory_xact_lock and rolls back on any failure,
// so a mid-way error can no longer orphan a half-created user/store.
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

interface ProvisionRpcRow {
  user_id: string;
  store_id: string;
  integration_id: string;
  user_email: string;
  is_new_provision: boolean;
  is_reinstall: boolean;
  linked_from_direct_user: boolean;
}

export async function provisionShopifyMerchant(params: {
  shopDomain: string;
  accessToken: string;
  shopifyUserId: string;
  scope: string;
}): Promise<ProvisionResult> {
  const { shopDomain, accessToken, scope } = params;

  // Fetch the shop profile from the Shopify Admin API. We key provisioning
  // on the shop owner email returned by Shopify, never a caller-controlled
  // value, so an attacker cannot collide on an arbitrary email.
  const shopProfile = await fetchShopProfile(shopDomain, accessToken);

  // Run the entire provisioning flow (lookup + reinstall vs new install +
  // user/store/link/integration/subscription) atomically inside Postgres.
  // The function serializes concurrent installs of this shop and rolls back
  // on any failure, so a partial provision cannot orphan rows.
  const { data, error } = await supabaseAdmin.rpc('provision_shopify_merchant', {
    p_shop_domain: shopDomain,
    p_access_token: accessToken,
    p_scope: scope,
    p_shop_email: shopProfile.email,
    p_shop_name: shopProfile.name,
    p_shop_currency: shopProfile.currencyCode,
    p_country_code: shopProfile.countryCodeV2,
    p_shopify_api_key: process.env.SHOPIFY_API_KEY ?? '',
  });

  if (error) {
    logger.error('SHOPIFY_PROVISION', 'provision rpc failed', { shopDomain, error });
    throw new Error(`provision failed: ${error.message}`);
  }

  // The function RETURNS TABLE(...) so the client hands back a row array.
  const row = (data as ProvisionRpcRow[] | null)?.[0];
  if (!row) {
    throw new Error('provision rpc returned no row');
  }

  const ordefyToken = signOrdefyToken(row.user_id, row.user_email);

  logger.info(
    'SHOPIFY_PROVISION',
    row.is_new_provision ? 'new provision completed' : row.is_reinstall ? 'reinstall' : 'token_refresh',
    {
      shopDomain,
      userId: row.user_id,
      storeId: row.store_id,
      integrationId: row.integration_id,
      linkedFromDirectUser: row.linked_from_direct_user,
    },
  );

  return {
    ordefyToken,
    userId: row.user_id,
    storeId: row.store_id,
    integrationId: row.integration_id,
    isNewProvision: row.is_new_provision,
    isReinstall: row.is_reinstall,
    linkedFromDirectUser: row.linked_from_direct_user,
  };
}

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

// stores.country has a CHECK constraint (PY, AR, BR, UY, CL, MX, US, ES).
// Shopify ships shops in any ISO-3166 country; we map non-supported codes
// to US to avoid violating the CHECK during provisioning. The merchant
// can update country later from Settings.
export const SUPPORTED_STORE_COUNTRIES = new Set(['PY', 'AR', 'BR', 'UY', 'CL', 'MX', 'US', 'ES']);

export function normalizeCountryCode(raw: string | null | undefined): string {
  const upper = (raw ?? '').toUpperCase().trim();
  return SUPPORTED_STORE_COUNTRIES.has(upper) ? upper : 'US';
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

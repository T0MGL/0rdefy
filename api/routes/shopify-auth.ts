// ================================================================
// SHOPIFY AUTH (Token Exchange + Managed Install)
// ================================================================
// POST /api/shopify/auth/token-exchange
//
// Called by the embedded frontend after App Bridge issues a session
// token. Exchanges that token for an offline access token with Shopify,
// then provisions (or reactivates) the merchant's Ordefy account and
// returns an Ordefy JWT.
//
// Feature-flagged behind SHOPIFY_TOKEN_EXCHANGE_ENABLED so we can
// roll back instantly without redeploy if Day-12 submit reveals a
// regression.
//
// Author: Bright Idea
// Date:   2026-05-16
// ================================================================

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger';
import { supabaseAdmin } from '../db/connection';
import {
  exchangeSessionTokenForOfflineToken,
  provisionShopifyMerchant,
} from '../services/shopify-provision.service';

export const shopifyAuthRouter = Router();

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;
const FEATURE_ENABLED =
  (process.env.SHOPIFY_TOKEN_EXCHANGE_ENABLED ?? 'false').toLowerCase() === 'true';

const log = logger.child('SHOPIFY_AUTH');

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

const BodySchema = z.object({
  session_token: z.string().min(20),
});

const QuerySchema = z.object({
  shop: z
    .string()
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/, 'invalid shop domain')
    .optional(),
});

interface ShopifySessionTokenClaims {
  iss: string;
  dest: string;
  aud: string;
  sub: string;
  exp: number;
  nbf: number;
  iat: number;
  jti: string;
  sid: string;
}

function verifySessionToken(token: string): ShopifySessionTokenClaims {
  if (!SHOPIFY_API_SECRET || !SHOPIFY_API_KEY) {
    throw new Error('shopify_api_secret_not_configured');
  }

  const decoded = jwt.verify(token, SHOPIFY_API_SECRET, {
    algorithms: ['HS256'],
    audience: SHOPIFY_API_KEY,
  }) as ShopifySessionTokenClaims;

  if (!decoded.dest || !decoded.sub || !decoded.aud) {
    throw new Error('invalid_session_token_claims');
  }

  if (decoded.aud !== SHOPIFY_API_KEY) {
    throw new Error('audience_mismatch');
  }

  return decoded;
}

async function recordAttempt(params: {
  shopDomain: string;
  phase:
    | 'session_token_received'
    | 'token_exchange'
    | 'provision'
    | 'login_redirect'
    | 'dashboard_loaded'
    | 'error';
  userAgent?: string;
  responseStatus?: number;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await supabaseAdmin.from('shopify_install_attempts').insert({
      shop_domain: params.shopDomain,
      attempt_phase: params.phase,
      user_agent: params.userAgent ?? null,
      response_status: params.responseStatus ?? null,
      error_message: params.errorMessage ?? null,
      metadata: params.metadata ?? null,
    });
  } catch (err) {
    // Audit log must never block the install flow.
    log.warn('Failed to write install attempt', { phase: params.phase, err });
  }
}

// ----------------------------------------------------------------
// Route
// ----------------------------------------------------------------

shopifyAuthRouter.post('/token-exchange', async (req: Request, res: Response) => {
  if (!FEATURE_ENABLED) {
    return res.status(503).json({
      error: 'token_exchange_disabled',
      message: 'Shopify Token Exchange is currently disabled by feature flag.',
    });
  }

  if (!SHOPIFY_API_KEY || !SHOPIFY_API_SECRET) {
    log.error('Shopify credentials not configured');
    return res.status(500).json({ error: 'shopify_not_configured' });
  }

  // Parse + validate input
  const bodyParse = BodySchema.safeParse(req.body);
  if (!bodyParse.success) {
    return res.status(400).json({
      error: 'invalid_body',
      details: bodyParse.error.flatten(),
    });
  }
  const queryParse = QuerySchema.safeParse(req.query);
  if (!queryParse.success) {
    return res.status(400).json({
      error: 'invalid_query',
      details: queryParse.error.flatten(),
    });
  }

  const { session_token: sessionToken } = bodyParse.data;
  const userAgent = req.get('User-Agent') ?? undefined;

  // Verify session token signature + claims
  let claims: ShopifySessionTokenClaims;
  try {
    claims = verifySessionToken(sessionToken);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    log.warn('session token verification failed', { reason: msg });
    await recordAttempt({
      shopDomain: queryParse.data.shop ?? 'unknown',
      phase: 'error',
      userAgent,
      responseStatus: 400,
      errorMessage: `session_token_invalid: ${msg}`,
    });
    return res.status(400).json({ error: 'invalid_session_token', reason: msg });
  }

  const shopDomain = claims.dest.replace(/^https?:\/\//, '');

  // Sanity check: query.shop matches token.dest when both provided.
  if (queryParse.data.shop && queryParse.data.shop !== shopDomain) {
    log.warn('shop mismatch between query and token', {
      query: queryParse.data.shop,
      token: shopDomain,
    });
    return res.status(400).json({ error: 'shop_mismatch' });
  }

  await recordAttempt({
    shopDomain,
    phase: 'session_token_received',
    userAgent,
    metadata: { sub: claims.sub },
  });

  // Token Exchange with Shopify
  let exchangeResult;
  try {
    exchangeResult = await exchangeSessionTokenForOfflineToken({
      shopDomain,
      sessionToken,
      clientId: SHOPIFY_API_KEY,
      clientSecret: SHOPIFY_API_SECRET,
    });

    await recordAttempt({
      shopDomain,
      phase: 'token_exchange',
      userAgent,
      responseStatus: 200,
      metadata: { scope_count: exchangeResult.scope.split(',').length },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    log.error('token exchange failed', { shopDomain, msg });
    await recordAttempt({
      shopDomain,
      phase: 'error',
      userAgent,
      responseStatus: 502,
      errorMessage: `token_exchange_failed: ${msg}`,
    });
    return res.status(502).json({ error: 'token_exchange_failed', reason: msg });
  }

  // Provision (or reactivate) the merchant
  try {
    const result = await provisionShopifyMerchant({
      shopDomain,
      accessToken: exchangeResult.accessToken,
      shopifyUserId: claims.sub,
      scope: exchangeResult.scope,
    });

    await recordAttempt({
      shopDomain,
      phase: 'provision',
      userAgent,
      responseStatus: 200,
      metadata: {
        isNewProvision: result.isNewProvision,
        isReinstall: result.isReinstall,
        linkedFromDirectUser: result.linkedFromDirectUser,
      },
    });

    return res.json({
      ordefyToken: result.ordefyToken,
      userId: result.userId,
      storeId: result.storeId,
      isNewProvision: result.isNewProvision,
      isReinstall: result.isReinstall,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    log.error('provision failed', { shopDomain, msg });
    await recordAttempt({
      shopDomain,
      phase: 'error',
      userAgent,
      responseStatus: 503,
      errorMessage: `provision_failed: ${msg}`,
    });
    return res.status(503).json({ error: 'provision_failed', reason: msg });
  }
});

// Health check (no secret data leaked).
shopifyAuthRouter.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    feature_enabled: FEATURE_ENABLED,
    api_key_configured: !!SHOPIFY_API_KEY,
    timestamp: new Date().toISOString(),
  });
});

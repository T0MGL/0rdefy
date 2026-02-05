// ================================================================
// SHOPIFY OAUTH ROUTES
// ================================================================
// Handles Shopify OAuth 2.0 flow for app installation
// Flow: GET /auth → Shopify login → GET /callback → Store token
// ================================================================

import { logger } from '../utils/logger';
import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import axios from 'axios';
import { supabaseAdmin } from '../db/connection';

export const shopifyOAuthRouter = Router();

// ================================================================
// ENVIRONMENT VARIABLES
// ================================================================
const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;
const SHOPIFY_SCOPES = process.env.SHOPIFY_SCOPES || 'read_products,write_products,read_orders,write_orders,read_customers,write_customers';
const SHOPIFY_REDIRECT_URI = process.env.SHOPIFY_REDIRECT_URI;
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-10';
const APP_URL = process.env.APP_URL || 'http://localhost:8080';
const API_URL = process.env.API_URL || 'http://localhost:3001';

// ================================================================
// WEBHOOK REGISTRATION
// ================================================================
// Topics to register when OAuth is completed
// IMPORTANT: Must match shopify.app.toml [webhooks.subscriptions]
// GDPR webhooks (customers/data_request, customers/redact, shop/redact)
// are configured via shopify.app.toml compliance_topics, NOT here
// ================================================================
const WEBHOOK_TOPICS = [
  'orders/create',      // New order created → api.ordefy.io/api/shopify/webhook/orders-create
  'orders/updated',     // Order updated → api.ordefy.io/api/shopify/webhook/orders-updated
  'products/delete',    // Product deleted → api.ordefy.io/api/shopify/webhook/products-delete
  'app/uninstalled'     // App uninstalled → api.ordefy.io/api/shopify/webhook/app-uninstalled
];

/**
 * Register all Shopify webhooks after OAuth completion
 * @param shop Shop domain (e.g., mystore.myshopify.com)
 * @param accessToken OAuth access token
 * @param integrationId UUID of the shopify_integrations record
 * @param grantedScopes Scopes granted by Shopify (comma-separated)
 * @returns Object with success count, failed count, and error details
 */
async function registerShopifyWebhooks(
  shop: string,
  accessToken: string,
  integrationId: string,
  grantedScopes?: string
): Promise<{ success: number; failed: number; errors: string[] }> {
  const baseUrl = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/webhooks.json`;
  const results = {
    success: 0,
    failed: 0,
    errors: [] as string[]
  };

  logger.info('API', `🔧 [SHOPIFY-WEBHOOKS] Starting webhook registration for ${shop}...`);
  logger.info('API', `🔐 [SHOPIFY-WEBHOOKS] Granted scopes: ${grantedScopes || 'unknown'}`);
  logger.info('API', `🔗 [SHOPIFY-WEBHOOKS] API URL: ${API_URL}`);
  logger.info('API', `📋 [SHOPIFY-WEBHOOKS] Topics to register: ${WEBHOOK_TOPICS.join(', ')}`);

  // Verify required scopes are present
  const requiredScopes = ['write_orders', 'write_products'];
  if (grantedScopes) {
    const scopeArray = grantedScopes.split(',').map(s => s.trim());
    const missingScopes = requiredScopes.filter(scope => !scopeArray.includes(scope));

    if (missingScopes.length > 0) {
      logger.warn('API', `⚠️  [SHOPIFY-WEBHOOKS] Missing required scopes: ${missingScopes.join(', ')}`);
      logger.warn('API', `⚠️  [SHOPIFY-WEBHOOKS] Webhook registration may fail`);
    }
  }

  // ================================================================
  // STEP 1: List existing webhooks from Shopify
  // ================================================================
  logger.info('API', `\n📋 [SHOPIFY-WEBHOOKS] Fetching existing webhooks from Shopify...`);
  let existingWebhooks: any[] = [];

  try {
    const listResponse = await axios.get(
      `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/webhooks.json`,
      {
        headers: {
          'X-Shopify-Access-Token': accessToken
        },
        timeout: 10000
      }
    );

    existingWebhooks = listResponse.data.webhooks || [];
    logger.info('API', `✅ [SHOPIFY-WEBHOOKS] Found ${existingWebhooks.length} existing webhooks in Shopify`);

    // Log each existing webhook
    existingWebhooks.forEach((webhook: any) => {
      logger.info('API', `   └─ ${webhook.topic}: ${webhook.address} (ID: ${webhook.id})`);
    });
  } catch (error: any) {
    logger.warn('API', `⚠️  [SHOPIFY-WEBHOOKS] Could not fetch existing webhooks:`, error.message);
    logger.warn('API', `   └─ Will attempt to create all webhooks (may get 422 errors)`);
  }

  for (const topic of WEBHOOK_TOPICS) {
    try {
      // Construct webhook URL endpoint
      const webhookUrl = `${API_URL}/api/shopify/webhook/${topic.replace('/', '-')}`;

      logger.info('API', `\n🔗 [SHOPIFY-WEBHOOKS] [${topic}] Processing...`);
      logger.info('API', `   └─ Expected URL: ${webhookUrl}`);

      // ================================================================
      // STEP 2: Check if webhook already exists
      // ================================================================
      const existingWebhook = existingWebhooks.find((w: any) => w.topic === topic);

      if (existingWebhook) {
        logger.info('API', `   └─ Found existing webhook in Shopify (ID: ${existingWebhook.id})`);
        logger.info('API', `   └─ Existing URL: ${existingWebhook.address}`);

        // Check if URL matches
        if (existingWebhook.address === webhookUrl) {
          logger.info('API', `   └─ ✅ URL matches - using existing webhook`);

          // Save existing webhook to our database
          const { error } = await supabaseAdmin
            .from('shopify_webhooks')
            .upsert({
              integration_id: integrationId,
              webhook_id: existingWebhook.id.toString(),
              topic: topic,
              shop_domain: shop,
              is_active: true
            }, {
              onConflict: 'integration_id,topic'
            });

          if (error && !error.message.includes('duplicate') && !error.message.includes('unique')) {
            logger.warn('API', `   └─ ⚠️  Database save warning: ${error.message}`);
          }

          logger.info('API', `✅ [SHOPIFY-WEBHOOKS] [${topic}] Verified existing webhook`);
          results.success++;
          continue; // Skip creation, use existing
        } else {
          logger.warn('API', `   └─ ⚠️  URL mismatch!`);
          logger.warn('API', `   └─ Expected: ${webhookUrl}`);
          logger.warn('API', `   └─ Got: ${existingWebhook.address}`);
          logger.info('API', `   └─ Deleting old webhook and creating new one...`);

          // Delete old webhook
          try {
            await axios.delete(
              `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/webhooks/${existingWebhook.id}.json`,
              {
                headers: {
                  'X-Shopify-Access-Token': accessToken
                },
                timeout: 10000
              }
            );
            logger.info('API', `   └─ ✅ Old webhook deleted`);
          } catch (deleteError: any) {
            logger.error('API', `   └─ ❌ Failed to delete old webhook:`, deleteError.message);
            // Continue anyway, try to create new one
          }
        }
      } else {
        logger.info('API', `   └─ No existing webhook found for ${topic}`);
      }

      // ================================================================
      // STEP 3: Create new webhook
      // ================================================================
      logger.info('API', `   └─ Creating new webhook...`);

      const response = await axios.post(
        baseUrl,
        {
          webhook: {
            topic: topic,
            address: webhookUrl,
            format: 'json'
          }
        },
        {
          headers: {
            'X-Shopify-Access-Token': accessToken,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      const webhookId = response.data.webhook.id;

      logger.info('API', `   └─ Shopify webhook ID: ${webhookId}`);

      // Save webhook_id in database for later management
      const { error } = await supabaseAdmin
        .from('shopify_webhooks')
        .insert({
          integration_id: integrationId,
          webhook_id: webhookId.toString(),
          topic: topic,
          shop_domain: shop,
          is_active: true
        });

      // Ignore duplicate key errors (webhook already registered)
      if (error && !error.message.includes('duplicate') && !error.message.includes('unique')) {
        logger.error('API', `   └─ ⚠️  Database save failed: ${error.message}`);
        // Don't fail the whole process if DB save fails
      }

      logger.info('API', `✅ [SHOPIFY-WEBHOOKS] [${topic}] Successfully registered`);
      results.success++;

    } catch (error: any) {
      results.failed++;

      // Detailed error logging
      logger.error('API', `❌ [SHOPIFY-WEBHOOKS] [${topic}] Registration FAILED`);

      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const data = error.response?.data;
        const headers = error.response?.headers;

        logger.error('API', `   └─ HTTP Status: ${status}`);
        logger.error('API', `   └─ Response Data:`, JSON.stringify(data, null, 2));

        // Specific error handling
        if (status === 401) {
          logger.error('API', `   └─ ⚠️  AUTHENTICATION ERROR - Access token may be invalid`);
          results.errors.push(`${topic}: Invalid access token (401)`);
        } else if (status === 403) {
          logger.error('API', `   └─ ⚠️  PERMISSION ERROR - Missing required scope for ${topic}`);
          logger.error('API', `   └─ Required: write_orders or write_products`);
          logger.error('API', `   └─ Granted: ${grantedScopes}`);
          results.errors.push(`${topic}: Missing scope permission (403)`);
        } else if (status === 422) {
          const errorMessage = data?.errors?.address?.[0] || JSON.stringify(data?.errors);

          if (errorMessage.includes('already been taken')) {
            logger.error('API', `   └─ ⚠️  DUPLICATE ERROR - Webhook already exists for this topic`);
            logger.error('API', `   └─ This usually means:`);
            logger.error('API', `      1. Webhook exists in Shopify but wasn't detected in the list`);
            logger.error('API', `      2. Another integration is using the same URL`);
            logger.error('API', `   └─ Solution: Go to Shopify admin and manually delete duplicate webhooks`);
            results.errors.push(`${topic}: Webhook already exists (422) - manually delete in Shopify admin`);
          } else {
            logger.error('API', `   └─ ⚠️  VALIDATION ERROR - Invalid webhook data`);
            logger.error('API', `   └─ Error details:`, data?.errors || data);
            results.errors.push(`${topic}: Validation error (422) - ${JSON.stringify(data?.errors)}`);
          }
        } else if (status === 429) {
          logger.error('API', `   └─ ⚠️  RATE LIMIT - Too many requests`);
          results.errors.push(`${topic}: Rate limited (429)`);
        } else {
          logger.error('API', `   └─ Unexpected error: ${error.message}`);
          results.errors.push(`${topic}: ${error.message}`);
        }
      } else {
        logger.error('API', `   └─ Non-HTTP error:`, error.message);
        results.errors.push(`${topic}: ${error.message}`);
      }
    }
  }

  // Summary
  logger.info('API', `\n📊 [SHOPIFY-WEBHOOKS] Registration Summary:`);
  logger.info('API', `   ✅ Success: ${results.success}/${WEBHOOK_TOPICS.length}`);
  logger.info('API', `   ❌ Failed: ${results.failed}/${WEBHOOK_TOPICS.length}`);

  if (results.failed > 0) {
    logger.error('API', `\n⚠️  [SHOPIFY-WEBHOOKS] ${results.failed} webhook(s) failed to register!`);
    logger.error('API', `   Errors:`, results.errors);
  } else {
    logger.info('API', `\n✨ [SHOPIFY-WEBHOOKS] All webhooks registered successfully!`);
  }

  return results;
}

// ================================================================
// HELPER: Validate Shopify HMAC signature
// ================================================================
// Shopify signs all OAuth callbacks with HMAC-SHA256
// We must validate this to prevent tampering
// ================================================================
const validateHmac = (query: any, secret: string): boolean => {
  const { hmac, ...params } = query;

  if (!hmac) {
    logger.error('API', '❌ [HMAC] No HMAC provided');
    return false;
  }

  // Step 1: Sort params alphabetically and build query string
  const sortedParams = Object.keys(params)
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join('&');

  logger.info('API', '🔐 [HMAC] Sorted params:', sortedParams);

  // Step 2: Create HMAC-SHA256 hash
  const hash = crypto
    .createHmac('sha256', secret)
    .update(sortedParams)
    .digest('hex');

  logger.info('API', '🔐 [HMAC] Calculated:', hash);
  logger.info('API', '🔐 [HMAC] Received:', hmac);

  // Step 3: Compare with received HMAC (timing-safe comparison)
  const hashBuf = Buffer.from(hash);
  const hmacBuf = Buffer.from(hmac as string);
  if (hashBuf.length !== hmacBuf.length) {
    logger.info('API', '❌ [HMAC] Invalid (length mismatch)');
    return false;
  }
  const isValid = crypto.timingSafeEqual(hashBuf, hmacBuf);

  logger.info('API', isValid ? '✅ [HMAC] Valid' : '❌ [HMAC] Invalid');
  return isValid;
};

// ================================================================
// HELPER: Validate shop domain format
// ================================================================
const isValidShopDomain = (shop: string): boolean => {
  const shopRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;
  return shopRegex.test(shop);
};

// ================================================================
// GET /api/shopify-oauth/auth - Start OAuth flow
// GET /api/shopify-oauth/install - Alias for /auth (more intuitive)
// ================================================================
// Query params: shop (required), user_id (optional), store_id (optional)
// ================================================================
const handleOAuthStart = async (req: Request, res: Response) => {
  try {
    const { shop, user_id, store_id, popup } = req.query;

    logger.info('API', '🚀 [SHOPIFY-OAUTH] Auth request:', { shop, user_id, store_id, popup });

    // Validate environment variables
    if (!SHOPIFY_API_KEY || !SHOPIFY_API_SECRET || !SHOPIFY_REDIRECT_URI) {
      logger.error('API', '❌ [SHOPIFY-OAUTH] Missing environment variables');
      return res.status(500).json({
        error: 'Server configuration error',
        message: 'Shopify OAuth not configured properly'
      });
    }

    // Validate shop parameter
    if (!shop || typeof shop !== 'string') {
      return res.status(400).json({
        error: 'Missing shop parameter',
        message: 'Please provide a valid Shopify store domain'
      });
    }

    // Validate shop domain format (*.myshopify.com)
    if (!isValidShopDomain(shop)) {
      return res.status(400).json({
        error: 'Invalid shop domain',
        message: 'Shop must be in format: yourstore.myshopify.com'
      });
    }

    // Generate random state for CSRF protection
    const state = crypto.randomBytes(32).toString('hex');
    logger.info('API', '🔐 [SHOPIFY-OAUTH] Generated state:', state);

    // Store state in database (expires in 10 minutes)
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    const { error: stateError } = await supabaseAdmin
      .from('shopify_oauth_states')
      .insert([{
        state,
        user_id: user_id || null,
        store_id: store_id || null,
        shop_domain: shop,
        is_popup: popup === 'true', // Store popup mode flag
        expires_at: expiresAt.toISOString(),
        used: false
      }]);

    if (stateError) {
      logger.error('API', '❌ [SHOPIFY-OAUTH] Error saving state:', stateError);
      return res.status(500).json({
        error: 'Database error',
        message: 'Error al inicializar flujo OAuth'
      });
    }

    logger.info('API', '✅ [SHOPIFY-OAUTH] State saved to database');

    // Build Shopify OAuth authorization URL
    const authUrl = new URL(`https://${shop}/admin/oauth/authorize`);
    authUrl.searchParams.append('client_id', SHOPIFY_API_KEY);
    authUrl.searchParams.append('scope', SHOPIFY_SCOPES);
    authUrl.searchParams.append('redirect_uri', SHOPIFY_REDIRECT_URI);
    authUrl.searchParams.append('state', state);

    // Store store_id in state if provided (for later association)
    if (store_id) {
      authUrl.searchParams.append('store_id', store_id as string);
    }

    logger.info('API', '🔗 [SHOPIFY-OAUTH] Redirecting to:', authUrl.toString());

    // Redirect user to Shopify for authorization
    res.redirect(authUrl.toString());

  } catch (error: any) {
    logger.error('API', '💥 [SHOPIFY-OAUTH] Error:', error);
    res.status(500).json({
      error: 'Error interno del servidor',
      message: error.message
    });
  }
};

// Register both /auth and /install routes to the same handler
shopifyOAuthRouter.get('/auth', handleOAuthStart);
shopifyOAuthRouter.get('/install', handleOAuthStart);

// ================================================================
// GET /api/shopify-oauth/health - Health check for OAuth configuration
// ================================================================
// Returns configuration status and any missing environment variables
// ================================================================
shopifyOAuthRouter.get('/health', async (req: Request, res: Response) => {
  const status = {
    configured: true,
    missing_vars: [] as string[],
    config: {
      api_key: !!SHOPIFY_API_KEY,
      api_secret: !!SHOPIFY_API_SECRET,
      redirect_uri: !!SHOPIFY_REDIRECT_URI,
      app_url: !!APP_URL,
      api_url: !!API_URL,
      scopes: SHOPIFY_SCOPES,
      api_version: SHOPIFY_API_VERSION
    }
  };

  if (!SHOPIFY_API_KEY) status.missing_vars.push('SHOPIFY_API_KEY');
  if (!SHOPIFY_API_SECRET) status.missing_vars.push('SHOPIFY_API_SECRET');
  if (!SHOPIFY_REDIRECT_URI) status.missing_vars.push('SHOPIFY_REDIRECT_URI');

  status.configured = status.missing_vars.length === 0;

  if (!status.configured) {
    return res.status(503).json({
      ...status,
      message: 'Shopify OAuth is not fully configured'
    });
  }

  res.json({
    ...status,
    message: 'Shopify OAuth is properly configured'
  });
});

// ================================================================
// GET /api/shopify-oauth/callback - OAuth callback from Shopify
// ================================================================
// Query params: code, hmac, shop, state, timestamp
// ================================================================
shopifyOAuthRouter.get('/callback', async (req: Request, res: Response) => {
  try {
    const { code, hmac, shop, state, timestamp, store_id } = req.query;

    logger.info('API', '📥 [SHOPIFY-OAUTH] Callback received:', {
      shop,
      state,
      hasCode: !!code,
      hasHmac: !!hmac
    });

    // Validate required parameters
    if (!code || !hmac || !shop || !state) {
      logger.error('API', '❌ [SHOPIFY-OAUTH] Missing required parameters');
      return res.redirect(`${APP_URL}/integrations?status=error&integration=shopify&error=missing_params`);
    }

    // Validate HMAC signature
    if (!validateHmac(req.query, SHOPIFY_API_SECRET!)) {
      logger.error('API', '❌ [SHOPIFY-OAUTH] Invalid HMAC signature');
      return res.redirect(`${APP_URL}/integrations?status=error&integration=shopify&error=invalid_signature`);
    }

    logger.info('API', '✅ [SHOPIFY-OAUTH] HMAC validated successfully');

    // Validate state parameter (CSRF protection)
    const { data: stateData, error: stateError } = await supabaseAdmin
      .from('shopify_oauth_states')
      .select('id, state, shop_domain, store_id, user_id, expires_at, used')
      .eq('state', state)
      .eq('shop_domain', shop)
      .eq('used', false)
      .single();

    if (stateError || !stateData) {
      logger.error('API', '❌ [SHOPIFY-OAUTH] Invalid or expired state:', stateError);
      return res.redirect(`${APP_URL}/integrations?status=error&integration=shopify&error=invalid_state`);
    }

    // Check if state has expired
    if (new Date(stateData.expires_at) < new Date()) {
      logger.error('API', '❌ [SHOPIFY-OAUTH] State has expired');
      await supabaseAdmin
        .from('shopify_oauth_states')
        .delete()
        .eq('state', state);
      return res.redirect(`${APP_URL}/integrations?status=error&integration=shopify&error=expired_state`);
    }

    logger.info('API', '✅ [SHOPIFY-OAUTH] State validated successfully');

    // Mark state as used to prevent replay attacks
    await supabaseAdmin
      .from('shopify_oauth_states')
      .update({ used: true })
      .eq('state', state);

    // Exchange authorization code for access token
    logger.info('API', '🔄 [SHOPIFY-OAUTH] Exchanging code for access token...');

    const tokenResponse = await axios.post(
      `https://${shop}/admin/oauth/access_token`,
      {
        client_id: SHOPIFY_API_KEY,
        client_secret: SHOPIFY_API_SECRET,
        code
      },
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    const { access_token, scope } = tokenResponse.data;

    if (!access_token) {
      logger.error('API', '❌ [SHOPIFY-OAUTH] No access token received');
      return res.redirect(`${APP_URL}/integrations?status=error&integration=shopify&error=no_token`);
    }

    logger.info('API', '✅ [SHOPIFY-OAUTH] Access token received');
    logger.info('API', '📋 [SHOPIFY-OAUTH] Granted scopes:', scope);

    // Fetch shop info from Shopify API to get shop name
    let shopName = shop as string; // Default to shop domain
    try {
      const shopInfoResponse = await axios.get(
        `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/shop.json`,
        {
          headers: {
            'X-Shopify-Access-Token': access_token,
          }
        }
      );

      if (shopInfoResponse.data?.shop?.name) {
        shopName = shopInfoResponse.data.shop.name;
        logger.info('API', '✅ [SHOPIFY-OAUTH] Shop name fetched:', shopName);
      }
    } catch (error: any) {
      logger.error('API', '⚠️ [SHOPIFY-OAUTH] Failed to fetch shop name:', error.message);
      // Continue with shop domain as fallback
    }

    // Determine store_id - prioritize: stateData.store_id > query param > user's first store
    let finalStoreId = stateData.store_id || store_id || null;

    if (!finalStoreId && stateData.user_id) {
      // If no store_id, try to get user's first store
      const { data: userStores } = await supabaseAdmin
        .from('user_stores')
        .select('store_id')
        .eq('user_id', stateData.user_id)
        .limit(1)
        .single();

      if (userStores?.store_id) {
        finalStoreId = userStores.store_id;
      }
    }

    logger.info('API', '🏪 [SHOPIFY-OAUTH] Store ID resolved:', finalStoreId);

    // Save integration to database (OAuth flow)
    // OAuth integrations use access_token, NOT api_key/api_secret_key
    const integrationData: any = {
      user_id: stateData.user_id,
      store_id: finalStoreId,
      shop_domain: shop as string,
      shop_name: shopName, // Store the fetched shop name
      shop: shop as string, // Alias for shop_domain
      access_token, // OAuth access token
      scope, // OAuth granted scopes
      status: 'active',
      installed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // Check if integration already exists
    const { data: existingIntegration } = await supabaseAdmin
      .from('shopify_integrations')
      .select('id')
      .eq('shop', shop)
      .single();

    let integrationIdForWebhooks: string;

    if (existingIntegration) {
      // Update existing integration
      logger.info('API', '🔄 [SHOPIFY-OAUTH] Updating existing integration');
      const { error: updateError } = await supabaseAdmin
        .from('shopify_integrations')
        .update({
          access_token,
          scope,
          shop_name: shopName, // Update shop name on reconnection
          status: 'active',
          updated_at: new Date().toISOString()
        })
        .eq('shop', shop);

      if (updateError) {
        logger.error('API', '❌ [SHOPIFY-OAUTH] Error updating integration:', updateError);
        throw updateError;
      }

      integrationIdForWebhooks = existingIntegration.id;
    } else {
      // Create new integration
      logger.info('API', '✨ [SHOPIFY-OAUTH] Creating new integration');
      const { data: newIntegration, error: insertError } = await supabaseAdmin
        .from('shopify_integrations')
        .insert([integrationData])
        .select('id')
        .single();

      if (insertError || !newIntegration) {
        logger.error('API', '❌ [SHOPIFY-OAUTH] Error saving integration:', insertError);
        throw insertError;
      }

      integrationIdForWebhooks = newIntegration.id;
    }

    logger.info('API', '✅ [SHOPIFY-OAUTH] Integration saved to database');

    // Update store name in the stores table if we have a store_id
    if (finalStoreId && shopName) {
      try {
        const { error: updateStoreError } = await supabaseAdmin
          .from('stores')
          .update({ name: shopName })
          .eq('id', finalStoreId);

        if (updateStoreError) {
          logger.error('API', '⚠️ [SHOPIFY-OAUTH] Failed to update store name:', updateStoreError);
        } else {
          logger.info('API', '✅ [SHOPIFY-OAUTH] Store name updated to:', shopName);
        }
      } catch (error: any) {
        logger.error('API', '⚠️ [SHOPIFY-OAUTH] Error updating store name:', error.message);
      }
    }

    // ================================================================
    // CRITICAL: Register webhooks automatically
    // ================================================================
    // This is the main reason webhooks might not appear in Shopify
    // If this fails, we still complete OAuth but warn the user
    // ================================================================
    logger.info('API', '\n🎯 [SHOPIFY-OAUTH] ===== STARTING WEBHOOK REGISTRATION =====');
    logger.info('API', `[SHOPIFY-OAUTH] Shop: ${shop}`);
    logger.info('API', `[SHOPIFY-OAUTH] Integration ID: ${integrationIdForWebhooks}`);
    logger.info('API', `[SHOPIFY-OAUTH] Scopes: ${scope}`);
    logger.info('API', `[SHOPIFY-OAUTH] API URL: ${API_URL}`);

    const webhookResults = await registerShopifyWebhooks(
      shop as string,
      access_token,
      integrationIdForWebhooks,
      scope // Pass granted scopes for verification
    );

    logger.info('API', '🎯 [SHOPIFY-OAUTH] ===== WEBHOOK REGISTRATION COMPLETE =====\n');

    // Save webhook registration results to integration record
    await supabaseAdmin
      .from('shopify_integrations')
      .update({
        webhook_registration_success: webhookResults.success,
        webhook_registration_failed: webhookResults.failed,
        webhook_registration_errors: webhookResults.errors.length > 0 ? webhookResults.errors : null,
        last_webhook_attempt: new Date().toISOString()
      })
      .eq('id', integrationIdForWebhooks);

    // Clean up used state
    await supabaseAdmin
      .from('shopify_oauth_states')
      .delete()
      .eq('state', state);

    logger.info('API', '🧹 [SHOPIFY-OAUTH] State cleaned up');

    // Build redirect URL with webhook status
    let redirectUrl = `${APP_URL}/integrations?status=success&integration=shopify&shop=${shop}`;

    // Add webhook status to redirect URL
    if (webhookResults.failed > 0) {
      redirectUrl += `&webhooks_failed=${webhookResults.failed}`;
      redirectUrl += `&webhooks_success=${webhookResults.success}`;
      logger.warn('API', `⚠️  [SHOPIFY-OAUTH] ${webhookResults.failed} webhooks failed to register`);
      logger.warn('API', `   User will be notified via redirect URL`);
    } else {
      redirectUrl += '&webhooks=ok';
      logger.info('API', '✅ [SHOPIFY-OAUTH] All webhooks registered successfully');
    }

    logger.info('API', '🔗 [SHOPIFY-OAUTH] APP_URL env var:', process.env.APP_URL);
    logger.info('API', '🔗 [SHOPIFY-OAUTH] Final APP_URL:', APP_URL);

    // Check if this is a popup OAuth flow (Shopify embedded mode)
    if (stateData.is_popup) {
      logger.info('API', '🪟 [SHOPIFY-OAUTH] Popup mode detected - redirecting to callback page');
      // Redirect to special callback page that closes popup and notifies parent
      const popupCallbackUrl = `${APP_URL}/shopify-oauth-callback?status=success&shop=${shop}${webhookResults.failed > 0 ? `&webhooks_failed=${webhookResults.failed}` : '&webhooks=ok'}`;
      logger.info('API', '🔗 [SHOPIFY-OAUTH] Redirecting popup to:', popupCallbackUrl);
      res.redirect(popupCallbackUrl);
    } else {
      // Normal redirect (standalone mode)
      logger.info('API', '🔗 [SHOPIFY-OAUTH] Redirecting to:', redirectUrl);
      res.redirect(redirectUrl);
    }

  } catch (error: any) {
    logger.error('API', '💥 [SHOPIFY-OAUTH] Callback error:', error);

    // Log detailed error for debugging
    if (axios.isAxiosError(error)) {
      logger.error('API', '📡 [SHOPIFY-OAUTH] Axios error:', {
        status: error.response?.status,
        data: error.response?.data
      });
    }

    // Check if we're in popup mode for error redirect
    const stateParam = req.query.state;
    if (stateParam) {
      const { data: stateData } = await supabaseAdmin
        .from('shopify_oauth_states')
        .select('is_popup')
        .eq('state', stateParam)
        .single();

      if (stateData?.is_popup) {
        return res.redirect(`${APP_URL}/shopify-oauth-callback?status=error&error=callback_failed`);
      }
    }

    res.redirect(`${APP_URL}/integrations?status=error&integration=shopify&error=callback_failed`);
  }
});

// ================================================================
// GET /api/shopify/status - Check integration status
// ================================================================
// Query params: shop (required)
// ================================================================
shopifyOAuthRouter.get('/status', async (req: Request, res: Response) => {
  try {
    const { shop } = req.query;

    if (!shop || typeof shop !== 'string') {
      return res.status(400).json({
        error: 'Missing shop parameter'
      });
    }

    const { data: integration, error } = await supabaseAdmin
      .from('shopify_integrations')
      .select('id, shop, scope, installed_at, last_sync_at, status')
      .eq('shop', shop)
      .single();

    if (error || !integration) {
      return res.json({
        connected: false
      });
    }

    res.json({
      connected: true,
      shop: integration.shop,
      scope: integration.scope,
      installed_at: integration.installed_at,
      last_sync_at: integration.last_sync_at,
      status: integration.status
    });

  } catch (error: any) {
    logger.error('API', '💥 [SHOPIFY-OAUTH] Status check error:', error);
    res.status(500).json({
      error: 'Error interno del servidor',
      message: error.message
    });
  }
});

// ================================================================
// DELETE /api/shopify/disconnect - Disconnect Shopify integration
// ================================================================
// Query params: shop (required)
// IMPORTANT: This endpoint performs full cleanup:
// 1. Removes all webhooks registered in Shopify
// 2. Revokes the access token (invalidates credentials)
// 3. Marks integration as disconnected in database
// Note: Cannot programmatically uninstall app from Shopify
//       User must manually uninstall from Shopify admin
// ================================================================
shopifyOAuthRouter.delete('/disconnect', async (req: Request, res: Response) => {
  try {
    const { shop } = req.query;
    const authHeader = req.headers['authorization'];
    const storeIdHeader = req.headers['x-store-id'];

    logger.info('API', '🔌 [SHOPIFY-OAUTH] Disconnect request:', { shop, hasAuth: !!authHeader, storeId: storeIdHeader });

    if (!shop || typeof shop !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Missing shop parameter'
      });
    }

    logger.info('API', '🔌 [SHOPIFY-OAUTH] Disconnecting shop:', shop);

    // Get integration with credentials needed for webhook removal
    const { data: integration, error: fetchError } = await supabaseAdmin
      .from('shopify_integrations')
      .select('id, store_id, shop_domain, access_token, status')
      .eq('shop_domain', shop)
      .single();

    if (fetchError || !integration) {
      logger.error('API', '❌ [SHOPIFY-OAUTH] Integration not found:', shop);
      return res.status(404).json({
        success: false,
        error: 'Integration not found'
      });
    }

    // ================================================================
    // STEP 1: Remove all webhooks from Shopify
    // ================================================================
    logger.info('API', '🗑️ [SHOPIFY-OAUTH] Removing webhooks from Shopify...');

    try {
      const { ShopifyWebhookSetupService } = await import('../services/shopify-webhook-setup.service');
      const webhookSetup = new ShopifyWebhookSetupService(integration);
      const removeResult = await webhookSetup.removeAllWebhooks();

      logger.info('API', `✅ [SHOPIFY-OAUTH] Removed ${removeResult.removed} webhooks from Shopify`);
      if (removeResult.errors.length > 0) {
        logger.warn('API', '⚠️ [SHOPIFY-OAUTH] Some webhooks failed to remove:', removeResult.errors);
      }
    } catch (webhookError: any) {
      logger.error('API', '❌ [SHOPIFY-OAUTH] Error removing webhooks:', webhookError);
      // Continue with disconnection even if webhook removal fails
    }

    // ================================================================
    // STEP 2: Revoke access token (invalidate credentials)
    // ================================================================
    logger.info('API', '🔐 [SHOPIFY-OAUTH] Revoking access token...');

    try {
      if (integration.access_token) {
        const revokeUrl = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/access_scopes.json`;

        // Delete access token (this invalidates it)
        await axios.delete(revokeUrl, {
          headers: {
            'X-Shopify-Access-Token': integration.access_token,
            'Content-Type': 'application/json'
          }
        });

        logger.info('API', '✅ [SHOPIFY-OAUTH] Access token revoked successfully');
      }
    } catch (revokeError: any) {
      // Token revocation might fail if already revoked or app uninstalled
      logger.warn('API', '⚠️ [SHOPIFY-OAUTH] Could not revoke token (may already be invalid):', revokeError.message);
      // Continue with disconnection
    }

    // ================================================================
    // STEP 3: Mark integration as disconnected in database
    // ================================================================
    const { error: updateError } = await supabaseAdmin
      .from('shopify_integrations')
      .update({
        status: 'disconnected',
        updated_at: new Date().toISOString()
      })
      .eq('shop_domain', shop);

    if (updateError) {
      logger.error('API', '❌ [SHOPIFY-OAUTH] Error updating integration status:', updateError);
      return res.status(500).json({
        success: false,
        error: 'Error al desconectar integración',
        message: updateError.message
      });
    }

    logger.info('API', '✅ [SHOPIFY-OAUTH] Shop disconnected successfully');

    res.json({
      success: true,
      message: 'Shopify integration disconnected. Please manually uninstall the app from your Shopify admin.',
      note: 'Webhooks removed and credentials revoked. App will appear in Shopify until manually uninstalled.'
    });

  } catch (error: any) {
    logger.error('API', '💥 [SHOPIFY-OAUTH] Disconnect error:', error);
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor',
      message: error.message
    });
  }
});

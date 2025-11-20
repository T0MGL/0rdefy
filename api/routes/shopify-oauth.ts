// ================================================================
// SHOPIFY OAUTH ROUTES
// ================================================================
// Handles Shopify OAuth 2.0 flow for app installation
// Flow: GET /auth → Shopify login → GET /callback → Store token
// ================================================================

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
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2024-10';
const APP_URL = process.env.APP_URL || 'http://localhost:8080';
const API_URL = process.env.API_URL || 'http://localhost:3001';

// ================================================================
// WEBHOOK REGISTRATION
// ================================================================
// Topics to register when OAuth is completed
// ================================================================
const WEBHOOK_TOPICS = [
  'orders/create',      // New order created
  'orders/updated',     // Order updated
  'products/create',    // New product created
  'products/update',    // Product updated
  'products/delete',    // Product deleted
  'customers/create',   // New customer created
  'customers/update',   // Customer updated
  'app/uninstalled'     // App uninstalled
];

/**
 * Register all Shopify webhooks after OAuth completion
 * @param shop Shop domain (e.g., mystore.myshopify.com)
 * @param accessToken OAuth access token
 * @param integrationId UUID of the shopify_integrations record
 */
async function registerShopifyWebhooks(
  shop: string,
  accessToken: string,
  integrationId: string
): Promise<void> {
  const baseUrl = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/webhooks.json`;

  console.log(`🔧 [SHOPIFY-WEBHOOKS] Registering webhooks for ${shop}...`);

  for (const topic of WEBHOOK_TOPICS) {
    try {
      // Construct webhook URL endpoint
      const webhookUrl = `${API_URL}/api/shopify/webhook/${topic.replace('/', '-')}`;

      console.log(`🔗 [SHOPIFY-WEBHOOKS] Registering ${topic} → ${webhookUrl}`);

      // Register webhook with Shopify
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
          }
        }
      );

      const webhookId = response.data.webhook.id;

      // Save webhook_id in database for later management
      const { error } = await supabaseAdmin
        .from('shopify_webhooks')
        .insert({
          integration_id: integrationId,
          webhook_id: webhookId,
          topic: topic,
          shop_domain: shop,
          is_active: true
        });

      // Ignore duplicate key errors (webhook already registered)
      if (error && !error.message.includes('duplicate')) {
        throw error;
      }

      console.log(`✅ [SHOPIFY-WEBHOOKS] ${topic} registered (ID: ${webhookId})`);

    } catch (error: any) {
      // Log error but continue with other webhooks
      console.error(`❌ [SHOPIFY-WEBHOOKS] Failed to register ${topic}:`,
        error.response?.data || error.message);
    }
  }

  console.log(`✨ [SHOPIFY-WEBHOOKS] All webhooks registered for ${shop}`);
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
    console.error('❌ [HMAC] No HMAC provided');
    return false;
  }

  // Step 1: Sort params alphabetically and build query string
  const sortedParams = Object.keys(params)
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join('&');

  console.log('🔐 [HMAC] Sorted params:', sortedParams);

  // Step 2: Create HMAC-SHA256 hash
  const hash = crypto
    .createHmac('sha256', secret)
    .update(sortedParams)
    .digest('hex');

  console.log('🔐 [HMAC] Calculated:', hash);
  console.log('🔐 [HMAC] Received:', hmac);

  // Step 3: Compare with received HMAC (timing-safe comparison)
  const isValid = crypto.timingSafeEqual(
    Buffer.from(hash),
    Buffer.from(hmac as string)
  );

  console.log(isValid ? '✅ [HMAC] Valid' : '❌ [HMAC] Invalid');
  return isValid;
};

// ================================================================
// HELPER: Validate shop domain format
// ================================================================
const isValidShopDomain = (shop: string): boolean => {
  const shopRegex = /^[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$/;
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
    const { shop, user_id, store_id } = req.query;

    console.log('🚀 [SHOPIFY-OAUTH] Auth request:', { shop, user_id, store_id });

    // Validate environment variables
    if (!SHOPIFY_API_KEY || !SHOPIFY_API_SECRET || !SHOPIFY_REDIRECT_URI) {
      console.error('❌ [SHOPIFY-OAUTH] Missing environment variables');
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
    console.log('🔐 [SHOPIFY-OAUTH] Generated state:', state);

    // Store state in database (expires in 10 minutes)
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    const { error: stateError } = await supabaseAdmin
      .from('shopify_oauth_states')
      .insert([{
        state,
        user_id: user_id || null,
        store_id: store_id || null,
        shop_domain: shop,
        expires_at: expiresAt.toISOString(),
        used: false
      }]);

    if (stateError) {
      console.error('❌ [SHOPIFY-OAUTH] Error saving state:', stateError);
      return res.status(500).json({
        error: 'Database error',
        message: 'Failed to initialize OAuth flow'
      });
    }

    console.log('✅ [SHOPIFY-OAUTH] State saved to database');

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

    console.log('🔗 [SHOPIFY-OAUTH] Redirecting to:', authUrl.toString());

    // Redirect user to Shopify for authorization
    res.redirect(authUrl.toString());

  } catch (error: any) {
    console.error('💥 [SHOPIFY-OAUTH] Error:', error);
    res.status(500).json({
      error: 'Internal server error',
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

    console.log('📥 [SHOPIFY-OAUTH] Callback received:', {
      shop,
      state,
      hasCode: !!code,
      hasHmac: !!hmac
    });

    // Validate required parameters
    if (!code || !hmac || !shop || !state) {
      console.error('❌ [SHOPIFY-OAUTH] Missing required parameters');
      return res.redirect(`${APP_URL}/integrations?status=error&integration=shopify&error=missing_params`);
    }

    // Validate HMAC signature
    if (!validateHmac(req.query, SHOPIFY_API_SECRET!)) {
      console.error('❌ [SHOPIFY-OAUTH] Invalid HMAC signature');
      return res.redirect(`${APP_URL}/integrations?status=error&integration=shopify&error=invalid_signature`);
    }

    console.log('✅ [SHOPIFY-OAUTH] HMAC validated successfully');

    // Validate state parameter (CSRF protection)
    const { data: stateData, error: stateError } = await supabaseAdmin
      .from('shopify_oauth_states')
      .select('*')
      .eq('state', state)
      .eq('shop_domain', shop)
      .eq('used', false)
      .single();

    if (stateError || !stateData) {
      console.error('❌ [SHOPIFY-OAUTH] Invalid or expired state:', stateError);
      return res.redirect(`${APP_URL}/integrations?status=error&integration=shopify&error=invalid_state`);
    }

    // Check if state has expired
    if (new Date(stateData.expires_at) < new Date()) {
      console.error('❌ [SHOPIFY-OAUTH] State has expired');
      await supabaseAdmin
        .from('shopify_oauth_states')
        .delete()
        .eq('state', state);
      return res.redirect(`${APP_URL}/integrations?status=error&integration=shopify&error=expired_state`);
    }

    console.log('✅ [SHOPIFY-OAUTH] State validated successfully');

    // Mark state as used to prevent replay attacks
    await supabaseAdmin
      .from('shopify_oauth_states')
      .update({ used: true })
      .eq('state', state);

    // Exchange authorization code for access token
    console.log('🔄 [SHOPIFY-OAUTH] Exchanging code for access token...');

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
      console.error('❌ [SHOPIFY-OAUTH] No access token received');
      return res.redirect(`${APP_URL}/integrations?status=error&integration=shopify&error=no_token`);
    }

    console.log('✅ [SHOPIFY-OAUTH] Access token received');
    console.log('📋 [SHOPIFY-OAUTH] Granted scopes:', scope);

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
        console.log('✅ [SHOPIFY-OAUTH] Shop name fetched:', shopName);
      }
    } catch (error: any) {
      console.error('⚠️ [SHOPIFY-OAUTH] Failed to fetch shop name:', error.message);
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

    console.log('🏪 [SHOPIFY-OAUTH] Store ID resolved:', finalStoreId);

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
      console.log('🔄 [SHOPIFY-OAUTH] Updating existing integration');
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
        console.error('❌ [SHOPIFY-OAUTH] Error updating integration:', updateError);
        throw updateError;
      }

      integrationIdForWebhooks = existingIntegration.id;
    } else {
      // Create new integration
      console.log('✨ [SHOPIFY-OAUTH] Creating new integration');
      const { data: newIntegration, error: insertError } = await supabaseAdmin
        .from('shopify_integrations')
        .insert([integrationData])
        .select('id')
        .single();

      if (insertError || !newIntegration) {
        console.error('❌ [SHOPIFY-OAUTH] Error saving integration:', insertError);
        throw insertError;
      }

      integrationIdForWebhooks = newIntegration.id;
    }

    console.log('✅ [SHOPIFY-OAUTH] Integration saved to database');

    // Update store name in the stores table if we have a store_id
    if (finalStoreId && shopName) {
      try {
        const { error: updateStoreError } = await supabaseAdmin
          .from('stores')
          .update({ name: shopName })
          .eq('id', finalStoreId);

        if (updateStoreError) {
          console.error('⚠️ [SHOPIFY-OAUTH] Failed to update store name:', updateStoreError);
        } else {
          console.log('✅ [SHOPIFY-OAUTH] Store name updated to:', shopName);
        }
      } catch (error: any) {
        console.error('⚠️ [SHOPIFY-OAUTH] Error updating store name:', error.message);
      }
    }

    // Register webhooks automatically
    await registerShopifyWebhooks(shop as string, access_token, integrationIdForWebhooks);
    console.log('✅ [SHOPIFY-OAUTH] Webhooks registered successfully');

    // Clean up used state
    await supabaseAdmin
      .from('shopify_oauth_states')
      .delete()
      .eq('state', state);

    console.log('🧹 [SHOPIFY-OAUTH] State cleaned up');

    // Redirect to frontend integrations page with success status
    const redirectUrl = `${APP_URL}/integrations?status=success&integration=shopify&shop=${shop}`;
    console.log('🔗 [SHOPIFY-OAUTH] APP_URL env var:', process.env.APP_URL);
    console.log('🔗 [SHOPIFY-OAUTH] Final APP_URL:', APP_URL);
    console.log('🔗 [SHOPIFY-OAUTH] Redirecting to:', redirectUrl);
    res.redirect(redirectUrl);

  } catch (error: any) {
    console.error('💥 [SHOPIFY-OAUTH] Callback error:', error);

    // Log detailed error for debugging
    if (axios.isAxiosError(error)) {
      console.error('📡 [SHOPIFY-OAUTH] Axios error:', {
        status: error.response?.status,
        data: error.response?.data
      });
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
    console.error('💥 [SHOPIFY-OAUTH] Status check error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

// ================================================================
// DELETE /api/shopify/disconnect - Disconnect Shopify integration
// ================================================================
// Query params: shop (required)
// ================================================================
shopifyOAuthRouter.delete('/disconnect', async (req: Request, res: Response) => {
  try {
    const { shop } = req.query;
    const authHeader = req.headers['authorization'];
    const storeIdHeader = req.headers['x-store-id'];

    console.log('🔌 [SHOPIFY-OAUTH] Disconnect request:', { shop, hasAuth: !!authHeader, storeId: storeIdHeader });

    if (!shop || typeof shop !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Missing shop parameter'
      });
    }

    console.log('🔌 [SHOPIFY-OAUTH] Disconnecting shop:', shop);

    // Update status to disconnected instead of deleting
    // (Keep historical record)
    // Match by shop_domain (OAuth integrations use shop_domain field)
    const { error } = await supabaseAdmin
      .from('shopify_integrations')
      .update({
        status: 'disconnected',
        updated_at: new Date().toISOString()
      })
      .eq('shop_domain', shop);

    if (error) {
      console.error('❌ [SHOPIFY-OAUTH] Error disconnecting:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to disconnect integration',
        message: error.message
      });
    }

    console.log('✅ [SHOPIFY-OAUTH] Shop disconnected successfully');

    res.json({
      success: true,
      message: 'Shopify integration disconnected'
    });

  } catch (error: any) {
    console.error('💥 [SHOPIFY-OAUTH] Disconnect error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

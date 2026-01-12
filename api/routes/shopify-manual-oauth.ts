// ================================================================
// SHOPIFY MANUAL OAUTH ROUTES
// ================================================================
// Handles OAuth 2.0 flow for Custom Apps created by merchants
// in the new Dev Dashboard (post January 2026)
//
// This is SEPARATE from the official OAuth flow (shopify-oauth.ts)
// which uses Ordefy's official app credentials from env vars.
//
// Flow:
// 1. User enters Client ID + Client Secret from their Dev Dashboard app
// 2. POST /start - Saves credentials and redirects to Shopify authorize
// 3. GET /callback - Exchanges code for permanent access token
// 4. Token saved to shopify_integrations table
// ================================================================

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import axios from 'axios';
import { supabaseAdmin } from '../db/connection';
import { verifyToken, extractStoreId, AuthRequest } from '../middleware/auth';

export const shopifyManualOAuthRouter = Router();

// ================================================================
// CONSTANTS
// ================================================================
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-10';
const APP_URL = process.env.APP_URL || 'http://localhost:8080';
const API_URL = process.env.API_URL || 'http://localhost:3001';

// Scopes required for Ordefy integration
const REQUIRED_SCOPES = [
  'read_products',
  'write_products',
  'read_orders',
  'write_orders',
  'read_customers',
  'write_customers',
  'read_inventory',
  'write_inventory',
  'read_locations'
].join(',');

// Webhook topics to register after OAuth
const WEBHOOK_TOPICS = [
  'orders/create',
  'orders/updated',
  'products/delete',
  'app/uninstalled'
];

// ================================================================
// HELPER: Validate HMAC signature from Shopify callback
// ================================================================
const validateHmac = (query: any, secret: string): boolean => {
  const { hmac, ...params } = query;

  if (!hmac) {
    console.error('❌ [MANUAL-OAUTH] No HMAC provided');
    return false;
  }

  const sortedParams = Object.keys(params)
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join('&');

  const hash = crypto
    .createHmac('sha256', secret)
    .update(sortedParams)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(hash),
      Buffer.from(hmac as string)
    );
  } catch {
    return false;
  }
};

// ================================================================
// HELPER: Register webhooks after successful OAuth
// ================================================================
async function registerWebhooks(
  shop: string,
  accessToken: string,
  integrationId: string
): Promise<{ success: number; failed: number; errors: string[] }> {
  const results = { success: 0, failed: 0, errors: [] as string[] };

  console.log(`🔧 [MANUAL-OAUTH] Registering webhooks for ${shop}...`);

  for (const topic of WEBHOOK_TOPICS) {
    try {
      const webhookUrl = `${API_URL}/api/shopify/webhook/${topic.replace('/', '-')}`;

      // Check if webhook exists
      const listResponse = await axios.get(
        `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/webhooks.json`,
        {
          headers: { 'X-Shopify-Access-Token': accessToken },
          timeout: 10000
        }
      );

      const existing = (listResponse.data.webhooks || []).find(
        (w: any) => w.topic === topic
      );

      if (existing && existing.address === webhookUrl) {
        console.log(`   ✅ [${topic}] Already exists`);
        results.success++;
        continue;
      }

      // Delete old webhook if URL mismatch
      if (existing) {
        await axios.delete(
          `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/webhooks/${existing.id}.json`,
          {
            headers: { 'X-Shopify-Access-Token': accessToken },
            timeout: 10000
          }
        );
      }

      // Create new webhook
      const response = await axios.post(
        `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/webhooks.json`,
        {
          webhook: {
            topic,
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

      // Save to database
      await supabaseAdmin
        .from('shopify_webhooks')
        .upsert({
          integration_id: integrationId,
          webhook_id: response.data.webhook.id.toString(),
          topic,
          shop_domain: shop,
          is_active: true
        }, { onConflict: 'integration_id,topic' });

      console.log(`   ✅ [${topic}] Registered`);
      results.success++;

    } catch (error: any) {
      console.error(`   ❌ [${topic}] Failed:`, error.message);
      results.failed++;
      results.errors.push(`${topic}: ${error.message}`);
    }
  }

  return results;
}

// ================================================================
// POST /api/shopify/manual-oauth/start
// ================================================================
// Starts OAuth flow using merchant's custom app credentials
// Body: { shop_domain, client_id, client_secret }
// ================================================================
shopifyManualOAuthRouter.post('/start',
  verifyToken,
  extractStoreId,
  async (req: AuthRequest, res: Response) => {
    try {
      const { shop_domain, client_id, client_secret } = req.body;
      const userId = req.userId;
      const storeId = req.storeId;

      console.log('🚀 [MANUAL-OAUTH] Start request:', { shop_domain, client_id: client_id?.substring(0, 8) + '...' });

      // Validate required fields
      if (!shop_domain || !client_id || !client_secret) {
        return res.status(400).json({
          success: false,
          error: 'shop_domain, client_id, and client_secret are required'
        });
      }

      // Normalize shop domain
      let normalizedShop = shop_domain.trim().toLowerCase();
      if (!normalizedShop.includes('.myshopify.com')) {
        normalizedShop = `${normalizedShop}.myshopify.com`;
      }

      // Validate shop domain format
      const shopRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;
      if (!shopRegex.test(normalizedShop)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid shop domain format. Use: yourstore.myshopify.com'
        });
      }

      // Generate state for CSRF protection
      const state = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      // Store OAuth state with custom credentials
      const { error: stateError } = await supabaseAdmin
        .from('shopify_oauth_states')
        .insert({
          state,
          user_id: userId,
          store_id: storeId,
          shop_domain: normalizedShop,
          // Store custom app credentials (encrypted in production)
          custom_client_id: client_id,
          custom_client_secret: client_secret,
          is_custom_app: true,
          expires_at: expiresAt.toISOString(),
          used: false
        });

      if (stateError) {
        console.error('❌ [MANUAL-OAUTH] Error saving state:', stateError);
        return res.status(500).json({
          success: false,
          error: 'Failed to initialize OAuth flow'
        });
      }

      // Build Shopify authorization URL
      const redirectUri = `${API_URL}/api/shopify/manual-oauth/callback`;
      const authUrl = new URL(`https://${normalizedShop}/admin/oauth/authorize`);
      authUrl.searchParams.append('client_id', client_id);
      authUrl.searchParams.append('scope', REQUIRED_SCOPES);
      authUrl.searchParams.append('redirect_uri', redirectUri);
      authUrl.searchParams.append('state', state);

      console.log('✅ [MANUAL-OAUTH] OAuth URL generated');

      // Return URL for frontend to redirect
      res.json({
        success: true,
        oauth_url: authUrl.toString()
      });

    } catch (error: any) {
      console.error('💥 [MANUAL-OAUTH] Start error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

// ================================================================
// GET /api/shopify/manual-oauth/callback
// ================================================================
// Callback from Shopify after user authorizes
// Exchanges code for permanent access token
// ================================================================
shopifyManualOAuthRouter.get('/callback', async (req: Request, res: Response) => {
  try {
    const { code, hmac, shop, state, timestamp } = req.query;

    console.log('📥 [MANUAL-OAUTH] Callback received:', {
      shop,
      state: (state as string)?.substring(0, 16) + '...',
      hasCode: !!code
    });

    // Validate required parameters
    if (!code || !shop || !state) {
      console.error('❌ [MANUAL-OAUTH] Missing required parameters');
      return res.redirect(`${APP_URL}/integrations?status=error&error=missing_params&type=custom`);
    }

    // Get OAuth state from database
    const { data: stateData, error: stateError } = await supabaseAdmin
      .from('shopify_oauth_states')
      .select('*')
      .eq('state', state)
      .eq('shop_domain', shop)
      .eq('used', false)
      .eq('is_custom_app', true)
      .single();

    if (stateError || !stateData) {
      console.error('❌ [MANUAL-OAUTH] Invalid state:', stateError);
      return res.redirect(`${APP_URL}/integrations?status=error&error=invalid_state&type=custom`);
    }

    // Check expiration
    if (new Date(stateData.expires_at) < new Date()) {
      console.error('❌ [MANUAL-OAUTH] State expired');
      await supabaseAdmin.from('shopify_oauth_states').delete().eq('state', state);
      return res.redirect(`${APP_URL}/integrations?status=error&error=expired_state&type=custom`);
    }

    // Validate HMAC using the custom app's client secret
    if (hmac && !validateHmac(req.query, stateData.custom_client_secret)) {
      console.error('❌ [MANUAL-OAUTH] Invalid HMAC');
      return res.redirect(`${APP_URL}/integrations?status=error&error=invalid_signature&type=custom`);
    }

    // Mark state as used
    await supabaseAdmin
      .from('shopify_oauth_states')
      .update({ used: true })
      .eq('state', state);

    // Exchange code for access token
    console.log('🔄 [MANUAL-OAUTH] Exchanging code for access token...');

    const tokenResponse = await axios.post(
      `https://${shop}/admin/oauth/access_token`,
      {
        client_id: stateData.custom_client_id,
        client_secret: stateData.custom_client_secret,
        code
      },
      {
        headers: { 'Content-Type': 'application/json' }
      }
    );

    const { access_token, scope } = tokenResponse.data;

    if (!access_token) {
      console.error('❌ [MANUAL-OAUTH] No access token received');
      return res.redirect(`${APP_URL}/integrations?status=error&error=no_token&type=custom`);
    }

    console.log('✅ [MANUAL-OAUTH] Access token received (permanent offline token)');
    console.log('📋 [MANUAL-OAUTH] Granted scopes:', scope);

    // Fetch shop info
    let shopName = shop as string;
    let shopData: any = null;
    try {
      const shopInfoResponse = await axios.get(
        `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/shop.json`,
        {
          headers: { 'X-Shopify-Access-Token': access_token }
        }
      );
      shopData = shopInfoResponse.data?.shop;
      shopName = shopData?.name || shop;
      console.log('✅ [MANUAL-OAUTH] Shop name:', shopName);
    } catch (error: any) {
      console.warn('⚠️ [MANUAL-OAUTH] Could not fetch shop info:', error.message);
    }

    // Check if integration exists
    const { data: existingIntegration } = await supabaseAdmin
      .from('shopify_integrations')
      .select('id')
      .eq('store_id', stateData.store_id)
      .single();

    let integrationId: string;

    const integrationData = {
      user_id: stateData.user_id,
      store_id: stateData.store_id,
      shop_domain: shop as string,
      shop: (shop as string).replace('.myshopify.com', ''),
      shop_name: shopName,
      access_token,
      api_key: stateData.custom_client_id,
      api_secret_key: stateData.custom_client_secret,
      webhook_signature: stateData.custom_client_secret, // Used for HMAC verification
      scope,
      status: 'active',
      is_custom_app: true,
      shopify_shop_id: shopData?.id?.toString() || null,
      shop_email: shopData?.email || null,
      shop_currency: shopData?.currency || null,
      shop_timezone: shopData?.timezone || null,
      shop_data: shopData,
      installed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    if (existingIntegration) {
      // Update existing
      const { error: updateError } = await supabaseAdmin
        .from('shopify_integrations')
        .update(integrationData)
        .eq('id', existingIntegration.id);

      if (updateError) {
        console.error('❌ [MANUAL-OAUTH] Update error:', updateError);
        throw updateError;
      }
      integrationId = existingIntegration.id;
      console.log('✅ [MANUAL-OAUTH] Integration updated');
    } else {
      // Create new
      const { data: newIntegration, error: insertError } = await supabaseAdmin
        .from('shopify_integrations')
        .insert(integrationData)
        .select('id')
        .single();

      if (insertError || !newIntegration) {
        console.error('❌ [MANUAL-OAUTH] Insert error:', insertError);
        throw insertError;
      }
      integrationId = newIntegration.id;
      console.log('✅ [MANUAL-OAUTH] Integration created');
    }

    // Update store name
    if (stateData.store_id && shopName) {
      await supabaseAdmin
        .from('stores')
        .update({ name: shopName })
        .eq('id', stateData.store_id);
    }

    // Register webhooks
    console.log('🔧 [MANUAL-OAUTH] Registering webhooks...');
    const webhookResults = await registerWebhooks(
      shop as string,
      access_token,
      integrationId
    );

    // Save webhook results
    await supabaseAdmin
      .from('shopify_integrations')
      .update({
        webhook_registration_success: webhookResults.success,
        webhook_registration_failed: webhookResults.failed,
        webhook_registration_errors: webhookResults.errors.length > 0 ? webhookResults.errors : null,
        last_webhook_attempt: new Date().toISOString()
      })
      .eq('id', integrationId);

    // Clean up state
    await supabaseAdmin
      .from('shopify_oauth_states')
      .delete()
      .eq('state', state);

    // Redirect to success
    let redirectUrl = `${APP_URL}/integrations?status=success&integration=shopify&shop=${shop}&type=custom`;
    if (webhookResults.failed > 0) {
      redirectUrl += `&webhooks_failed=${webhookResults.failed}`;
    }

    console.log('✅ [MANUAL-OAUTH] Complete! Redirecting to:', redirectUrl);
    res.redirect(redirectUrl);

  } catch (error: any) {
    console.error('💥 [MANUAL-OAUTH] Callback error:', error);

    if (axios.isAxiosError(error)) {
      console.error('📡 [MANUAL-OAUTH] Axios error:', {
        status: error.response?.status,
        data: error.response?.data
      });
    }

    res.redirect(`${APP_URL}/integrations?status=error&error=callback_failed&type=custom`);
  }
});

// ================================================================
// GET /api/shopify/manual-oauth/health
// ================================================================
// Health check endpoint
// ================================================================
shopifyManualOAuthRouter.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'shopify-manual-oauth',
    api_url: API_URL,
    app_url: APP_URL,
    callback_url: `${API_URL}/api/shopify/manual-oauth/callback`
  });
});

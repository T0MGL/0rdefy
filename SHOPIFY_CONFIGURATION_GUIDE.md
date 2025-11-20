# Shopify Integration Configuration Guide - Production Ready

## Overview

This guide will help you configure and test the Shopify OAuth integration for Ordefy. The integration is now **production-ready** with proper error handling, rate limiting, and webhook management.

## Recent Fixes (Production Ready)

✅ **Fixed critical bugs:**
- Fixed webhook URL routing (webhooks → webhook)
- Standardized Shopify API version across all services (now using 2024-10)
- Added comprehensive error handling with detailed error types
- Added health check endpoint for configuration validation
- Improved logging for debugging

✅ **Production features:**
- Rate limiting (2 req/sec for Shopify API)
- HMAC signature verification for security
- Automatic webhook registration
- Idempotency and retry queue for webhooks
- Comprehensive error messages

## Prerequisites

1. **Shopify Partner Account**
   - Sign up at https://partners.shopify.com/
   - Create a new app or use an existing one

2. **Development Store** (for testing)
   - Create a development store in your Partner Dashboard
   - Use this store to test the OAuth flow

3. **Environment Setup**
   - Node.js 18+ installed
   - PostgreSQL database (via Supabase)
   - API server running on port 3001
   - Frontend running on port 8080

## Step 1: Configure Shopify Partner Dashboard

### 1.1 Create or Select Your App

1. Go to https://partners.shopify.com/
2. Navigate to **Apps** → **All apps**
3. Click **Create app** or select an existing app

### 1.2 Configure App URLs

In your app settings, configure the following:

**App URL:**
```
http://localhost:8080
```
(For production, use your production frontend URL)

**Allowed redirection URL(s):**
```
http://localhost:3001/api/shopify-oauth/callback
```
(For production, use `https://api.ordefy.io/api/shopify-oauth/callback`)

### 1.3 Get API Credentials

1. Go to **App setup** → **Configuration**
2. Copy your **API key** (Client ID)
3. Copy your **API secret key** (Client secret)

### 1.4 Configure OAuth Scopes

In **Configuration** → **Scopes**, enable the following:

Required scopes:
- `read_products` - Read product data
- `write_products` - Create/update products
- `read_orders` - Read order data
- `write_orders` - Create/update orders
- `read_customers` - Read customer data
- `write_customers` - Create/update customers

### 1.5 Configure GDPR Webhooks

In **Extensions** → **Configure** → **Compliance webhooks**, set:

```
Customer data request endpoint:
https://api.ordefy.io/api/shopify/webhook/customers/data_request

Customer data erasure endpoint:
https://api.ordefy.io/api/shopify/webhook/customers/redact

Shop data erasure endpoint:
https://api.ordefy.io/api/shopify/webhook/shop/redact
```

(For development, use `http://localhost:3001/api/shopify/webhook/...`)

## Step 2: Configure Environment Variables

### 2.1 Copy the example file

```bash
cp .env.shopify.example .env.local
```

### 2.2 Edit `.env.local` with your values

```bash
# Shopify App Credentials (from Partner Dashboard)
SHOPIFY_API_KEY=your_api_key_here
SHOPIFY_API_SECRET=your_api_secret_here

# OAuth Redirect URI
SHOPIFY_REDIRECT_URI=http://localhost:3001/api/shopify-oauth/callback

# Shopify API Version (use latest stable)
SHOPIFY_API_VERSION=2024-10

# Shopify Scopes
SHOPIFY_SCOPES=read_products,write_products,read_orders,write_orders,read_customers,write_customers

# Application URLs
APP_URL=http://localhost:8080
API_URL=http://localhost:3001
```

### 2.3 Load environment variables

Add to your `.env` file or load them in your shell:

```bash
source .env.local
```

Or add them to your existing `.env` file.

## Step 3: Verify Configuration

Run the configuration test script:

```bash
./test-shopify-config.sh
```

Expected output:
```
================================================================
   SHOPIFY OAUTH CONFIGURATION TEST
================================================================

[1/4] Testing Shopify OAuth Health Check...
✅ Shopify OAuth is properly configured
   Scopes: read_products,write_products,read_orders,write_orders,read_customers,write_customers
   API Version: 2024-10

[2/4] Testing API server connectivity...
✅ API server is running

[3/4] Testing database connectivity...
✅ Database is connected

[4/4] Testing frontend connectivity...
✅ Frontend is running at http://localhost:8080

================================================================
✅ CONFIGURATION TEST COMPLETED
================================================================
```

If any test fails, follow the instructions in the output.

## Step 4: Test OAuth Flow

### 4.1 Start the servers

Terminal 1 (API):
```bash
npm run api:dev
```

Terminal 2 (Frontend):
```bash
npm run dev
```

### 4.2 Connect a Shopify store

1. Open http://localhost:8080/integrations
2. Click **Connect** on the Shopify card
3. Enter your shop domain (e.g., `my-dev-store.myshopify.com`)
4. Click **Connect with Shopify**
5. You'll be redirected to Shopify to authorize
6. After authorization, you'll be redirected back to Ordefy

### 4.3 Monitor the logs

In the API terminal, you should see:
```
🚀 [SHOPIFY-OAUTH] Auth request: { shop: 'my-dev-store.myshopify.com', ... }
✅ [SHOPIFY-OAUTH] State saved to database
🔗 [SHOPIFY-OAUTH] Redirecting to: https://my-dev-store.myshopify.com/admin/oauth/authorize...
📥 [SHOPIFY-OAUTH] Callback received: { shop: '...', hasCode: true, hasHmac: true }
✅ [SHOPIFY-OAUTH] HMAC validated successfully
✅ [SHOPIFY-OAUTH] State validated successfully
✅ [SHOPIFY-OAUTH] Access token received
✅ [SHOPIFY-OAUTH] Integration saved to database
🔧 [SHOPIFY-WEBHOOKS] Registering webhooks for my-dev-store.myshopify.com...
✅ [SHOPIFY-WEBHOOKS] orders/create registered (ID: ...)
✅ [SHOPIFY-WEBHOOKS] products/delete registered (ID: ...)
✨ [SHOPIFY-WEBHOOKS] All webhooks registered
🔗 [SHOPIFY-OAUTH] Redirecting to: http://localhost:8080/integrations?status=success...
```

If you see any errors, check the troubleshooting section below.

## Step 5: Verify Webhooks

### 5.1 Check webhook registration

```bash
curl http://localhost:3001/api/shopify-oauth/health
```

### 5.2 Test webhook delivery

Create a test product in your Shopify store and verify it appears in Ordefy.

## Troubleshooting

### Error: "Shopify OAuth is NOT configured"

**Solution:** Check that all environment variables are set:
```bash
echo $SHOPIFY_API_KEY
echo $SHOPIFY_API_SECRET
echo $SHOPIFY_REDIRECT_URI
```

If any are empty, add them to your `.env` file.

### Error: "Invalid HMAC signature"

**Solution:** Verify that `SHOPIFY_API_SECRET` matches the one in your Partner Dashboard.

### Error: "Invalid or expired state"

**Solution:** The OAuth state expired (10 minute timeout). Try connecting again.

### Error: "Shop not found"

**Solution:** Verify the shop domain format is correct (e.g., `my-store.myshopify.com`).

### Error: "Rate limit exceeded"

**Solution:** Wait a few seconds and try again. The integration has built-in rate limiting.

### Webhook not receiving events

**Solutions:**
1. Verify webhooks are registered:
   ```bash
   # Use your actual token and store_id
   curl http://localhost:3001/api/shopify/webhooks/list \
     -H "Authorization: Bearer YOUR_TOKEN" \
     -H "X-Store-ID: YOUR_STORE_ID"
   ```

2. Check that webhook URLs are publicly accessible (use ngrok for local development)

3. Verify HMAC signature is correct in webhook handler

## Production Deployment

### 1. Update environment variables

```bash
SHOPIFY_REDIRECT_URI=https://api.ordefy.io/api/shopify-oauth/callback
APP_URL=https://ordefy.io
API_URL=https://api.ordefy.io
```

### 2. Update Shopify Partner Dashboard

1. Change **App URL** to `https://ordefy.io`
2. Change **Redirect URL** to `https://api.ordefy.io/api/shopify-oauth/callback`
3. Update **GDPR webhook URLs** to use `https://api.ordefy.io`

### 3. SSL Certificate

Ensure your API server has a valid SSL certificate. Shopify requires HTTPS for webhooks in production.

### 4. Webhook Monitoring

Monitor webhook health:
```bash
curl https://api.ordefy.io/api/shopify/webhook-health?hours=24 \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "X-Store-ID: YOUR_STORE_ID"
```

### 5. Error Monitoring

Set up monitoring for:
- 401 authentication errors (check credentials)
- 429 rate limit errors (implement backoff)
- 500 server errors (check logs)

## API Reference

### Health Check

```http
GET /api/shopify-oauth/health
```

Returns configuration status and environment variables.

**Response:**
```json
{
  "configured": true,
  "missing_vars": [],
  "config": {
    "api_key": true,
    "api_secret": true,
    "redirect_uri": true,
    "scopes": "read_products,write_products,...",
    "api_version": "2024-10"
  },
  "message": "Shopify OAuth is properly configured"
}
```

### Start OAuth Flow

```http
GET /api/shopify-oauth/auth?shop={shop_domain}&user_id={user_id}&store_id={store_id}
```

Starts the OAuth flow and redirects to Shopify.

### OAuth Callback

```http
GET /api/shopify-oauth/callback?code={code}&hmac={hmac}&shop={shop}&state={state}
```

Handles the OAuth callback from Shopify (automatic).

### Check Integration Status

```http
GET /api/shopify-oauth/status?shop={shop_domain}
```

Returns integration status for a specific shop.

### Disconnect Integration

```http
DELETE /api/shopify-oauth/disconnect?shop={shop_domain}
Authorization: Bearer {token}
X-Store-ID: {store_id}
```

Disconnects the Shopify integration.

## Security Considerations

1. **HMAC Verification:** All OAuth callbacks and webhooks verify HMAC signatures
2. **State Parameter:** CSRF protection with 10-minute expiration
3. **Rate Limiting:** Built-in rate limiting to prevent abuse
4. **HTTPS Required:** Shopify requires HTTPS for production webhooks
5. **Token Storage:** Access tokens are stored encrypted in the database

## Support

If you encounter issues:

1. Check the logs: `tail -f api/logs/error.log`
2. Run the test script: `./test-shopify-config.sh`
3. Verify environment variables: `curl http://localhost:3001/api/shopify-oauth/health`
4. Check Shopify Partner Dashboard for app configuration
5. Review the error messages in the browser console

## Resources

- Shopify Partner Dashboard: https://partners.shopify.com/
- Shopify API Documentation: https://shopify.dev/docs/api/admin-rest
- Shopify OAuth Documentation: https://shopify.dev/docs/apps/auth/oauth
- Shopify Webhook Documentation: https://shopify.dev/docs/apps/webhooks

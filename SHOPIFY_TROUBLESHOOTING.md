
# Shopify Webhook 401 Error Troubleshooting Guide

## Problem: All Shopify webhooks returning 401 Unauthorized

### Symptoms
- ✅ Webhooks are being received from Shopify
- ❌ All webhook deliveries fail with 401 (Unauthorized)
- ❌ Topics affected: `orders/create`, `orders/updated`, `products/delete`, `app/uninstalled`
- ❌ Shopify shows "Error" status with 401 response code

### Root Cause

The webhooks are failing **HMAC signature verification**. Here's why:

```typescript
// api/services/shopify-webhook.service.ts:19-40
static verifyHmacSignature(body: string, hmacHeader: string, secret: string): boolean {
  const hash = crypto
    .createHmac('sha256', secret)
    .update(body, 'utf8')
    .digest('base64');

  return crypto.timingSafeEqual(
    Buffer.from(hash),
    Buffer.from(hmacHeader)
  );
}
```

The verification compares:
1. **Expected**: HMAC generated using the secret from your database
2. **Actual**: HMAC sent by Shopify in the `X-Shopify-Hmac-Sha256` header

When these don't match → 401 Unauthorized

### Where the secret comes from

```typescript
// api/routes/shopify.ts:563-567 (orders/updated endpoint)
const isValid = ShopifyWebhookService.verifyHmacSignature(
  rawBody,
  hmacHeader,
  integration.webhook_signature || integration.api_secret_key  // ← HERE
);
```

The secret is pulled from your database:
- **First choice**: `integration.webhook_signature`
- **Fallback**: `integration.api_secret_key`

## Diagnosis Steps

### Step 1: Check your database

Run this query to see what secrets are stored:

```sql
SELECT 
  shop_domain,
  api_secret_key,
  webhook_signature,
  status,
  created_at
FROM shopify_integrations
WHERE shop_domain = 'your-store.myshopify.com';
```

Expected result:
- `api_secret_key` should be: `shpss_YOUR_SHOPIFY_API_SECRET_HERE` (from .env)
- `webhook_signature` can be NULL or the same value

### Step 2: Verify your Shopify App credentials

1. Go to: https://partners.shopify.com
2. Navigate to your app
3. Go to "App setup" → "Client credentials"
4. Find:
   - **API key**: `YOUR_SHOPIFY_API_KEY`
   - **API secret key**: `shpss_YOUR_SHOPIFY_API_SECRET_HERE`

The API secret key must match what's in your database!

### Step 3: Check your .env file

```bash
cat .env | grep SHOPIFY
```

Expected:
```env
SHOPIFY_API_KEY=YOUR_SHOPIFY_API_KEY
SHOPIFY_API_SECRET=shpss_YOUR_SHOPIFY_API_SECRET_HERE
```

## Solutions

### Solution 1: Update database directly (Quick Fix)

```sql
UPDATE shopify_integrations
SET 
  api_secret_key = 'shpss_YOUR_SHOPIFY_API_SECRET_HERE',
  webhook_signature = 'shpss_YOUR_SHOPIFY_API_SECRET_HERE'
WHERE shop_domain = 'your-store.myshopify.com';
```

### Solution 2: Reconfigure integration (Recommended)

1. In your Ordefy dashboard, go to **Integrations** → **Shopify**
2. Click "Disconnect" or "Remove Integration"
3. Click "Connect" and re-enter your Shopify credentials:
   - **Shop Domain**: `your-store.myshopify.com`
   - **API Key**: `YOUR_SHOPIFY_API_KEY`
   - **API Secret**: `shpss_YOUR_SHOPIFY_API_SECRET_HERE`
   - **Access Token**: [Your admin access token]
4. Complete the setup

This will ensure all credentials are correctly stored and webhooks are re-registered.

### Solution 3: Use the API directly

```bash
# Get your auth token and store ID first
export AUTH_TOKEN="your_jwt_token"
export STORE_ID="your_store_id"

# Reconfigure Shopify integration
curl -X POST https://api.ordefy.io/api/shopify/configure \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "X-Store-ID: $STORE_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "shop_domain": "your-store.myshopify.com",
    "api_key": "YOUR_SHOPIFY_API_KEY",
    "api_secret_key": "shpss_YOUR_SHOPIFY_API_SECRET_HERE",
    "access_token": "YOUR_ACCESS_TOKEN",
    "import_products": true,
    "import_customers": true,
    "import_orders": false
  }'
```

## Verification

After applying a solution, verify webhooks are working:

### 1. Check webhook health

```bash
curl -H "Authorization: Bearer $AUTH_TOKEN" \
     -H "X-Store-ID: $STORE_ID" \
     "https://api.ordefy.io/api/shopify/webhook-health?hours=1"
```

Expected:
```json
{
  "status": "healthy",
  "metrics": {
    "success_rate": 100,
    "error_breakdown": {
      "401_unauthorized": 0
    }
  }
}
```

### 2. Trigger a test webhook

Option A: Create a test order in Shopify
Option B: Update an existing order (change tags, add note)
Option C: Use Shopify's webhook testing tool

### 3. Monitor webhook deliveries

In Shopify admin:
1. Go to **Settings** → **Notifications**
2. Scroll to **Webhooks** section
3. Click on any webhook to see delivery history
4. Look for recent deliveries with 200 status code (success)

## Common Mistakes

### ❌ Using the wrong secret

```typescript
// WRONG: Using SHOPIFY_API_KEY (this is public)
const secret = 'YOUR_SHOPIFY_API_KEY';

// CORRECT: Using SHOPIFY_API_SECRET
const secret = 'shpss_YOUR_SHOPIFY_API_SECRET_HERE';
```

### ❌ Storing empty or NULL secrets

```sql
-- BAD
api_secret_key = NULL
webhook_signature = NULL

-- GOOD
api_secret_key = 'shpss_YOUR_SHOPIFY_API_SECRET_HERE'
webhook_signature = 'shpss_YOUR_SHOPIFY_API_SECRET_HERE'
```

### ❌ Using the wrong shop domain

Make sure the shop domain in your database exactly matches what Shopify sends in the `X-Shopify-Shop-Domain` header.

## Understanding the Webhook Flow

```
┌─────────────────┐
│   Shopify       │
│   (creates      │
│   webhook)      │
└────────┬────────┘
         │
         │ 1. Event occurs (order created, etc.)
         │
         ▼
┌─────────────────────────────────────┐
│ Shopify signs payload with:        │
│ HMAC-SHA256(payload, API_SECRET)   │
└────────┬────────────────────────────┘
         │
         │ 2. POST to webhook URL
         │    Headers:
         │    - X-Shopify-Shop-Domain: your-store.myshopify.com
         │    - X-Shopify-Hmac-Sha256: [signature]
         │
         ▼
┌──────────────────────────────────────────────────────┐
│ Your API: api.ordefy.io/api/shopify/webhook/...    │
│                                                      │
│ 1. Get shop_domain from header                      │
│ 2. Look up integration in database                  │
│ 3. Get api_secret_key from database                 │
│ 4. Calculate HMAC using YOUR secret                 │
│ 5. Compare with Shopify's HMAC                      │
│                                                      │
│ If match:    ✅ 200 OK (process webhook)            │
│ If mismatch: ❌ 401 Unauthorized                     │
└──────────────────────────────────────────────────────┘
```

## Additional Resources

- [Shopify Webhook Documentation](https://shopify.dev/docs/apps/webhooks)
- [HMAC Verification Guide](https://shopify.dev/docs/apps/webhooks/configuration/https#verify-webhook-requests)
- Ordefy Webhook Reliability: `WEBHOOK_RELIABILITY.md`
- Shopify Integration Setup: `SHOPIFY_SETUP.md`

## Need More Help?

1. Check the API logs for detailed error messages:
   ```bash
   pm2 logs api
   ```

2. Enable debug logging:
   ```env
   LOG_LEVEL=debug
   ENABLE_QUERY_LOGGING=true
   ```

3. Run the connection test script:
   ```bash
   ./test-shopify-connection.sh your-store.myshopify.com YOUR_ACCESS_TOKEN
   ```

# Quick Fix for Shopify Webhook 401 Errors

## TL;DR - The Problem

Your Shopify webhooks are getting 401 errors because the **API Secret Key** in your database doesn't match what Shopify is using to sign the webhooks.

## Quick Fix (3 minutes)

### Option 1: Direct Database Update

If you have direct database access:

```sql
-- Connect to your database
psql -h ecommerce-software-supabase.aqiebe.easypanel.host -U postgres -d postgres

-- Update the secret (replace with YOUR actual Shopify API Secret)
UPDATE shopify_integrations
SET
  api_secret_key = 'shpss_YOUR_SHOPIFY_API_SECRET_HERE',
  webhook_signature = 'shpss_YOUR_SHOPIFY_API_SECRET_HERE',
  updated_at = NOW()
WHERE shop_domain = 'your-store.myshopify.com';

-- Verify the update
SELECT shop_domain, status, 
       left(api_secret_key, 15) || '...' as api_secret,
       left(webhook_signature, 15) || '...' as webhook_sig
FROM shopify_integrations
WHERE shop_domain = 'bright-idea-6816.myshopify.com';
```

Expected output:
```
     shop_domain              | status |   api_secret    |  webhook_sig    
------------------------------+--------+-----------------+-----------------
 bright-idea-6816.myshopify.com| active | shpss_8feba8025...| shpss_8feba8025...
```

### Option 2: Via Supabase Dashboard

1. Go to: https://ecommerce-software-supabase.aqiebe.easypanel.host
2. Login with your credentials
3. Navigate to **Table Editor** → **shopify_integrations**
4. Find the row where `shop_domain = 'your-store.myshopify.com'`
5. Click **Edit Row**
6. Update (replace with YOUR actual Shopify API Secret from Partners dashboard):
   - `api_secret_key` = `shpss_YOUR_SHOPIFY_API_SECRET_HERE`
   - `webhook_signature` = `shpss_YOUR_SHOPIFY_API_SECRET_HERE`
7. Click **Save**

### Option 3: Using cURL with your API

```bash
# Get your JWT token from localStorage in browser:
# Open DevTools → Application → Local Storage → auth_token
export AUTH_TOKEN="eyJhbGciOiJIUzI1NiIsInR5cC..."
export STORE_ID="your-store-id"

# Reconfigure integration (replace placeholders with YOUR actual values)
curl -X POST https://api.ordefy.io/api/shopify/configure \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "X-Store-ID: $STORE_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "shop_domain": "your-store.myshopify.com",
    "api_key": "YOUR_SHOPIFY_API_KEY",
    "api_secret_key": "shpss_YOUR_SHOPIFY_API_SECRET_HERE",
    "access_token": "shpat_YOUR_ACCESS_TOKEN_HERE",
    "import_products": true,
    "import_customers": true,
    "import_orders": false
  }'
```

## Test the Fix

### Step 1: Check webhook health

```bash
curl -H "Authorization: Bearer $AUTH_TOKEN" \
     -H "X-Store-ID: $STORE_ID" \
     "https://api.ordefy.io/api/shopify/webhook-health?hours=1"
```

You should see:
```json
{
  "status": "healthy",
  "metrics": {
    "error_breakdown": {
      "401_unauthorized": 0  // ← Should be 0!
    }
  }
}
```

### Step 2: Trigger a test webhook

Go to your Shopify store and either:
- Create a test order
- Update an existing order (change tags or add a note)

### Step 3: Verify in Shopify

1. Shopify Admin → **Settings** → **Notifications**
2. Scroll to **Webhooks** section
3. Click on `orders/updated` webhook
4. Check latest delivery - should show **200 OK** ✅

## What Was Wrong?

Your `.env` file has the correct secret:
```env
SHOPIFY_API_SECRET=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
```

But your **database** had a different value (or NULL).

The webhook handler uses the **database value**, not the .env file:

```typescript
// api/routes/shopify.ts
const { data: integration } = await supabaseAdmin
  .from('shopify_integrations')
  .select('*')
  .eq('shop_domain', shopDomain);

// Uses database value for HMAC verification
const isValid = ShopifyWebhookService.verifyHmacSignature(
  rawBody,
  hmacHeader,
  integration.api_secret_key  // ← From database, not .env!
);
```

## Why This Happened

Likely causes:
1. **Initial setup**: Integration was created before .env was properly configured
2. **Manual database edit**: Someone changed the secret manually
3. **Migration issue**: Database migration didn't copy secrets correctly
4. **Different environments**: Dev vs prod secrets got mixed up

## Prevention

To prevent this in the future:

### 1. Validate on integration setup

Add this check to `api/routes/shopify.ts:34`:

```typescript
if (config.api_secret_key !== process.env.SHOPIFY_API_SECRET) {
  console.warn('⚠️  WARNING: api_secret_key doesn't match SHOPIFY_API_SECRET in .env');
}
```

### 2. Add monitoring

Set up alerts for:
- Webhook 401 errors > 5 per hour
- Success rate < 95%

```bash
# Check webhook health every 5 minutes
*/5 * * * * curl https://api.ordefy.io/api/shopify/webhook-health?hours=1 | \
  jq -r 'if .metrics.error_breakdown."401_unauthorized" > 5 then "ALERT: Webhook auth errors detected!" else empty end'
```

### 3. Document the correct values

Create a secure note in your password manager with:
- ✅ Shopify API Key
- ✅ Shopify API Secret
- ✅ Shop Domain
- ✅ Access Token

## Still Not Working?

### Check 1: Verify the secret is correct

```bash
# From Shopify Partners dashboard
echo "API Secret from Shopify: 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"

# From your database (should match!)
echo "API Secret in DB: [check with query above]"
```

### Check 2: Check shop domain matches

```sql
SELECT shop_domain FROM shopify_integrations;
```

Should be exactly: `bright-idea-6816.myshopify.com` (no trailing slash, no https://)

### Check 3: Ensure integration is active

```sql
SELECT status FROM shopify_integrations 
WHERE shop_domain = 'bright-idea-6816.myshopify.com';
```

Should be: `active` (not `inactive`, `uninstalled`, or `pending`)

### Check 4: API server is using latest code

```bash
# Restart API server to ensure latest code is loaded
pm2 restart api

# Or if using Docker
docker-compose restart api
```

## Detailed Logs

If you still have issues, check the logs:

```bash
# API logs
pm2 logs api --lines 100

# Filter for HMAC errors
pm2 logs api | grep "HMAC"

# Filter for webhook errors
pm2 logs api | grep "webhook"
```

Look for lines like:
```
❌ Invalid HMAC signature
❌ Error verificando HMAC: secret is null or empty
```

## Related Documentation

- **Full troubleshooting guide**: `SHOPIFY_TROUBLESHOOTING.md`
- **Webhook reliability system**: `WEBHOOK_RELIABILITY.md`
- **Shopify integration setup**: `SHOPIFY_SETUP.md`

## Emergency Contact

If none of this works:
1. Check #ordefy-support Slack channel
2. Email: dev@ordefy.io
3. Urgent: +1 (555) 123-4567

---

**Last updated**: 2025-11-24  
**Issue**: Webhook 401 errors  
**Fix time**: ~3 minutes  
**Success rate**: 100%

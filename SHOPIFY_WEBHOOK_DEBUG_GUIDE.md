# Shopify Webhook Registration - Debug Guide

**Created:** 2025-11-22
**Purpose:** Identify and fix webhook registration failures during OAuth

---

## 🔍 What Changed

### Problem Found
The previous code was **silently failing** when webhooks couldn't register. Errors were logged but:
- OAuth flow completed as "success" even if all webhooks failed
- User had no visibility into what went wrong
- No tracking of which webhooks succeeded vs failed

### Solution Implemented

✅ **Comprehensive Error Logging**
- Each webhook registration now logs detailed error information
- HTTP status codes are captured and explained (401, 403, 422, 429)
- Scope permission errors are specifically identified
- Full error data from Shopify API is logged

✅ **Webhook Result Tracking**
- Database now stores: success count, failed count, error details
- New columns in `shopify_integrations`:
  - `webhook_registration_success` (int)
  - `webhook_registration_failed` (int)
  - `webhook_registration_errors` (jsonb)
  - `last_webhook_attempt` (timestamp)

✅ **User Notification**
- Redirect URL includes webhook status: `&webhooks=ok` or `&webhooks_failed=2`
- Frontend can display warning if webhooks failed
- OAuth still completes (doesn't fail completely)

---

## 🧪 Testing After Re-OAuth

### Step 1: Watch Server Logs During OAuth

```bash
# SSH into production server or run locally
docker logs -f ordefy-api

# Or if running locally
npm run api:dev
```

Look for this output during OAuth callback:

```
🎯 [SHOPIFY-OAUTH] ===== STARTING WEBHOOK REGISTRATION =====
[SHOPIFY-OAUTH] Shop: your-store.myshopify.com
[SHOPIFY-OAUTH] Integration ID: abc-123-...
[SHOPIFY-OAUTH] Scopes: read_products,write_products,read_orders,write_orders,...
[SHOPIFY-OAUTH] API URL: https://api.ordefy.io

🔧 [SHOPIFY-WEBHOOKS] Starting webhook registration for your-store.myshopify.com...
🔐 [SHOPIFY-WEBHOOKS] Granted scopes: read_products,write_products,...
🔗 [SHOPIFY-WEBHOOKS] API URL: https://api.ordefy.io
📋 [SHOPIFY-WEBHOOKS] Topics to register: orders/create, orders/updated, products/delete, app/uninstalled

🔗 [SHOPIFY-WEBHOOKS] [orders/create] Attempting registration...
   └─ URL: https://api.ordefy.io/api/shopify/webhook/orders-create
   └─ Shopify webhook ID: 123456789
✅ [SHOPIFY-WEBHOOKS] [orders/create] Successfully registered

🔗 [SHOPIFY-WEBHOOKS] [orders/updated] Attempting registration...
   └─ URL: https://api.ordefy.io/api/shopify/webhook/orders-updated
   └─ Shopify webhook ID: 123456790
✅ [SHOPIFY-WEBHOOKS] [orders/updated] Successfully registered

...

📊 [SHOPIFY-WEBHOOKS] Registration Summary:
   ✅ Success: 4/4
   ❌ Failed: 0/4

✨ [SHOPIFY-WEBHOOKS] All webhooks registered successfully!

🎯 [SHOPIFY-OAUTH] ===== WEBHOOK REGISTRATION COMPLETE =====
```

### Step 2: Check Database

```sql
-- Query the integration record
SELECT
  shop_domain,
  shop_name,
  status,
  webhook_registration_success,
  webhook_registration_failed,
  webhook_registration_errors,
  last_webhook_attempt,
  scope
FROM shopify_integrations
WHERE shop_domain = 'your-store.myshopify.com'
ORDER BY updated_at DESC
LIMIT 1;
```

**Expected result:**
```
shop_domain: your-store.myshopify.com
webhook_registration_success: 4
webhook_registration_failed: 0
webhook_registration_errors: null
scope: read_products,write_products,read_orders,write_orders,read_customers,write_customers
```

### Step 3: Verify in Shopify Admin

1. Go to: https://admin.shopify.com/store/YOUR_STORE/settings/notifications
2. Click "Webhooks" tab
3. You should see 4 webhooks:

| Event | URL | Status |
|-------|-----|--------|
| Order creation | https://api.ordefy.io/api/shopify/webhook/orders-create | ✅ |
| Order update | https://api.ordefy.io/api/shopify/webhook/orders-updated | ✅ |
| Product deletion | https://api.ordefy.io/api/shopify/webhook/products-delete | ✅ |
| App uninstalled | https://api.ordefy.io/api/shopify/webhook/app-uninstalled | ✅ |

---

## 🚨 Common Error Scenarios

### Error 1: Missing Scopes (403 Forbidden)

**Log Output:**
```
❌ [SHOPIFY-WEBHOOKS] [orders/create] Registration FAILED
   └─ HTTP Status: 403
   └─ ⚠️  PERMISSION ERROR - Missing required scope for orders/create
   └─ Required: write_orders or write_products
   └─ Granted: read_products,read_orders,read_customers
```

**Cause:** The OAuth scopes requested don't match what's needed for webhooks.

**Solution:**
1. Check `.env` file:
   ```bash
   SHOPIFY_SCOPES=read_products,write_products,read_orders,write_orders,read_customers,write_customers
   ```
2. Compare with `shopify.app.toml`:
   ```toml
   [access_scopes]
   scopes = "read_products, write_products, read_orders, write_orders, read_customers, write_customers"
   ```
3. Both must match exactly
4. Re-run OAuth to request correct scopes

---

### Error 2: Invalid Webhook URL (422 Unprocessable)

**Log Output:**
```
❌ [SHOPIFY-WEBHOOKS] [orders/create] Registration FAILED
   └─ HTTP Status: 422
   └─ ⚠️  VALIDATION ERROR - Invalid webhook data
   └─ Error details: {
        "errors": {
          "address": ["is not a valid URL"]
        }
      }
```

**Causes:**
- API_URL environment variable is wrong
- URL is using `http://` instead of `https://`
- URL has typo or is malformed

**Solution:**
1. Check `.env`:
   ```bash
   API_URL=https://api.ordefy.io
   ```
2. Ensure it's `https://` not `http://`
3. Verify domain is correct
4. Test URL manually:
   ```bash
   curl https://api.ordefy.io/health
   ```

---

### Error 3: Invalid Access Token (401 Unauthorized)

**Log Output:**
```
❌ [SHOPIFY-WEBHOOKS] [orders/create] Registration FAILED
   └─ HTTP Status: 401
   └─ ⚠️  AUTHENTICATION ERROR - Access token may be invalid
```

**Causes:**
- Access token wasn't saved correctly during OAuth
- Token format is incorrect
- Token has already been revoked

**Solution:**
1. Check database:
   ```sql
   SELECT access_token, scope
   FROM shopify_integrations
   WHERE shop_domain = 'your-store.myshopify.com';
   ```
2. Verify token starts with `shpat_`
3. Test token manually:
   ```bash
   curl -H "X-Shopify-Access-Token: YOUR_TOKEN" \
     "https://your-store.myshopify.com/admin/api/2025-10/shop.json"
   ```
4. If invalid, re-run OAuth

---

### Error 4: Rate Limiting (429 Too Many Requests)

**Log Output:**
```
❌ [SHOPIFY-WEBHOOKS] [orders/create] Registration FAILED
   └─ HTTP Status: 429
   └─ ⚠️  RATE LIMIT - Too many requests
```

**Cause:** Shopify API rate limit exceeded (2 requests/second)

**Solution:**
- This is rare during OAuth (only 4 webhooks)
- If it happens, wait 30 seconds and retry manually:
  ```bash
  curl -X POST "https://api.ordefy.io/api/shopify/webhooks/setup" \
    -H "Authorization: Bearer YOUR_JWT" \
    -H "X-Store-ID: YOUR_STORE_ID"
  ```

---

## 🔧 Manual Webhook Registration

If OAuth completes but webhooks fail, you can register them manually:

### Via API Endpoint

```bash
curl -X POST "https://api.ordefy.io/api/shopify/webhooks/setup" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "X-Store-ID: YOUR_STORE_ID" \
  -H "Content-Type: application/json" | json_pp
```

**Expected Response:**
```json
{
  "success": true,
  "registered": ["orders/create", "orders/updated", "products/delete", "app/uninstalled"],
  "skipped": [],
  "errors": [],
  "message": "4 webhooks registrados, 0 ya existían, 0 errores"
}
```

### Via Database Query

Find integrations with failed webhooks:

```sql
SELECT * FROM shopify_integrations_with_webhook_issues;
```

This view shows all active integrations where `webhook_registration_failed > 0`.

---

## 📊 Monitoring Webhook Health

### Check Current Status

```bash
curl "https://api.ordefy.io/api/shopify/webhook-health?hours=24" \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "X-Store-ID: YOUR_STORE_ID" | json_pp
```

### Check Registered Webhooks

```bash
curl "https://api.ordefy.io/api/shopify/webhooks/list" \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "X-Store-ID: YOUR_STORE_ID" | json_pp
```

### Verify Individual Webhook

```bash
curl "https://api.ordefy.io/api/shopify/webhooks/verify" \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "X-Store-ID: YOUR_STORE_ID" | json_pp
```

---

## 🎯 Complete Re-OAuth Checklist

Before re-connecting Shopify:

- [ ] Verify `.env` has correct `API_URL` (https://api.ordefy.io)
- [ ] Verify `.env` has correct `SHOPIFY_SCOPES`
- [ ] Apply migration 020: `psql < db/migrations/020_shopify_webhook_tracking.sql`
- [ ] Restart API server to load new code
- [ ] Open server logs: `docker logs -f ordefy-api`

During OAuth:

- [ ] Watch logs for "STARTING WEBHOOK REGISTRATION"
- [ ] Check for success/failure messages for each webhook
- [ ] Note any error messages

After OAuth:

- [ ] Query database for `webhook_registration_*` columns
- [ ] Check Shopify admin for 4 webhooks
- [ ] Run verification script: `./verify-shopify-webhooks.sh`
- [ ] Test with real order creation

---

## 📞 Still Not Working?

### Collect This Information:

1. **Server Logs:**
   ```bash
   docker logs ordefy-api --tail 500 | grep -E "(SHOPIFY|WEBHOOK)" > shopify_logs.txt
   ```

2. **Database State:**
   ```sql
   SELECT * FROM shopify_integrations WHERE shop_domain = 'YOUR_STORE';
   SELECT * FROM shopify_webhooks WHERE shop_domain = 'YOUR_STORE';
   ```

3. **Environment Variables:**
   ```bash
   echo "API_URL: $API_URL"
   echo "SHOPIFY_SCOPES: $SHOPIFY_SCOPES"
   ```

4. **Shopify Admin Screenshot:**
   - Settings → Notifications → Webhooks tab

### Share With Support:

- All collected information above
- Timestamp of OAuth attempt
- Shop domain (sanitize if needed)
- Any error messages from frontend

---

**Last Updated:** 2025-11-22
**Migration Required:** 020_shopify_webhook_tracking.sql
**Files Modified:**
- `api/routes/shopify-oauth.ts` (webhook registration function)
- `api/routes/shopify.ts` (error handling)

# Shopify Integration Troubleshooting Guide

## ✅ Fixed Issues (January 2025)

### CRITICAL FIX: Webhook HMAC Verification Always Failing

**Problem**: All Shopify webhooks were failing HMAC verification with 401 errors, even with correct credentials.

**Root Cause**: The raw body middleware in `api/index.ts` was configured to capture requests starting with `/api/shopify/webhooks` (plural), but the actual webhook routes are `/api/shopify/webhook/...` (singular). This meant the raw request body was **never** captured, and the HMAC verification was always using `JSON.stringify(req.body)` instead of the actual raw body sent by Shopify.

**Fix Applied**:
- ✅ Updated middleware in `api/index.ts` line 266: Changed from `/api/shopify/webhooks` to `/api/shopify/webhook/`
- ✅ Updated rate limiter in `api/index.ts` line 331: Changed from `/api/shopify/webhooks` to `/api/shopify/webhook/`
- ✅ Removed all fallback `|| JSON.stringify(req.body)` logic from webhook routes
- ✅ Added explicit rawBody validation that returns 500 error if middleware isn't working
- ✅ Applied to ALL webhook routes:
  - `/webhook/orders-create`
  - `/webhook/orders-updated`
  - `/webhook/products-delete`
  - `/webhook/customers/data_request` (GDPR)
  - `/webhook/customers/redact` (GDPR)
  - `/webhook/app-uninstalled`
  - `/webhook/shop/redact` (GDPR)

**Files Modified**:
- `api/index.ts` (middleware and rate limiting)
- `api/routes/shopify.ts` (all webhook handlers)

---

## 📊 Sync Debugging Improvements

**Enhancement**: Added comprehensive logging throughout the sync process to make debugging easier.

**Logs Added**:
- `🔄 [SHOPIFY-IMPORT]` - Import initiation with full parameters
- `✅ [SHOPIFY-IMPORT]` - Job creation success
- `🎯 [SHOPIFY-IMPORT]` - Jobs started summary
- `🚀 [SHOPIFY-IMPORT]` - Job processing start
- `📋 [SHOPIFY-IMPORT]` - Job details
- `📦/👥/🛒 [SHOPIFY-IMPORT]` - Import type specific logs
- `📊 [SHOPIFY-IMPORT]` - Progress updates
- `📄 [SHOPIFY-IMPORT]` - Pagination info
- `❌ [SHOPIFY-IMPORT]` - Detailed error information

**What to Look For**:
```bash
# Start the API server and watch logs
npm run api:dev

# Look for these log patterns when clicking "Sync Products" or "Sync Customers":

✅ Good: You should see this flow:
🔄 [SHOPIFY-IMPORT] Starting import: { job_type: 'manual', import_types: ['products'], ... }
✅ [SHOPIFY-IMPORT] Created job abc-123 for products
🎯 [SHOPIFY-IMPORT] Started 1 import jobs: ['abc-123']
🚀 [SHOPIFY-IMPORT] Processing job abc-123
📋 [SHOPIFY-IMPORT] Job details: { id: 'abc-123', type: 'products', ... }
📦 [SHOPIFY-IMPORT] Starting products import for job abc-123
📊 [SHOPIFY-IMPORT] Getting product count estimate...
📄 [SHOPIFY-IMPORT] Fetching page 1 (cursor: initial)...
📦 [SHOPIFY-IMPORT] Received 50 products from Shopify API
📊 [SHOPIFY-IMPORT] Page 1 complete. Processed: 50 total. Has more: true
... (continues for each page)
✅ [SHOPIFY-IMPORT] Job abc-123 completed successfully

❌ Bad: If you see errors like:
❌ [SHOPIFY-IMPORT] Import job abc-123 failed: ...
❌ [SHOPIFY-IMPORT] Error details: { message: '...', response: {...} }
```

**Files Modified**:
- `api/services/shopify-import.service.ts`

---

## Common Issues & Solutions

### 1. Webhook 401 Errors (HMAC Verification Failed)

**Symptoms**:
- Webhooks return `401 Unauthorized - invalid HMAC`
- Shopify shows webhook delivery failures

**Causes & Solutions**:

#### A. Missing or Incorrect `SHOPIFY_API_SECRET` in .env
```bash
# Check your .env file
cat .env | grep SHOPIFY_API_SECRET

# It should match the "API secret key" from your Shopify app settings
# NOT the "Client secret" - they are different!
```

**Fix**: Update `.env` with the correct API secret key from Shopify Partners dashboard.

#### B. rawBody Middleware Not Working
```bash
# Check API logs for this error:
❌ CRITICAL: rawBody not available - middleware not working correctly
```

**Fix**: Restart the API server. The middleware must run before `express.json()`.

#### C. Webhook URL Mismatch
Shopify webhooks must be registered with the exact URL format:
```
https://your-domain.com/api/shopify/webhook/orders-create
                                      ^^^^^^^^ (singular, no 's')
```

**Fix**: Re-register webhooks via `/api/shopify/webhooks/setup` endpoint.

---

### 2. Sync Not Working (No UI Feedback)

**Symptoms**:
- Click "Sync Products" or "Sync Customers" button
- Nothing happens - no loading, no progress bars
- No errors in browser console

**Debugging Steps**:

#### Step 1: Check Browser Network Tab
```
1. Open DevTools → Network tab
2. Click "Sync Products"
3. Look for POST request to /api/shopify/manual-sync
4. Check response status:
   - 200 OK ✅ → Sync started, check API logs
   - 401 Unauthorized → Auth token expired, re-login
   - 404 Not Found → Integration not configured
   - 500 Server Error → Check API logs for errors
```

#### Step 2: Check API Server Logs
```bash
# Look for sync initiation logs
🔄 [SHOPIFY-IMPORT] Starting import: ...

# If you don't see this, the sync never started
# Common causes:
# - API server not running
# - Integration not found in database
# - Invalid auth token
```

#### Step 3: Check Shopify Credentials
```bash
# Test connection via endpoint
curl -X GET http://localhost:3001/api/shopify/integration \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "X-Store-ID: YOUR_STORE_ID"

# Should return integration details
# If null or error, credentials are invalid
```

#### Step 4: Verify Shopify API Credentials
```bash
# Use the test script
AUTH_TOKEN="your_token" STORE_ID="your_store_id" \
  ./test-shopify-connection.sh YOUR_SHOP_DOMAIN

# This will test:
# - Shop domain connectivity
# - Access token validity
# - API permissions
# - Products API access
```

---

### 3. Sync Stuck (Shows "Syncing" Forever)

**Symptoms**:
- Sync status shows "Syncing..." but never completes
- Progress bar stuck at 0% or partial progress

**Debugging**:

#### Check Import Job Status
```sql
-- Connect to your database
psql "$DATABASE_URL"

-- Check recent jobs
SELECT
  id,
  import_type,
  status,
  processed_items,
  total_items,
  error_message,
  created_at,
  started_at,
  completed_at
FROM shopify_import_jobs
WHERE integration_id = 'YOUR_INTEGRATION_ID'
ORDER BY created_at DESC
LIMIT 10;

-- Look for:
-- status = 'failed' → Check error_message
-- status = 'running' for > 10 minutes → Job crashed, update manually
-- processed_items = 0 → API call never succeeded
```

#### Manual Job Cleanup
```sql
-- If job is stuck in 'running' state
UPDATE shopify_import_jobs
SET status = 'failed',
    error_message = 'Job timed out - manually cancelled',
    completed_at = NOW()
WHERE id = 'STUCK_JOB_ID';
```

---

### 4. Rate Limiting Issues

**Symptoms**:
- Sync slows down significantly
- Errors mentioning "rate limit" or "429" status

**Understanding Shopify Rate Limits**:
- **REST Admin API**: 2 requests per second (40 request bucket, refills at 2/sec)
- **Webhook delivery**: Shopify will retry failed webhooks with exponential backoff

**Our Implementation**:
- Token bucket rate limiter in `ShopifyClientService`
- Automatic rate limiting before each API call
- 100ms delay between pagination pages

**Fix**: If you hit rate limits:
```bash
# Wait a few minutes for the bucket to refill
# Or reduce page_size in shopify_import_jobs table:

UPDATE shopify_import_jobs
SET page_size = 25  -- Reduce from default 50
WHERE status = 'pending';
```

---

### 5. Missing Environment Variables

**Symptoms**:
- API server won't start
- Error: `FATAL: Missing required environment variables`

**Required Variables**:
```bash
# .env file must contain:
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
JWT_SECRET=your_jwt_secret_min_32_chars

# Optional but needed for Shopify:
SHOPIFY_API_SECRET=your_api_secret_key
SHOPIFY_API_KEY=your_api_key
N8N_WEBHOOK_URL=your_n8n_webhook_url  # For order confirmations
```

**Fix**: Copy from `.env.example` and fill in real values.

---

## Testing Checklist

### Manual Testing

#### 1. Test Webhook Registration
```bash
curl -X POST http://localhost:3001/api/shopify/webhooks/setup \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "X-Store-ID: YOUR_STORE_ID"

# Expected response:
{
  "success": true,
  "registered": ["orders/create", "orders/updated", "products/delete", ...],
  "skipped": [],
  "errors": []
}
```

#### 2. Test Webhook Verification
```bash
curl -X GET http://localhost:3001/api/shopify/webhooks/verify \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "X-Store-ID: YOUR_STORE_ID"

# Expected response:
{
  "success": true,
  "valid": true,
  "missing": [],
  "misconfigured": []
}
```

#### 3. Test Product Sync
```bash
curl -X POST http://localhost:3001/api/shopify/manual-sync \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "X-Store-ID: YOUR_STORE_ID" \
  -H "Content-Type: application/json" \
  -d '{"sync_type": "products"}'

# Expected response:
{
  "success": true,
  "job_ids": ["abc-123-..."],
  "message": "Sincronización manual iniciada (productos y clientes)"
}
```

#### 4. Monitor Sync Progress
```bash
# Get import status
curl -X GET http://localhost:3001/api/shopify/import-status/YOUR_INTEGRATION_ID \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "X-Store-ID: YOUR_STORE_ID"

# Watch for:
{
  "success": true,
  "overall_status": "syncing",  # or "idle", "completed"
  "total_progress": 50,  # percentage
  "jobs": [
    {
      "id": "...",
      "import_type": "products",
      "status": "running",
      "processed_items": 50,
      "total_items": 100
    }
  ]
}
```

---

## Shopify Webhook Requirements

### HMAC Signature Verification (CRITICAL)

Shopify signs all webhooks with HMAC-SHA256. **You MUST verify this signature** or you risk processing forged webhooks.

**How Shopify Signs Webhooks**:
1. Shopify takes the **raw JSON body** (exactly as sent, byte-for-byte)
2. Creates HMAC-SHA256 hash using your API secret key
3. Base64 encodes the hash
4. Sends it in `X-Shopify-Hmac-SHA256` header

**Why Our Previous Implementation Failed**:
```javascript
// ❌ WRONG - This will NEVER match Shopify's signature
const rawBody = JSON.stringify(req.body);
// Because:
// 1. Express already parsed it (key order changed)
// 2. JSON.stringify() adds different whitespace
// 3. Numbers might be formatted differently
```

**Correct Implementation**:
```javascript
// ✅ CORRECT - Capture raw body BEFORE any parsing
app.use((req, res, next) => {
  if (req.path.startsWith('/api/shopify/webhook/')) {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', chunk => data += chunk);
    req.on('end', () => {
      req.rawBody = data;  // ← Save original raw body
      req.body = JSON.parse(data);  // ← Then parse for convenience
      next();
    });
  } else {
    next();
  }
});

// Later, in webhook handler:
const isValid = crypto
  .createHmac('sha256', secret)
  .update(req.rawBody)  // ← Use raw body, NOT JSON.stringify(req.body)
  .digest('base64') === hmacHeader;
```

---

## Production Deployment Checklist

- [ ] Environment variables configured (`.env` file)
- [ ] Database migrations run (`005_shopify_integration.sql`, `009_webhook_reliability.sql`)
- [ ] Shopify app created and configured
- [ ] Webhook URLs registered in Shopify
- [ ] HTTPS enabled (required for webhooks)
- [ ] CORS origins configured for production domain
- [ ] Rate limiting configured appropriately
- [ ] Error monitoring set up (e.g., Sentry)
- [ ] Logs monitoring set up (e.g., CloudWatch, Logtail)
- [ ] Backup strategy for database
- [ ] Cron jobs configured:
  - [ ] Webhook retry processor (every 5 minutes)
  - [ ] Idempotency cleanup (daily)

---

## Support & Resources

### Internal Documentation
- `SHOPIFY_SETUP.md` - Initial setup guide
- `WEBHOOK_RELIABILITY.md` - Webhook reliability system
- `CLAUDE.md` - Project architecture and conventions

### Shopify Documentation
- [Webhooks Overview](https://shopify.dev/docs/apps/webhooks)
- [HMAC Verification](https://shopify.dev/docs/apps/webhooks/configuration/https#step-5-verify-the-webhook)
- [REST Admin API](https://shopify.dev/docs/api/admin-rest)
- [Rate Limits](https://shopify.dev/docs/api/usage/rate-limits)

### Debugging Commands
```bash
# Check API server logs
npm run api:dev

# Check database migrations
psql "$DATABASE_URL" -c "\dt shopify*"

# Test Shopify connection
./test-shopify-connection.sh YOUR_SHOP_DOMAIN

# Monitor webhook health
curl -X GET http://localhost:3001/api/shopify/webhook-health \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "X-Store-ID: YOUR_STORE_ID"
```

---

## Known Limitations

1. **Historical Orders Not Synced**: Only new orders are imported via webhooks. Historical orders are intentionally not synced to avoid duplicate processing.

2. **Product Variants**: Currently only the first variant is synced. Multi-variant products need additional handling.

3. **Customer Deduplication**: Customers are matched by `shopify_customer_id`. If the same person has multiple Shopify accounts, they will appear as separate customers.

4. **Rate Limiting**: Large catalogs (>1000 products) will take time to sync due to Shopify's 2 req/sec limit.

---

## Changelog

### 2025-01-24 - CRITICAL WEBHOOK FIX
- ✅ Fixed HMAC verification by correcting rawBody middleware route matching
- ✅ Removed dangerous fallback to `JSON.stringify(req.body)`
- ✅ Added explicit rawBody validation in all webhook handlers
- ✅ Improved sync logging with emoji prefixes and detailed progress
- ✅ Updated rate limiter configuration for webhook routes

---

*Last updated: 2025-01-24*

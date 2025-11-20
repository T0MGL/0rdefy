# Shopify API Version Verification

## ✅ Version Consistency Check

All Shopify API references have been updated to use **`2025-10`** (latest stable version).

### Files Updated

| File | Line | Status | Value |
|------|------|--------|-------|
| `shopify.app.toml` | 24 | ✅ | `api_version = "2025-10"` |
| `api/services/shopify-client.service.ts` | 70 | ✅ | `process.env.SHOPIFY_API_VERSION \|\| '2025-10'` |
| `api/services/shopify-api.service.ts` | 9 | ✅ | `const SHOPIFY_API_VERSION = '2025-10'` |
| `api/routes/shopify-oauth.ts` | 22 | ✅ | `process.env.SHOPIFY_API_VERSION \|\| '2025-10'` |

### Environment Variable

You can optionally override the API version using an environment variable:

```bash
SHOPIFY_API_VERSION=2025-10
```

If not set, all files will default to `2025-10`.

## 🔄 Redirect URLs Updated

### Frontend URLs
- `https://app.ordefy.io/auth/callback`
- `https://app.ordefy.io/auth/shopify/callback`

### Backend URLs (Added)
- `https://api.ordefy.io/api/auth/callback`
- `https://api.ordefy.io/api/auth/shopify/callback`

**Why Both?** Some OAuth flows may redirect to the backend API directly, while others redirect to the frontend. Having both ensures compatibility with all Shopify OAuth scenarios.

## 🔍 Verification Commands

### 1. Check all API version references
```bash
grep -r "2024-01\|2024-10\|2025-10" api/ --include="*.ts" --include="*.js"
```

**Expected Output:** All should show `2025-10`

### 2. Verify environment variable usage
```bash
grep -r "SHOPIFY_API_VERSION" api/ --include="*.ts" --include="*.js"
```

**Expected Output:**
```
api/services/shopify-client.service.ts:    const apiVersion = process.env.SHOPIFY_API_VERSION || '2025-10';
api/routes/shopify-oauth.ts:const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-10';
```

### 3. Check TOML configuration
```bash
grep "api_version" shopify.app.toml
```

**Expected Output:**
```
api_version = "2025-10"
```

## 📋 Impact of API Version Changes

### Breaking Changes from 2024-10 → 2025-10

Check Shopify's changelog for breaking changes:
https://shopify.dev/docs/api/release-notes/2025-10

**Common changes to watch:**
1. **Webhook payload structure** - May have new/removed fields
2. **GraphQL schema updates** - New types or deprecated fields
3. **REST API endpoints** - Deprecated endpoints removed
4. **Rate limits** - May have changed
5. **Authentication** - OAuth flow updates

### Testing Checklist

After deploying with the new API version:

- [ ] Test OAuth installation flow
- [ ] Verify webhook delivery (customers/data_request, customers/redact, shop/redact)
- [ ] Test product sync (import/update/delete)
- [ ] Test customer sync
- [ ] Test order webhooks (orders/create, orders/updated)
- [ ] Check HMAC signature verification still works
- [ ] Verify rate limiting is respected

## 🚨 Rollback Plan

If issues occur with `2025-10`, you can rollback to `2024-10`:

### Option 1: Environment Variable (Quick)
```bash
# Set in your .env file
SHOPIFY_API_VERSION=2024-10

# Restart API server
npm run api:start
```

### Option 2: Code Rollback (Permanent)
```bash
# Update all files back to 2024-10
sed -i '' 's/2025-10/2024-10/g' shopify.app.toml
sed -i '' "s/'2025-10'/'2024-10'/g" api/services/shopify-client.service.ts
sed -i '' "s/'2025-10'/'2024-10'/g" api/services/shopify-api.service.ts
sed -i '' "s/'2025-10'/'2024-10'/g" api/routes/shopify-oauth.ts
```

## 📊 API Version Lifecycle

| Version | Status | Support Until | Notes |
|---------|--------|---------------|-------|
| 2024-01 | ⚠️ Deprecated | 2025-01-31 | Will stop working soon |
| 2024-10 | ✅ Stable | 2025-10-31 | Current stable version |
| 2025-10 | ✅ Latest | 2026-10-31 | Recommended for new apps |

**Shopify Policy:** API versions are supported for 12 months after release.

## 🎯 Best Practices

1. **Use Environment Variables**: Makes version changes easier without code changes
2. **Test in Staging First**: Always test new API versions in a staging environment
3. **Monitor Shopify Changelog**: Subscribe to Shopify API updates
4. **Plan Upgrades**: Upgrade API versions at least 3 months before deprecation
5. **Version Consistency**: Always use the same version across all services

## 📞 Support

If you encounter issues after changing API versions:

1. **Check Shopify Status**: https://www.shopifystatus.com/
2. **Review API Changelog**: https://shopify.dev/docs/api/release-notes
3. **Test Locally**: Use Shopify CLI to test webhook delivery
4. **Check Logs**: Review API server logs for error messages
5. **Contact Shopify Support**: If you suspect a bug in the API

---

**Last Updated**: 2025-11-20
**Current API Version**: `2025-10`
**Next Review Date**: 2026-09-01 (Before 2025-10 deprecation)

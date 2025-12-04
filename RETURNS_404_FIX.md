# Returns System 404 Error - Fixed

## Problem

The returns system was throwing a 404 error with the following symptoms:
- Error: `api.ordefy.io/api/api/returns/sessions` (notice the double `/api/api/`)
- The API endpoint exists and works correctly
- The issue only appeared in production, not in local development

## Root Cause

**Environment Variable Misconfiguration in Production**

The production environment had `VITE_API_URL` set to:
```
VITE_API_URL=https://api.ordefy.io/api  ❌ WRONG (includes /api suffix)
```

Instead of:
```
VITE_API_URL=https://api.ordefy.io  ✅ CORRECT (no /api suffix)
```

Since `api.client.ts` adds `/api` to the base URL:
```typescript
baseURL: `${API_BASE_URL}/api`  // This adds /api
```

The result was: `https://api.ordefy.io/api` + `/api` = `https://api.ordefy.io/api/api` ❌

## Solution

### 1. Code Fix (Defensive Programming) ✅ DONE

Updated `src/services/api.client.ts` to automatically strip any trailing `/api` from the base URL:

```typescript
// Defensive: Remove trailing /api if present to avoid double /api/api/
const cleanBaseURL = API_BASE_URL.replace(/\/api\/?$/, '');

const apiClient = axios.create({
  baseURL: `${cleanBaseURL}/api`,
  headers: {
    'Content-Type': 'application/json',
  },
});
```

This fix ensures the app works correctly regardless of whether `VITE_API_URL` includes `/api` or not.

### 2. Deployment Steps

**For Vercel/Netlify/Railway/Other Platforms:**

1. **Update Environment Variables in Deployment Platform:**
   - Go to your deployment platform's settings
   - Find environment variables section
   - Set `VITE_API_URL` to: `https://api.ordefy.io` (without `/api`)

2. **Rebuild and Deploy:**
   ```bash
   npm run build
   git add .
   git commit -m "Fix: Returns system double /api URL issue"
   git push
   ```

3. **Verify the Fix:**
   - Open browser DevTools → Network tab
   - Navigate to Returns page
   - Check that URLs are: `https://api.ordefy.io/api/returns/sessions` (single `/api`)

## Testing

After deployment, test the returns functionality:

1. **Go to Returns page** (`/returns`)
2. **Check console** - Should see no 404 errors
3. **Try creating a return session:**
   - Click "Nueva Sesión"
   - Select eligible orders
   - Create session
   - Verify no errors

## Environment Variables Reference

### ✅ Correct Configuration:
```env
# Frontend (.env)
VITE_API_URL=https://api.ordefy.io

# Backend (.env)
API_URL=https://api.ordefy.io
```

### ❌ Incorrect Configuration:
```env
# This will cause double /api/api/
VITE_API_URL=https://api.ordefy.io/api  ❌ DON'T DO THIS
```

## Status

- ✅ Code fix applied (defensive URL cleaning)
- ✅ Build successful
- ⏳ **Pending:** Update production environment variables and redeploy
- ⏳ **Pending:** Test in production

## Related Files

- `src/services/api.client.ts` - API client configuration (FIXED)
- `src/services/returns.service.ts` - Returns API service
- `api/routes/returns.ts` - Backend returns routes
- `db/migrations/022_returns_system.sql` - Returns database schema

## Notes

The code fix is **defensive** - it works with both correct and incorrect configurations. However, it's still recommended to fix the production environment variable for clarity and consistency.

# Test & Development Scripts

⚠️ **WARNING: DO NOT RUN THESE FILES IN PRODUCTION**

This folder contains test and development scripts that should **NEVER** be executed in a production environment.

## Files

- `test-login.ts` - Tests user login functionality (logs passwords in console)
- `create-test-user.ts` - Creates test users (logs passwords in console)
- `reset-password.ts` - Resets user passwords (logs passwords in console)

## Security Notice

These files contain `console.log` statements that output **sensitive information** including:
- Plain text passwords
- Password hashes
- User credentials

## Usage

Only run these scripts in **local development** or **testing environments**:

```bash
# Local development only
NODE_ENV=development tsx api/tests/test-login.ts
NODE_ENV=development tsx api/tests/create-test-user.ts
```

## Production Safety

These files are:
- ✅ Excluded from production builds
- ✅ Located in `/tests` folder (isolated from production code)
- ✅ Should be blocked by pre-commit hooks
- ✅ Documented as development-only in package.json scripts

## If Accidentally Run in Production

If these scripts were accidentally executed in production:
1. ⚠️ Immediately rotate all user passwords
2. ⚠️ Review production logs for exposed credentials
3. ⚠️ Clear/purge any logs containing passwords
4. ⚠️ Notify security team

---

**Last updated:** 2026-02-13
**Security Level:** INTERNAL USE ONLY

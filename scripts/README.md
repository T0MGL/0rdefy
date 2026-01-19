# Ordefy Scripts

Utility scripts for development, maintenance, and deployment.

## 📜 Available Scripts

### migrate-console-logs.sh

Automatically migrates `console.log/error/warn` statements to the production-ready logger utility.

**Usage:**

```bash
# Migrate a single file
./scripts/migrate-console-logs.sh api/routes/orders.ts
./scripts/migrate-console-logs.sh src/pages/Dashboard.tsx

# Migrate all backend files
./scripts/migrate-console-logs.sh --all-backend

# Migrate all frontend files
./scripts/migrate-console-logs.sh --all-frontend

# Migrate high-priority files only
./scripts/migrate-console-logs.sh --high-priority
```

**What it does:**
- Adds logger import (backend: `../utils/logger`, frontend: `@/utils/logger`)
- Replaces `console.log` → `logger.log` (frontend) or `logger.info` (backend)
- Replaces `console.error` → `logger.error`
- Replaces `console.warn` → `logger.warn`
- Replaces `console.debug` → `logger.debug`
- Reports how many console statements were migrated

**Note:** Some complex console statements may need manual review after migration.

---

## 📚 Related Documentation

- [CONSOLE_LOG_MIGRATION_GUIDE.md](../CONSOLE_LOG_MIGRATION_GUIDE.md) - Complete migration guide
- [CONSOLE_LOG_FIX_SUMMARY.md](../CONSOLE_LOG_FIX_SUMMARY.md) - Executive summary

---

## 🔧 Adding New Scripts

1. Create script file: `scripts/my-script.sh`
2. Add shebang: `#!/bin/bash`
3. Make executable: `chmod +x scripts/my-script.sh`
4. Document in this README
5. Follow naming convention: `kebab-case.sh`

---

**Last Updated:** 2026-01-18

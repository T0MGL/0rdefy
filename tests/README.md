# Ordefy E2E Test Suite

Production-grade End-to-End testing for Ordefy e-commerce platform.

## Overview

This test suite runs against the **PRODUCTION** environment and validates critical business flows:

- Authentication & Authorization
- Order CRUD Operations
- Inventory/Stock Management (CRITICAL)
- Warehouse Picking & Packing
- Returns Processing
- Role-Based Permissions
- Dispatch & Settlements

## Production Safety

All tests follow strict production safety guidelines:

1. **Prefixed Data**: All test data uses `TEST_E2E_` prefix
2. **Automatic Cleanup**: Resources are cleaned after each test suite
3. **Resource Tracking**: Every created resource is tracked for deletion
4. **No Real Data Modification**: Tests never modify existing production data
5. **Final Verification**: Cleanup test verifies no test data remains

## Quick Start

```bash
# Navigate to tests directory
cd tests

# Install dependencies
npm install

# Run all tests
npm run test:e2e

# Run specific test suites
npm run test:auth        # Authentication tests
npm run test:orders      # Orders CRUD tests
npm run test:inventory   # Stock tracking (CRITICAL)
npm run test:warehouse   # Picking & packing
npm run test:returns     # Returns processing
npm run test:permissions # Role-based access
npm run test:settlements # Dispatch & reconciliation
npm run test:cleanup     # Final cleanup verification
```

## Test Suites

### 01-auth.test.ts - Authentication
- Login with valid credentials
- Invalid credential handling
- Token-based authorization
- Protected endpoint access
- Response time validation

### 02-orders-crud.test.ts - Orders
- Create orders with line items
- Read single and list orders
- Update order status flow
- Delete orders (soft/hard)
- Search and filtering

### 03-inventory-flow.test.ts - Stock Tracking [CRITICAL]
- Stock unchanged at order creation
- Stock unchanged at confirmation
- **Stock DECREMENTS at ready_to_ship**
- Stock maintained through delivery
- **Stock RESTORES on cancellation**
- Multi-item order handling
- Multiple orders same product

### 04-warehouse-flow.test.ts - Picking & Packing
- Create picking session
- Aggregate products across orders
- Complete picking phase
- Pack individual orders
- Verify stock decrement
- Session abandonment

### 05-returns-flow.test.ts - Returns
- Create return session
- Accept/reject items
- Stock restoration for accepted
- No stock change for rejected
- Partial returns handling

### 06-permissions.test.ts - Access Control
- Owner full access verification
- Collaborator system endpoints
- Module access control
- Plan-based user limits

### 07-settlements.test.ts - Dispatch & Settlements
- Create dispatch session
- Export CSV for courier
- Import delivery results
- Process settlement
- Financial calculations

### 08-cleanup.test.ts - Final Verification
- Detect orphaned test data
- Clean all TEST_E2E_ resources
- Verify production is clean
- Generate cleanup report

## Configuration

```typescript
// tests/e2e/config.ts
export const CONFIG = {
  apiUrl: 'https://api.ordefy.io/api',
  frontendUrl: 'https://app.ordefy.io',
  credentials: {
    email: 'gaston@thebrightidea.ai',
    password: 'rorito28'
  },
  testPrefix: 'TEST_E2E_',
  timeout: 30000
};
```

## Test Data Factory

All test data is generated with identifiable prefixes:

```typescript
import { TestData } from './utils/test-data-factory';

// Create test product
const product = TestData.product({ stock: 100 });
// → { name: "TEST_E2E_Producto_1234567890_1", sku: "TEST_E2E_SKU_...", ... }

// Create test customer
const customer = TestData.customer();
// → { name: "TEST_E2E_Cliente_1234567890_2", phone: "+595981...", ... }

// Create test order
const order = TestData.order(customerId, carrierId, items);
// → { notes: "TEST_E2E_Orden de prueba...", ... }
```

## API Client

The `ProductionApiClient` handles:

- Automatic authentication
- Token management
- Store ID injection
- Resource tracking
- Rate limiting
- Automatic retries

```typescript
import { ProductionApiClient } from './utils/api-client';

const api = new ProductionApiClient();
await api.login();

// Create resource (automatically tracked)
const product = await api.request('POST', '/products', data);
api.trackResource('products', product.id);

// Cleanup all tracked resources
await api.cleanupAll();
```

## Running in CI/CD

```yaml
# GitHub Actions example
jobs:
  e2e-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        working-directory: ./tests
        run: npm ci

      - name: Run E2E tests
        working-directory: ./tests
        run: npm run test:e2e
        env:
          CI: true
```

## Scripts

| Script | Description |
|--------|-------------|
| `test:e2e` | Run all E2E tests |
| `test:watch` | Run tests in watch mode |
| `test:critical` | Run only inventory tests |
| `test:quick` | Run auth + orders only |
| `test:cleanup` | Run cleanup verification |
| `cleanup:force` | Force cleanup all test data |

## Troubleshooting

### Tests fail with 401 Unauthorized
- Verify credentials in `config.ts`
- Check if account is locked
- Verify API URL is correct

### Cleanup fails
1. Run `npm run cleanup:force`
2. Check API responses for blocked deletions
3. Verify no active sessions blocking orders

### Rate limiting errors
- Tests include automatic rate limiting (200ms between requests)
- If still hitting limits, increase delay in config

### Flaky tests
- Production APIs can have latency
- Tests auto-retry once on failure
- Check network connectivity

## Output Example

```
╔══════════════════════════════════════════════════════════════╗
║     🧪  ORDEFY E2E TEST SUITE - PRODUCTION                   ║
╠══════════════════════════════════════════════════════════════╣
║  API URL:    https://api.ordefy.io/api                       ║
║  User:       gaston@thebrightidea.ai                         ║
║  Prefix:     TEST_E2E_                                       ║
╚══════════════════════════════════════════════════════════════╝

✓ Authentication (234ms)
  ✓ Login with valid credentials
  ✓ Login with wrong password fails
  ✓ Request without token fails

✓ Orders CRUD (1.2s)
  ✓ Create order
  ✓ Get order by ID
  ✓ Update order status

✓ Inventory Flow [CRITICAL] (3.4s)
  ✓ Stock inicial correcto
  ✓ Crear orden NO decrementa stock
  ✓ Ready to ship SÍ DECREMENTA stock ★

✓ Cleanup Verification (890ms)
  ✓ No TEST_E2E_ orders remaining
  ✓ No TEST_E2E_ products remaining
  ✓ Production is clean

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Results: 45 passed, 0 failed
Duration: 12.4s
Data cleanup: ✓ Complete
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## License

Proprietary - Bright Idea © 2026

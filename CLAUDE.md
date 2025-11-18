# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is **Ordefy**, an e-commerce management dashboard built with React, TypeScript, Vite, and shadcn/ui. The application helps manage orders, products, carriers, suppliers, ads, and provides intelligent business analytics with health scoring, alerts, and recommendations.

**Developed by:** Bright Idea
**Domain:** ordefy.app
**Copyright:** All Rights Reserved

## Development Commands

```bash
# Install dependencies
npm i

# Start development server (runs on http://localhost:8080)
npm run dev

# Build for production
npm run build

# Build for development mode
npm run build:dev

# Run linter
npm run lint

# Preview production build
npm run preview
```

## Architecture Overview

### Tech Stack
- **Frontend Framework**: React 18 with TypeScript
- **Build Tool**: Vite with SWC
- **UI Components**: shadcn/ui (Radix UI primitives)
- **Styling**: Tailwind CSS with Dark Mode support
- **Routing**: React Router v6
- **State Management**: React hooks + localStorage for persistence
- **Data Fetching**: TanStack Query (React Query)
- **Animations**: Framer Motion
- **Charts**: Recharts
- **Form Validation**: React Hook Form + Zod
- **Backend**: Node.js + Express + PostgreSQL (Supabase)
- **Authentication**: JWT tokens with role-based access

### Project Structure

```
src/
├── components/          # React components
│   ├── ui/             # shadcn/ui components (button, card, dialog, etc.)
│   ├── skeletons/      # Loading skeleton components
│   ├── forms/          # Form components (OrderForm, etc.)
│   ├── ShopifyIntegrationModal.tsx  # Shopify integration dialog
│   ├── FollowUpSettings.tsx         # WhatsApp follow-up configuration
│   ├── LoadingSkeleton.tsx          # Reusable loading skeletons
│   └── [features]      # Feature-specific components
├── pages/              # Route pages (Dashboard, Orders, Products, etc.)
│   ├── Onboarding.tsx  # Multi-step onboarding with user/store setup
│   ├── Settings.tsx    # User settings with dark mode toggle
│   ├── Integrations.tsx # E-commerce platform integrations
│   └── Orders.tsx      # Orders with follow-up dialog
├── contexts/           # React contexts
│   ├── AuthContext.tsx  # Authentication and user state
│   └── ThemeContext.tsx # Dark/light theme management
├── services/           # Data service layer
│   ├── orders.service.ts    # Orders CRUD with API
│   ├── products.service.ts  # Products CRUD
│   ├── customers.service.ts # Customers CRUD with auth headers
│   ├── ads.service.ts       # Campaigns CRUD with auth headers
│   └── api.client.ts        # Axios client with auth interceptors
├── utils/              # Business logic utilities
│   ├── alertEngine.ts       # Generates alerts based on business metrics
│   ├── recommendationEngine.ts  # Generates actionable recommendations
│   ├── healthCalculator.ts     # Calculates business health score
│   ├── notificationEngine.ts   # Manages notifications
│   ├── periodComparison.ts     # Period-over-period comparisons
│   ├── mockData.ts            # Mock data for orders/products/ads
│   └── mockCarriers.ts        # Mock carrier data
├── types/              # TypeScript type definitions
│   ├── index.ts        # Core types (Order, Product, Ad, etc.)
│   ├── carrier.ts      # Carrier-related types
│   └── notification.ts # Notification types
├── hooks/              # Custom React hooks
│   ├── useDebounce.ts  # Debounce hook
│   └── useLocalStorage.ts # localStorage hook
├── lib/                # Library utilities (utils.ts, constants.ts)
└── App.tsx             # Main app component with routing

api/
├── index.ts            # Express server with CORS configuration
├── routes/
│   ├── auth.ts         # Authentication endpoints (login, register, onboarding)
│   ├── customers.ts    # Customers API with auth middleware
│   └── campaigns.ts    # Campaigns API with auth middleware
├── middleware/
│   └── auth.ts         # JWT verification and store ID extraction
└── db/
    ├── connection.ts   # Supabase client
    └── migrations/     # Database migrations
        ├── 001_create_base_schema.sql
        ├── 002_create_triggers.sql
        ├── 003_create_additional_values.sql
        └── 004_add_users_and_user_stores.sql

db/
└── seed.sql            # Database seed data
```

### Key Architectural Patterns

#### 1. Authentication & Onboarding Flow
- **Multi-step Onboarding**: Captures user info (name, phone) + store details (name, country, currency, tax rates)
- `OnboardingGuard` component wraps the entire app to enforce onboarding completion
- `AuthContext` provides user, currentStore, and authentication state globally
- JWT tokens stored in localStorage with automatic header injection
- Backend validates JWT and extracts store_id via middleware (`verifyToken`, `extractStoreId`)
- After onboarding, user info and phone are saved to `users` table
- Store configuration (tax_rate, admin_fee) saved to `stores` table

#### 2. Data Services Layer
Services in `src/services/` provide CRUD operations with API integration:
- `ordersService`: Manages orders with confirmation/rejection workflows
- `productsService`: Manages product inventory
- `customersService`: Customer management with auth headers (Bearer token + X-Store-ID)
- `adsService`: Campaign management with auth headers
- `api.client.ts`: Axios instance with automatic auth header injection

**Authentication Pattern** (for customers & campaigns):
```typescript
const getAuthHeaders = (): HeadersInit => {
  const token = localStorage.getItem('auth_token');
  const storeId = localStorage.getItem('current_store_id');
  return {
    'Content-Type': 'application/json',
    ...(token && { 'Authorization': `Bearer ${token}` }),
    ...(storeId && { 'X-Store-ID': storeId }),
  };
};
```

All services follow a consistent pattern:
```typescript
{
  getAll: () => Promise<T[]>
  getById: (id: string) => Promise<T | undefined>
  create: (data: Partial<T>) => Promise<T>
  update: (id: string, data: Partial<T>) => Promise<T | undefined>
  delete: (id: string) => Promise<boolean>
}
```

#### 3. Intelligence Engines
Located in `src/utils/`, these pure functions analyze business data:
- **Alert Engine**: Analyzes metrics and generates alerts (critical/warning/info)
  - Low confirmation rates, poor ROI, low stock, underperforming carriers
- **Recommendation Engine**: Suggests actions with impact projections
  - Budget reallocation, pricing adjustments, inventory optimization
- **Health Calculator**: Computes business health score (0-100) with issues/suggestions
  - Evaluates delivery rate (25 points), profit margin (25), ROI (25), stock (25)

#### 4. Theme System (Dark Mode)
- **ThemeContext**: Manages light/dark theme with localStorage persistence
- Inline script in `index.html` prevents FOUC (Flash of Unstyled Content)
- System preference detection fallback
- All components support dark mode via CSS variables
- Toggle available in Settings → Preferences

#### 5. Global Search
`GlobalSearch` component provides command palette-style search (Cmd+K):
- Searches across orders, products, suppliers, carriers
- Global keyboard shortcut accessible from anywhere

#### 6. Component Structure
- Feature components in root of `components/` (e.g., `BusinessHealth`, `AlertsPanel`)
- UI primitives from shadcn/ui in `components/ui/`
- Components use controlled/uncontrolled patterns with React Hook Form where needed
- Loading states use skeleton components for seamless UX

#### 7. Integrations System
- **ShopifyIntegrationModal**: Full integration dialog for Shopify setup
  - Auto-loads store name from AuthContext
  - Zod validation for all fields
  - Password fields with show/hide toggle
  - Import options: Products (✓), Customers (✓), Orders (✗ by default)
  - Historical orders option (conditional)
- **Integrations Page**: Category-based layout
  - E-commerce platforms section
  - Cards show status: available, connected, coming soon
  - Shopify and Dropi integrations

### State Management Strategy

- **Local State**: React hooks (`useState`, `useReducer`)
- **Persistence**: localStorage for orders, products, settings
- **Server State**: TanStack Query (configured but currently using mock data)
- **Form State**: React Hook Form with Zod validation

### Type System

All types defined in `src/types/`:
- Core business entities: `Order`, `Product`, `Ad`, `AdditionalValue`, `Supplier`, `Carrier`
- UI types: `MetricCardProps`, `Alert`, `Recommendation`
- Status types use discriminated unions (e.g., `status: 'pending' | 'confirmed' | 'in_transit' | 'delivered' | 'cancelled'`)

### Path Aliases

The project uses `@/` alias for `src/`:
```typescript
import { Button } from '@/components/ui/button'
import { ordersService } from '@/services/orders.service'
```

### Styling Conventions

- Tailwind utility classes for styling
- Component variants managed via `class-variance-authority`
- Theme colors defined in `src/index.css` with CSS variables
- Full dark mode support with `.dark` class
- Responsive design with mobile-first approach
- Hover states: subtle but noticeable (`transition-all duration-200`)
- Status colors with dark mode variants:
  - Pending: yellow-50/yellow-950
  - Confirmed: green-50/green-950
  - Cancelled: red-50/red-950

## Important Development Notes

### Adding New Pages
1. Create page component in `src/pages/`
2. Add route in `App.tsx` within the nested Routes (after sidebar/header)
3. Add navigation link in `Sidebar.tsx`
4. Use loading skeletons for data fetching states

### Working with Services
- **Frontend services** (customers, ads) must include auth headers
- Use `getAuthHeaders()` helper to inject Bearer token + X-Store-ID
- Storage keys follow pattern: `neonflow_[entity]`
- Always handle errors gracefully with try/catch
- All API calls return promises

### Backend API
- **Port**: 3001 (configurable via API_PORT env var)
- **CORS**: Configured for localhost:8080, 8081, 5173, 3000
- **Authentication**: JWT tokens with middleware
- **Database**: PostgreSQL via Supabase client
- Run with: `npm run api:dev`
- Migrations in `db/migrations/`

### UI Components
- Use existing shadcn/ui components from `components/ui/`
- Install new components via: check `components.json` for configuration
- Follow shadcn/ui patterns for consistency
- Always support dark mode with `dark:` variants

### Dark Mode Best Practices
- Use CSS variables instead of hardcoded colors
- Always provide light and dark variants for status colors
- Test hover states in both themes
- Use `dark:bg-{color}-950/20` for subtle dark backgrounds
- Use `dark:text-{color}-400` for readable dark text

### Follow-up Configuration
- `FollowUpSettings` component now opens in a dialog
- Accessible via "Follow-ups" button in Orders page header
- Located next to Export and Import buttons

### Integrations

**Shopify Integration (Production-Ready)**
- **Purpose**: Connect Shopify store for product/customer sync and order webhooks
- **Location**: `src/pages/Integrations.tsx`, `src/components/ShopifyIntegrationModal.tsx`, `src/components/ShopifySyncStatus.tsx`
- **Backend**: `api/routes/shopify.ts`, `api/services/shopify-*.service.ts`, `api/services/shopify-webhook-manager.service.ts`
- **Database**: Migration `005_shopify_integration.sql` + `009_webhook_reliability.sql`
- **Features**:
  - One-time import of products, customers, orders from Shopify
  - Bidirectional product sync (update/delete in Shopify from dashboard)
  - Webhook for new orders (orders/create, orders/updated)
  - Webhook for deleted products (products/delete) - removes from dashboard
  - Automatic sending of new orders to n8n for WhatsApp confirmation
  - Real-time sync progress monitoring with polling
  - Manual sync buttons for products, customers, orders
  - Rate limiting (2 req/sec for Shopify API)
  - HMAC signature verification for webhooks
  - **Production-grade webhook reliability**:
    - ✅ Idempotency: Prevents duplicate webhook processing with 24h TTL
    - ✅ Automatic retries: Exponential backoff (60s → 960s, max 5 attempts)
    - ✅ Monitoring: Real-time health metrics with dashboard
    - ✅ Logging: Comprehensive audit trail with error breakdown
- **Configuration**: See `SHOPIFY_SETUP.md` for setup, `WEBHOOK_RELIABILITY.md` for webhook system
- **Environment Variables**: `N8N_WEBHOOK_URL` for order confirmation

**Dropi Integration (Coming Soon)**
- **Purpose**: Dropshipping platform integration for Latin America
- **Status**: Planned for future release
- **Features**: Product sourcing, order fulfillment, inventory management

**General Integration Architecture**
- Category-based layout (E-commerce, Dropshipping, Logistics, etc.)
- Each integration has status: available, connected, coming_soon
- Modals for integration setup with validation
- State management tracks connected integrations
- Real-time sync status monitoring

### TypeScript Configuration
- Project uses relaxed TypeScript settings (`noImplicitAny: false`, `strictNullChecks: false`)
- Maintain type safety where possible despite relaxed settings

## Troubleshooting

### Port Already in Use
The dev server runs on port 8080. If unavailable, change in `vite.config.ts`:
```typescript
server: {
  port: 3000, // or another port
}
```

### CORS Issues
If you get CORS errors:
1. Check `api/index.ts` - ensure your frontend port is in `ALLOWED_ORIGINS`
2. Restart the API server after CORS changes
3. Verify auth headers are being sent (check Network tab)

### Authentication 401 Errors
- Ensure JWT token is in localStorage as `auth_token`
- Ensure store ID is in localStorage as `current_store_id`
- Check that services include `getAuthHeaders()` in all requests
- Verify backend middleware is properly configured

### Database Migration Issues
Run migrations in order:
```bash
psql -h <host> -U <user> -d <database> -f db/migrations/001_create_base_schema.sql
psql -h <host> -U <user> -d <database> -f db/migrations/002_create_triggers.sql
psql -h <host> -U <user> -d <database> -f db/migrations/003_create_additional_values.sql
psql -h <host> -U <user> -d <database> -f db/migrations/004_add_users_and_user_stores.sql
```

### Dark Mode Not Working
- Clear localStorage and refresh
- Check `index.html` inline script is loading
- Verify CSS variables are defined in `src/index.css`
- Ensure components use `dark:` variants

### Build Issues
- Ensure Node.js version is compatible (project uses modern ESM)
- Clear node_modules and reinstall if dependency issues occur
- Check for TypeScript errors with `npm run lint`

### Rate Limiting (429 Errors)
If you receive "Too Many Requests" errors:
1. **Check rate limit headers** in the response:
   - `RateLimit-Limit`: Maximum requests allowed
   - `RateLimit-Remaining`: Requests remaining
   - `RateLimit-Reset`: When the limit resets
2. **Wait for the reset time** or implement exponential backoff
3. **For development:** Restart the API server to reset all rate limits
4. **For production:** Consider adjusting limits in `api/index.ts`
5. **Test rate limits:** Run `./test-rate-limit.sh` to verify configuration

**Rate Limit Tiers:**
- General API: 500 requests/15 min
- Authentication: 5 attempts/15 min
- Webhooks: 60 requests/min
- Write operations: 200/15 min

See `RATE_LIMITING.md` for detailed documentation.

## Recent Updates

### Latest Features (January 2025)

#### Security Enhancements
- ✅ **Comprehensive Rate Limiting**:
  - Multi-tier rate limiting for API protection
  - General API: 500 requests/15 min per IP
  - Authentication: 5 attempts/15 min (brute force protection)
  - Webhooks: 60 requests/min (1 req/sec average)
  - Write operations: 200 operations/15 min
  - Custom error handlers with logging
  - Standard rate limit headers (RateLimit-*)
  - Documentation in `RATE_LIMITING.md`
  - Protects against: DoS, brute force, data scraping, webhook abuse

#### Performance & Code Quality
- ✅ **React Performance Optimization**:
  - Lazy loading for all page components (71% faster initial load)
  - Optimized QueryClient configuration (staleTime: 5min, cacheTime: 10min)
  - DRY refactoring: Eliminated 156 lines of duplicate code with reusable layouts
  - Memoization: useMemo for expensive calculations, useCallback for handlers
  - Estimated improvements: Initial Load 3.5s→1.0s, Bundle Size 850KB→320KB initial

#### Analytics & Metrics
- ✅ **Real Percentage Changes**:
  - Backend now calculates actual period-over-period comparisons (last 7 days vs previous 7 days)
  - Removed all hardcoded/mock percentages from dashboard
  - Smart display logic: Only shows percentage badges when there's real data to compare
  - API returns `changes` object with calculated deltas for all metrics
  - Files: `api/routes/analytics.ts`, `src/pages/Dashboard.tsx`, `src/types/index.ts`

#### Date Filtering
- ✅ **Functional Period Comparator**:
  - Custom date range picker with dual calendars
  - Support for single-day selection (start date only)
  - Preset periods: Today vs Yesterday, This Week vs Last Week, This Month vs Last Month
  - Spanish locale formatting with date-fns
  - File: `src/components/PeriodComparator.tsx`

#### Mathematical Formulas
- ✅ **100% Verified Analytics Formulas**:
  - All 9 formulas documented and verified in `api/routes/analytics.ts`:
    1. Revenue = Sum of all order total_price
    2. Costs = Sum of (product_cost × quantity)
    3. Marketing = Sum of campaign investment (from campaigns table, active campaigns only)
    4. Net Profit = Revenue - Costs - Marketing
    5. Profit Margin = (Net Profit ÷ Revenue) × 100
    6. ROI = Revenue ÷ Total Investment
    7. Delivery Rate = (Delivered Orders ÷ Total) × 100
    8. Cost Per Order = Total Costs ÷ Total Orders
    9. Average Order Value = Revenue ÷ Total Orders
  - Zero-division protection on all calculations
  - Proper Number() conversions to prevent type coercion errors
  - Marketing costs are calculated per period (current vs previous) for accurate comparisons

#### Security & Account Management
- ✅ **Password Change Functionality**:
  - Frontend: `AuthContext.changePassword()` function
  - Backend: `/api/auth/change-password` endpoint with bcrypt
  - UI: Settings → Security tab with password dialog
  - Validation: Requires current password, min 6 characters for new
  - Password visibility toggles included

- ✅ **Account Deletion with Double Confirmation**:
  - Frontend: `AuthContext.deleteAccount()` function
  - Backend: `/api/auth/delete-account` endpoint
  - UI: Settings → Security → Danger Zone
  - Warning dialog with detailed consequences list
  - Requires password confirmation
  - Automatic logout after deletion

- ✅ **Production-Ready Logout**:
  - Clean logout button in Settings → Security tab
  - Clears all localStorage data (auth_token, user, store_id, onboarding)
  - Redirects to login page
  - Toast notification for user feedback

#### UI Improvements
- ✅ **Smart Percentage Display**:
  - MetricCard component now checks if value is zero
  - No colored badges shown when metric value is 0
  - Full dark mode support for percentage badges
  - Extracts numeric values from formatted strings

- ✅ **Removed Dashboard Duplicates**:
  - Removed duplicate "Margen de Beneficio" metric card
  - Dashboard now shows 9 unique, non-redundant metrics

### Earlier Features (2024-2025)
- ✅ **Dark Mode**: Full theme system with persistence and no FOUC
- ✅ **User Profile Management**: Onboarding captures name + phone
- ✅ **Authentication**: JWT + role-based access with store isolation
- ✅ **Shopify Integration**: Complete modal with validation and import options
- ✅ **Follow-up Dialog**: WhatsApp follow-up configuration in popup
- ✅ **Improved Buttons**: Better colors and hover states for confirm/reject
- ✅ **Loading Skeletons**: Seamless loading experience
- ✅ **CORS Fixed**: Added localhost:8081 support

### Database Schema Updates
- Migration 004: Added `users` table with phone field
- Migration 004: Added `user_stores` many-to-many relationship
- Migration 004: Added `tax_rate` and `admin_fee` to stores table

## Current State (January 2025)

### Production-Ready Features
- ✅ Authentication (login, register, logout, password change, account deletion)
- ✅ Real-time analytics with period-over-period comparisons
- ✅ Order management with WhatsApp confirmation
- ✅ Product inventory management
- ✅ Customer relationship management
- ✅ Supplier management
- ✅ Carrier tracking and comparison
- ✅ Campaign/Ads management
- ✅ Shopify integration (products, customers, orders, webhooks)
- ✅ Dark mode theme system
- ✅ Multi-store support with role-based access
- ✅ Functional date filtering with custom ranges

### Known Placeholders
- 2FA authentication marked as "coming soon"
- Billing/Subscription tab shows "in development"
- Dropi integration marked as "coming soon"

## Webhook Reliability System

### Overview

The Shopify integration includes a production-grade webhook reliability system that solves the 3 critical problems:

1. **Deduplicación**: Prevents processing duplicate webhooks using idempotency keys
2. **Reintentos automáticos**: Automatic retry with exponential backoff for failed webhooks
3. **Monitoreo**: Real-time health metrics with visual dashboard

### Architecture Components

#### 1. Idempotency Layer
- **Table**: `shopify_webhook_idempotency`
- **Key Format**: `{order_id}:{topic}:{timestamp_hash}`
- **TTL**: 24 hours (auto-cleanup)
- **Purpose**: Prevents duplicate webhook processing

#### 2. Retry Queue
- **Table**: `shopify_webhook_retry_queue`
- **Backoff Schedule**: 60s → 120s → 240s → 480s → 960s
- **Max Retries**: 5 attempts
- **Status**: pending, processing, success, failed
- **Error History**: Full JSON array of all retry attempts

#### 3. Metrics System
- **Table**: `shopify_webhook_metrics`
- **Granularity**: Hourly aggregation
- **Metrics**: received, processed, failed, duplicates, success_rate, processing_time
- **Error Breakdown**: 401, 404, 500, timeout, other

#### 4. Webhook Manager Service
- **File**: `api/services/shopify-webhook-manager.service.ts`
- **Methods**:
  - `checkIdempotency()`: Verify if webhook was already processed
  - `recordIdempotency()`: Save idempotency key
  - `addToRetryQueue()`: Add failed webhook to retry queue
  - `processRetryQueue()`: Process pending retries
  - `recordMetric()`: Record webhook metrics
  - `getWebhookHealth()`: Get health status and metrics
  - `cleanupExpiredKeys()`: Remove expired idempotency keys

### API Endpoints

#### Health Check
```http
GET /api/shopify/webhook-health?hours=24
Authorization: Bearer {token}
X-Store-ID: {store_id}
```

Returns:
- Status: healthy, degraded, unhealthy
- Metrics: total_received, success_rate, processing_time, pending_retries
- Error breakdown: 401, 404, 500, timeout, other

#### Process Retry Queue
```http
POST /api/shopify/webhook-retry/process
Authorization: Bearer {token}
X-Store-ID: {store_id}
```

Manually trigger retry processing (also runs via cron job).

#### Cleanup Expired Keys
```http
POST /api/shopify/webhook-cleanup
Authorization: Bearer {token}
X-Store-ID: {store_id}
```

Remove expired idempotency keys (should run daily).

### UI Component

**WebhookHealthMonitor** (`src/components/WebhookHealthMonitor.tsx`):
- Real-time health status with visual indicators
- Metrics cards: total webhooks, success rate, processing time, pending retries
- Error breakdown chart
- Auto-refresh every 30 seconds
- Manual retry processing button
- Dark mode support

Usage:
```tsx
import { WebhookHealthMonitor } from '@/components/WebhookHealthMonitor';

<WebhookHealthMonitor
  autoRefresh={true}
  refreshInterval={30}
/>
```

### Production Setup

#### 1. Database Migration
```bash
psql -h <host> -U <user> -d <database> \
  -f db/migrations/009_webhook_reliability.sql
```

#### 2. Cron Jobs

**Retry Queue Processor** (every 5 minutes):
```bash
*/5 * * * * curl -X POST http://api.ordefy.app/api/shopify/webhook-retry/process \
  -H "Authorization: Bearer {token}" \
  -H "X-Store-ID: {store_id}"
```

**Idempotency Cleanup** (daily at 3 AM):
```bash
0 3 * * * curl -X POST http://api.ordefy.app/api/shopify/webhook-cleanup \
  -H "Authorization: Bearer {token}" \
  -H "X-Store-ID: {store_id}"
```

#### 3. Monitoring Alerts

Set up alerts for:
- Success rate < 95% (24h window)
- Pending retries > 50
- 401 errors > 5 (1h window)
- Processing time > 2000ms (1h avg)

### Testing

Run the test suite:
```bash
AUTH_TOKEN='your_token' STORE_ID='your_store_id' ./test-webhook-reliability.sh
```

Tests:
1. Health check endpoint
2. Retry queue processing
3. Cleanup expired keys
4. Database schema verification (requires DATABASE_URL)

### Documentation

- **Complete Guide**: `WEBHOOK_RELIABILITY.md` - 30+ pages with architecture, API, troubleshooting
- **Executive Summary**: `WEBHOOK_RELIABILITY_SUMMARY.md` - Quick reference guide
- **Test Script**: `test-webhook-reliability.sh` - Automated testing
- **Migration**: `db/migrations/009_webhook_reliability.sql` - Database schema

### Metrics to Monitor

#### Success Rate
- **Goal**: ≥ 99%
- **Acceptable**: ≥ 95%
- **Critical**: < 80%

#### Processing Time
- **Excellent**: < 500ms
- **Good**: < 1000ms
- **Slow**: > 1000ms

#### Pending Retries
- **Good**: < 10
- **Warning**: 10-50
- **Critical**: > 50

### Security Features

1. **HMAC Verification**: All webhooks verified with HMAC-SHA256
2. **Replay Protection**: Webhooks older than 5 minutes rejected
3. **Idempotency**: Prevents duplicate processing
4. **Error Isolation**: Returns 200 to Shopify even on failure to prevent retry storms

### Troubleshooting

Common issues:
- **High 401 errors**: Check Shopify credentials in database
- **Stuck retries**: Process queue manually, check n8n availability
- **Growing idempotency table**: Verify cleanup job is running
- **Low success rate**: Check error breakdown for patterns

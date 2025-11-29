# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is **Ordefy**, an e-commerce management dashboard built with React, TypeScript, Vite, and shadcn/ui. The application helps manage orders, products, carriers, suppliers, ads, and provides intelligent business analytics with health scoring, alerts, and recommendations.

**Developed by:** Bright Idea
**Domain:** ordefy.io
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
│   ├── Orders.tsx      # Orders with follow-up dialog
│   ├── Warehouse.tsx   # Warehouse operations (added by user)
│   └── Merchandise.tsx # Inbound shipments/supplier purchases management
├── contexts/           # React contexts
│   ├── AuthContext.tsx  # Authentication and user state
│   └── ThemeContext.tsx # Dark/light theme management
├── services/           # Data service layer
│   ├── orders.service.ts      # Orders CRUD with API
│   ├── products.service.ts    # Products CRUD
│   ├── customers.service.ts   # Customers CRUD with auth headers
│   ├── ads.service.ts         # Campaigns CRUD with auth headers
│   ├── merchandise.service.ts # Inbound shipments CRUD with receive endpoint
│   ├── warehouse.service.ts   # Warehouse picking/packing operations
│   └── api.client.ts          # Axios client with auth interceptors
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
│   ├── campaigns.ts    # Campaigns API with auth middleware
│   ├── merchandise.ts  # Inbound shipments/supplier purchases API
│   ├── warehouse.ts    # Warehouse operations (added by user)
│   └── shopify.ts      # Shopify integration and webhooks
├── middleware/
│   └── auth.ts         # JWT verification and store ID extraction
├── services/
│   ├── shopify-*.service.ts        # Shopify integration services
│   ├── warehouse.service.ts        # Warehouse picking/packing business logic
│   └── delivery-photo-cleanup.service.ts
└── db/
    └── connection.ts   # Supabase client

db/
├── migrations/
│   ├── 000_MASTER_MIGRATION.sql  # ⭐ Migración maestra (usa solo esta)
│   └── README.md                 # Documentación de migraciones
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
- `merchandiseService`: Inbound shipments from suppliers with receive endpoint
- `warehouseService`: Picking and packing operations for order preparation
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

### Warehouse Module (Picking & Packing)

**Purpose**: Manages order preparation workflow without barcode scanners. Optimized for manual input with touch-friendly interface.

**Location**:
- Frontend: `src/pages/Warehouse.tsx`, `src/services/warehouse.service.ts`
- Backend: `api/routes/warehouse.ts`, `api/services/warehouse.service.ts`
- Database: `db/migrations/015_warehouse_picking.sql`

**Core Workflow**:
1. **Dashboard View**: Select multiple "confirmed" orders to create a preparation batch (picking session)
2. **Picking Mode**: Collect aggregated quantities of products for the entire batch
3. **Packing Mode**: Distribute collected items into their respective order boxes

**Features**:
- ✅ **Batch Processing**: Group multiple orders into sessions with unique codes (e.g., "PREP-2505-01")
- ✅ **Aggregated Picking**: Shows total quantities needed across all orders in the batch
- ✅ **Manual Controls**: Large `[-] 0/5 [+]` buttons and "MAX" shortcuts (no barcode scanner needed)
- ✅ **Visual Feedback**: Green backgrounds for completed items, progress bars, checkmarks
- ✅ **Smart Packing**: Split-view interface with item basket (left) and order boxes (right)
- ✅ **Intelligent Highlighting**: System highlights only orders that need the selected item
- ✅ **Progress Tracking**: Real-time tracking of picked/packed quantities
- ✅ **Order State Management**: Automatic transitions: confirmed → in_preparation → ready_to_ship
- ✅ **Print Labels**: "Print Label" button appears when order is fully packed
- ✅ **Dark Mode Support**: Full theme compatibility
- ✅ **Touch Optimized**: Large buttons and tap targets for tablet/mobile use

**Database Schema** (`015_warehouse_picking.sql`):
- `picking_sessions` - Tracks preparation batches with status (picking/packing/completed)
- `picking_session_orders` - Links orders to sessions (junction table)
- `picking_session_items` - Aggregated picking list with quantity_picked tracking
- `packing_progress` - Tracks packing progress per order line item
- New order statuses: `in_preparation`, `ready_to_ship`
- Auto-generated session codes via `generate_session_code()` function

**API Endpoints** (all require auth headers):
- `GET /api/warehouse/orders/confirmed` - Lists orders ready for preparation
- `GET /api/warehouse/sessions/active` - Lists active sessions (picking/packing)
- `POST /api/warehouse/sessions` - Creates new batch from order IDs
- `GET /api/warehouse/sessions/:id/picking-list` - Returns aggregated items to pick
- `POST /api/warehouse/sessions/:id/picking-progress` - Updates picked quantities
- `POST /api/warehouse/sessions/:id/finish-picking` - Transitions to packing phase
- `GET /api/warehouse/sessions/:id/packing-list` - Returns orders with items and basket
- `POST /api/warehouse/sessions/:id/packing-progress` - Assigns item to order
- `POST /api/warehouse/sessions/:id/complete` - Marks session as completed

**Usage Pattern**:
```typescript
// Create session
const session = await warehouseService.createSession(['order-id-1', 'order-id-2']);

// Update picking progress
await warehouseService.updatePickingProgress(sessionId, productId, 5);

// Finish picking and start packing
await warehouseService.finishPicking(sessionId);

// Pack item into order
await warehouseService.updatePackingProgress(sessionId, orderId, productId);
```

**Navigation**: Accessible via "Almacén" in sidebar (between "Pedidos" and "Productos")

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

### Database Setup

Para configurar una nueva base de datos, ejecuta **SOLO** la migración maestra:
```bash
psql -h <host> -U <user> -d <database> -f db/migrations/000_MASTER_MIGRATION.sql
```

La migración maestra es idempotente (puede ejecutarse múltiples veces sin errores) y contiene TODAS las tablas, funciones y triggers necesarios. Ver `db/migrations/README.md` para más detalles.

**Migraciones Adicionales** (para funcionalidades específicas):
- `011_merchandise_system.sql` - Sistema de mercadería/inbound shipments
- `015_warehouse_picking.sql` - Sistema de picking y packing para warehouse

Estas migraciones se ejecutan de forma independiente según las funcionalidades que necesites activar.

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

## Recent Updates

### Latest Features (January 2025)

#### Warehouse Management (Picking & Packing)
- ✅ **Complete Warehouse Module**:
  - Batch order preparation workflow (no barcode scanners required)
  - **Dashboard**: Multi-select confirmed orders to create picking sessions
  - **Picking Interface**: Aggregated product list with manual `[-] 0/5 [+]` controls and "MAX" button
  - **Packing Interface**: Split-view design with item basket (left) and order boxes (right)
  - **Smart Highlighting**: System highlights only orders needing the selected item
  - **Auto-generated Session Codes**: Unique batch references (e.g., "PREP-2505-01")
  - **Progress Tracking**: Real-time visual feedback with progress bars and color coding
  - **Order State Management**: Automatic transitions (confirmed → in_preparation → ready_to_ship)
  - **Touch Optimized**: Large buttons and tap targets for tablet/mobile use
  - **Dark Mode Support**: Full theme compatibility with green/blue highlighting
  - Database: 4 new tables in `015_warehouse_picking.sql` (picking_sessions, picking_session_orders, picking_session_items, packing_progress)
  - Backend: 8 API endpoints with auth middleware + comprehensive business logic
  - Frontend: 3 integrated views (Dashboard, Picking, Packing) in single component

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

### Database Schema

La base de datos está completamente definida en `db/migrations/000_MASTER_MIGRATION.sql`:
- **Tablas Base**: stores, users, user_stores, store_config
- **Negocio**: products, customers, carriers, suppliers, campaigns, shipping_integrations, additional_values
- **Pedidos**: orders (con COD, delivery, rating, Shopify sync, warehouse statuses: in_preparation, ready_to_ship)
- **Historial**: order_status_history, follow_up_log
- **Delivery**: delivery_attempts, daily_settlements, settlement_orders
- **Mercadería**: inbound_shipments, inbound_shipment_items (ver `db/migrations/011_merchandise_system.sql`)
- **Warehouse**: picking_sessions, picking_session_orders, picking_session_items, packing_progress (ver `db/migrations/015_warehouse_picking.sql`)
- **Shopify**: shopify_integrations, shopify_oauth_states, shopify_import_jobs, shopify_webhook_events, shopify_sync_conflicts
- **Webhook Reliability**: shopify_webhook_idempotency, shopify_webhook_retry_queue, shopify_webhook_metrics
- **Vistas**: courier_performance, shopify_integrations_with_webhook_issues, inbound_shipments_summary
- **Triggers**: Actualización automática de stats de clientes, carriers, log de estados, delivery tokens, COD calculation, warehouse updated_at timestamps
- **Funciones**: generate_inbound_reference, receive_shipment_items (inventory updates), generate_session_code (warehouse batch codes)

## Current State (January 2025)

### Production-Ready Features
- ✅ Authentication (login, register, logout, password change, account deletion)
- ✅ Real-time analytics with period-over-period comparisons
- ✅ Order management with WhatsApp confirmation
- ✅ Product inventory management
- ✅ **Merchandise/Inbound Shipments** (supplier purchases, inventory reception, product creation)
- ✅ **Warehouse/Picking & Packing** (batch order preparation, manual picking, split-view packing, no barcode scanners required)
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

La integración de Shopify incluye un sistema de confiabilidad de webhooks de grado producción:

### Características Principales
1. **Idempotencia**: Previene procesamiento duplicado (TTL 24h)
2. **Reintentos automáticos**: Backoff exponencial (60s → 960s, max 5 intentos)
3. **Monitoreo**: Métricas en tiempo real con dashboard visual

### Componentes de Base de Datos
- `shopify_webhook_idempotency` - Previene duplicados
- `shopify_webhook_retry_queue` - Cola de reintentos
- `shopify_webhook_metrics` - Métricas por hora (received, processed, failed, success_rate)

### Servicios Backend
- `api/services/shopify-webhook-manager.service.ts` - Gestión de webhooks
- Endpoints: `/api/shopify/webhook-health`, `/api/shopify/webhook-retry/process`, `/api/shopify/webhook-cleanup`

### Configuración de Producción

**Cron Jobs Recomendados**:
```bash
# Procesamiento de reintentos (cada 5 min)
*/5 * * * * curl -X POST https://api.ordefy.io/api/shopify/webhook-retry/process

# Limpieza de idempotency keys (diario 3 AM)
0 3 * * * curl -X POST https://api.ordefy.io/api/shopify/webhook-cleanup
```

**Alertas Sugeridas**:
- Success rate < 95% (24h)
- Pending retries > 50
- 401 errors > 5 (1h)
- Processing time > 2000ms (1h avg)

### Métricas Objetivo
- **Success Rate**: ≥ 99% (crítico < 80%)
- **Processing Time**: < 500ms (aceptable < 1000ms)
- **Pending Retries**: < 10 (crítico > 50)

## Merchandise System (Inbound Shipments)

Sistema completo de gestión de mercadería entrante desde proveedores con actualización automática de inventario.

### Características Principales

**1. Gestión de Envíos**
- Crear envíos de proveedores con múltiples productos
- Auto-generación de referencias internas: `ISH-YYYYMMDD-XXX`
- Auto-generación de códigos de seguimiento: `TRACK-YYYYMMDD-XXXX`
- Tracking opcional de transportadora, ETA, costos
- Soporte para notas y evidencia fotográfica

**2. Creación de Productos en Línea**
- Botón `📦+` junto a cada selector de producto
- Formulario inline para crear productos nuevos al vuelo
- Auto-selección y auto-fill del costo unitario
- Campos: Nombre (req), Costo (req), Precio de Venta (opt), Imagen (opt)
- Stock inicial: 0 (se actualiza solo en recepción)

**3. Flujo de Recepción**
- Modal de verificación para confirmar cantidades recibidas
- Campos por producto:
  - Cantidad Aceptada (updates inventory)
  - Cantidad Rechazada (no updates inventory)
  - Notas de Discrepancia (requeridas si qty_rejected > 0)
- Estados automáticos:
  - `pending`: Creado, inventario NO actualizado
  - `partial`: Recibido parcialmente con discrepancias
  - `received`: Completamente recibido y verificado
- **Crucial**: El inventario se actualiza SOLO con qty_received (accepted)

**4. Protecciones y Validaciones**
- No se puede eliminar envíos `received` o `partial` (integridad de datos)
- Solo envíos `pending` son eliminables
- Validación de cantidades: `qty_received + qty_rejected ≤ qty_ordered`
- Triggers automáticos actualizan `total_cost` del envío

### Base de Datos

**Migración**: `db/migrations/011_merchandise_system.sql`

**Tablas**:
```sql
inbound_shipments
  - id, store_id, internal_reference (unique per store)
  - supplier_id, carrier_id, tracking_code
  - estimated_arrival_date, received_date
  - status (pending/partial/received)
  - shipping_cost, total_cost (auto-calculated)
  - evidence_photo_url, notes
  - created_by, received_by

inbound_shipment_items
  - id, shipment_id, product_id
  - qty_ordered, qty_received, qty_rejected
  - unit_cost, total_cost (generated column)
  - discrepancy_notes
  - has_discrepancy (generated column)
```

**Funciones**:
- `generate_inbound_reference(store_id)` - Auto-gen reference
- `receive_shipment_items(shipment_id, items[], received_by)` - Updates inventory

**Vista**:
- `inbound_shipments_summary` - Enriched view with supplier/carrier names and aggregated stats

### API Endpoints

```bash
# List shipments
GET /api/merchandise?status=pending&limit=50

# Get shipment with items
GET /api/merchandise/:id

# Create shipment
POST /api/merchandise
{
  "supplier_id": "uuid",
  "tracking_code": "TRACK-20251128-1234",
  "estimated_arrival_date": "2025-12-01",
  "items": [
    {"product_id": "uuid", "qty_ordered": 100, "unit_cost": 25.50}
  ]
}

# Receive shipment (UPDATES INVENTORY)
POST /api/merchandise/:id/receive
{
  "items": [
    {
      "item_id": "uuid",
      "qty_received": 95,
      "qty_rejected": 5,
      "discrepancy_notes": "5 units damaged"
    }
  ]
}

# Update shipment header
PATCH /api/merchandise/:id

# Delete shipment (pending only)
DELETE /api/merchandise/:id

# Get statistics
GET /api/merchandise/stats/summary
```

### Frontend Components

**Página**: `src/pages/Merchandise.tsx` (18.84 kB)

**Características UI**:
- Lista con búsqueda y filtros (por estado)
- Badges de estado con colores (pending/partial/received)
- Modal de creación con:
  - Auto-generación de tracking code
  - Creación inline de productos (botón 📦+)
  - Items dinámicos (agregar/quitar productos)
- Modal de recepción con:
  - Verificación de cantidades
  - Campos de discrepancia condicionales
  - Preview de cantidades restantes
- Soporte completo de Dark Mode

**Servicio**: `src/services/merchandise.service.ts`
- Métodos: `getAll`, `getById`, `create`, `update`, `delete`, `receive`, `getStats`
- Auth headers automáticos (Bearer token + X-Store-ID)

### Flujo de Uso

1. **Crear Mercadería**:
   - Click "Nueva Mercadería"
   - Opcional: Seleccionar proveedor, agregar tracking
   - Click "Generar" para auto-tracking code
   - Agregar productos:
     - Seleccionar existente O
     - Click 📦+ → Crear nuevo producto inline
   - Submit → Envío creado con status `pending`

2. **Recibir Mercadería**:
   - Click "Recibir" en envío pendiente
   - Para cada producto:
     - Ingresar cantidad aceptada
     - Ingresar cantidad rechazada (si aplica)
     - Agregar notas de discrepancia (si qty_rejected > 0)
   - Confirmar → Inventario actualizado, status cambia a `received` o `partial`

3. **Verificar Inventario**:
   - Ir a Productos
   - Stock aumentado por qty_received (NO por qty_ordered)

### Reglas de Negocio

- ✅ Inventory update: **ONLY on reception**, not on creation
- ✅ Stock increase: **ONLY by qty_received** (accepted items)
- ✅ Status logic: All complete → `received`, Some missing → `partial`
- ✅ Delete protection: Cannot delete `received` or `partial` shipments
- ✅ Reference uniqueness: Per store per day (ISH-YYYYMMDD-XXX)
- ✅ Auto-calculations: total_cost updated via triggers

### Testing Checklist

- [ ] Crear envío con productos existentes
- [ ] Crear envío con productos nuevos (inline creation)
- [ ] Auto-generar tracking code
- [ ] Recibir envío completo (100/100) → Status `received`, stock +100
- [ ] Recibir envío parcial (80/100, 10 rejected) → Status `partial`, stock +80
- [ ] Verificar que no se puede eliminar envíos received/partial
- [ ] Verificar búsqueda y filtros
- [ ] Verificar Dark Mode

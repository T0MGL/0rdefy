# Ordefy - E-commerce Management Platform

**Developed by:** Bright Idea | **Domain:** ordefy.io | **Copyright:** All Rights Reserved

E-commerce management dashboard with intelligent analytics, order processing, warehouse operations, and multi-platform integrations.

## Tech Stack

**Frontend:** React 18 + TypeScript + Vite + shadcn/ui + Tailwind + React Router + TanStack Query + Recharts + Framer Motion + React Hook Form + Zod
**Backend:** Node.js + Express + PostgreSQL (Supabase) + JWT Authentication
**Ports:** Frontend 8080, Backend 3001

## Architecture

### Project Structure
```
src/
├── components/          # UI components (shadcn/ui in /ui/)
├── pages/              # Routes (Dashboard, Orders, Products, Warehouse, Merchandise, Settings, Integrations)
├── contexts/           # AuthContext, ThemeContext
├── services/           # API layer (orders, products, customers, ads, merchandise, warehouse)
├── utils/              # Business logic (alertEngine, recommendationEngine, healthCalculator)
├── types/              # TypeScript definitions
├── hooks/              # Custom hooks
└── lib/                # Utilities

api/
├── routes/             # API endpoints (auth, customers, campaigns, merchandise, warehouse, shopify)
├── middleware/         # JWT verification, store ID extraction
├── services/           # Business logic (shopify, warehouse)
└── db/                 # Supabase client

db/
├── migrations/
│   ├── 000_MASTER_MIGRATION.sql  # ⭐ Use ONLY this for initial setup
│   ├── 011_merchandise_system.sql # Optional: Inbound shipments
│   └── 015_warehouse_picking.sql  # Optional: Picking & packing
└── seed.sql
```

### Key Patterns

**Authentication:**
- Multi-step onboarding (user info + store setup)
- JWT tokens in localStorage
- Headers: `Authorization: Bearer {token}`, `X-Store-ID: {id}`
- Middleware: `verifyToken`, `extractStoreId`

**Services Layer:**
```typescript
// All services follow CRUD pattern
{ getAll, getById, create, update, delete }
// Auth headers injected via api.client.ts
const getAuthHeaders = () => ({
  'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
  'X-Store-ID': localStorage.getItem('current_store_id')
})
```

**Intelligence Engines** (`src/utils/`):
- Alert Engine: Analyzes metrics, generates alerts (critical/warning/info)
- Recommendation Engine: Suggests actions with impact projections
- Health Calculator: Business health score 0-100 (delivery 25pts, margin 25pts, ROI 25pts, stock 25pts)

**Notification System** (`src/utils/notificationEngine.ts`, `NOTIFICATION_SYSTEM.md`):
- Timezone-aware time calculations (respects user's browser timezone)
- Accurate relative time formatting ("hace 2 horas" es realmente 2 horas)
- Clickeable notifications with direct navigation to problems
- Metadata-enriched (orderId, productId, count, timeReference)
- Priority levels: high (critical >48h), medium (warning 24-48h), low (info)
- Smart aggregation: Individual notifications for critical issues, summaries for warnings
- LocalStorage persistence with read status preservation
- Auto-refresh every 5 minutes
**Files:** `timeUtils.ts` (timezone helpers), `notificationEngine.ts` (notification generator), `notifications.service.ts` (singleton service), `useHighlight.ts` (URL highlighting hook)

**Theme System:**
- ThemeContext + localStorage persistence
- FOUC prevention via inline script in `index.html`
- CSS variables for all colors
- Full dark mode support

**Path Aliases:**
```typescript
import { Button } from '@/components/ui/button'
```

## Core Modules

### Inventory Management (Automatic Stock Tracking)
**Files:** `db/migrations/019_inventory_management.sql`, `INVENTORY_SYSTEM.md`

**Stock Flow:**
```
pending → confirmed → in_preparation → ready_to_ship → shipped → delivered
  100       100           100              97            97        97
                                           ⬇️ DECREMENT
```

**Key Features:**
- **Automatic Stock Updates:** Triggers decrement stock when order reaches `ready_to_ship`
- **Restoration on Cancel:** Restores stock when orders cancelled/rejected after decrement
- **Audit Log:** Complete tracking in `inventory_movements` table
- **Data Protection:** Prevents editing line_items or deleting orders after stock deducted
- **Edge Cases:** Handles order reversions and status changes

**Tables:** inventory_movements (audit log)
**Triggers:** trigger_update_stock_on_order_status, trigger_prevent_line_items_edit, trigger_prevent_order_deletion
**Testing:** `./test-inventory-tracking.sh`

**Why ready_to_ship?** Stock decrements when picking/packing complete (physical inventory removed), not at confirmation (prevents overselling while allowing order modifications).

### Warehouse (Picking & Packing)
**Files:** `src/pages/Warehouse.tsx`, `api/routes/warehouse.ts`, `api/services/warehouse.service.ts`, `db/migrations/015_warehouse_picking.sql`, `021_improve_warehouse_session_code.sql`

**Workflow:**
1. Dashboard: Multi-select confirmed orders → create picking session
2. Picking: Aggregate products across orders, manual controls `[-] 0/5 [+]`
3. Packing: Split-view (basket ← → order boxes), smart highlighting
4. Complete packing → order status = `ready_to_ship` → **stock automatically decremented** (see Inventory Management)

**Features:** Batch processing, auto-generated codes (PREP-DDMMYYYY-NN format, e.g., PREP-02122025-01), progress tracking, order transitions (confirmed → in_preparation → ready_to_ship), touch-optimized, automatic stock management

**Tables:** picking_sessions, picking_session_orders, picking_session_items, packing_progress

**Recent Fixes (Dec 2025):**
- ✅ Fixed 500 error in picking-list endpoint (query optimization)
- ✅ Implemented automatic stock tracking system (migration 019)
- ✅ Improved session code format to DDMMYYYY (Latin American standard)

### Merchandise (Inbound Shipments)
**Files:** `src/pages/Merchandise.tsx`, `api/routes/merchandise.ts`, `db/migrations/011_merchandise_system.sql`

**Features:**
- Create shipments from suppliers with multiple products
- Auto-generation: references (ISH-YYYYMMDD-XXX), tracking codes
- Inline product creation (📦+ button)
- Receive workflow: qty_received/qty_rejected, discrepancy notes
- Inventory updates ONLY on reception (qty_received)
- Status: pending → partial/received
- Cannot delete received/partial shipments

**Tables:** inbound_shipments, inbound_shipment_items
**Functions:** generate_inbound_reference, receive_shipment_items

### Shopify Integration (Production-Ready)
**Files:** `src/pages/Integrations.tsx`, `src/components/ShopifyIntegrationModal.tsx`, `api/routes/shopify.ts`, `api/services/shopify-*.service.ts`

**Features:**
- One-time import (products, customers, orders)
- Bidirectional product sync (update/delete)
- Webhooks: orders/create, orders/updated, products/delete
- Webhook reliability: Idempotency (24h TTL), exponential backoff retries (60s→960s, max 5), real-time metrics
- Rate limiting: 2 req/sec for Shopify API
- HMAC signature verification
- Auto-send new orders to n8n (N8N_WEBHOOK_URL)

**Tables:** shopify_integrations, shopify_webhook_events, shopify_webhook_idempotency, shopify_webhook_retry_queue, shopify_webhook_metrics

**Cron Jobs:**
```bash
*/5 * * * * curl -X POST /api/shopify/webhook-retry/process  # Retries
0 3 * * * curl -X POST /api/shopify/webhook-cleanup         # Cleanup
```

## Database Schema

**Master Migration:** `000_MASTER_MIGRATION.sql` (idempotent, all-in-one)

**Tables:**
- Base: stores, users, user_stores, store_config
- Business: products, customers, carriers, suppliers, campaigns, additional_values
- Orders: orders (statuses: pending, confirmed, in_preparation, ready_to_ship, shipped, delivered, cancelled)
- History: order_status_history, follow_up_log
- Delivery: delivery_attempts, daily_settlements, settlement_orders
- Inventory: inventory_movements (audit log for all stock changes)
- Merchandise: inbound_shipments, inbound_shipment_items
- Warehouse: picking_sessions, picking_session_orders, picking_session_items, packing_progress
- Shopify: shopify_integrations, shopify_oauth_states, shopify_import_jobs, shopify_webhook_events, shopify_sync_conflicts, shopify_webhook_idempotency, shopify_webhook_retry_queue, shopify_webhook_metrics

**Key Functions:**
- generate_inbound_reference, receive_shipment_items (inventory updates from suppliers)
- generate_session_code (warehouse batch codes)
- update_product_stock_on_order_status (automatic stock management)
- prevent_line_items_edit_after_stock_deducted (data integrity)
- prevent_order_deletion_after_stock_deducted (data integrity)

**Triggers:**
- Auto-update: customer stats, carrier stats, order status history, delivery tokens, COD calculation, warehouse timestamps
- Stock management: trigger_update_stock_on_order_status (decrements/restores stock on status changes)
- Data protection: trigger_prevent_line_items_edit, trigger_prevent_order_deletion (prevents data corruption)

## Analytics Formulas (Verified)

All formulas in `api/routes/analytics.ts`:
1. Revenue = Sum(order.total_price)
2. Costs = Sum(product.cost × quantity)
3. Marketing = Sum(campaign.investment) [active campaigns only]
4. Net Profit = Revenue - Costs - Marketing
5. Profit Margin = (Net Profit ÷ Revenue) × 100
6. ROI = Revenue ÷ Total Investment
7. Delivery Rate = (Delivered ÷ Total) × 100
8. Cost Per Order = Total Costs ÷ Total Orders
9. Average Order Value = Revenue ÷ Total Orders

Period-over-period comparisons: Current 7 days vs previous 7 days

## Security & Performance

### Rate Limiting
- General API: 500 req/15min per IP
- Authentication: 5 req/15min (brute force protection)
- Webhooks: 60 req/min
- Write operations: 200 req/15min

### Production Fixes (December 2025)
1. ✅ **N+1 Query Optimization:** Batch product fetching (300 queries → 1 query), analytics response 3-5s → 100-300ms
2. ✅ **Warehouse Service:** Fixed client (supabase → supabaseAdmin) for RLS permissions
3. ✅ **SQL Injection Prevention:** Input sanitization in search endpoints (`api/utils/sanitize.ts`)

### Pending Recommendations (Non-Blocking)
- ⚠️ Conditional logger (456 console statements in prod)
- ⚠️ UUID validation in warehouse service
- ⚠️ Rate limiting on public order endpoints (token-based)
- Code refactoring: DRY in orders transformation

**Status:** ✅ Production-ready (3 critical issues resolved, 17 non-blocking remain)

## Features

**Production-Ready:**
- ✅ Authentication (login, register, logout, password change, account deletion)
- ✅ Multi-store support with role-based access
- ✅ Real-time analytics with period comparisons
- ✅ Order management with WhatsApp confirmation
- ✅ Product inventory management
- ✅ Merchandise/Inbound shipments
- ✅ Warehouse picking & packing
- ✅ Customer/Supplier/Carrier management
- ✅ Campaign/Ads management
- ✅ Shopify integration (webhooks, sync)
- ✅ Dark mode theme system
- ✅ Global search (Cmd+K)

**Coming Soon:**
- 2FA authentication
- Billing/Subscription system
- Dropi integration (dropshipping for LATAM)

## Development Notes

**Adding Pages:** Create in `src/pages/` → Add route in `App.tsx` → Add link in `Sidebar.tsx`

**Styling:** Tailwind utilities, CSS variables, dark mode variants (`dark:bg-*-950/20`, `dark:text-*-400`)

**CORS:** Allowed origins in `api/index.ts` (8080, 8081, 5173, 3000)

**TypeScript:** Relaxed settings (`noImplicitAny: false`, `strictNullChecks: false`)

**Storage Keys:** Pattern `neonflow_[entity]`

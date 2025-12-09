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

**Recent Updates (Dec 2024 - Jan 2025):**
- ✅ Fixed 500 error in picking-list endpoint (query optimization)
- ✅ Implemented automatic stock tracking system (migration 019)
- ✅ Improved session code format to DDMMYYYY (Latin American standard)
- ✅ Added returns system with batch processing (migration 022)
- ✅ Implemented Shopify order line items normalization (migration 024)
- ✅ Fixed order creation/deletion protection triggers (migration 023)
- ✅ Added shipping label print tracking (migration 017)

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
**Documentation:** `SHOPIFY_ORDER_LINE_ITEMS.md`, `SHOPIFY_PRODUCT_SYNC_GUIDE.md`

**Features:**
- One-time import (products, customers, orders)
- **Bidirectional product sync:** Ordefy ↔ Shopify (products, inventory, prices)
- **Order Line Items:** Normalized table with product mapping (replaces JSONB parsing)
- Webhooks: orders/create, orders/updated, products/delete
- Webhook reliability: Idempotency (24h TTL), exponential backoff retries (60s→960s, max 5), real-time metrics
- Rate limiting: 2 req/sec for Shopify API
- HMAC signature verification
- Auto-send new orders to n8n (N8N_WEBHOOK_URL)

**Product Mapping:**
- `find_product_by_shopify_ids()` - Matches local products by Shopify IDs/SKU
- `create_line_items_from_shopify()` - Parses order line items from webhooks
- Automatic inventory updates when products mapped correctly
- Supports multiple products per order with proper stock tracking

**Sync Features:**
- When updating product locally → auto-syncs to Shopify (price, stock, name, description)
- `sync_status` tracking: synced, pending, error
- Inventory-only updates optimized for speed
- Field mapping: SKU, category, shopify_product_id, shopify_variant_id

**Tables:**
- Integration: shopify_integrations, shopify_oauth_states, shopify_import_jobs
- Webhooks: shopify_webhook_events, shopify_webhook_idempotency, shopify_webhook_retry_queue, shopify_webhook_metrics
- Orders: order_line_items (normalized line items with product mapping)
- Sync: shopify_sync_conflicts

**Cron Jobs:**
```bash
*/5 * * * * curl -X POST /api/shopify/webhook-retry/process  # Retries
0 3 * * * curl -X POST /api/shopify/webhook-cleanup         # Cleanup
```

### Returns System (Batch Returns Processing)
**Files:** `src/pages/Returns.tsx`, `api/routes/returns.ts`, `api/services/returns.service.ts`, `db/migrations/022_returns_system.sql`

**Workflow:**
1. Select eligible orders (delivered, shipped, or cancelled)
2. Create return session with auto-generated code (RET-DDMMYYYY-NN)
3. Process each item: Accept (restore stock) or Reject (damaged/defective)
4. Complete session → updates inventory + order status to 'returned'

**Features:**
- Batch processing of multiple returns in single session
- Item-level acceptance/rejection with reasons (damaged, defective, incomplete, wrong_item, other)
- Automatic inventory restoration for accepted items
- Audit trail in `inventory_movements` table
- Session progress tracking
- Rejection notes for quality control

**Tables:** return_sessions, return_session_orders, return_session_items
**Functions:** generate_return_session_code, complete_return_session

**Integration with Inventory:**
- Accepted items → stock incremented + logged as 'return_accepted'
- Rejected items → no stock change + logged as 'return_rejected' with reason
- Order status updated to 'returned' on session completion

### Shipping Labels System
**Files:** `src/components/OrderShippingLabel.tsx`, `src/pages/Orders.tsx`, `db/migrations/017_add_printed_status.sql`
**Documentation:** `INSTRUCCIONES_IMPRESION.md`

**Features:**
- 4x6 inch thermal label format (compatible with Dymo, Zebra, Brother)
- QR code for delivery tracking (links to delivery confirmation page)
- Customer feedback instructions on label
- Print tracking: `printed`, `printed_at`, `printed_by` fields
- Visual indicators: Blue (not printed) → Green (printed)
- Bulk printing workflow with sequential dialog
- Multi-select orders for batch label printing

**Label Contents:**
- QR code with delivery token
- Customer info (name, phone, address)
- Courier/carrier name
- Product list with quantities
- Delivery instructions for carrier
- Feedback request for customer

**API Endpoints:**
- `POST /api/orders/:id/mark-printed` - Mark single order as printed
- `POST /api/orders/mark-printed-bulk` - Mark multiple orders as printed

## Database Schema

**Master Migration:** `000_MASTER_MIGRATION.sql` (idempotent, all-in-one)

**Tables:**
- Base: stores, users, user_stores, store_config
- Business: products, customers, carriers, suppliers, campaigns, additional_values
- Orders: orders (statuses: pending, confirmed, in_preparation, ready_to_ship, shipped, delivered, cancelled, returned), order_line_items
- History: order_status_history, follow_up_log
- Delivery: delivery_attempts, daily_settlements, settlement_orders
- Inventory: inventory_movements (audit log for all stock changes)
- Merchandise: inbound_shipments, inbound_shipment_items
- Warehouse: picking_sessions, picking_session_orders, picking_session_items, packing_progress
- Returns: return_sessions, return_session_orders, return_session_items
- Shopify: shopify_integrations, shopify_oauth_states, shopify_import_jobs, shopify_webhook_events, shopify_sync_conflicts, shopify_webhook_idempotency, shopify_webhook_retry_queue, shopify_webhook_metrics

**Key Functions:**
- generate_inbound_reference, receive_shipment_items (inventory updates from suppliers)
- generate_session_code (warehouse batch codes)
- generate_return_session_code (returns batch codes)
- complete_return_session (process returns and update inventory)
- update_product_stock_on_order_status (automatic stock management)
- prevent_line_items_edit_after_stock_deducted (data integrity)
- prevent_order_deletion_after_stock_deducted (data integrity)
- find_product_by_shopify_ids (product mapping for Shopify orders)
- create_line_items_from_shopify (normalize Shopify line items)

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
- ✅ Product inventory management with automatic stock tracking
- ✅ Merchandise/Inbound shipments
- ✅ Warehouse picking & packing with batch processing
- ✅ Returns system with batch processing and inventory restoration
- ✅ Shipping labels (4x6 thermal) with QR codes and print tracking
- ✅ Customer/Supplier/Carrier management
- ✅ Campaign/Ads management
- ✅ Shopify integration (bidirectional sync, webhooks, product mapping)
- ✅ Order line items normalization with product mapping
- ✅ Dark mode theme system
- ✅ Global search (Cmd+K)
- ✅ Intelligent notification system with timezone awareness

**Coming Soon:**
- 2FA authentication
- Billing/Subscription system
- Dropi integration (dropshipping for LATAM)
- Mercado Libre integration
- Multi-channel inventory sync

## Development Notes

**Adding Pages:** Create in `src/pages/` → Add route in `App.tsx` → Add link in `Sidebar.tsx`

**Styling:** Tailwind utilities, CSS variables, dark mode variants (`dark:bg-*-950/20`, `dark:text-*-400`)

**CORS:** Allowed origins in `api/index.ts` (8080, 8081, 5173, 3000)

**TypeScript:** Relaxed settings (`noImplicitAny: false`, `strictNullChecks: false`)

**Storage Keys:** Pattern `neonflow_[entity]`

## Technical Documentation

**Core Systems:**
- `SHOPIFY_ORDER_LINE_ITEMS.md` - Shopify order normalization and product mapping system
- `SHOPIFY_PRODUCT_SYNC_GUIDE.md` - Bidirectional product synchronization with Shopify
- `INSTRUCCIONES_IMPRESION.md` - Shipping label printing system (4x6 thermal labels)
- `ROADMAP_MEJORAS_UX.md` - Product roadmap and UX improvements (2026)

**Database:**
- `db/migrations/README.md` - Migration system documentation
- `db/migrations/000_MASTER_MIGRATION.sql` - Complete schema (idempotent, production-ready)

**Key Migrations:**
- 011: Merchandise/Inbound shipments system
- 015: Warehouse picking & packing system
- 017: Shipping label print tracking
- 019: Automatic inventory management
- 022: Returns/refunds system
- 023: Order creation/deletion protection fixes
- 024: Shopify order line items normalization

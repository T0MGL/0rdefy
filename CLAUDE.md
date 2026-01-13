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
├── components/          # UI components (shadcn/ui in /ui/, TeamManagement, ShopifyIntegrationModal, OrderShippingLabel)
├── pages/              # Routes (Dashboard, Orders, Products, Warehouse, Merchandise, Returns, Settings, Integrations, AcceptInvitation)
├── contexts/           # AuthContext, ThemeContext
├── services/           # API layer (orders, products, customers, ads, merchandise, warehouse, collaborators)
├── utils/              # Business logic (alertEngine, recommendationEngine, healthCalculator, notificationEngine, timeUtils)
├── types/              # TypeScript definitions
├── hooks/              # Custom hooks (useHighlight)
└── lib/                # Utilities

api/
├── routes/             # API endpoints (auth, customers, campaigns, merchandise, warehouse, shopify, collaborators, returns)
├── middleware/         # JWT verification, store ID extraction, permissions (extractUserRole, requireRole, requireModule, requirePermission)
├── services/           # Business logic (shopify, warehouse, returns)
├── permissions.ts      # Role-based permission definitions (6 roles, 15 modules, 4 permissions)
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
- **NEW: WhatsApp Phone Verification** - One phone number per account (prevents multicuentas)

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
**Files:** `src/pages/Warehouse.tsx`, `api/routes/warehouse.ts`, `api/services/warehouse.service.ts`, `db/migrations/015_warehouse_picking.sql`, `021_improve_warehouse_session_code.sql`, `058_warehouse_production_ready_fixes.sql`

**Workflow:**
1. Dashboard: Multi-select confirmed orders → create picking session
2. Picking: Aggregate products across orders, manual controls `[-] 0/5 [+]`
3. Packing: Split-view (basket ← → order boxes), smart highlighting
4. Complete packing → order status = `ready_to_ship` → **stock automatically decremented** (see Inventory Management)

**Features:** Batch processing, auto-generated codes (PREP-DDMMYYYY-NNN format, e.g., PREP-12012026-001), progress tracking, order transitions (confirmed → in_preparation → ready_to_ship), touch-optimized, automatic stock management

**Tables:** picking_sessions (with last_activity_at, abandoned_at columns), picking_session_orders, picking_session_items, packing_progress

**Session Management (Migration 058):**
- **Session Abandonment:** `POST /api/warehouse/sessions/:id/abandon` restores orders to confirmed
- **Order Removal:** `DELETE /api/warehouse/sessions/:id/orders/:orderId` removes single order
- **Stale Session Cleanup:** `POST /api/warehouse/cleanup-sessions?hours=48` for cron jobs
- **Session Code:** 3-digit format supports 999 sessions/day (was 99)
- **Atomic Packing:** `update_packing_progress_atomic()` RPC with row locking
- **Staleness Indicators:** UI shows WARNING (>24h) and CRITICAL (>48h) sessions

**Session Recovery:**
- Abandoned sessions: Orders restored to confirmed, can be re-picked
- Browser close: Session remains active, user can resume from dashboard
- Auto-cleanup: Cron job cleans sessions inactive >48h (configurable)

**Cron Setup (Recommended):**
```bash
# Every 6 hours, cleanup sessions inactive > 48h
0 */6 * * * curl -X POST https://api.ordefy.io/api/warehouse/cleanup-sessions?hours=48
```

**Monitoring Views:**
- `v_stale_warehouse_sessions`: Sessions needing attention (WARNING/CRITICAL)
- `v_orders_stuck_in_preparation`: Orders that may be orphaned
- `v_warehouse_session_stats`: Daily completion rates and metrics

**Recent Updates (Dec 2024 - Jan 2026):**
- ✅ Fixed 500 error in picking-list endpoint (query optimization)
- ✅ Implemented automatic stock tracking system (migration 019)
- ✅ Improved session code format to DDMMYYYY (Latin American standard)
- ✅ Added returns system with batch processing (migration 022)
- ✅ Implemented Shopify order line items normalization (migration 024)
- ✅ Fixed order creation/deletion protection triggers (migration 023)
- ✅ Added shipping label print tracking (migration 017)
- ✅ Collaborator invitation system with role-based access (migration 030)
- ✅ Shopify order fields expansion - total_discounts, tags, timestamps (migration 033)
- ✅ Hard delete system for orders - Complete cascading cleanup (migration 039)
- ✅ **NEW: Production-ready warehouse fixes (migration 058):**
  - Session abandonment with order restoration
  - 3-digit session codes (999/day capacity)
  - Atomic packing operations with row locking
  - Session staleness tracking and auto-cleanup
  - Cancel Session UI button with confirmation dialog
  - Visual indicators for stale sessions (>24h WARNING, >48h CRITICAL)

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
**Documentation:** `SHOPIFY_ORDER_LINE_ITEMS.md`, `SHOPIFY_PRODUCT_SYNC_GUIDE.md`, `SHOPIFY_INVENTORY_SYNC.md`, `SHOPIFY_AUTOMATIC_INBOUND_SHIPMENT.md`

**Features:**
- One-time import (products, customers, orders)
- **Bidirectional product sync:** Ordefy ↔ Shopify (products, inventory, prices)
- **Automatic inventory sync:** All stock changes auto-sync to Shopify (NEW: Dec 2025)
- **Automatic inbound shipment:** Creates merchandise reception when importing products (NEW: Jan 2026)
- **Order Line Items:** Normalized table with product mapping (replaces JSONB parsing)
- Webhooks: orders/create, orders/updated, products/delete
- Webhook reliability: Idempotency (24h TTL), exponential backoff retries (60s→960s, max 5), real-time metrics
- Rate limiting: 2 req/sec for Shopify API
- HMAC signature verification
- Auto-send new orders to n8n (N8N_WEBHOOK_URL)

**Automatic Inbound Shipment (NEW: Jan 2026):**
- When importing products from Shopify, automatically creates an inbound shipment
- Reference: ISH-YYYYMMDD-XXX (e.g., ISH-20260106-001)
- Status: 'received' (inventory already in Shopify)
- Only includes products with stock > 0
- Creates inventory movements for complete audit trail
- Notes: "Recepción automática de inventario inicial desde Shopify"
- Prevents inventory discrepancies when dispatching orders
- Non-blocking: Import succeeds even if shipment creation fails

**Product Mapping:**
- `find_product_by_shopify_ids()` - Matches local products by Shopify IDs/SKU
- `create_line_items_from_shopify()` - Parses order line items from webhooks
- Automatic inventory updates when products mapped correctly
- Supports multiple products per order with proper stock tracking

**Sync Features:**
- When updating product locally → auto-syncs to Shopify (price, stock, name, description)
- **NEW: Creating product** → Auto-publishes to Shopify with stock OR fetches inventory from Shopify
- **NEW: Receiving merchandise** → Batch syncs all updated products to Shopify
- `sync_status` tracking: synced, pending, error
- Inventory-only updates optimized for speed
- Field mapping: SKU, category, shopify_product_id, shopify_variant_id
- Non-blocking error handling: Local operations always succeed, sync errors only warn

**Tables:**
- Integration: shopify_integrations, shopify_oauth_states, shopify_import_jobs
- Webhooks: shopify_webhook_events, shopify_webhook_idempotency, shopify_webhook_retry_queue, shopify_webhook_metrics
- Orders: order_line_items (normalized line items with product mapping)
- Sync: shopify_sync_conflicts

**Cron Jobs (auto-configured via railway.json):**
```bash
# Shopify (manual setup if needed)
*/5 * * * * curl -X POST /api/shopify/webhook-retry/process  # Retries
0 3 * * * curl -X POST /api/shopify/webhook-cleanup         # Cleanup

# Billing (auto-configured in railway.json - Railway handles these)
# 0 8 * * *  /api/billing/cron/expiring-trials         # Trial reminders (3 days before)
# 0 9 * * *  /api/billing/cron/past-due-enforcement    # Downgrade after 7-day grace
# 0 10 * * * /api/billing/cron/process-referral-credits # Credits after 30-day wait
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

### Dispatch & Settlements System (Courier Reconciliation)
**Files:** `src/pages/Settlements.tsx`, `api/routes/settlements.ts`, `api/services/settlements.service.ts`, `db/migrations/045_dispatch_settlements_system.sql`, `059_dispatch_settlements_production_fixes.sql`

**Workflow (Despacho → Conciliación → Liquidación → Pago):**
1. **Despacho:** Select ready_to_ship orders → create dispatch session (DISP-DDMMYYYY-NNN)
2. **Export CSV:** Download session for courier (Google Sheets/Excel compatible)
3. **Courier Delivery:** Courier delivers orders, marks results in CSV
4. **Conciliación:** Import CSV results → system validates and reconciles
5. **Liquidación:** Calculate net amount (COD collected - carrier fees)
6. **Pago:** Mark settlement as paid

**Features:**
- Batch dispatch sessions with auto-generated codes (3-digit: 999 sessions/day)
- **Duplicate order prevention** - Orders cannot be in multiple active sessions
- CSV export for courier communication (transition until QR scanning)
- CSV import with Spanish column name support (ESTADO_ENTREGA, MONTO_COBRADO, etc.)
- **Latin number format support** - Parses 25.000, 25,000, 25000 correctly
- Zone-based carrier rates (Asunción: 25,000 Gs, Central: 30,000-35,000 Gs, Interior: 45,000 Gs)
- **Carrier zone validation** - Warns if carrier has no zones configured
- Delivery result tracking: delivered, failed, rejected, rescheduled
- Discrepancy detection during reconciliation
- Financial summary: COD expected vs collected, carrier fees, net receivable
- Pending amounts by carrier dashboard
- **Status transition validation** - Prevents invalid status changes

**Delivery Results:**
- `delivered`: Order delivered, COD collected (if applicable)
- `failed`: Delivery attempt failed (no one home, wrong address, etc.)
- `rejected`: Customer rejected delivery
- `rescheduled`: Delivery rescheduled for another day

**Session Status Flow:**
```
dispatched → processing → settled
     ↓           ↓           ↓
  Export     Import      Create
  CSV        Results     Settlement
     ↓
 cancelled (can happen from any non-settled state)
```

**Net Receivable Calculation:**
```
Net Receivable = COD Collected - Carrier Fees (COD + Prepaid) - Failed Attempt Fees
If positive: Courier owes store
If negative: Store owes courier (common with prepaid orders)
```

**Tables:** dispatch_sessions, dispatch_session_orders, carrier_zones, daily_settlements
**Functions:** generate_dispatch_session_code, process_dispatch_settlement_atomic, check_orders_not_in_active_session, validate_carrier_has_zones, get_carrier_fee_for_zone
**Views:** v_dispatch_session_health, v_settlement_discrepancies

**Production Fixes (Migration 059):**
- ✅ Duplicate order dispatch prevention (trigger + validation)
- ✅ Session code format: 3 digits (999/day capacity)
- ✅ Status transition validation trigger
- ✅ Carrier zone validation helpers
- ✅ Settlement tracking columns (total_cod_expected, carrier_fees_cod, carrier_fees_prepaid)
- ✅ Carrier fee protection (cannot modify after dispatch)
- ✅ Performance indexes for dispatch queries
- ✅ Atomic settlement processing with row locking
- ✅ Health monitoring view (CRITICAL >72h, WARNING >48h)
- ✅ Discrepancy tracking view

**API Endpoints:**
- `GET/POST /api/settlements/dispatch-sessions` - List/create dispatch sessions
- `GET /api/settlements/dispatch-sessions/:id` - Session detail with orders
- `POST /api/settlements/dispatch-sessions/:id/dispatch` - Mark as dispatched
- `GET /api/settlements/dispatch-sessions/:id/export` - Export CSV for courier
- `POST /api/settlements/dispatch-sessions/:id/import` - Import delivery results
- `POST /api/settlements/dispatch-sessions/:id/process` - Process settlement (atomic)
- `POST /api/settlements/v2/:id/pay` - Record payment
- `GET /api/settlements/summary/v2` - Analytics summary
- `GET /api/settlements/pending-by-carrier` - Pending amounts by carrier
- `POST /api/settlements/manual-reconciliation` - Manual reconciliation without CSV

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

### Collaborator Invitation System (Team Management)
**Files:** `src/components/TeamManagement.tsx`, `src/pages/AcceptInvitation.tsx`, `api/routes/collaborators.ts`, `api/permissions.ts`, `api/middleware/permissions.ts`, `db/migrations/030_collaborator_invitation_system.sql`
**Documentation:** `COLLABORATORS_SYSTEM.md`

**Features:**
- Invite users via secure unique links (64-char tokens, 7-day expiration)
- Role-based access control: owner, admin, logistics, confirmador, contador, inventario
- Module-level permissions: 15 modules × 4 permissions (VIEW, CREATE, EDIT, DELETE)
- Plan limits: Free (1 user), Starter (3 users), Growth/Enterprise (unlimited)
- Soft delete for removed collaborators
- Auto-login after invitation acceptance

**Roles & Permissions:**
- **owner**: Full access to all modules
- **admin**: All except Team and Billing
- **logistics**: Warehouse, Returns, Carriers, Orders (view + edit status), Analytics (view only for logistics metrics)
- **confirmador**: Orders (no delete), Customers, Products (view only for order creation)
- **contador**: Analytics, Campaigns (view), Orders/Products (view)
- **inventario**: Products, Merchandise, Suppliers

**Workflow:**
1. Owner creates invitation (name, email, role) → receives unique link
2. Sends link to collaborator (manual via WhatsApp/Email)
3. Collaborator opens link → validates token → creates password
4. Auto-creates user account + store relationship → auto-login
5. Collaborator sees only permitted modules

**Tables:** collaborator_invitations, stores (subscription_plan, max_users), user_stores (invited_by, invited_at, is_active)
**Functions:** can_add_user_to_store, get_store_user_stats
**Middleware:** extractUserRole, requireRole, requireModule, requirePermission

**API Endpoints:**
- `POST /api/collaborators/invite` - Create invitation
- `GET /api/collaborators/invitations` - List invitations
- `DELETE /api/collaborators/invitations/:id` - Cancel invitation
- `GET /api/collaborators/validate-token/:token` - Validate token (public)
- `POST /api/collaborators/accept-invitation` - Accept invitation (public)
- `GET /api/collaborators` - List team members
- `DELETE /api/collaborators/:userId` - Remove collaborator
- `PATCH /api/collaborators/:userId/role` - Change role
- `GET /api/collaborators/stats` - User stats vs plan limits

### Phone Verification System (WhatsApp)
**Files:** `src/components/PhoneVerification.tsx`, `src/pages/AccountRecovery.tsx`, `api/routes/phone-verification.ts`, `api/services/whatsapp.service.ts`, `db/migrations/034_phone_verification_system.sql`
**Documentation:** `WHATSAPP_VERIFICATION_SETUP.md`

**Features:**
- WhatsApp-based phone number verification using Meta Business API
- Prevents multiple accounts with same phone number (anti-fraud)
- 6-digit verification codes with 10-minute expiration
- Account recovery flow for duplicate phone numbers
- Rate limiting: 60 seconds between code requests, max 5 verification attempts
- Demo mode (no WhatsApp needed for testing)
- Production mode (real WhatsApp messages via Meta Cloud API)

**Workflow:**
1. User registers → creates account (phone_verified: false)
2. System prompts for phone number
3. If phone already registered → redirect to account recovery page
4. If phone new → generate 6-digit code → send via WhatsApp
5. User enters code (max 5 attempts)
6. Code verified → phone_verified: true → full access granted
7. Codes expire after 10 minutes, auto-cleanup after 24 hours

**Configuration:**
```bash
# .env
WHATSAPP_PHONE_NUMBER_ID=123456789012345
WHATSAPP_ACCESS_TOKEN=your_meta_access_token
WHATSAPP_VERIFICATION_ENABLED=false  # false = demo mode, true = production
```

**Setup Requirements:**
1. Meta Business Account
2. WhatsApp Business API access (requires verification)
3. Verified business phone number
4. Permanent access token (from System User)

**API Endpoints:**
- `POST /api/phone-verification/request` - Request verification code (rate limited)
- `POST /api/phone-verification/verify` - Verify code
- `GET /api/phone-verification/status` - Check verification status
- `POST /api/phone-verification/resend` - Resend code

**Tables:** phone_verification_codes
**Functions:** generate_verification_code, can_request_verification_code, cleanup_expired_verification_codes

**Costs:**
- Free tier: 1,000 conversations/month
- After free tier: $0.005-$0.09 per conversation (varies by country)
- LATAM: ~$0.012-$0.015 per verification

### Billing & Subscriptions System (Stripe)
**Files:** `src/pages/Billing.tsx`, `src/services/billing.service.ts`, `api/routes/billing.ts`, `api/services/stripe.service.ts`, `db/migrations/036_billing_subscriptions_system.sql`

**Plans:**
| Plan | Price/mo | Annual | Users | Orders/mo | Products | Trial |
|------|----------|--------|-------|-----------|----------|-------|
| Free | $0 | - | 1 | 50 | 100 | No |
| Starter | $29 | $24 | 3 | 500 | 500 | 14 days |
| Growth | $79 | $66 | 10 | 2,000 | 2,000 | 14 days |
| Professional | $169 | $142 | 25 | 10,000 | Unlimited | No |

**Features by Plan:**
- **Free:** Dashboard, orders, products, customers (manual only)
- **Starter:** + Warehouse, Returns, Merchandise, Shipping Labels, Shopify import, Team (3 users)
- **Growth:** + Shopify bidirectional sync, Smart Alerts, Campaign tracking, API read, Team (10 users)
- **Professional:** + Multi-store (3), Custom roles, API full, Webhooks, Forecasting

**Trial System:**
- 14 days free trial on Starter and Growth plans
- Card required to start trial (no charge)
- **ONE trial per user lifetime** (any plan) - prevents trial abuse
- Auto-charges at end of trial or cancels
- Cron job sends reminder 3 days before expiration

**Referral System:**
- Each user gets unique referral code (6 chars)
- **30-day waiting period** before referrer earns $10 credit (anti-abuse)
- Credit only applied if referred user remains active after 30 days
- Referred user gets 20% off first month
- No limits on referral credits

**Discount Codes:**
- Types: percentage, fixed, trial_extension
- Restrictions: valid dates, max uses, applicable plans
- Stored in Stripe as coupons/promotion codes
- **Atomic increment** of usage in webhook (prevents race conditions)

**Downgrade Protection:**
- System validates current usage before allowing downgrade
- Must reduce users/products/stores to fit new plan limits
- Error message shows exactly what needs to be reduced

**Payment Grace Period:**
- 7-day grace period after payment failure
- User retains access during grace period
- Auto-downgrade to Free after grace period expires

**Configuration:**
```bash
# .env
STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
```

**API Endpoints:**
- `GET /api/billing/plans` - Get all plans (public)
- `GET /api/billing/subscription` - Get current subscription + usage
- `POST /api/billing/checkout` - Create Stripe checkout session
- `POST /api/billing/portal` - Open Stripe billing portal
- `POST /api/billing/cancel` - Cancel subscription at period end
- `POST /api/billing/reactivate` - Reactivate canceled subscription
- `POST /api/billing/change-plan` - Change plan (validates downgrade limits)
- `GET /api/billing/referrals` - Get referral stats
- `POST /api/billing/referrals/generate` - Generate referral code
- `POST /api/billing/webhook` - Stripe webhook handler

**Cron Endpoints (require X-Cron-Secret header):**
- `POST /api/billing/cron/expiring-trials` - Send reminders for trials expiring in 3 days
- `POST /api/billing/cron/past-due-enforcement` - Downgrade subscriptions past 7-day grace period
- `POST /api/billing/cron/process-referral-credits` - Apply credits after 30-day waiting period

**Stripe Webhook Events:**
- `checkout.session.completed` - Trial/subscription started
- `customer.subscription.created/updated/deleted` - Subscription changes
- `invoice.paid` - Payment successful (triggers referral credit)
- `invoice.payment_failed` - Payment failed
- `customer.subscription.trial_will_end` - 3 days before trial ends

**Tables:** subscriptions, subscription_history, subscription_trials, plan_limits, referral_codes, referrals, referral_credits, discount_codes, discount_redemptions, usage_tracking, stripe_billing_events

### Onboarding & Activation System (User Experience)
**Files:** `src/components/OnboardingChecklist.tsx`, `src/components/FirstTimeTooltip.tsx`, `src/components/EnhancedEmptyState.tsx`, `src/services/onboarding.service.ts`, `api/routes/onboarding.ts`, `db/migrations/050_onboarding_progress_tracking.sql`

**Features:**
- Visual setup checklist on Dashboard showing completion progress
- First-time welcome banners for each module (Orders, Products, Customers, Warehouse)
- Contextual empty states with tips and clear actions
- Progress tracking: computed dynamically from store data (carriers, products, customers, orders)
- Dismissible checklist that remembers user preference
- LocalStorage + Database persistence for first-visit tracking

**Checklist Steps:**
1. Agregar transportadora (create carrier)
2. Agregar primer producto (create product)
3. Agregar cliente (create customer)
4. Crear primer pedido (create order)

**Components:**
- `OnboardingChecklist` - Main visual checklist with animated progress bar
- `FirstTimeWelcomeBanner` - Page-level welcome banner with tips (auto-hides after first visit)
- `FirstTimeTooltip` - Multi-step tooltips for element-level guidance
- `EnhancedEmptyState` - Improved empty states with tips, actions, and onboarding hints

**API Endpoints:**
- `GET /api/onboarding/progress` - Get computed onboarding progress
- `POST /api/onboarding/dismiss` - Dismiss checklist
- `POST /api/onboarding/visit-module` - Mark module as visited
- `GET /api/onboarding/is-first-visit/:moduleId` - Check first visit status
- `POST /api/onboarding/reset` - Reset progress (dev/testing)

**Tables:** onboarding_progress
**Functions:** get_onboarding_progress, dismiss_onboarding_checklist, mark_module_visited, is_first_module_visit

**Integration Points:**
- Dashboard: OnboardingChecklist component at top
- Orders/Products/Customers/Warehouse: FirstTimeWelcomeBanner at page top
- Empty states: EnhancedEmptyState with contextual tips

## Database Schema

**Master Migration:** `000_MASTER_MIGRATION.sql` (idempotent, all-in-one)

**Tables:**
- Base: stores (subscription_plan, max_users), users, user_stores (invited_by, invited_at, is_active), store_config
- Business: products, customers, carriers, suppliers, campaigns, additional_values
- Orders: orders (statuses: pending, confirmed, in_preparation, ready_to_ship, shipped, delivered, cancelled, returned; fields: total_discounts, order_status_url, tags, processed_at, cancelled_at), order_line_items
- History: order_status_history, follow_up_log
- Delivery: delivery_attempts, daily_settlements, settlement_orders
- Dispatch: dispatch_sessions, dispatch_session_orders, carrier_zones (zone-based courier rates)
- Inventory: inventory_movements (audit log for all stock changes)
- Merchandise: inbound_shipments, inbound_shipment_items
- Warehouse: picking_sessions, picking_session_orders, picking_session_items, packing_progress
- Returns: return_sessions, return_session_orders, return_session_items
- Team: collaborator_invitations
- Verification: phone_verification_codes (WhatsApp verification codes)
- Billing: subscriptions, subscription_history, subscription_trials, plan_limits, referral_codes, referrals, referral_credits, discount_codes, discount_redemptions, usage_tracking, stripe_billing_events
- Onboarding: onboarding_progress (user preferences, visited modules, tour completion)
- Shopify: shopify_integrations, shopify_oauth_states, shopify_import_jobs, shopify_webhook_events, shopify_sync_conflicts, shopify_webhook_idempotency, shopify_webhook_retry_queue, shopify_webhook_metrics

**Key Functions:**
- generate_inbound_reference, receive_shipment_items (inventory updates from suppliers)
- generate_session_code (warehouse batch codes)
- generate_return_session_code (returns batch codes)
- complete_return_session (process returns and update inventory)
- generate_dispatch_session_code (dispatch batch codes DISP-DDMMYYYY-NN)
- process_dispatch_settlement (calculate net amount from reconciliation)
- calculate_shipping_cost (zone-based rate lookup)
- update_product_stock_on_order_status (automatic stock management)
- prevent_line_items_edit_after_stock_deducted (data integrity)
- prevent_order_deletion_after_stock_deducted (data integrity)
- find_product_by_shopify_ids (product mapping for Shopify orders)
- create_line_items_from_shopify (normalize Shopify line items)
- can_add_user_to_store (validate user limits per plan)
- get_store_user_stats (user statistics vs plan limits)
- generate_verification_code (6-digit WhatsApp verification codes)
- can_request_verification_code (rate limiting for SMS spam prevention)
- cleanup_expired_verification_codes (daily cleanup of expired codes)
- generate_referral_code (6-char unique referral codes)
- get_available_credits (calculate available referral credits)
- can_start_trial (validate trial eligibility)
- get_store_usage (orders, products, users vs plan limits)
- has_feature_access (check feature access by plan)
- get_onboarding_progress (compute onboarding status from store data)
- dismiss_onboarding_checklist (user preference to hide checklist)
- mark_module_visited (track first-time module visits)
- is_first_module_visit (check if module has been visited)

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
- Phone Verification: 5 req/15min (SMS spam prevention)
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
- ✅ Team management with collaborator invitations and role-based permissions
- ✅ Subscription plans with user limits (Free, Starter, Growth, Enterprise)
- ✅ Real-time analytics with period comparisons
- ✅ Order management with WhatsApp confirmation
- ✅ Product inventory management with automatic stock tracking
- ✅ Merchandise/Inbound shipments with automatic Shopify sync
- ✅ Warehouse picking & packing with batch processing
- ✅ Returns system with batch processing and inventory restoration
- ✅ Shipping labels (4x6 thermal) with QR codes and print tracking
- ✅ Customer/Supplier/Carrier management
- ✅ Campaign/Ads management
- ✅ Shopify integration (bidirectional sync, webhooks, product mapping)
- ✅ Automatic inventory sync to Shopify (product creation, stock updates, merchandise reception)
- ✅ Order line items normalization with product mapping
- ✅ Dark mode theme system
- ✅ Global search (Cmd+K)
- ✅ Intelligent notification system with timezone awareness
- ✅ **NEW: WhatsApp phone verification (prevents multicuentas)**

- ✅ **NEW: Stripe Billing System** (subscriptions, trials, referrals, discount codes)
- ✅ **NEW: Dispatch & Settlements** (courier reconciliation, CSV export/import, zone-based rates)
- ✅ **NEW: Onboarding & Activation System** (setup checklist, first-time tooltips, contextual empty states)

**Coming Soon:**
- 2FA authentication
- Email service for automated invitation emails (SendGrid/AWS SES)
- Dropi integration (dropshipping for LATAM)
- Mercado Libre integration
- Multi-channel inventory sync
- Custom roles (Enterprise plan)
- SSO integration (Google/Microsoft)

## Development Notes

**Adding Pages:** Create in `src/pages/` → Add route in `App.tsx` → Add link in `Sidebar.tsx`

**Styling:** Tailwind utilities, CSS variables, dark mode variants (`dark:bg-*-950/20`, `dark:text-*-400`)

**CORS:** Allowed origins in `api/index.ts` (8080, 8081, 5173, 3000)

**TypeScript:** Relaxed settings (`noImplicitAny: false`, `strictNullChecks: false`)

**Storage Keys:** Pattern `neonflow_[entity]`

## Technical Documentation

**Core Systems:**
- `COLLABORATORS_SYSTEM.md` - Team management with role-based access control and invitations
- `WHATSAPP_VERIFICATION_SETUP.md` - **NEW:** WhatsApp phone verification setup guide
- `SHOPIFY_ORDER_LINE_ITEMS.md` - Shopify order normalization and product mapping system
- `SHOPIFY_PRODUCT_SYNC_GUIDE.md` - Bidirectional product synchronization with Shopify
- `SHOPIFY_INVENTORY_SYNC.md` - Automatic inventory synchronization (Ordefy ↔ Shopify)
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
- 030: Collaborator invitation system with role-based access
- 033: Shopify order fields expansion (total_discounts, tags, timestamps)
- 034: **NEW:** WhatsApp phone verification system (prevents multicuentas)
- 036: **NEW:** Billing & Subscriptions system (Stripe, referrals, discount codes)
- 039: **NEW:** Hard delete with cascading cleanup (owner only, no soft delete, complete data cleanup)
- 045: **NEW:** Dispatch & Settlements system (courier reconciliation, zone rates, CSV import/export)
- 050: **NEW:** Onboarding progress tracking (setup checklist, first-time module visits)
- 051: **NEW:** Add image_url to order_line_items (product thumbnail in Orders list)
- 055: **NEW:** Billing production fixes (trial reminders, referral credits, discount increments)
- 058: **NEW:** Warehouse production-ready fixes (session abandonment, atomic packing, staleness tracking)
- 059: **NEW:** Dispatch & Settlements production fixes (duplicate prevention, 999/day codes, status validation)

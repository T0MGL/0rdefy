# Ordefy - E-commerce Management Platform

**Bright Idea** | ordefy.io | All Rights Reserved

E-commerce dashboard: analytics, order processing, warehouse ops, multi-platform integrations.

## Tech Stack

**Frontend:** React 18 + TypeScript + Vite + shadcn/ui + Tailwind + React Router + TanStack Query + Recharts + Framer Motion + React Hook Form + Zod
**Backend:** Node.js + Express + PostgreSQL (Supabase) + JWT Auth
**Ports:** Frontend 8080, Backend 3001

## Architecture

### Project Structure
```
src/
├── components/   # UI (shadcn/ui in /ui/, TeamManagement, ShopifyIntegrationModal, OrderShippingLabel)
├── pages/        # Routes (Dashboard, Orders, Products, Warehouse, Merchandise, Returns, Settings, Integrations, AcceptInvitation)
├── contexts/     # AuthContext, ThemeContext
├── services/     # API layer (orders, products, customers, ads, merchandise, warehouse, collaborators)
├── utils/        # Business logic (alertEngine, recommendationEngine, healthCalculator, notificationEngine, timeUtils)
├── types/        # TypeScript definitions
├── hooks/        # Custom hooks (useHighlight)
└── lib/          # Utilities

api/
├── routes/       # API endpoints
├── middleware/    # JWT verification, store ID extraction, permissions
├── services/     # Business logic (shopify, warehouse, returns)
├── permissions.ts # Role-based (6 roles, 15 modules, 4 permissions)
└── db/           # Supabase client

db/
├── migrations/
│   └── 000_MASTER_MIGRATION.sql  # Use ONLY this for initial setup
└── seed.sql
```

### Key Patterns

**Auth:** JWT in localStorage. Headers: `Authorization: Bearer {token}`, `X-Store-ID: {id}`. Middleware: `verifyToken`, `extractStoreId`. WhatsApp phone verification (one phone per account).

**Services:** All follow CRUD pattern `{ getAll, getById, create, update, delete }`. Auth headers injected via `api.client.ts`.

**Intelligence Engines** (`src/utils/`): Alert Engine (critical/warning/info), Recommendation Engine (impact projections), Health Calculator (0-100 score: delivery/margin/ROI/stock 25pts each).

**Notifications** (`notificationEngine.ts`): Timezone-aware, clickable with navigation, metadata-enriched, priority levels (high/medium/low), smart aggregation, localStorage persistence, 5min auto-refresh. Files: `timeUtils.ts`, `notificationEngine.ts`, `notifications.service.ts`, `useHighlight.ts`.

**Theme:** ThemeContext + localStorage + FOUC prevention + CSS variables + dark mode.

**Path Aliases:** `@/components/ui/button`

## Core Modules

### Inventory Management
**Files:** `db/migrations/019_inventory_management.sql`

**Stock Flow:** `pending → contacted → confirmed → in_preparation → ready_to_ship → shipped → delivered`
Stock decrements at `ready_to_ship` (picking/packing complete). Restores on cancel/reject. Audit log in `inventory_movements`. Prevents editing line_items or deleting orders after stock deducted. Also handles `shipped`, `in_transit`, `delivered` statuses (migration 098/107).

**Tables:** inventory_movements
**Triggers:** trigger_update_stock_on_order_status, trigger_prevent_line_items_edit, trigger_prevent_order_deletion

### Product System
**Files:** `api/routes/products.ts`, `src/pages/Products.tsx`, `db/migrations/063_product_system_production_fixes.sql`

**Constraints:** Non-negative stock/price/cost (CHECK), SKU uniqueness per store (partial index), `validate_product_data()` validation.

**Safe Deletion:** `can_delete_product()` checks active orders/shipments/sessions. Webhook: `safe_delete_product_by_shopify_id()`. Fallback: deactivate.

**Sync Monitoring:** Views `v_products_sync_status` (OK/ERROR/STUCK_PENDING), `v_products_needing_sync_attention`. `mark_products_for_sync_retry()`.

**Image Upload:** NOT supported - external URLs only.

**Endpoints:** `GET/POST /api/products`, `GET/PUT/DELETE /api/products/:id`, `GET /api/products/:id/can-delete`, `PATCH /api/products/:id/stock`, `POST /api/products/:id/publish-to-shopify`, `GET /api/products/stats/inventory`, `GET /api/products/stats/full`, `GET /api/products/sync/status`, `POST /api/products/sync/retry`

**Functions:** validate_product_data, can_delete_product, safe_delete_product_by_shopify_id, normalize_sku, mark_products_for_sync_retry, get_product_stats
**Views:** v_products_sync_status, v_products_needing_sync_attention, v_products_stock_discrepancy

### Product Variants & Bundles (Migration 101)
**Files:** `src/components/ProductVariantsManager.tsx`, `api/routes/products.ts`, `db/migrations/086, 087, 101`

**BUNDLES vs VARIATIONS (clearly separated):**

| Type | variant_type | Stock | Example |
|------|-------------|-------|---------|
| **BUNDLE** | `'bundle'` | Shared with parent (units_per_pack) | NOCTE Personal(1x), Pareja(2x), Oficina(3x) |
| **VARIATION** | `'variation'` | Independent per variant | T-Shirt S, M, L, XL |

Products can have BOTH simultaneously. Bundle sells deduct `units_per_pack` from parent. Variation sells deduct from variant's own stock.

**Endpoints:** `GET /api/products/:id/variants` → `{ bundles[], variations[], parent_stock }`, `POST .../bundles`, `POST .../variations`, `PUT/DELETE .../variants/:variantId`

**Functions:** deduct_shared_stock_for_variant (type-aware), restore_shared_stock_for_variant, resolve_variant_type
**Views:** v_bundles_inventory, v_variations_inventory, v_all_variants_inventory

**UI:** ProductVariantsManager with tabs "Packs" (purple) / "Variantes" (emerald). Visual badges PACK/VAR.

### Warehouse (Picking & Packing)
**Files:** `src/pages/Warehouse.tsx`, `api/routes/warehouse.ts`, `api/services/warehouse.service.ts`, `db/migrations/015, 058, 079, 100, 102, 108`

**Workflow:** Multi-select confirmed orders → picking session (PREP-DDMMYYYY-NNN) → picking (aggregate products `[-] 0/5 [+]`) → packing (split-view basket↔boxes) → complete → `ready_to_ship` → stock decremented.

**Tables:** picking_sessions (last_activity_at, abandoned_at), picking_session_orders, picking_session_items (variant_id), packing_progress (variant_id)

**Key Features:**
- **Session Management (058):** Abandon/remove orders, stale cleanup (>48h cron), 999 sessions/day, staleness indicators (WARNING >24h, CRITICAL >48h)
- **Concurrent Packing (079):** 3-layer defense (primary RPC → fallback RPC → CAS). `increment_packing_quantity()` atomic with row locking
- **Auto-Pack (100):** `auto_pack_session()` - one-click pack entire session. `pack_all_items_for_order()` - single order. 75%+ click reduction
- **Orphan Cleanup (102):** Trigger removes orders from sessions when status changes outside warehouse flow. Empty sessions auto-abandoned
- **Variant Support (108):** variant_id on packing_progress, variant-aware RPCs and UNIQUE constraints

**Endpoints:** Standard CRUD + `POST .../auto-pack`, `POST .../pack-order/:orderId`, `POST .../abandon`, `DELETE .../orders/:orderId`, `POST /warehouse/cleanup-sessions?hours=48`, `GET .../orphaned`, `POST /warehouse/cleanup-orphaned-sessions`

**Cron:** `0 */6 * * * curl -X POST .../cleanup-sessions?hours=48`
**Views:** v_stale_warehouse_sessions, v_orders_stuck_in_preparation, v_warehouse_session_stats, v_orphaned_picking_session_orders, v_warehouse_variant_status

### Merchandise (Inbound Shipments)
**Files:** `src/pages/Merchandise.tsx`, `api/routes/merchandise.ts`, `db/migrations/011, 062`

Create shipments from suppliers → receive (qty_received/qty_rejected) → delta-based stock updates (prevents double-counting). Auto-generated references (ISH-YYYYMMDD-XXX) with advisory lock. Inline product creation with duplicate detection. Audit trail in inventory_movements. Cannot delete received/partial shipments. Shopify duplicate import prevention.

**Tables:** inbound_shipments, inbound_shipment_items
**Functions:** generate_inbound_reference (advisory lock), receive_shipment_items (delta-based), check_shopify_import_duplicate, check_product_exists
**Views:** v_inbound_items_with_history, v_merchandise_stock_discrepancies, v_stuck_inbound_shipments

### Shopify Integration
**Files:** `api/routes/shopify.ts`, `api/services/shopify-*.service.ts`, `src/components/ShopifyIntegrationModal.tsx`
**Docs:** `SHOPIFY_ORDER_LINE_ITEMS.md`, `SHOPIFY_PRODUCT_SYNC_GUIDE.md`, `SHOPIFY_INVENTORY_SYNC.md`, `SHOPIFY_AUTOMATIC_INBOUND_SHIPMENT.md`

**Features:** One-time import (products/customers/orders), bidirectional product sync, automatic inventory sync to Shopify, automatic inbound shipment on product import, normalized order_line_items with product mapping. Webhooks: orders/create, orders/updated, products/delete. Reliability: idempotency (24h TTL), exponential backoff retries (60s→960s, max 5). Rate limit: 2 req/sec. HMAC verification. Auto-send new orders to n8n.

**Auto Inbound Shipment:** On Shopify product import → creates received shipment (ISH-YYYYMMDD-XXX) for products with stock > 0. Non-blocking.

**Product Mapping:** `find_product_by_shopify_ids()`, `create_line_items_from_shopify()`. Sync: local updates → auto-sync to Shopify (price, stock, name). `sync_status`: synced/pending/error.

**Order Field Extraction (094):** shipping_address.city → shipping_city, address2 → address_reference, shipping_lines → shopify_shipping_method, order.note → delivery_notes.

**Tables:** shopify_integrations, shopify_oauth_states, shopify_import_jobs, shopify_webhook_events, shopify_webhook_idempotency, shopify_webhook_retry_queue, shopify_webhook_metrics, order_line_items, shopify_sync_conflicts

**Crons:** `*/5 * * * * .../webhook-retry/process`, `0 3 * * * .../webhook-cleanup`

### Returns System
**Files:** `src/pages/Returns.tsx`, `api/routes/returns.ts`, `api/services/returns.service.ts`, `db/migrations/022, 110`

**Workflow:** Select eligible orders (delivered/shipped/cancelled) → create session (RET-DDMMYYYY-NN) → accept (restore stock) or reject (damaged/defective/incomplete/wrong_item) per item → complete → order status 'returned'.

**Variant-aware (110):** Bundle returns restore `qty * units_per_pack` to parent. Variation returns restore to variant's own stock. Uses `restore_shared_stock_for_variant()`.

Order uniqueness constraint (one order per active session). Auto-cleanup on cancel.

**Tables:** return_sessions, return_session_orders, return_session_items (variant_id, variant_type, units_per_pack)
**Functions:** generate_return_session_code, complete_return_session (variant-aware), prevent_duplicate_return_orders
**Views:** v_returns_variant_status

### Carrier Coverage System (Migration 090)
**Files:** `src/components/OrderConfirmationDialog.tsx`, `api/routes/carriers.ts`, `db/migrations/090_*`

City-based carrier selection: user types city → autocomplete `paraguay_locations` (266 cities) → shows carriers with per-city rates → auto-selects cheapest.

**Data:** `paraguay_locations` (master, shared) with city/department/zone_code (ASUNCION/CENTRAL/INTERIOR_1/INTERIOR_2). `carrier_coverage` (per-store) with carrier_id/city/rate.

**Endpoints:** `GET .../locations/search?q=`, `GET .../coverage/city?city=`, `GET/POST/DELETE .../carriers/:id/coverage`, `POST .../coverage/bulk`, `GET .../coverage/summary`
**Functions:** normalize_location_text, search_paraguay_cities, get_carriers_for_city, get_carrier_rate_for_city, import_carrier_coverage
**Views:** v_carrier_coverage_summary, v_coverage_gaps

**UI:** City autocomplete replaces zone dropdown. Carrier cards with rates. "SIN COBERTURA" visible but not selectable. Toggle for legacy zone system.

### Carrier Reviews & Ratings (Migration 013)
**Files:** `src/pages/CarrierDetail.tsx`, `api/routes/couriers.ts`

Customer rates delivery (1-5 stars + comment) via QR code → trigger auto-recalculates carrier average_rating/total_ratings. CarrierDetail shows ratings distribution and individual reviews.

**Endpoints:** `GET /api/couriers/:id/reviews`, `POST /api/orders/:id/rate-delivery` (public, token-based)

### Delivery Preferences (Migration 095)
**Files:** `src/components/DeliveryPreferencesAccordion.tsx`, `src/components/OrderConfirmationDialog.tsx`

JSONB `delivery_preferences`: `not_before_date` (ISO date), `preferred_time_slot` (morning/afternoon/evening/any), `delivery_notes`. Collapsible accordion in confirmation/creation/edit dialogs. Purple badge in Orders table. Filter: Todos/Listos/Programados.

**Functions:** has_active_delivery_restriction, get_delivery_preference_summary
**Views:** v_orders_with_delivery_restrictions

### Dispatch & Settlements
**Files:** `src/pages/Settlements.tsx`, `src/components/settlements/PendingReconciliationView.tsx`, `api/routes/settlements.ts`, `db/migrations/045, 059, 066, 069, 100`

**Two reconciliation modes:**
1. **Por fecha de entrega (DEFAULT):** Groups by delivered_at date - simpler 2-step flow
2. **Por sesion de despacho (Legacy):** Dispatch → CSV export → courier delivers → CSV import → reconciliation → settlement → payment

**Unified order numbers:** `#XXXX` format (Shopify name → Shopify number → last 4 UUID).

**Features:** Auto-generated codes (DISP-DDMMYYYY-NNN), duplicate order prevention, pickup order exclusion (is_pickup=true), CSV import/export (Spanish columns, Latin number formats), zone-based rates, carrier zone validation (BLOCKING), delivery results (delivered/failed/rejected/rescheduled), discrepancy detection, financial summary.

**Net Receivable:** COD Collected - Carrier Fees (COD + Prepaid) - Failed Attempt Fees. Positive = courier owes store.

**Failed Attempt Fee (077):** `carriers.failed_attempt_fee_percent` (default 50%).

**Session Flow:** dispatched → processing → settled (or cancelled from any non-settled state)

**Tables:** dispatch_sessions, dispatch_session_orders, carrier_zones, daily_settlements
**Functions:** generate_dispatch_code_atomic, generate_settlement_code_atomic, process_dispatch_settlement_atomic, check_orders_not_in_active_session, validate_carrier_has_zones, calculate_shipping_cost, suggest_carrier_for_order, reassign_carrier_orders
**Views:** v_dispatch_session_health, v_settlement_discrepancies, v_carrier_health, v_orders_without_carrier, v_carrier_zone_coverage_gaps

**Endpoints:** `GET/POST .../dispatch-sessions`, `GET .../dispatch-sessions/:id`, `POST .../dispatch`, `GET .../export`, `POST .../import`, `POST .../process`, `POST .../v2/:id/pay`, `GET .../summary/v2`, `GET .../pending-by-carrier`, `POST .../manual-reconciliation`, `GET .../pending-reconciliation`, `POST .../reconcile-delivery`

### Shipping Labels
**Files:** `src/components/OrderShippingLabel.tsx`, `db/migrations/017`

4x6 thermal labels (Dymo/Zebra/Brother). QR code for delivery tracking. Print tracking (printed, printed_at, printed_by). Bulk printing. Endpoints: `POST .../mark-printed`, `POST .../mark-printed-bulk`.

### Collaborators (Team Management)
**Files:** `src/components/TeamManagement.tsx`, `src/pages/AcceptInvitation.tsx`, `api/routes/collaborators.ts`, `api/permissions.ts`, `db/migrations/030, 078`

Invite via secure unique links (64-char tokens, 7-day expiration). RBAC: 6 roles × 15 modules × 4 permissions. Plan limits (Free:1, Starter:3, Growth/Enterprise:unlimited). Atomic acceptance with row-level locking (migration 078 - prevents duplicates/plan bypass).

**Roles:**
- **owner:** Full access
- **admin:** All except Team/Billing
- **logistics:** Warehouse, Returns, Carriers, Orders (view+edit status)
- **confirmador:** Orders (no delete), Customers, Products (view)
- **contador:** Analytics, Campaigns (view), Orders/Products (view)
- **inventario:** Products, Merchandise, Suppliers

**Middleware:** extractUserRole, requireRole, requireModule, requirePermission

**Endpoints:** `POST .../invite`, `GET .../invitations`, `DELETE .../invitations/:id`, `GET .../validate-token/:token` (public), `POST .../accept-invitation` (public), `GET/DELETE .../collaborators/:userId`, `PATCH .../:userId/role`, `GET .../stats`

### Phone Verification (WhatsApp)
**Files:** `api/routes/phone-verification.ts`, `api/services/whatsapp.service.ts`, `db/migrations/034`

WhatsApp-based (Meta Business API). 6-digit codes, 10min expiration, max 5 attempts, 60s rate limit. Demo mode available. Prevents multiple accounts per phone.

**Config:** `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_VERIFICATION_ENABLED` (false=demo)
**Endpoints:** `POST .../request`, `POST .../verify`, `GET .../status`, `POST .../resend`

### Billing & Subscriptions (Stripe)
**Files:** `src/pages/Billing.tsx`, `api/routes/billing.ts`, `api/services/stripe.service.ts`, `db/migrations/036, 055`

| Plan | $/mo | Annual | Users | Orders/mo | Products |
|------|------|--------|-------|-----------|----------|
| Free | $0 | - | 1 | 50 | 100 |
| Starter | $29 | $24 | 3 | 500 | 500 |
| Growth | $79 | $66 | 10 | 2,000 | 2,000 |
| Professional | $169 | $142 | 25 | 10,000 | Unlimited |

**Features:** Free(basic) → Starter(+warehouse/returns/labels/shopify-import) → Growth(+bidirectional sync/alerts/campaigns/API-read) → Professional(+multi-store/custom-roles/full-API/webhooks).

**Trial:** 14 days (Starter/Growth), card required, ONE per lifetime. **Referral:** 6-char code, $10 credit after 30-day wait, referred gets 20% off. **Discounts:** percentage/fixed/trial_extension, atomic increment. **Grace:** 7-day after payment failure, auto-downgrade to Free.

**Config:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`

**Endpoints:** `GET .../plans`, `GET .../subscription`, `POST .../checkout`, `POST .../portal`, `POST .../cancel`, `POST .../reactivate`, `POST .../change-plan`, `GET/POST .../referrals`, `POST .../webhook`
**Crons (X-Cron-Secret):** `.../cron/expiring-trials`, `.../cron/past-due-enforcement`, `.../cron/process-referral-credits`

**Tables:** subscriptions, subscription_history, subscription_trials, plan_limits, referral_codes, referrals, referral_credits, discount_codes, discount_redemptions, usage_tracking, stripe_billing_events

### Onboarding & Activation
**Files:** `src/components/OnboardingChecklist.tsx`, `src/components/FirstTimeTooltip.tsx`, `src/components/EnhancedEmptyState.tsx`, `api/routes/onboarding.ts`, `db/migrations/050, 103`

Dashboard checklist (add carrier → product → customer → order). First-time welcome banners per module. Contextual empty states. Progress computed from store data (optimized single query, batch tip states).

**Endpoints:** `GET .../progress`, `POST .../dismiss`, `POST .../visit-module`, `GET .../is-first-visit/:moduleId`
**Functions:** get_onboarding_progress, get_batch_tip_states, dismiss_onboarding_checklist, mark_module_visited

### Demo Tour
**Files:** `src/components/demo-tour/DemoTour*.tsx`, `tourTargets.ts`

Interactive guided tour with spotlight highlighting. Role-based paths: owner/admin (manual/shopify 7-12 steps), logistics (6), confirmador (6), inventario (5), contador (5). SVG mask spotlight, lazy-loaded interactive steps, localStorage persistence.

**Tour targets:** `data-tour-target` attributes on UI elements. **Trigger:** `setTourPending()` from `@/components/demo-tour`.

### Mobile Bottom Navigation
**Files:** `src/components/MobileBottomNav.tsx`, `src/App.tsx`

Desktop (lg+): sidebar. Mobile (<lg): bottom tabs with "Mas" sheet.

**Role-based tabs:** Owner(Dashboard/Pedidos/Almacen/Mas), Logistics(Almacen/Pedidos/Devoluciones/Mas), Confirmador(Pedidos/Clientes/Dashboard/Mas), Contador(Dashboard/Pedidos/Anuncios/Mas), Inventario(Productos/Mercaderia/Proveedores/Mas).

Glassmorphism, iOS safe areas, Framer Motion, permission-filtered. Layout: sidebar `hidden lg:block`, content `pb-24 lg:pb-6`.

## Database Schema

**Master Migration:** `000_MASTER_MIGRATION.sql` (idempotent, all-in-one)

**Tables:**
- **Base:** stores, users, user_stores, store_config
- **Business:** products, customers, carriers, suppliers, campaigns, additional_values
- **Orders:** orders (statuses: pending/contacted/confirmed/in_preparation/ready_to_ship/shipped/delivered/cancelled/returned; fields: is_pickup, internal_notes, shipping_city, shopify_shipping_method, delivery_preferences, contacted_at/by), order_line_items
- **History:** order_status_history, follow_up_log
- **Delivery:** delivery_attempts, daily_settlements, settlement_orders
- **Dispatch:** dispatch_sessions, dispatch_session_orders, carrier_zones
- **Inventory:** inventory_movements
- **Merchandise:** inbound_shipments, inbound_shipment_items
- **Warehouse:** picking_sessions, picking_session_orders, picking_session_items, packing_progress
- **Returns:** return_sessions, return_session_orders, return_session_items
- **Team:** collaborator_invitations
- **Verification:** phone_verification_codes
- **Billing:** subscriptions, subscription_history, subscription_trials, plan_limits, referral_codes, referrals, referral_credits, discount_codes, discount_redemptions, usage_tracking, stripe_billing_events
- **Onboarding:** onboarding_progress
- **Shopify:** shopify_integrations, shopify_oauth_states, shopify_import_jobs, shopify_webhook_events, shopify_sync_conflicts, shopify_webhook_idempotency, shopify_webhook_retry_queue, shopify_webhook_metrics

**Key Triggers:**
- Auto-update: customer/carrier stats, order status history, delivery tokens, COD calc, warehouse timestamps
- Stock: trigger_update_stock_on_order_status (decrements/restores on status changes)
- Protection: trigger_prevent_line_items_edit, trigger_prevent_order_deletion, trigger_prevent_carrier_deletion
- Cleanup: trigger_cleanup_picking_session_on_order_status (orphan removal)

## Analytics Formulas (`api/routes/analytics.ts`)

Revenue = Sum(total_price), Costs = Sum(cost*qty), Marketing = Sum(active campaign.investment), Net Profit = Revenue-Costs-Marketing, Margin = (Profit/Revenue)*100, ROI = Revenue/Investment, Delivery Rate = (Delivered/Total)*100. Period: 7d vs previous 7d.

## Security & Performance

**Rate Limits:** General 500/15min, Auth 5/15min, Phone 5/15min, Webhooks 60/min, Writes 200/15min.
**Fixes:** N+1 optimization (300→1 query), SQL injection prevention (`api/utils/sanitize.ts`), invitation race condition (atomic locking, migration 078).
**Pending:** Conditional logger (456 console.log), UUID validation in warehouse, rate limiting on public endpoints.

## Development Notes

**Adding Pages:** `src/pages/` → route in `App.tsx` → link in `Sidebar.tsx`
**Styling:** Tailwind + CSS variables + dark mode (`dark:bg-*-950/20`)
**CORS:** `api/index.ts` (8080, 8081, 5173, 3000)
**TypeScript:** Relaxed (`noImplicitAny: false`, `strictNullChecks: false`)
**Storage Keys:** Pattern `neonflow_[entity]`

## Documentation Index

**Docs:** COLLABORATORS_SYSTEM.md, INVITATION_RACE_CONDITION_FIX.md, WHATSAPP_VERIFICATION_SETUP.md, SHOPIFY_ORDER_LINE_ITEMS.md, SHOPIFY_PRODUCT_SYNC_GUIDE.md, SHOPIFY_INVENTORY_SYNC.md, SHOPIFY_AUTOMATIC_INBOUND_SHIPMENT.md, INSTRUCCIONES_IMPRESION.md, WAREHOUSE_PACKING_RACE_FIX.md, NOTIFICATION_SYSTEM.md, INVENTORY_SYSTEM.md, ROADMAP_MEJORAS_UX.md

## Migration Index

| # | System |
|---|--------|
| 011 | Merchandise/Inbound shipments |
| 013 | Delivery rating system |
| 015 | Warehouse picking & packing |
| 017 | Shipping label print tracking |
| 019 | Automatic inventory management |
| 022 | Returns system |
| 023 | Order creation/deletion protection |
| 024 | Shopify order line items normalization |
| 030 | Collaborator invitations + RBAC |
| 033 | Shopify order fields expansion |
| 034 | WhatsApp phone verification |
| 036 | Billing & Subscriptions (Stripe) |
| 039 | Hard delete with cascading cleanup |
| 045 | Dispatch & Settlements |
| 050 | Onboarding progress tracking |
| 051 | image_url on order_line_items |
| 055 | Billing production fixes |
| 058 | Warehouse production fixes (abandonment, atomic packing, staleness) |
| 059 | Dispatch production fixes (duplicates, codes, validation) |
| 062 | Merchandise production fixes (race-safe refs, delta stock, audit) |
| 063 | Carrier/Product system fixes (deletion protection, zone validation, sync monitoring) |
| 066 | Settlement/Dispatch code race fix (advisory locks, UNIQUE) |
| 069 | Settlement atomic processing |
| 071 | Returns order uniqueness constraint |
| 077 | Configurable failed attempt fee % |
| 078 | Invitation race condition fix (atomic locking) |
| 079 | Atomic packing increment (concurrent protection) |
| 086 | Product variants system |
| 087 | Shared stock bundles (units_per_pack) |
| 089 | Pickup orders (is_pickup, optional courier) |
| 090 | Carrier coverage (city-based rates, paraguay_locations) |
| 091 | Mark COD as prepaid |
| 094 | Order notes & Shopify field enhancements |
| 095 | Delivery preferences (not_before_date, time_slot) |
| 098 | Stock trigger for all ship statuses + SKU fallback |
| 099 | Contacted order status |
| 100 | Auto-Pack mode + Delivery-based reconciliation |
| 101 | Bundle/Variation separation |
| 102 | Orphan session auto-cleanup |
| 103 | Onboarding N+1 optimization |
| 107 | Variant & stock critical fixes |
| 108 | Warehouse variant support |
| 110 | Returns variant & bundle support |
| 124 | customers.city VARCHAR(150) fix |

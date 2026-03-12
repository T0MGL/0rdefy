# Ordefy External API Documentation

**Base URL:** `https://api.ordefy.io`
**Store ID (NOCTE):** `1eeaf2c7-2cd2-4257-8213-d90b1280a19d`
**Authentication:** `X-API-Key` header (required on ALL endpoints)
**Content-Type:** `application/json` (required on POST/PATCH)

> **CRITICAL: All field names are in ENGLISH.** Do NOT use Spanish field names (e.g., use `name` not `nombre`, `address` not `direccion`, `items` not `productos`).

---

## Quick Reference

| Action | Method | Endpoint |
|--------|--------|----------|
| Create order | `POST` | `/api/webhook/orders/{storeId}` |
| Lookup orders | `GET` | `/api/webhook/orders/{storeId}/lookup` |
| Confirm order | `POST` | `/api/webhook/orders/{storeId}/confirm` |
| Update status | `PATCH` | `/api/webhook/orders/{storeId}/status` |
| Update items | `PATCH` | `/api/webhook/orders/{storeId}/items` |

All endpoints require `X-API-Key` header. Replace `{storeId}` with the store UUID.

---

## 1. Create Order

**`POST /api/webhook/orders/{storeId}`**

### Complete Payload Structure

```json
{
  "idempotency_key": "unique-string-to-prevent-duplicates",

  "customer": {
    "name": "Juan Pérez",
    "email": "juan@email.com",
    "phone": "+595981123456"
  },

  "shipping_address": {
    "address": "Av. España 1234",
    "city": "Asunción",
    "country": "Paraguay",
    "reference": "Casa blanca, enfrente al supermercado",
    "notes": "Entregar después de las 6pm",
    "google_maps_url": "https://maps.app.goo.gl/xxxxx"
  },

  "items": [
    {
      "name": "Product Name",
      "sku": "PRODUCT-SKU",
      "quantity": 2,
      "price": 150000,
      "variant_title": "Pack Pareja",
      "variant_type": "variation"
    }
  ],

  "totals": {
    "subtotal": 300000,
    "shipping": 25000,
    "discount": 10000,
    "tax": 0,
    "total": 315000
  },

  "payment_method": "cash_on_delivery",

  "metadata": {
    "source": "n8n-chatbot",
    "campaign": "whatsapp-nocte"
  }
}
```

### Required Fields

| Field | Type | Rules |
|-------|------|-------|
| `customer` | object | **Required** |
| `customer.name` | string | **Required.** Non-empty string |
| `customer.email` OR `customer.phone` | string | **At least one required** |
| `shipping_address` | object | **Required** |
| `shipping_address.address` + `shipping_address.city` | string | **Required together** (unless `google_maps_url` is provided) |
| `shipping_address.google_maps_url` | string | **Alternative to address+city.** Must be a valid Google Maps URL |
| `items` | array | **Required.** At least 1 item |
| `items[].name` | string | **Required.** Non-empty |
| `items[].quantity` | number | **Required.** Integer >= 1 |
| `items[].price` | number | **Required.** Number >= 0 (unit price in guaraníes, no decimals) |
| `totals` | object | **Required** |
| `totals.total` | number | **Required.** Number >= 0 |
| `payment_method` | string | **Required.** One of: `"cash_on_delivery"`, `"online"`, `"pending"` |

### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `idempotency_key` | string | Prevents duplicate orders. Strongly recommended. 24h TTL |
| `shipping_address.country` | string | Default: `"Paraguay"` |
| `shipping_address.reference` | string | Location reference (saved to `address_reference` column) |
| `shipping_address.notes` | string | Delivery instructions (saved to `delivery_notes` column) |
| `items[].sku` | string | Maps to existing product/variant in Ordefy for stock tracking |
| `items[].variant_title` | string | Display text for the variant (e.g., "Pack Pareja") |
| `items[].variant_type` | string | `"bundle"` or `"variation"`. Auto-detected from SKU if omitted |
| `totals.subtotal` | number | Defaults to `totals.total` if omitted |
| `totals.shipping` | number | Shipping cost. Default: 0 |
| `totals.discount` | number | Discount amount. Default: 0 |
| `totals.tax` | number | Tax amount. Default: 0 |
| `metadata` | object | Any JSON object. Stored as-is. Useful for tracking source/campaign |

### Address Validation Rules

The API accepts two address modes:

1. **Manual address:** Both `address` AND `city` must be non-empty strings
2. **Google Maps URL:** A valid Google Maps link (accepted patterns: `google.com/maps`, `maps.google.com`, `goo.gl/maps`, `maps.app.goo.gl`)

If only `google_maps_url` is provided (no address/city), the system stores `"Ver ubicación en Google Maps"` as the address.

### Success Response (201)

```json
{
  "success": true,
  "order_id": "550e8400-e29b-41d4-a716-446655440000",
  "order_number": "ORD-00042",
  "customer_id": "550e8400-e29b-41d4-a716-446655440001",
  "message": "Order created successfully"
}
```

### Duplicate Response (200)

If `idempotency_key` matches a previous order (within 24h):

```json
{
  "success": true,
  "duplicate": true,
  "order_id": "550e8400-e29b-41d4-a716-446655440000",
  "message": "Order already processed"
}
```

### Error Response (400)

```json
{
  "success": false,
  "error": "validation_error",
  "message": "Invalid payload"
}
```

### SKU Resolution

When `items[].sku` is provided, the system attempts to map it to an existing product or variant:

1. Calls `find_product_or_variant_by_sku` RPC (case-insensitive)
2. Fallback: queries `product_variants` table, then `products` table
3. If found: links `product_id` and `variant_id` to the line item (enables stock tracking)
4. If not found: line item is created with the provided name/price but without stock tracking

### Payment Method Mapping

| API value | Stored as | Financial status |
|-----------|-----------|-----------------|
| `cash_on_delivery` | `cod` | `pending` (COD amount = total) |
| `online` | `online` | `paid` |
| `pending` | `pending` | `pending` |

---

## 2. Lookup Orders

**`GET /api/webhook/orders/{storeId}/lookup`**

### Query Parameters

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `phone` | string | One of these | Customer phone number (exact match after normalization) |
| `order_number` | string | is required | Order number: `"1315"`, `"#1315"`, `"ORD-00001"` |
| `status` | string | No | Filter: `pending`, `contacted`, `confirmed`, `in_preparation`, `ready_to_ship`, `shipped`, `in_transit`, `delivered`, `cancelled`, `returned` |
| `limit` | number | No | Max results 1-100. Default: 20 |

### Example Request

```
GET /api/webhook/orders/{storeId}/lookup?phone=0981123456&status=pending&limit=5
```

### Success Response (200)

```json
{
  "success": true,
  "orders": [
    {
      "id": "uuid",
      "order_number": "#1315",
      "status": "pending",
      "customer_name": "Juan Pérez",
      "customer_phone": "+595981123456",
      "customer_email": "juan@email.com",
      "address": "Av. España 1234",
      "city": "Asunción",
      "total_price": 349000,
      "subtotal": 349000,
      "shipping_cost": 0,
      "discount": 0,
      "cod_amount": 349000,
      "payment_method": "cod",
      "financial_status": "pending",
      "is_pickup": false,
      "delivery_preferences": null,
      "delivery_notes": null,
      "created_at": "2026-03-09T10:30:00.000Z",
      "confirmed_at": null,
      "delivered_at": null,
      "items": [
        {
          "name": "NOCTE® Orange Light Blocking Glasses",
          "sku": "NOCTE-OGLASSES-PERSONAL",
          "quantity": 1,
          "price": 174500,
          "variant_title": "Pack Pareja"
        },
        {
          "name": "NOCTE® Red Light Blocking Glasses",
          "sku": "NOCTE-GLASSES-PERSONAL",
          "quantity": 1,
          "price": 174500,
          "variant_title": "Pack Pareja"
        }
      ]
    }
  ],
  "total": 1
}
```

### Phone Normalization

The phone is normalized by stripping all characters except digits and `+`. Examples:
- `0981 123 456` → `0981123456`
- `+595 981 123 456` → `+595981123456`
- `(0981) 123-456` → `0981123456`

---

## 3. Confirm Order

**`POST /api/webhook/orders/{storeId}/confirm`**

Confirms a `pending` or `contacted` order. Three confirmation paths:

### Path A: With courier_id (full confirmation)

```json
{
  "order_number": "ORD-00042",
  "courier_id": "carrier-uuid-here",
  "shipping_cost": 25000
}
```

### Path B: With shipping_city (auto-selects cheapest carrier)

```json
{
  "order_number": "ORD-00042",
  "shipping_city": "San Lorenzo"
}
```

The system calls `get_carriers_for_city` → selects cheapest carrier → assigns it automatically.

### Path C: Without carrier (awaiting assignment)

```json
{
  "order_number": "ORD-00042"
}
```

Order confirmed but no carrier. Dashboard shows "Necesita repartidor" badge.

### Path D: Pickup (no carrier needed)

```json
{
  "order_number": "ORD-00042",
  "is_pickup": true
}
```

### All Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `order_number` | string | One of | Order number (`"ORD-00042"`, `"1315"`, `"#1315"`) |
| `phone` | string | these two | Customer phone. Finds most recent pending/contacted order. Fails if multiple exist |
| `courier_id` | UUID | No | Carrier UUID for full confirmation |
| `is_pickup` | boolean | No | `true` = store pickup, no carrier needed |
| `shipping_city` | string | No | City name. If no `courier_id`, auto-selects cheapest carrier for this city |
| `shipping_cost` | number | No | Override shipping cost (guaraníes). If auto-carrier, uses carrier's rate |
| `address` | string | No | Update delivery address |
| `google_maps_link` | string | No | Update Google Maps link |
| `delivery_zone` | string | No | Delivery zone code |
| `latitude` | number | No | GPS latitude |
| `longitude` | number | No | GPS longitude |
| `delivery_preferences` | object | No | `{ not_before_date, preferred_time_slot, delivery_notes }` |

### delivery_preferences Object

| Field | Type | Values |
|-------|------|--------|
| `not_before_date` | string | ISO date: `"2026-03-15"` |
| `preferred_time_slot` | string | `"morning"`, `"afternoon"`, `"evening"`, `"any"` |
| `delivery_notes` | string | Free text |

### Success Response (200)

```json
{
  "success": true,
  "order_id": "uuid",
  "order_number": "ORD-00042",
  "status": "confirmed",
  "awaiting_carrier": false,
  "auto_carrier": true,
  "is_pickup": false,
  "confirmed_at": "2026-03-10T14:00:00.000Z",
  "carrier_name": "Flash Envíos",
  "total_price": 349000,
  "shipping_cost": 25000
}
```

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `awaiting_carrier` | boolean | `true` = confirmed without carrier (needs manual assignment) |
| `auto_carrier` | boolean | `true` = carrier auto-selected by `shipping_city` |
| `is_pickup` | boolean | `true` = store pickup order |
| `carrier_name` | string/null | Assigned carrier name (null if awaiting) |

### Auto-Carrier Selection Logic

When `shipping_city` is provided without `courier_id`:

1. RPC `get_carriers_for_city` searches `carrier_coverage` table (normalized text matching)
2. Fallback: `carrier_zones` table with zone string matching
3. Filters carriers with coverage AND rate > 0
4. Sorts by rate ascending → picks cheapest
5. If no coverage found → confirms without carrier (`awaiting_carrier: true`)

If no `shipping_city` is provided and no `courier_id`, the system tries to read the order's existing `shipping_city` column (set during order creation from `shipping_address.city`).

---

## 4. Update Order Status

**`PATCH /api/webhook/orders/{storeId}/status`**

### Request Body

```json
{
  "order_number": "ORD-00042",
  "status": "cancelled",
  "reason": "Customer requested cancellation"
}
```

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `order_number` | string | One of | Order number |
| `phone` | string | these two | Customer phone (finds most recent active order) |
| `status` | string | **Yes** | Target status |
| `reason` | string | No | Reason for change (max 500 chars). Used for cancellations/rejections |

### Allowed Statuses via API

| Status | Description |
|--------|-------------|
| `pending` | Reset to pending |
| `contacted` | Mark as contacted (sets `contacted_at` timestamp) |
| `confirmed` | Confirm (sets `confirmed_at` timestamp) |
| `cancelled` | Cancel (sets `cancelled_at`, stores reason) |
| `rejected` | Reject (sets `cancelled_at`, stores reason) |

**NOT allowed via API** (dashboard-only): `in_preparation`, `ready_to_ship`, `shipped`, `in_transit`, `delivered`, `returned`

### Blocked Transitions

| From Status | Cannot go to |
|-------------|-------------|
| `delivered` | Anything (terminal state) |
| `returned` | Anything (terminal state) |
| `shipped` | pending, contacted, confirmed, rejected |
| `in_transit` | pending, contacted, confirmed, rejected |
| `ready_to_ship` | pending, contacted, confirmed, rejected |
| `in_preparation` | pending, contacted, rejected |

**Allowed transitions for cancellation:** ALL statuses except `delivered` and `returned` can be cancelled.

### Reactivation

Cancelled/rejected orders can be reactivated to `pending`, `contacted`, or `confirmed`. This resets delivery fields.

### Success Response (200)

```json
{
  "success": true,
  "order_id": "uuid",
  "order_number": "ORD-00042",
  "previous_status": "pending",
  "new_status": "cancelled"
}
```

### Concurrency Protection

Uses optimistic locking: if the order's status changed between read and update (another user/process modified it), returns `CONCURRENT_MODIFICATION` (409). Retry once.

---

## 5. Update Order Items

**`PATCH /api/webhook/orders/{storeId}/items`**

Modifies products on an order. Only works **before stock deduction** (statuses: `pending`, `contacted`, `confirmed`, `in_preparation`).

### Request Body

```json
{
  "order_number": "ORD-00042",
  "action": "add",
  "products": [
    {
      "sku": "NOCTE-OGLASSES-PERSONAL",
      "name": "NOCTE® Orange Light Blocking Glasses",
      "quantity": 1,
      "price": 163000,
      "variant_title": "Pack Oficina",
      "is_upsell": true
    }
  ]
}
```

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `order_number` | string | One of | Order number |
| `phone` | string | these two | Customer phone |
| `action` | string | **Yes** | `"add"`, `"remove"`, or `"replace"` |
| `products` | array | **Yes** | 1-50 products |

### Action Behavior

| Action | Description |
|--------|-------------|
| `add` | Appends products to existing items. Recalculates total |
| `remove` | Removes products by `sku` or `product_id`. Recalculates total |
| `replace` | Replaces ALL items with provided products. Recalculates total |

### Product Fields

| Field | Type | Required for | Description |
|-------|------|-------------|-------------|
| `sku` | string | remove (one of) | SKU - auto-resolves to product/variant |
| `product_id` | UUID | remove (one of) | Direct product UUID |
| `name` | string | add/replace | Product name (fallback if SKU not found) |
| `quantity` | number | add/replace | 1-99999 |
| `price` | number | add/replace | 0-999999999 (unit price) |
| `variant_title` | string | No | Variant description |
| `variant_type` | string | No | `"bundle"` or `"variation"` |
| `is_upsell` | boolean | No | `true` to mark as upsell |

### Success Response (200)

```json
{
  "success": true,
  "order_id": "uuid",
  "order_number": "ORD-00042",
  "items_count": 3,
  "total_price": 489000
}
```

### Restrictions

- **Locked after stock deduction:** Cannot modify items when status is `ready_to_ship`, `shipped`, `in_transit`, `delivered`, or `returned`. Returns `ITEMS_LOCKED` (409).
- **Max 50 products** per request.
- The JSONB `line_items` column is updated first (source of truth), then the `order_line_items` normalized table.

---

## Error Codes Reference

All errors follow this format:

```json
{
  "success": false,
  "error": "ERROR_CODE",
  "message": "Human-readable description"
}
```

### Authentication Errors

| Code | HTTP | Description |
|------|------|-------------|
| `unauthorized` | 401 | Missing or invalid `X-API-Key` header |
| `webhook_disabled` | 403 | Webhook integration is disabled for this store |
| `invalid_store_id` | 400 | Store ID is not a valid UUID |

### Validation Errors

| Code | HTTP | Description |
|------|------|-------------|
| `validation_error` | 400 | Payload validation failed (create order) |
| `missing_identifier` | 400 | Neither `order_number` nor `phone` provided |
| `invalid_phone` | 400 | Phone must have 6-20 digits |
| `invalid_order_number` | 400 | Order number exceeds 50 characters |
| `missing_status` | 400 | `status` field missing (update status) |
| `missing_action` | 400 | `action` field missing (update items) |
| `missing_products` | 400 | `products` array empty (update items) |
| `invalid_product` | 400 | Product in array has invalid fields |

### Order Errors

| Code | HTTP | Description |
|------|------|-------------|
| `ORDER_NOT_FOUND` | 404 | No order found with that identifier |
| `MULTIPLE_ORDERS` | 409 | Multiple active orders for that phone. Use `order_number` instead. Response includes `multiple_orders: N` |
| `INVALID_STATUS` | 400 | Order cannot be confirmed (already confirmed/shipped/etc) |
| `INVALID_TRANSITION` | 400 | Status transition blocked (e.g., delivered → pending) |
| `SAME_STATUS` | 400 | Order already in the requested status |
| `STATUS_NOT_ALLOWED` | 400 | Status not settable via API (e.g., `in_preparation`) |
| `CONCURRENT_MODIFICATION` | 409 | Order modified by another process. Retry once |
| `ITEMS_LOCKED` | 409 | Cannot modify items after stock deduction |
| `CARRIER_NOT_FOUND` | 404 | `courier_id` not found or carrier is inactive |
| `TOO_MANY_PRODUCTS` | 400 | More than 50 products in single request |

---

## Order Lifecycle

```
                        ┌── API can set ──┐
                        │                 │
  ┌─────────┐  ┌───────────┐  ┌───────────┐  ┌────────────────┐  ┌──────────────┐
  │ pending  │→ │ contacted │→ │ confirmed │→ │ in_preparation │→ │ ready_to_ship│→ shipped → delivered
  └─────────┘  └───────────┘  └───────────┘  └────────────────┘  └──────────────┘
       │             │             │                                      │
       └─────────────┴─────────────┴──── cancelled ◄─────────────────────┘
                                                    (stock auto-restored by DB trigger)
```

**API can set:** `pending`, `contacted`, `confirmed`, `cancelled`, `rejected`
**Dashboard-only:** `in_preparation`, `ready_to_ship`, `shipped`, `in_transit`, `delivered`, `returned`

Stock is deducted at `ready_to_ship` and auto-restored on cancellation via database triggers.

---

## NOCTE Products Reference

### Products & SKUs

| Product | SKU | Price (Personal) | Stock |
|---------|-----|-------------------|-------|
| NOCTE® Orange Light Blocking Glasses | `NOCTE-OGLASSES-PERSONAL` | 229.000 Gs | 30 |
| NOCTE® Red Light Blocking Glasses | `NOCTE-GLASSES-PERSONAL` | 199.000 Gs | 0 |
| ENVIO PRIORITARIO | `NOCTE-ENVIO-PRIORITARIO` | 10.000 Gs | 122 |

### Mixed Pack Pricing (use the highest tier)

| Pack | Units | Total Price | Price per lens |
|------|-------|-------------|----------------|
| Personal | 1 | 229.000 Gs | 229.000 |
| Pareja | 2 | 349.000 Gs | 174.500 |
| Oficina | 3 | 489.000 Gs | 163.000 |

For mixed color packs, use the **product parent SKU** (not the bundle SKU) for each color, with the pack's per-unit price:

**Bundle SKUs (DO NOT use for mixed packs):**
- `NOCTE-OGLASSES-PAREJA`, `NOCTE-OGLASSES-OFICINA` (Orange bundles)
- `NOCTE-GLASSES-PAREJA`, `NOCTE-GLASSES-OFICINA` (Red bundles)

**Product SKUs (USE these for mixed packs):**
- `NOCTE-OGLASSES-PERSONAL` (Orange - stock deducts from Orange product)
- `NOCTE-GLASSES-PERSONAL` (Red - stock deducts from Red product)

### Pack Pricing Logic (for n8n Code Node)

```javascript
const orangeQty = $input.item.json.orange_qty || 0;
const redQty = $input.item.json.red_qty || 0;
const totalUnits = orangeQty + redQty;

const PACK_PRICES = {
  1: 229000,   // Personal
  2: 349000,   // Pareja
  3: 489000    // Oficina
};

const PACK_NAMES = {
  1: "Personal",
  2: "Pareja",
  3: "Oficina"
};

const packTotal = PACK_PRICES[totalUnits];
if (!packTotal) {
  throw new Error(`Invalid quantity: ${totalUnits}. Must be 1, 2, or 3.`);
}

const pricePerUnit = Math.round(packTotal / totalUnits);
const packName = PACK_NAMES[totalUnits];

const items = [];

if (orangeQty > 0) {
  items.push({
    name: "NOCTE® Orange Light Blocking Glasses",
    sku: "NOCTE-OGLASSES-PERSONAL",
    quantity: orangeQty,
    price: pricePerUnit,
    variant_title: `Pack ${packName}`
  });
}

if (redQty > 0) {
  items.push({
    name: "NOCTE® Red Light Blocking Glasses",
    sku: "NOCTE-GLASSES-PERSONAL",
    quantity: redQty,
    price: pricePerUnit,
    variant_title: `Pack ${packName}`
  });
}
```

---

## NOCTE Example Payloads

### Example 1: Pack Personal — 1 orange

```json
{
  "idempotency_key": "nocte-order-001",
  "customer": {
    "name": "Juan Pérez",
    "phone": "+595981123456"
  },
  "shipping_address": {
    "address": "Av. España 1234",
    "city": "Asunción",
    "reference": "Casa blanca"
  },
  "items": [
    {
      "name": "NOCTE® Orange Light Blocking Glasses",
      "sku": "NOCTE-OGLASSES-PERSONAL",
      "quantity": 1,
      "price": 229000,
      "variant_title": "Pack Personal"
    }
  ],
  "totals": {
    "subtotal": 229000,
    "total": 229000
  },
  "payment_method": "cash_on_delivery"
}
```

### Example 2: Pack Pareja — 1 orange + 1 red (mixed)

```json
{
  "idempotency_key": "nocte-order-002",
  "customer": {
    "name": "María González",
    "phone": "+595971987654"
  },
  "shipping_address": {
    "address": "Calle Palma 567",
    "city": "San Lorenzo"
  },
  "items": [
    {
      "name": "NOCTE® Orange Light Blocking Glasses",
      "sku": "NOCTE-OGLASSES-PERSONAL",
      "quantity": 1,
      "price": 174500,
      "variant_title": "Pack Pareja"
    },
    {
      "name": "NOCTE® Red Light Blocking Glasses",
      "sku": "NOCTE-GLASSES-PERSONAL",
      "quantity": 1,
      "price": 174500,
      "variant_title": "Pack Pareja"
    }
  ],
  "totals": {
    "subtotal": 349000,
    "total": 349000
  },
  "payment_method": "cash_on_delivery"
}
```

### Example 3: Pack Oficina — 2 orange + 1 red (mixed)

```json
{
  "idempotency_key": "nocte-order-003",
  "customer": {
    "name": "Carlos Benítez",
    "phone": "+595982555444"
  },
  "shipping_address": {
    "address": "Ruta 2 km 15",
    "city": "Luque",
    "reference": "Portón negro al lado de la farmacia"
  },
  "items": [
    {
      "name": "NOCTE® Orange Light Blocking Glasses",
      "sku": "NOCTE-OGLASSES-PERSONAL",
      "quantity": 2,
      "price": 163000,
      "variant_title": "Pack Oficina"
    },
    {
      "name": "NOCTE® Red Light Blocking Glasses",
      "sku": "NOCTE-GLASSES-PERSONAL",
      "quantity": 1,
      "price": 163000,
      "variant_title": "Pack Oficina"
    }
  ],
  "totals": {
    "subtotal": 489000,
    "total": 489000
  },
  "payment_method": "cash_on_delivery"
}
```

### Example 4: Pack Oficina — 3 red (no mix)

```json
{
  "idempotency_key": "nocte-order-004",
  "customer": {
    "name": "Ana López",
    "phone": "+595991333222"
  },
  "shipping_address": {
    "address": "Av. Mariscal López 3000",
    "city": "Asunción"
  },
  "items": [
    {
      "name": "NOCTE® Red Light Blocking Glasses",
      "sku": "NOCTE-GLASSES-PERSONAL",
      "quantity": 3,
      "price": 163000,
      "variant_title": "Pack Oficina"
    }
  ],
  "totals": {
    "subtotal": 489000,
    "total": 489000
  },
  "payment_method": "cash_on_delivery"
}
```

### Example 5: Order with Google Maps URL (no manual address)

```json
{
  "customer": {
    "name": "Roberto Acosta",
    "phone": "+595981777888"
  },
  "shipping_address": {
    "google_maps_url": "https://maps.app.goo.gl/abc123xyz",
    "notes": "Llamar antes de entregar"
  },
  "items": [
    {
      "name": "NOCTE® Orange Light Blocking Glasses",
      "sku": "NOCTE-OGLASSES-PERSONAL",
      "quantity": 1,
      "price": 229000,
      "variant_title": "Pack Personal"
    }
  ],
  "totals": {
    "total": 229000
  },
  "payment_method": "cash_on_delivery"
}
```

### Example 6: Confirm with auto-carrier

```json
{
  "order_number": "ORD-00042",
  "shipping_city": "San Lorenzo"
}
```

Response:
```json
{
  "success": true,
  "order_id": "uuid",
  "order_number": "ORD-00042",
  "status": "confirmed",
  "awaiting_carrier": false,
  "auto_carrier": true,
  "carrier_name": "Flash Envíos",
  "shipping_cost": 25000
}
```

### Example 7: Confirm as pickup

```json
{
  "order_number": "ORD-00042",
  "is_pickup": true
}
```

### Example 8: Confirm without carrier (needs dashboard assignment)

```json
{
  "order_number": "ORD-00042"
}
```

Response:
```json
{
  "success": true,
  "order_id": "uuid",
  "order_number": "ORD-00042",
  "status": "confirmed",
  "awaiting_carrier": true,
  "auto_carrier": false,
  "carrier_name": null
}
```

### Example 9: Cancel order

```json
{
  "order_number": "ORD-00042",
  "status": "cancelled",
  "reason": "Cliente canceló el pedido"
}
```

### Example 10: Mark as contacted

```json
{
  "phone": "+595981123456",
  "status": "contacted"
}
```

### Example 11: Add upsell product to order

```json
{
  "order_number": "ORD-00042",
  "action": "add",
  "products": [
    {
      "sku": "NOCTE-ENVIO-PRIORITARIO",
      "name": "ENVIO PRIORITARIO",
      "quantity": 1,
      "price": 10000,
      "is_upsell": true
    }
  ]
}
```

### Example 12: Replace all items (change pack)

```json
{
  "order_number": "ORD-00042",
  "action": "replace",
  "products": [
    {
      "sku": "NOCTE-OGLASSES-PERSONAL",
      "name": "NOCTE® Orange Light Blocking Glasses",
      "quantity": 3,
      "price": 163000,
      "variant_title": "Pack Oficina"
    }
  ]
}
```

---

## n8n Integration Flow

```
WhatsApp/Webhook Trigger → AI Agent / Switch Node →
  ├── New Order    → Code Node (build payload)  → HTTP POST   /api/webhook/orders/{storeId}
  ├── Check Status → HTTP GET    /api/webhook/orders/{storeId}/lookup?phone={phone}
  ├── Confirm      → HTTP POST   /api/webhook/orders/{storeId}/confirm
  ├── Cancel       → HTTP PATCH  /api/webhook/orders/{storeId}/status
  ├── Add Upsell   → HTTP PATCH  /api/webhook/orders/{storeId}/items
  └── Change Items → HTTP PATCH  /api/webhook/orders/{storeId}/items
```

### HTTP Request Node Configuration

For ALL Ordefy API calls:
- **Authentication:** Header Auth
- **Header Name:** `X-API-Key`
- **Header Value:** `{{ $credentials.ordefyApiKey }}` (or hardcoded key)
- **Content-Type:** `application/json` (auto-set by n8n for JSON body)
- **On Error:** Set to `Stop Workflow` (NOT `Continue`) to catch failures

### Retry Strategy

- **5xx errors / timeouts:** Retry up to 3 times with exponential backoff (1s → 2s → 4s)
- **`CONCURRENT_MODIFICATION` (409):** Retry once immediately
- **`MULTIPLE_ORDERS` (409):** Ask customer which order (provide order numbers from lookup)
- **400 errors:** Do NOT retry — fix the payload

### Phone vs Order Number Strategy

| Method | When to use |
|--------|-------------|
| `phone` | Default for chatbots. Customer identified by phone. Simpler UX |
| `order_number` | Fallback when `MULTIPLE_ORDERS` error. Ask customer for order # |

---

## Idempotency

To prevent duplicate orders, always include `idempotency_key`:

```json
{
  "idempotency_key": "whatsapp-conv-12345-order-1",
  ...
}
```

- Keys expire after **24 hours**
- If no key is provided, one is auto-generated from payload hash + timestamp (unreliable for retries)
- Best practice: Use your system's conversation/session ID + order sequence number
- Duplicate requests return `200` with `"duplicate": true` and the original `order_id`

# Shopify Inventory Sync System

**Status:** ✅ Production-Ready (December 2025)
**Author:** Bright Idea
**Related Docs:** `SHOPIFY_PRODUCT_SYNC_GUIDE.md`, `SHOPIFY_ORDER_LINE_ITEMS.md`

---

## Overview

This document describes the **bidirectional automatic inventory synchronization** between Ordefy and Shopify. The system ensures that inventory levels stay synchronized across both platforms automatically, without manual intervention.

---

## Synchronization Flows

### 1. Creating New Products

#### **Scenario A: Create NEW Product (Manual Form)**

**Endpoint:** `POST /api/products`

```
User fills manual form in Ordefy (name, SKU, price, stock, etc.)
    ↓
Product saved to local database
    ↓
System checks for active Shopify integration
    ↓
Auto-publish to Shopify (creates product with stock)
    ↓
Store shopify_product_id & shopify_variant_id locally
```

**Example Request:**
```json
POST /api/products
{
  "name": "Blue T-Shirt",
  "price": 25.99,
  "stock": 100,
  "sku": "BLUE-TSHIRT-001"
}
```

**Example Response:**
```json
{
  "message": "Product created and published to Shopify successfully",
  "data": {
    "id": "uuid-1234",
    "name": "Blue T-Shirt",
    "stock": 100,
    "shopify_product_id": "8876543210",
    "shopify_variant_id": "47654321098"
  }
}
```

---

#### **Scenario B: Import EXISTING Product from Shopify (Dropdown)**

**Endpoint:** `POST /api/products/from-shopify`

```
User selects product from Shopify dropdown (UI automatically detects Shopify integration)
    ↓
Frontend sends shopify_product_id + shopify_variant_id
    ↓
Backend fetches ALL data from Shopify (name, SKU, price, inventory, image)
    ↓
Product created locally with Shopify's inventory as stock
    ↓
shopify_product_id & shopify_variant_id linked
```

**Example Request:**
```json
POST /api/products/from-shopify
{
  "shopify_product_id": "8876543210",
  "shopify_variant_id": "47654321098"
}
```

**Example Response:**
```json
{
  "message": "Product imported from Shopify successfully",
  "data": {
    "id": "uuid-5678",
    "name": "Red T-Shirt - Medium",  ← From Shopify
    "sku": "RED-MEDIUM-001",         ← From Shopify
    "price": 29.99,                  ← From Shopify
    "stock": 45,                     ← From Shopify inventory_quantity
    "image_url": "https://...",      ← From Shopify
    "shopify_product_id": "8876543210",
    "shopify_variant_id": "47654321098"
  }
}
```

**Note:** The UI (ProductForm.tsx) automatically shows:
- **Manual Form** - If no Shopify integration
- **Shopify Dropdown** - If Shopify integration is active (preferred method)

---

### 2. Updating Product Stock (Ordefy → Shopify)

**Endpoints:**
- `PUT /api/products/:id` (full product update)
- `PATCH /api/products/:id/stock` (stock-only update)

**Flow:**
```
User updates product stock in Ordefy
    ↓
Stock updated in local database
    ↓
If product has shopify_product_id:
    ↓
Auto-sync to Shopify inventory
    ↓
Update sync_status and last_synced_at
```

**Example Request:**
```json
PATCH /api/products/uuid-1234/stock
{
  "stock": 150,
  "operation": "set"
}
```

**Shopify API Calls:**
1. `GET /variants/{variant_id}.json` → Get inventory_item_id
2. `GET /locations.json` → Get active location
3. `POST /inventory_levels/set.json` → Update inventory

---

### 3. Receiving Merchandise (Ordefy → Shopify)

**Endpoint:** `POST /api/merchandise/:id/receive`

**This is the CRITICAL flow for bulk inventory updates.**

**Flow:**
```
User receives inbound shipment (10 products, 500 units total)
    ↓
receive_shipment_items() updates stock in local database
    ↓
System identifies all products in shipment
    ↓
Filter products with shopify_variant_id
    ↓
Batch sync to Shopify (all products in one operation)
    ↓
Log results (success/failed counts)
```

**Example Request:**
```json
POST /api/merchandise/shipment-id-123/receive
{
  "items": [
    { "item_id": "item-1", "qty_received": 100 },
    { "item_id": "item-2", "qty_received": 200 },
    { "item_id": "item-3", "qty_received": 50 }
  ]
}
```

**Example Response:**
```json
{
  "success": true,
  "shipment": { ... },
  "sync_warnings": [
    "Product uuid-9999: Product not linked to Shopify"
  ]
}
```

**Console Output:**
```
📦 [MERCHANDISE-RECEIVE] Syncing 2 products to Shopify...
🔄 [INVENTORY-SYNC] Starting sync for product uuid-1234, new stock: 200
✅ [INVENTORY-SYNC] Successfully synced inventory to Shopify for product uuid-1234
🔄 [INVENTORY-SYNC] Starting sync for product uuid-5678, new stock: 350
✅ [INVENTORY-SYNC] Successfully synced inventory to Shopify for product uuid-5678
✅ [MERCHANDISE-RECEIVE] Shopify sync complete: 2 success, 0 failed
```

---

## Services

### ShopifyInventorySyncService

**File:** `api/services/shopify-inventory-sync.service.ts`

**Purpose:** Handles inventory-only synchronization (faster than full product sync)

**Methods:**

1. **`syncInventoryToShopify()`**
   - Syncs single product inventory
   - Updates sync_status in database
   - Returns success/error status

2. **`batchSyncInventoryToShopify()`**
   - Syncs multiple products in batch
   - 500ms delay between products (rate limiting)
   - Returns { success, failed, errors }

3. **`updateShopifyInventory()` (private)**
   - Makes actual Shopify API calls
   - Steps:
     1. Get inventory_item_id from variant
     2. Get active location
     3. Set inventory level

**Example Usage:**
```typescript
const syncService = new ShopifyInventorySyncService(supabaseAdmin);

const result = await syncService.batchSyncInventoryToShopify({
  storeId: 'store-123',
  products: [
    { productId: 'uuid-1', newStock: 100 },
    { productId: 'uuid-2', newStock: 200 }
  ]
});

console.log(result);
// { success: 2, failed: 0, errors: [] }
```

---

### ShopifyProductSyncService

**File:** `api/services/shopify-product-sync.service.ts`

**Purpose:** Handles full product synchronization (name, price, stock, etc.)

**Methods:**

1. **`publishProductToShopify()`**
   - Creates new product in Shopify
   - Stores shopify_product_id and shopify_variant_id locally
   - Used in POST /api/products auto-publish flow

2. **`updateProductInShopify()`**
   - Updates existing product in Shopify
   - Syncs name, description, price, stock, category
   - Used in PUT /api/products

3. **`deleteProductFromShopify()`**
   - Deletes product from Shopify and locally
   - Used in DELETE /api/products?hard_delete=true

---

## Database Schema

**Products Table Fields:**
```sql
shopify_product_id   TEXT     -- Shopify product ID (e.g., "8876543210")
shopify_variant_id   TEXT     -- Shopify variant ID (e.g., "47654321098")
last_synced_at       TIMESTAMP -- Last successful sync
sync_status          TEXT     -- 'synced', 'pending', 'error'
stock                INTEGER  -- Current inventory level
```

**Sync Status Values:**
- `synced` - Successfully synchronized with Shopify
- `pending` - Waiting to be synced
- `error` - Last sync failed (check logs)

---

## Error Handling

All synchronization operations follow **non-blocking error handling**:

✅ **Local operation always succeeds first**
❌ **Shopify sync errors only produce warnings**

**Example:**
```
User receives merchandise shipment
    ↓
Stock updated in Ordefy database ✅ SUCCESS
    ↓
Shopify sync fails (network error) ❌ WARNING
    ↓
Response: {
  "success": true,
  "sync_warnings": ["Failed to sync to Shopify: Network timeout"]
}
```

**Why non-blocking?**
- Prevents data loss if Shopify is down
- User can continue working
- Sync can be retried later manually
- Preserves audit trail in inventory_movements

---

## Rate Limiting

**Shopify API Limits:**
- General API: 2 requests/second
- Burst: Up to 40 requests (1 minute window)

**Our Implementation:**
- 500ms delay between products in batch sync
- Handles ~120 products/minute safely
- Logs rate limit errors with retry guidance

**Example Batch Sync (10 products):**
```
Product 1: Sync ✅ (0s)
Wait 500ms
Product 2: Sync ✅ (0.5s)
Wait 500ms
Product 3: Sync ✅ (1.0s)
...
Total time: ~5 seconds for 10 products
```

---

## Shopify API Endpoints Used

### Inventory Levels
```
POST /admin/api/2025-10/inventory_levels/set.json
{
  "location_id": "123456789",
  "inventory_item_id": "987654321",
  "available": 100
}
```

### Variants
```
GET /admin/api/2025-10/variants/{variant_id}.json
Response: {
  "variant": {
    "id": "47654321098",
    "inventory_item_id": "987654321",
    "inventory_quantity": 45
  }
}
```

### Locations
```
GET /admin/api/2025-10/locations.json
Response: {
  "locations": [
    { "id": "123456789", "name": "Main Warehouse", "active": true }
  ]
}
```

### Products (Create)
```
POST /admin/api/2025-10/products.json
{
  "product": {
    "title": "Blue T-Shirt",
    "variants": [
      { "price": "25.99", "sku": "BLUE-001", "inventory_quantity": 100 }
    ]
  }
}
```

---

## Testing

### Manual Testing Checklist

**1. Create new product (no Shopify ID)**
- [ ] Product created locally
- [ ] Product auto-published to Shopify
- [ ] shopify_product_id and shopify_variant_id stored
- [ ] Stock matches in both systems

**2. Create product linked to Shopify**
- [ ] Product created locally
- [ ] Inventory fetched from Shopify
- [ ] Local stock = Shopify stock

**3. Update product stock**
- [ ] Stock updated locally
- [ ] Stock synced to Shopify
- [ ] sync_status = 'synced'
- [ ] last_synced_at updated

**4. Receive merchandise**
- [ ] Multiple products' stock updated locally
- [ ] All Shopify-linked products synced
- [ ] Console shows sync progress
- [ ] Response includes sync_warnings if any

**5. Error scenarios**
- [ ] Shopify integration disabled → No sync attempted
- [ ] Network error → Warning returned, local stock updated
- [ ] Invalid variant ID → Warning returned, product marked as error

---

## Monitoring

**Console Logs to Watch:**

**Success:**
```
📦 [PRODUCT-CREATE] Fetched inventory from Shopify: 45 units
🚀 [PRODUCT-CREATE] Auto-publishing new product to Shopify...
✅ [PRODUCT-CREATE] Product auto-published to Shopify successfully
🔄 [MERCHANDISE-RECEIVE] Syncing 5 products to Shopify...
✅ [INVENTORY-SYNC] Successfully synced inventory to Shopify for product uuid-1234
✅ [MERCHANDISE-RECEIVE] Shopify sync complete: 5 success, 0 failed
```

**Warnings:**
```
⚠️  [INVENTORY-SYNC] Product uuid-9999 is not linked to Shopify, skipping sync
⚠️  [INVENTORY-SYNC] No active Shopify integration found for store store-123
ℹ️  [MERCHANDISE-RECEIVE] No Shopify-linked products to sync
```

**Errors:**
```
❌ [INVENTORY-SYNC] Error syncing inventory: Network timeout
❌ [INVENTORY-SYNC] Shopify API error (429): Rate limit exceeded
```

---

## Future Enhancements

**Planned:**
- [ ] Webhook from Shopify → Ordefy (reverse sync when inventory changes in Shopify)
- [ ] Retry queue for failed syncs (background job)
- [ ] Sync status dashboard (show pending/error products)
- [ ] Bulk manual sync button (force sync all products)

**Considered:**
- [ ] Multi-location inventory support
- [ ] Variant-level syncing for products with multiple variants
- [ ] Historical sync audit log (track all sync attempts)

---

## Related Documentation

- **`SHOPIFY_PRODUCT_SYNC_GUIDE.md`** - Full product synchronization (name, price, etc.)
- **`SHOPIFY_ORDER_LINE_ITEMS.md`** - Order normalization and product mapping
- **`INVENTORY_SYSTEM.md`** - Automatic stock tracking with order status changes
- **`db/migrations/019_inventory_management.sql`** - Inventory movement triggers

---

## Support

**Common Issues:**

**Q: Product not syncing to Shopify**
A: Check that product has `shopify_variant_id` and Shopify integration is active

**Q: Sync warnings in response**
A: These are non-blocking. Local operation succeeded, Shopify sync can be retried manually

**Q: How to manually sync a product?**
A: Use existing endpoint `POST /api/shopify-sync/sync/inventory` (syncs all products)

**Q: How to force re-sync after error?**
A: Update product stock via `PATCH /api/products/:id/stock` to trigger automatic sync

---

**Last Updated:** December 12, 2025
**Version:** 1.0
**Status:** Production-Ready

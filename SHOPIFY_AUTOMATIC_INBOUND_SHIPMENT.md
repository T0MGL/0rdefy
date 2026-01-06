# Shopify Automatic Inbound Shipment Creation

**Developed by:** Bright Idea | **Date:** January 2026

## Overview

When importing products from Shopify, the system now automatically creates an inbound shipment (merchandise reception) to register the initial inventory. This ensures complete audit trail and prevents inventory discrepancies when dispatching orders.

## Problem Solved

**Before:** Products imported from Shopify had stock, but there was no record of WHERE that inventory came from. When trying to dispatch an order, the system couldn't track the inventory source, potentially causing confusion in warehouse operations.

**After:** All imported inventory is automatically documented as an inbound shipment, providing a complete audit trail from the moment products enter the system.

## How It Works

### 1. Product Import Process

```typescript
// shopify-import.service.ts - importProducts()

1. Fetch products from Shopify API (paginated)
2. For each product:
   - Upsert product to database
   - If stock > 0, collect product data
3. After all pages processed:
   - Create automatic inbound shipment
   - Register all products with stock
```

### 2. Inbound Shipment Creation

```typescript
// shopify-import.service.ts - createAutomaticInboundShipment()

1. Generate reference: ISH-YYYYMMDD-XXX
2. Create inbound_shipments record:
   - Status: 'received' (already in Shopify)
   - Supplier: NULL (Shopify import)
   - Tracking: SHOPIFY-IMPORT-YYYY-MM-DD
   - Notes: "Recepción automática de inventario inicial desde Shopify"

3. Create inbound_shipment_items:
   - qty_ordered = product.stock
   - qty_received = product.stock
   - qty_rejected = 0
   - unit_cost = 0 (user can update later)

4. Create inventory_movements (audit trail):
   - movement_type: 'inbound_receipt'
   - quantity: product.stock
   - reference_type: 'inbound_shipment'
   - notes: 'Inventario inicial importado desde Shopify'
```

## Database Records Created

### inbound_shipments
```sql
{
  id: UUID,
  store_id: UUID,
  internal_reference: "ISH-20260106-001",
  supplier_id: NULL,  -- Shopify import (no supplier)
  carrier_id: NULL,
  tracking_code: "SHOPIFY-IMPORT-2026-01-06",
  estimated_arrival_date: "2026-01-06",
  received_date: "2026-01-06T10:30:00Z",
  status: "received",
  shipping_cost: 0,
  total_cost: 0,  -- Calculated from items
  notes: "Recepción automática de inventario inicial desde Shopify. Importados 25 productos con stock.",
  created_by: user_id,
  received_by: user_id
}
```

### inbound_shipment_items
```sql
{
  id: UUID,
  shipment_id: shipment_id,
  product_id: product_id,
  qty_ordered: 50,      -- From Shopify inventory_quantity
  qty_received: 50,     -- Same as ordered (already received)
  qty_rejected: 0,
  unit_cost: 0,         -- User can update later
  discrepancy_notes: "Inventario inicial importado desde Shopify"
}
```

### inventory_movements
```sql
{
  id: UUID,
  store_id: store_id,
  product_id: product_id,
  movement_type: "inbound_receipt",
  quantity: 50,
  reference_type: "inbound_shipment",
  reference_id: shipment_id,
  notes: "Inventario inicial importado desde Shopify",
  created_by: user_id,
  created_at: "2026-01-06T10:30:00Z"
}
```

## Key Features

### ✅ Automatic Creation
- No user intervention required
- Happens during normal Shopify product import
- Batch processing (one shipment for all products)

### ✅ Complete Audit Trail
- All inventory tracked in `inventory_movements`
- Clear documentation of source (Shopify)
- Timestamp and user tracking

### ✅ Non-Blocking
- Import succeeds even if shipment creation fails
- Errors logged but don't fail the import job
- Graceful degradation

### ✅ Stock Consistency
- Stock is set during product import
- NOT updated again during shipment creation
- Avoids double-counting inventory

### ✅ Selective Processing
- Only products with `stock > 0` included
- Products without inventory are skipped
- Efficient batch processing

## UI/UX Impact

### Merchandise Page
Users will see a new inbound shipment after importing from Shopify:

```
Reference: ISH-20260106-001
Status: ✅ Received
Supplier: Shopify Import
Items: 25 products
Total Stock: 450 units
Notes: Recepción automática de inventario inicial desde Shopify
```

### Order Dispatching
When preparing orders, warehouse staff can now see:
- Where the inventory came from
- When it was received
- Complete movement history

## Error Handling

### Shipment Creation Fails
```typescript
// Import succeeds, but shipment creation is logged as error
console.error('❌ [SHOPIFY-IMPORT] Failed to create automatic inbound shipment:', error);
// Import job continues and completes successfully
```

### Inventory Movements Fail
```typescript
// Shipment created, but movements not logged
console.warn('⚠️ [SHOPIFY-IMPORT] Could not create inventory movements:', error);
// Shipment creation continues successfully
```

## Testing

### Verification Steps

1. **Import Products from Shopify**
   ```bash
   # Via Dashboard: Integrations > Shopify > Manual Sync > Products
   ```

2. **Check Merchandise Page**
   ```
   - Navigate to Merchandise
   - Look for shipment with reference ISH-YYYYMMDD-XXX
   - Status should be "received"
   - Supplier should be empty (Shopify import)
   ```

3. **Verify Shipment Items**
   ```sql
   SELECT
     i.qty_ordered,
     i.qty_received,
     i.qty_rejected,
     p.name,
     p.stock
   FROM inbound_shipment_items i
   JOIN products p ON i.product_id = p.id
   WHERE i.shipment_id = 'shipment_id';

   -- Verify: qty_ordered = qty_received = p.stock
   ```

4. **Check Inventory Movements**
   ```sql
   SELECT
     movement_type,
     quantity,
     reference_type,
     notes,
     created_at
   FROM inventory_movements
   WHERE reference_type = 'inbound_shipment'
     AND notes LIKE '%Shopify%'
   ORDER BY created_at DESC;
   ```

### Expected Logs

```
📦 [SHOPIFY-IMPORT] Starting product import with pagination (page_size: 50)
📄 [SHOPIFY-IMPORT] Fetching page 1 (cursor: initial)...
📦 [SHOPIFY-IMPORT] Received 50 products from Shopify API
📊 [SHOPIFY-IMPORT] Page 1 complete. Processed: 50 total. Has more: true
...
📦 [SHOPIFY-IMPORT] Creating automatic inbound shipment for 25 products...
📦 [SHOPIFY-IMPORT] Creating inbound shipment with reference: ISH-20260106-001
✅ [SHOPIFY-IMPORT] Inbound shipment created: abc-123-def
✅ [SHOPIFY-IMPORT] Created 25 shipment items
✅ [SHOPIFY-IMPORT] Created 25 inventory movement records
📊 [SHOPIFY-IMPORT] Total stock imported: 450 units
```

## Configuration

No configuration required. Feature is automatically enabled for all Shopify integrations.

## Limitations

1. **One Shipment Per Import Job**
   - Each manual sync creates ONE shipment
   - All products are batched together
   - Cannot split by category or supplier

2. **Cost is Zero by Default**
   - `unit_cost` set to 0 for all items
   - Users must update costs manually later
   - Future: Could fetch cost from Shopify if available

3. **Re-imports**
   - If you import the same products again, a NEW shipment is created
   - This could lead to duplicate shipment records
   - Products are upserted, so stock won't double

4. **No Inventory Adjustment**
   - Stock is set during product import
   - Shipment creation is for audit only
   - NOT used to update inventory again

## Future Enhancements

### 1. Import Cost from Shopify
```typescript
// If Shopify provides cost data
unit_cost: variant.cost || 0
```

### 2. Category-Based Shipments
```typescript
// Create separate shipments per product category
groupBy(products, 'category').forEach(createShipment)
```

### 3. Avoid Duplicate Shipments
```typescript
// Check if products already have inbound shipments
if (hasExistingShipment(productId)) {
  skip();
}
```

### 4. Update Existing Products
```typescript
// Instead of creating new shipment, update existing one
if (productExists) {
  updateShipmentQuantities();
}
```

## Related Files

- `api/services/shopify-import.service.ts` - Main import logic
- `db/migrations/011_merchandise_system.sql` - Inbound shipments schema
- `db/migrations/019_inventory_management.sql` - Inventory movements
- `src/pages/Merchandise.tsx` - UI for viewing shipments
- `SHOPIFY_PRODUCT_SYNC_GUIDE.md` - Product sync documentation

## Support

For issues or questions:
1. Check logs for error messages
2. Verify database tables exist (inbound_shipments, inventory_movements)
3. Contact: Bright Idea Development Team

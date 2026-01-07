# Shipping Batch Dispatch Error - Fix Documentation

**Date:** 2026-01-07
**Issue:** 500 Server Error when dispatching orders in batch
**Error Message:** "structure of query does not match function result type"

## Problem Description

When attempting to dispatch multiple orders using the batch dispatch feature, the system returns a 500 error with the message:

```
Failed to dispatch batch
Details: structure of query does not match function result type
```

## Root Cause

The PostgreSQL function `create_shipments_batch()` had a structural issue in how it handles the `RETURN QUERY` statement within the `EXCEPTION` block.

**Problematic code flow:**
1. Function loops through each order ID
2. For each order, it tries to create a shipment
3. In the SUCCESS case, it queries the `orders` table to get `shopify_order_number` and returns the result
4. In the EXCEPTION case, it also tries to query the `orders` table
5. **Problem:** If the order doesn't exist in the table (edge case with manual orders), the query returns NULL
6. The variable `v_order_number` was undefined in the EXCEPTION block, causing type mismatch

## Solution

Migration 041 fixes this by:

1. **Fetching order number BEFORE creating shipment** - This ensures `v_order_number` is defined before any operation
2. **Handling NULL case** - If order is not found, uses a default format: `ORD-{first-8-chars-of-uuid}`
3. **Reusing the variable** - Both SUCCESS and EXCEPTION blocks use the pre-defined `v_order_number`

### Code Changes

**Before (Migration 027):**
```sql
-- Return success
RETURN QUERY
SELECT
  v_shipment.id,
  v_order_id,
  COALESCE(o.shopify_order_number, 'ORD-' || SUBSTRING(o.id::TEXT, 1, 8)),
  TRUE,
  NULL::TEXT
FROM orders o
WHERE o.id = v_order_id;

EXCEPTION WHEN OTHERS THEN
  -- Return error for this order
  RETURN QUERY
  SELECT
    NULL::UUID,
    v_order_id,
    COALESCE(o.shopify_order_number, 'ORD-' || SUBSTRING(o.id::TEXT, 1, 8)), -- ❌ v_order_number undefined
    FALSE,
    SQLERRM
  FROM orders o
  WHERE o.id = v_order_id;
```

**After (Migration 041):**
```sql
DECLARE
  v_order_id UUID;
  v_shipment shipments;
  v_order_number TEXT; -- ✅ New variable

BEGIN
  FOREACH v_order_id IN ARRAY p_order_ids
  LOOP
    BEGIN
      -- ✅ Get order number FIRST
      SELECT COALESCE(o.shopify_order_number, 'ORD-' || SUBSTRING(o.id::TEXT, 1, 8))
      INTO v_order_number
      FROM orders o
      WHERE o.id = v_order_id AND o.store_id = p_store_id;

      -- ✅ Handle NULL case
      IF v_order_number IS NULL THEN
        v_order_number := 'ORD-' || SUBSTRING(v_order_id::TEXT, 1, 8);
      END IF;

      -- Create shipment
      v_shipment := create_shipment(...);

      -- ✅ Return success with pre-defined v_order_number
      RETURN QUERY
      SELECT
        v_shipment.id,
        v_order_id,
        v_order_number, -- ✅ Using variable
        TRUE,
        NULL::TEXT;

    EXCEPTION WHEN OTHERS THEN
      -- ✅ Return error with pre-defined v_order_number
      RETURN QUERY
      SELECT
        NULL::UUID,
        v_order_id,
        v_order_number, -- ✅ Using variable
        FALSE,
        SQLERRM;
    END;
  END LOOP;
END;
```

## Migration File

**File:** `db/migrations/041_fix_batch_shipment_function.sql`

**How to Apply:**

### Option 1: Supabase Dashboard (Recommended)
1. Open [Supabase Dashboard](https://supabase.com/dashboard)
2. Navigate to **SQL Editor**
3. Create a new query
4. Copy and paste the contents of `041_fix_batch_shipment_function.sql`
5. Execute the query

### Option 2: CLI (if available)
```bash
node scripts/apply-migration-041.mjs
```

## Testing

After applying the migration, test the batch dispatch feature:

1. Navigate to **Shipping** page
2. Select multiple orders (including manual orders if possible)
3. Click **Despachar** button
4. Add optional notes
5. Click **Confirmar Despacho**
6. Verify orders are successfully dispatched

**Expected Result:**
- No 500 errors
- Orders successfully transition from `ready_to_ship` → `shipped`
- Success toast message appears
- Orders disappear from shipping list

## Related Files

- **Migration:** [db/migrations/041_fix_batch_shipment_function.sql](db/migrations/041_fix_batch_shipment_function.sql)
- **Apply Script:** [scripts/apply-migration-041.mjs](scripts/apply-migration-041.mjs)
- **Backend Route:** [api/routes/shipping.ts](api/routes/shipping.ts)
- **Backend Service:** [api/services/shipping.service.ts](api/services/shipping.service.ts)
- **Frontend Page:** [src/pages/Shipping.tsx](src/pages/Shipping.tsx)
- **Frontend Service:** [src/services/shipping.service.ts](src/services/shipping.service.ts)

## Impact

- **Severity:** High (blocking feature)
- **Affected Users:** All users attempting to dispatch orders in batch
- **Affected Orders:** Both Shopify and manual orders
- **Fix Complexity:** Low (single function modification)
- **Breaking Changes:** None

## Status

- [x] Issue identified
- [x] Root cause analyzed
- [x] Migration created
- [ ] Migration applied (manual step pending)
- [ ] Testing completed
- [ ] Documentation updated

---

**Author:** Bright Idea
**Copyright:** All Rights Reserved

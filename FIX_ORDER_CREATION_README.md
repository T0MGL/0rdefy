# Fix: Order Creation COALESCE Type Mismatch

## Problem

Orders could not be created due to PostgreSQL error:
```
COALESCE types integer and text cannot be matched
```

This error occurred in the `generate_order_number()` trigger function which fires on every INSERT to the `orders` table.

## Root Cause

In `db/migrations/017_fix_orders_schema.sql`, the `generate_order_number()` function had:

```sql
NEW.order_number := COALESCE(
  NEW.shopify_order_number,  -- INT type
  'ORD-' || ...               -- TEXT type
);
```

PostgreSQL's `COALESCE` requires all arguments to be the same type. Here, `shopify_order_number` is `INT` but the fallback string is `TEXT`, causing a type mismatch.

## Solution

Cast `shopify_order_number` to TEXT before using COALESCE:

```sql
NEW.order_number := COALESCE(
  NEW.shopify_order_number::TEXT,  -- Cast to TEXT
  'ORD-' || ...
);
```

## How to Apply

Run the fix script:

```bash
./fix-order-creation.sh
```

Or manually apply the migration:

```bash
source .env
psql $DATABASE_URL -f db/migrations/026_fix_generate_order_number_coalesce.sql
```

## Verification

After applying, test order creation:

1. **Via Dashboard**: Try creating a new order manually
2. **Via Shopify Webhook**: Create an order in Shopify and verify it syncs
3. **Check logs**: No more COALESCE errors in console/API logs

## Related Migrations

This issue was present in:
- `017_fix_orders_schema.sql` - Original function with bug
- `026_fix_generate_order_number_coalesce.sql` - This fix

## Impact

- **Before fix**: No orders could be created (blocking issue)
- **After fix**: Orders create normally, both from dashboard and Shopify webhooks

## Date

2025-12-04

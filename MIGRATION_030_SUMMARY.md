# Migration 030: Customer Address Fields

## Problem
Shopify customer import was failing with the error:
```
Failed to import customer: Could not find the 'address' column of 'customers' in the schema cache
```

## Root Cause
The `shopify-import.service.ts` was trying to insert customer data into columns that didn't exist in the `customers` table:
- `address`
- `city`
- `state`
- `postal_code`
- `country`
- `notes`
- `tags`
- `name` (full name)

## Solution
Added missing columns to the `customers` table through migration 030.

### Columns Added
```sql
ALTER TABLE customers ADD COLUMN address TEXT;
ALTER TABLE customers ADD COLUMN city VARCHAR(100);
ALTER TABLE customers ADD COLUMN state VARCHAR(100);
ALTER TABLE customers ADD COLUMN postal_code VARCHAR(20);
ALTER TABLE customers ADD COLUMN country VARCHAR(100);
ALTER TABLE customers ADD COLUMN notes TEXT;
ALTER TABLE customers ADD COLUMN tags TEXT;
ALTER TABLE customers ADD COLUMN name VARCHAR(255);
```

### Indexes Created
```sql
CREATE INDEX idx_customers_city ON customers(store_id, city);
CREATE INDEX idx_customers_country ON customers(store_id, country);
CREATE INDEX idx_customers_name ON customers(store_id, name);
```

## Files Modified
1. **db/migrations/030_add_customer_address_fields.sql** - New migration file
2. **db/migrations/000_MASTER_MIGRATION.sql** - Updated to include new columns
3. **scripts/apply-migration-030.cjs** - Migration application script
4. **scripts/apply-migration-030-direct.cjs** - Direct verification script

## Status
✅ Migration applied manually by user
✅ All columns verified to exist
✅ MASTER_MIGRATION.sql updated for future installations
✅ Shopify customer import should now work correctly

## Testing
Run Shopify import again to verify customers are imported successfully:
- The previously failed customers (9083491713217, 9082986725569) should now import
- Address data from Shopify should be properly stored in the database

## Impact
- **Before**: Customers could not be imported from Shopify
- **After**: Full customer data including address information is imported and stored
- **Existing Data**: No data loss, only new columns added
- **Performance**: Minimal impact, indexes added for common queries

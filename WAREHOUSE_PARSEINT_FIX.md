# parseInt Radix Fix - Warehouse Service

**Date:** January 18, 2026
**File:** `api/services/warehouse.service.ts`
**Priority:** CRITICAL (Data Integrity)

## Problem

All `parseInt()` calls in the warehouse service were missing the radix parameter, which can cause silent data corruption:

```javascript
parseInt("010")     // Returns 8 (octal!) ❌
parseInt("010", 10) // Returns 10 (decimal) ✅
```

### Real-World Impact

If Shopify sends a quantity as `"010"`:
- **Before fix:** Parsed as 8 (octal) → Lost 2 units silently!
- **After fix:** Parsed as 10 (decimal) → Correct quantity

This affects:
- Order quantity aggregation
- Picking session item counts
- Packing progress calculations
- Stock calculations

## Fix Applied

Added radix parameter `, 10` to all 7 `parseInt()` calls:

### Line 198 - Normalized line items aggregation
```typescript
const quantity = parseInt(item.quantity, 10) || 0;
```

### Line 219 - JSONB line items aggregation
```typescript
const quantity = parseInt(item.quantity, 10) || 0;
```

### Line 601 - Packing records from normalized items
```typescript
const quantity = parseInt(item.quantity, 10) || 0;
```

### Line 642 - Packing records from manual orders
```typescript
const quantity = parseInt(item.quantity, 10) || 0;
```

### Lines 898 & 903 - Packing list item quantities
```typescript
itemQuantity = parseInt(lineItem.quantity, 10) || 0; // Both branches
```

### Line 1251 - Confirmed orders total items calculation
```typescript
? order.line_items.reduce((sum: number, item: any) => sum + (parseInt(item.quantity, 10) || 0), 0)
```

## Verification

```bash
# Confirm no more parseInt without radix
grep -n "parseInt([^,)]\+)" api/services/warehouse.service.ts
# Should return: No matches found ✅
```

## Impact

- **Data Integrity:** ✅ All quantity parsing now safe from octal interpretation
- **Shopify Integration:** ✅ Handles edge cases in Shopify quantity strings
- **Manual Orders:** ✅ Consistent parsing for JSONB line_items
- **Stock Tracking:** ✅ Accurate inventory calculations

## Related Files

This pattern should be audited in:
- `api/services/shopify-import.service.ts`
- `api/services/settlements.service.ts`
- Any other file parsing numeric strings from external sources

## Testing Recommendations

1. **Test with leading zeros:** Create test order with quantity `"010"`
2. **Verify aggregation:** Multiple line items with same product
3. **Stock accuracy:** Confirm inventory decrements match expected values
4. **Shopify sync:** Import orders with various quantity formats

## Severity

**CRITICAL** - This bug could cause:
- Incorrect stock deductions
- Lost inventory units
- Financial discrepancies
- Customer order fulfillment errors

All production deployments should include this fix immediately.

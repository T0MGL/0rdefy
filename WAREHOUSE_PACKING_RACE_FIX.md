# Warehouse Packing Race Condition Fix

**Date:** 2026-01-18
**Migration:** 079_atomic_packing_increment.sql
**Files Modified:** api/services/warehouse.service.ts

## Problem Description

### The Race Condition

When two warehouse workers pack the same product simultaneously, the fallback function `updatePackingProgress()` had a classic **read-modify-write race condition**:

```
Thread A reads: totalPacked = 5
Thread B reads: totalPacked = 5  (reads same value before Thread A updates)
Thread A writes: totalPacked = 6
Thread B writes: totalPacked = 6  ❌ LOST UPDATE!
```

**Expected result:** totalPacked = 7
**Actual result:** totalPacked = 6 (Thread B overwrites Thread A's increment)

### Code Location

The vulnerable code was in `api/services/warehouse.service.ts` lines 1090-1132:

```typescript
// Step 1: Read current value
const totalQuantityPacked = progressRecords.reduce((sum, p) => sum + (p.quantity_packed || 0), 0);

// Step 2: Check conditions
if (totalQuantityPacked >= totalQuantityNeeded) {
  throw new Error('already fully packed');
}

// ... more reads ...

// Step 3: Write with old value + 1 (RACE CONDITION!)
const { data: updated } = await supabaseAdmin
  .from('packing_progress')
  .update({ quantity_packed: progress.quantity_packed + 1 })  // ← Uses stale value!
  .eq('id', progress.id);
```

### Why This Happened

The main atomic function `update_packing_progress_atomic()` (with row locking) was added in migration 058, but the **fallback function** still used the old vulnerable implementation. When the RPC call fails (e.g., function not available in database), it falls back to the unsafe code path.

## Solution

### Three-Layer Protection

We implemented a **defense-in-depth** strategy with three layers:

#### Layer 1: Primary (Already Existed)
**Function:** `update_packing_progress_atomic()` (migration 058)
**Method:** Row-level locking with `FOR UPDATE`
**Location:** Database RPC

```sql
SELECT * INTO v_progress
FROM packing_progress
WHERE id = p_progress_id
FOR UPDATE;  -- ← Blocks concurrent access

UPDATE packing_progress
SET quantity_packed = v_new_quantity
WHERE id = v_progress.id;
```

#### Layer 2: NEW - Atomic Increment Fallback
**Function:** `increment_packing_quantity()` (migration 079)
**Method:** Single atomic transaction with row locking
**Location:** Database RPC

```typescript
const { data: updated } = await supabaseAdmin
  .rpc('increment_packing_quantity', {
    p_progress_id: progress.id,
    p_quantity_needed: progress.quantity_needed,
    p_picked_quantity: pickedItem.quantity_picked,
    p_session_id: sessionId,
    p_product_id: productId
  });
```

**SQL Implementation:**
```sql
-- Lock specific record
SELECT * INTO v_progress
FROM packing_progress
WHERE packing_progress.id = p_progress_id
FOR UPDATE;

-- Validate constraints
IF v_progress.quantity_packed >= v_progress.quantity_needed THEN
    RAISE EXCEPTION 'already fully packed';
END IF;

-- Atomically increment (no read-modify-write gap!)
UPDATE packing_progress
SET quantity_packed = v_progress.quantity_packed + 1
WHERE packing_progress.id = p_progress_id;
```

#### Layer 3: Final Fallback - Compare-And-Swap (CAS)
**Method:** Optimistic locking with retry on conflict
**Location:** Application code

```typescript
// Re-read current value
const { data: reread } = await supabaseAdmin
  .from('packing_progress')
  .select('quantity_packed')
  .eq('id', progress.id)
  .single();

// Update ONLY if value hasn't changed (CAS)
const { data: casUpdated } = await supabaseAdmin
  .from('packing_progress')
  .update({ quantity_packed: reread.quantity_packed + 1 })
  .eq('id', progress.id)
  .eq('quantity_packed', reread.quantity_packed)  // ← Compare-And-Swap condition
  .select()
  .single();

if (!casUpdated) {
  throw new Error('Concurrent update detected. Please try again.');
}
```

**How CAS Works:**
- If another thread updates between read and write, the `eq('quantity_packed', reread.quantity_packed)` condition fails
- No rows are updated → `casUpdated` is null
- Application detects conflict and asks user to retry

## Benefits

### Before Fix
- ❌ Concurrent packing clicks could lose updates
- ❌ Basket inventory could show wrong available count
- ❌ Workers might pack more items than available
- ❌ Inconsistent packing_progress records

### After Fix
- ✅ **Atomic operations:** All increments are transaction-safe
- ✅ **Row-level locking:** Prevents concurrent modifications
- ✅ **Full validation:** Quantity limits checked in database
- ✅ **Graceful degradation:** Three layers of protection
- ✅ **User feedback:** Clear error messages on conflicts
- ✅ **Audit trail:** All updates logged correctly

## Testing the Fix

### Manual Test (Two Browsers)

1. **Setup:**
   - Create picking session with Order A (needs 5 units of Product X)
   - Pick 10 units of Product X
   - Move to packing stage

2. **Test Concurrent Packing:**
   - Browser 1: Click [+] on Product X for Order A
   - Browser 2: Click [+] on Product X for Order A (immediately after)
   - Expected: Both increments succeed, quantity goes from 0 → 1 → 2 (not 0 → 1 → 1)

3. **Test Basket Limit:**
   - Pack 10 units (all available)
   - Try to pack 11th unit
   - Expected: Error "No more units available to pack"

### Automated Test (Concurrent Requests)

```bash
# Send 10 concurrent packing requests
for i in {1..10}; do
  curl -X PUT "http://localhost:3001/api/warehouse/sessions/{sessionId}/pack" \
    -H "Authorization: Bearer {token}" \
    -H "X-Store-ID: {storeId}" \
    -H "Content-Type: application/json" \
    -d '{"orderId": "{orderId}", "productId": "{productId}"}' &
done
wait

# Check final count (should be exactly 10, not random number 1-10)
```

## Migration Instructions

### For Production Deployment

1. **Apply Migration 079:**
   - Log into Supabase Dashboard → SQL Editor
   - Copy contents of `db/migrations/079_atomic_packing_increment.sql`
   - Run the migration
   - Verify: `SELECT * FROM pg_proc WHERE proname = 'increment_packing_quantity';`

2. **Deploy Code Changes:**
   - Deploy updated `api/services/warehouse.service.ts`
   - No API changes required (backward compatible)

3. **Verify in Logs:**
   - Monitor packing operations
   - No "Concurrent update detected" errors should appear (only if RPC fails AND CAS fails)

### Backward Compatibility

- ✅ **100% backward compatible:** Works with or without migration 079
- ✅ **Graceful fallback:** If `increment_packing_quantity()` not found, uses CAS layer
- ✅ **No breaking changes:** Existing API contracts unchanged

## Performance Impact

### Before (Vulnerable Code)
- 3 database queries per packing click:
  1. SELECT packing_progress
  2. SELECT picking_session_items
  3. UPDATE packing_progress

### After (With Migration 079)
- **1 database call** per packing click:
  1. RPC `increment_packing_quantity()` (does all validation + update in single transaction)

**Performance improvement:** 3x reduction in round-trips ⚡

## Related Files

- `db/migrations/058_warehouse_production_ready_fixes.sql` - Original atomic function
- `db/migrations/079_atomic_packing_increment.sql` - **NEW** Fallback atomic function
- `api/services/warehouse.service.ts` - Service layer with three-layer protection
- `api/routes/warehouse.ts` - Routes (calls `updatePackingProgressAtomic`)

## Future Improvements

- [ ] Add retry logic for CAS layer (automatic retry instead of user error)
- [ ] Monitor CAS conflict rate (if high, investigate session locking strategy)
- [ ] Consider WebSocket updates to notify other workers of packing changes
- [ ] Add optimistic UI updates with rollback on conflict

## References

- **Compare-And-Swap (CAS):** https://en.wikipedia.org/wiki/Compare-and-swap
- **PostgreSQL Row Locking:** https://www.postgresql.org/docs/current/explicit-locking.html
- **Optimistic vs Pessimistic Locking:** https://stackoverflow.com/questions/129329/optimistic-vs-pessimistic-locking

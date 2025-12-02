# Returns System Documentation

Complete return/refund processing system with batch sessions and automatic inventory management.

**Author:** Bright Idea
**Date:** 2025-12-02
**Status:** Production-ready

---

## Overview

The Returns System allows warehouse operators to process returned products from customers with:
- **Batch processing** of multiple orders in sessions
- **Accept/Reject decisions** with detailed reasons
- **Automatic inventory updates** (restock accepted items)
- **Complete audit trail** of all returns
- **Integration** with existing inventory management system

---

## Workflow

### 1. **Create Return Session**
Warehouse operators select eligible orders (delivered, shipped, or cancelled) to process in a batch session.

```
Dashboard → Nueva Sesión → Select Orders → Create Session
```

- **Session Code Format:** `RET-DDMMYYYY-NN` (e.g., `RET-02122025-01`)
- **Eligible Statuses:** `delivered`, `shipped`, `cancelled`
- **Session Notes:** Optional notes for tracking purposes

### 2. **Process Items**
For each product in the returned orders:

```
Select Quantity to Accept → Select Quantity to Reject → Add Rejection Reason → Save
```

**Decision Options:**
- **Accept:** Product is in good condition, return to stock
- **Reject:** Product is damaged/defective, do NOT return to stock

**Rejection Reasons:**
- `damaged` - Producto dañado
- `defective` - Producto defectuoso
- `incomplete` - Producto incompleto
- `wrong_item` - Item equivocado
- `other` - Otro (requires notes)

### 3. **Complete Session**
When all items are processed:

```
Review Summary → Finalizar Sesión → Automatic Updates
```

**What Happens:**
1. **Inventory Updated:** Accepted items added back to stock
2. **Order Status Changed:** Orders marked as `returned`
3. **Movements Logged:** All changes recorded in `inventory_movements`
4. **Session Completed:** Session marked as `completed`

---

## Database Schema

### Tables

#### `return_sessions`
Main session tracking table.

```sql
CREATE TABLE return_sessions (
  id UUID PRIMARY KEY,
  store_id UUID REFERENCES stores(id),
  session_code VARCHAR(50) UNIQUE,
  status VARCHAR(20) DEFAULT 'in_progress',
  total_orders INT DEFAULT 0,
  processed_orders INT DEFAULT 0,
  total_items INT DEFAULT 0,
  accepted_items INT DEFAULT 0,
  rejected_items INT DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  created_by UUID REFERENCES users(id)
);
```

#### `return_session_orders`
Links orders to return sessions.

```sql
CREATE TABLE return_session_orders (
  id UUID PRIMARY KEY,
  session_id UUID REFERENCES return_sessions(id),
  order_id UUID REFERENCES orders(id),
  original_status order_status NOT NULL,
  processed BOOLEAN DEFAULT FALSE,
  processed_at TIMESTAMP
);
```

#### `return_session_items`
Individual item decisions (accept/reject).

```sql
CREATE TABLE return_session_items (
  id UUID PRIMARY KEY,
  session_id UUID REFERENCES return_sessions(id),
  order_id UUID REFERENCES orders(id),
  product_id UUID REFERENCES products(id),
  quantity_expected INT NOT NULL,
  quantity_received INT DEFAULT 0,
  quantity_accepted INT DEFAULT 0,
  quantity_rejected INT DEFAULT 0,
  rejection_reason VARCHAR(50),
  rejection_notes TEXT,
  unit_cost DECIMAL(10,2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMP
);
```

### Functions

#### `generate_return_session_code(p_store_id UUID)`
Generates unique session codes in format `RET-DDMMYYYY-NN`.

```sql
SELECT generate_return_session_code('store-uuid-here');
-- Returns: 'RET-02122025-01'
```

#### `complete_return_session(p_session_id UUID)`
Processes session completion:
1. Updates product stock for accepted items
2. Logs inventory movements
3. Updates order statuses to `returned`
4. Marks session as `completed`

```sql
SELECT complete_return_session('session-uuid-here');
-- Returns: JSON summary of completion
```

---

## API Endpoints

All endpoints require authentication and store ID headers:
```
Authorization: Bearer {token}
X-Store-ID: {store_id}
```

### GET `/api/returns/eligible-orders`
Get orders eligible for return.

**Response:**
```json
[
  {
    "id": "uuid",
    "order_number": "ORD-001",
    "status": "delivered",
    "customer_name": "John Doe",
    "customer_phone": "+1234567890",
    "total_price": 150.00,
    "items_count": 3,
    "delivered_at": "2025-12-01T10:00:00Z"
  }
]
```

### POST `/api/returns/sessions`
Create a new return session.

**Request:**
```json
{
  "order_ids": ["uuid1", "uuid2"],
  "notes": "Return batch from delivery attempt #123"
}
```

**Response:**
```json
{
  "id": "uuid",
  "session_code": "RET-02122025-01",
  "status": "in_progress",
  "total_orders": 2,
  "total_items": 5,
  "created_at": "2025-12-02T14:30:00Z"
}
```

### GET `/api/returns/sessions/:id`
Get session details with items.

**Response:**
```json
{
  "id": "uuid",
  "session_code": "RET-02122025-01",
  "status": "in_progress",
  "total_items": 5,
  "items": [
    {
      "id": "uuid",
      "product_id": "uuid",
      "quantity_expected": 2,
      "quantity_accepted": 1,
      "quantity_rejected": 1,
      "rejection_reason": "damaged",
      "rejection_notes": "Package was wet",
      "product": {
        "name": "Product Name",
        "sku": "SKU-001",
        "stock": 50
      }
    }
  ]
}
```

### PATCH `/api/returns/items/:id`
Update item accept/reject quantities.

**Request:**
```json
{
  "quantity_accepted": 1,
  "quantity_rejected": 1,
  "rejection_reason": "damaged",
  "rejection_notes": "Box was crushed during shipping"
}
```

### POST `/api/returns/sessions/:id/complete`
Complete return session and update inventory.

**Response:**
```json
{
  "session_id": "uuid",
  "session_code": "RET-02122025-01",
  "orders_processed": 2,
  "items_accepted": 3,
  "items_rejected": 2,
  "completed_at": "2025-12-02T15:00:00Z"
}
```

### GET `/api/returns/stats`
Get return statistics for store.

**Response:**
```json
{
  "total_sessions": 10,
  "total_orders": 25,
  "total_items_accepted": 80,
  "total_items_rejected": 20,
  "acceptance_rate": "80.0"
}
```

---

## Frontend Components

### Pages

#### `src/pages/Returns.tsx`
Main returns page with three views:
1. **Sessions List:** View all return sessions
2. **Create Session:** Select orders and create new session
3. **Process Session:** Accept/reject items with reasons

**Features:**
- Multi-select orders for batch processing
- Real-time progress tracking
- Split-view for accepted vs rejected items
- Inline item processing with +/- controls
- Rejection reason dropdown with notes

### Services

#### `src/services/returns.service.ts`
API client for returns operations.

**Functions:**
- `getEligibleOrders()` - Fetch orders eligible for return
- `createReturnSession()` - Create new session
- `getReturnSession()` - Get session details
- `updateReturnItem()` - Update item quantities
- `completeReturnSession()` - Finalize session
- `getReturnStats()` - Get statistics

---

## Inventory Integration

### Automatic Stock Updates

When a return session is completed:

1. **Accepted Items:** Stock is increased
   ```sql
   UPDATE products
   SET stock = stock + quantity_accepted
   WHERE id = product_id;
   ```

2. **Inventory Movement Logged:**
   ```sql
   INSERT INTO inventory_movements (
     product_id, order_id, movement_type, quantity, reason
   ) VALUES (
     product_id, order_id, 'return_accepted', quantity_accepted,
     'Return session: RET-02122025-01'
   );
   ```

3. **Rejected Items:** No stock update, only logged
   ```sql
   INSERT INTO inventory_movements (
     product_id, order_id, movement_type, quantity, reason
   ) VALUES (
     product_id, order_id, 'return_rejected', quantity_rejected,
     'Rejected - damaged: Box was crushed'
   );
   ```

### Order Status Changes

All orders in a completed return session:
```sql
UPDATE orders
SET status = 'returned', updated_at = CURRENT_TIMESTAMP
WHERE id IN (session_order_ids);
```

**Status Enum Updated:**
```sql
ALTER TYPE order_status ADD VALUE 'returned';
```

---

## Testing

### Manual Testing

1. **Create test orders** in `delivered` status
2. **Navigate to** `/returns` in UI
3. **Create session** with test orders
4. **Process items** (mix of accept/reject)
5. **Complete session**
6. **Verify:**
   - Inventory updated correctly
   - Orders marked as `returned`
   - Movements logged in `inventory_movements`

### Automated Testing

Run the test script:
```bash
./test-returns-flow.sh [email] [password]
```

**Script tests:**
1. ✅ Login authentication
2. ✅ Fetch eligible orders
3. ✅ Create return session
4. ✅ Process items (accept/reject)
5. ✅ Complete session
6. ✅ Verify inventory movements
7. ✅ Get return statistics

---

## Edge Cases Handled

1. **Partial Returns:** Accept some items, reject others
2. **Zero Stock Products:** Returns still processed correctly
3. **Concurrent Sessions:** Each session is independent
4. **Session Cancellation:** Can cancel before completion
5. **Order Already Returned:** Prevented at database level (unique constraint)

---

## Security & Permissions

- ✅ **Authentication Required:** All endpoints require valid JWT token
- ✅ **Store Isolation:** RLS ensures users only see their store's data
- ✅ **Audit Trail:** All actions logged with timestamps and user IDs
- ✅ **Data Integrity:** Triggers prevent invalid state changes

---

## Performance Considerations

- **Batch Processing:** Process multiple orders in one session (reduces overhead)
- **Indexed Queries:** All foreign keys indexed for fast lookups
- **Minimal Transactions:** Complete session runs in single transaction
- **No N+1 Queries:** All data fetched with JOINs

---

## Future Enhancements

### Potential Features
- [ ] **Refund Integration:** Link returns to payment refunds
- [ ] **RMA Numbers:** Generate return merchandise authorization codes
- [ ] **Photo Upload:** Attach photos of damaged products
- [ ] **Customer Notifications:** Email/SMS when return processed
- [ ] **Return Policies:** Configurable rules (time limits, restocking fees)
- [ ] **Analytics Dashboard:** Return rate by product, customer, date
- [ ] **Bulk Actions:** Process all items at once with preset rules

---

## Migration Application

Apply the migration to enable the returns system:

```bash
# Using psql
psql "$DATABASE_URL" -f db/migrations/022_returns_system.sql

# Or via Supabase dashboard
# Copy contents of 022_returns_system.sql
# Paste into SQL Editor
# Execute
```

**Verification:**
```sql
-- Check tables created
SELECT tablename FROM pg_tables
WHERE schemaname = 'public' AND tablename LIKE 'return%';

-- Check function exists
SELECT proname FROM pg_proc WHERE proname LIKE 'generate_return%';
```

---

## Troubleshooting

### Issue: "No eligible orders found"
**Cause:** Orders must be in `delivered`, `shipped`, or `cancelled` status.
**Solution:** Update order status or use different orders.

### Issue: "Cannot complete session - unprocessed items"
**Cause:** All items must be accepted or rejected before completion.
**Solution:** Process all items in the session.

### Issue: "Inventory not updating"
**Cause:** Session may not have completed successfully.
**Solution:** Check `inventory_movements` table for logs, verify session status.

### Issue: "Session code already exists"
**Cause:** Multiple sessions created same day reached sequence limit.
**Solution:** Function auto-increments, retry should work. Check for conflicts.

---

## Support

For questions or issues:
- **Developer:** Bright Idea
- **Documentation:** `RETURNS_SYSTEM.md`
- **Testing:** `./test-returns-flow.sh`
- **Database:** `db/migrations/022_returns_system.sql`

---

**Last Updated:** 2025-12-02
**Version:** 1.0.0

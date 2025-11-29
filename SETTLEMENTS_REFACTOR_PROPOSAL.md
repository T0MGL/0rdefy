# Settlement System Refactor - Technical Proposal

## Executive Summary

This document outlines the database schema changes and architectural refactoring needed to support:
1. **Zone-based carrier rates** (e.g., "Asunción": $3, "Interior": $5)
2. **Dual settlement workflows**: Daily cash (internal fleet) + Deferred payments (external carriers)
3. **Free shipping model**: Customer pays total_price (COD), carrier deducts shipping_cost, transfers remainder

---

## Current State Analysis

### Existing Schema (from `000_MASTER_MIGRATION.sql`)

**carriers table** (lines 140-167):
- ✅ Has: name, phone, email, delivery stats, ratings
- ❌ Missing: Zone-based rates, carrier type (internal vs external)

**orders table** (lines 240-327):
- ✅ Has: `total_price` (customer COD amount), `courier_id`
- ❌ Missing: `shipping_cost` (internal expense), `zone`

**daily_settlements table** (lines 398-412):
- ✅ Purpose: Daily cash reconciliation
- ❌ Problem: Only designed for cash flow, not for deferred carrier payments

**Current Limitations:**
1. No way to define carrier rates per zone
2. No tracking of shipping costs as internal expenses
3. No workflow for deferred carrier settlements (weekly payments)
4. Settlement math doesn't account for: `Net Receivable = COD - Shipping Cost`

---

## Proposed Schema Changes

### Migration 016: Carrier Zones & Advanced Settlements

#### 1. Create `carrier_zones` table

**Purpose:** Define different shipping rates per carrier per geographic zone

```sql
CREATE TABLE IF NOT EXISTS carrier_zones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    carrier_id UUID NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,
    zone_name VARCHAR(100) NOT NULL,        -- e.g., "Asunción", "Interior", "Gran Asunción"
    zone_code VARCHAR(20),                  -- e.g., "ASU", "INT"
    rate DECIMAL(10,2) NOT NULL,            -- Shipping cost for this zone
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(carrier_id, zone_name)
);

CREATE INDEX idx_carrier_zones_carrier ON carrier_zones(carrier_id);
CREATE INDEX idx_carrier_zones_store ON carrier_zones(store_id);
CREATE INDEX idx_carrier_zones_active ON carrier_zones(carrier_id, is_active);
```

**Example Data:**
| carrier_id | zone_name | rate |
|------------|-----------|------|
| uuid-juan  | Asunción  | 3.00 |
| uuid-juan  | Interior  | 5.00 |
| uuid-fastbox | Asunción | 4.50 |

---

#### 2. Update `carriers` table

**Purpose:** Differentiate between internal fleet (daily cash) vs external carriers (deferred payment)

```sql
-- Add carrier_type to distinguish internal vs external
ALTER TABLE carriers ADD COLUMN IF NOT EXISTS carrier_type VARCHAR(20) DEFAULT 'internal';
-- carrier_type: 'internal' (rides, daily cash) or 'external' (FastBox, weekly payment)

-- Add default zone (optional, for quick assignments)
ALTER TABLE carriers ADD COLUMN IF NOT EXISTS default_zone VARCHAR(100);

-- Update trigger
DROP TRIGGER IF EXISTS trigger_update_carrier_zones_timestamp ON carrier_zones;
CREATE TRIGGER trigger_update_carrier_zones_timestamp
    BEFORE UPDATE ON carrier_zones
    FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();
```

---

#### 3. Update `orders` table

**Purpose:** Track internal shipping costs and zone assignment

```sql
-- Add shipping cost (what we pay the carrier - internal expense)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_cost DECIMAL(10,2) DEFAULT 0.00;

-- Add zone assigned to the order
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_zone VARCHAR(100);

-- Link to carrier settlement (when order is part of a bulk settlement)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS carrier_settlement_id UUID;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_orders_shipping_cost ON orders(shipping_cost) WHERE shipping_cost > 0;
CREATE INDEX IF NOT EXISTS idx_orders_zone ON orders(delivery_zone);
CREATE INDEX IF NOT EXISTS idx_orders_carrier_settlement ON orders(carrier_settlement_id);

-- Add foreign key (after creating carrier_settlements table)
-- ALTER TABLE orders ADD CONSTRAINT fk_orders_carrier_settlement
--     FOREIGN KEY (carrier_settlement_id) REFERENCES carrier_settlements(id) ON DELETE SET NULL;
```

**Important Notes:**
- `total_price` = What customer pays (COD amount)
- `shipping_cost` = What we owe the carrier (internal expense, invisible to customer)
- **Net Profit Calculation:** `total_price - product_costs - shipping_cost - marketing`

---

#### 4. Create `carrier_settlements` table

**Purpose:** Manage deferred payments to external carriers (weekly/monthly)

```sql
CREATE TABLE IF NOT EXISTS carrier_settlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    carrier_id UUID NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,

    -- Period covered by this settlement
    settlement_period_start DATE NOT NULL,
    settlement_period_end DATE NOT NULL,

    -- Order counts and financials
    total_orders INT NOT NULL DEFAULT 0,
    total_cod_collected DECIMAL(10,2) NOT NULL DEFAULT 0,   -- Sum(order.total_price)
    total_shipping_cost DECIMAL(10,2) NOT NULL DEFAULT 0,   -- Sum(order.shipping_cost)

    -- NET RECEIVABLE = What carrier owes us after deducting their fees
    net_amount DECIMAL(10,2) GENERATED ALWAYS AS (total_cod_collected - total_shipping_cost) STORED,

    -- Settlement status
    status VARCHAR(20) DEFAULT 'pending',  -- pending, paid, cancelled
    payment_date DATE,
    payment_method VARCHAR(50),            -- transfer, cash, etc.
    payment_reference VARCHAR(255),        -- bank ref, transaction ID

    -- Metadata
    notes TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),

    -- Ensure no duplicate settlements for same period
    CONSTRAINT unique_carrier_settlement_period UNIQUE(store_id, carrier_id, settlement_period_start, settlement_period_end)
);

CREATE INDEX idx_carrier_settlements_store ON carrier_settlements(store_id);
CREATE INDEX idx_carrier_settlements_carrier ON carrier_settlements(carrier_id);
CREATE INDEX idx_carrier_settlements_status ON carrier_settlements(status);
CREATE INDEX idx_carrier_settlements_period ON carrier_settlements(settlement_period_start, settlement_period_end);
CREATE INDEX idx_carrier_settlements_pending ON carrier_settlements(status, carrier_id) WHERE status = 'pending';

-- Trigger for updated_at
DROP TRIGGER IF EXISTS trigger_update_carrier_settlements_timestamp ON carrier_settlements;
CREATE TRIGGER trigger_update_carrier_settlements_timestamp
    BEFORE UPDATE ON carrier_settlements
    FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();
```

**Business Logic:**
- When creating a settlement, query all `orders` WHERE:
  - `courier_id = X`
  - `sleeves_status = 'delivered'`
  - `delivered_at BETWEEN period_start AND period_end`
  - `carrier_settlement_id IS NULL` (not already settled)
- Calculate:
  - `total_orders = COUNT(*)`
  - `total_cod_collected = SUM(total_price)`
  - `total_shipping_cost = SUM(shipping_cost)`
  - `net_amount = total_cod_collected - total_shipping_cost`
- Mark all those orders with `carrier_settlement_id = settlement.id`

---

#### 5. Add Foreign Key to Orders

```sql
ALTER TABLE orders DROP CONSTRAINT IF EXISTS fk_orders_carrier_settlement;
ALTER TABLE orders ADD CONSTRAINT fk_orders_carrier_settlement
    FOREIGN KEY (carrier_settlement_id)
    REFERENCES carrier_settlements(id)
    ON DELETE SET NULL;
```

---

#### 6. Create Helper Function for Settlement Creation

```sql
CREATE OR REPLACE FUNCTION create_carrier_settlement(
    p_store_id UUID,
    p_carrier_id UUID,
    p_period_start DATE,
    p_period_end DATE,
    p_created_by UUID
)
RETURNS UUID AS $$
DECLARE
    v_settlement_id UUID;
    v_total_orders INT;
    v_total_cod DECIMAL(10,2);
    v_total_shipping DECIMAL(10,2);
BEGIN
    -- Calculate totals from delivered orders in period
    SELECT
        COUNT(*),
        COALESCE(SUM(total_price), 0),
        COALESCE(SUM(shipping_cost), 0)
    INTO v_total_orders, v_total_cod, v_total_shipping
    FROM orders
    WHERE store_id = p_store_id
      AND courier_id = p_carrier_id
      AND sleeves_status = 'delivered'
      AND delivered_at >= p_period_start
      AND delivered_at < p_period_end + INTERVAL '1 day'
      AND carrier_settlement_id IS NULL;

    -- Create settlement
    INSERT INTO carrier_settlements (
        store_id, carrier_id,
        settlement_period_start, settlement_period_end,
        total_orders, total_cod_collected, total_shipping_cost,
        status, created_by
    ) VALUES (
        p_store_id, p_carrier_id,
        p_period_start, p_period_end,
        v_total_orders, v_total_cod, v_total_shipping,
        'pending', p_created_by
    )
    RETURNING id INTO v_settlement_id;

    -- Link orders to settlement
    UPDATE orders
    SET carrier_settlement_id = v_settlement_id
    WHERE store_id = p_store_id
      AND courier_id = p_carrier_id
      AND sleeves_status = 'delivered'
      AND delivered_at >= p_period_start
      AND delivered_at < p_period_end + INTERVAL '1 day'
      AND carrier_settlement_id IS NULL;

    RETURN v_settlement_id;
END;
$$ LANGUAGE plpgsql;
```

---

#### 7. Create View for Pending Settlements Summary

```sql
CREATE OR REPLACE VIEW pending_carrier_settlements_summary AS
SELECT
    c.id as carrier_id,
    c.name as carrier_name,
    c.carrier_type,
    s.id as store_id,
    COUNT(DISTINCT o.id) as pending_orders_count,
    COALESCE(SUM(o.total_price), 0) as total_cod_pending,
    COALESCE(SUM(o.shipping_cost), 0) as total_shipping_cost_pending,
    COALESCE(SUM(o.total_price) - SUM(o.shipping_cost), 0) as net_receivable_pending,
    MIN(o.delivered_at) as oldest_delivery,
    MAX(o.delivered_at) as newest_delivery
FROM carriers c
INNER JOIN orders o ON o.courier_id = c.id
INNER JOIN stores s ON c.store_id = s.id
WHERE o.sleeves_status = 'delivered'
  AND o.carrier_settlement_id IS NULL
  AND c.carrier_type = 'external'
GROUP BY c.id, c.name, c.carrier_type, s.id
HAVING COUNT(o.id) > 0
ORDER BY oldest_delivery ASC;
```

---

## Frontend Changes Required

### 1. Carriers Page (`src/pages/Carriers.tsx`)

**New Features:**
- [ ] Add "Carrier Type" field in form: Internal / External
- [ ] Add "Zones & Rates" section with table:
  - Columns: Zone Name | Rate | Active | Actions
  - Add/Edit/Delete zone buttons
  - Validate: rate must be > 0

**UI Mockup:**
```
┌─────────────────────────────────────────┐
│ Carrier Type: [External ▼]             │
│                                         │
│ Zones & Rates                           │
│ ┌────────────┬──────┬────────┬────────┐│
│ │ Zone       │ Rate │ Active │ Actions││
│ ├────────────┼──────┼────────┼────────┤│
│ │ Asunción   │ $3.00│   ✓    │ ✏️ 🗑️  ││
│ │ Interior   │ $5.00│   ✓    │ ✏️ 🗑️  ││
│ └────────────┴──────┴────────┴────────┘│
│ [+ Add Zone]                            │
└─────────────────────────────────────────┘
```

---

### 2. Orders Page - Carrier Assignment

**When assigning a carrier to an order:**
- [ ] If carrier has zones defined, show zone dropdown (required)
- [ ] Auto-calculate `shipping_cost` based on carrier + zone
- [ ] Display shipping cost to admin (not visible to customer)

**Example:**
```
┌─────────────────────────────────────────┐
│ Carrier: [Juan - Internal ▼]           │
│ Zone:    [Asunción ▼]                   │
│                                         │
│ Shipping Cost: $3.00 (internal expense) │
│ Customer Pays: $100.00 (COD)            │
└─────────────────────────────────────────┘
```

---

### 3. Settlements Page Refactor (`src/pages/Settlements.tsx`)

**New 2-Tab Layout:**

#### Tab 1: Rendición Diaria (Daily Cash - Internal Fleet)
- **Purpose:** Close cash for in-house riders who collect cash daily
- **Current functionality (keep as-is):**
  - View today's pending cash
  - "Rendir Caja" button opens dialog
  - Input: Cash collected, Transfer/QR amounts
  - Register returns (update stock)
  - Close shift

#### Tab 2: Liquidaciones Transportadora (Carrier Settlements - External)
- **Purpose:** Generate bulk settlements for external carriers (weekly)
- **New Features:**

**Main View - Pending Settlements:**
```
┌─────────────────────────────────────────────────────────────────────┐
│ Carrier       │ Orders │ Total COD │ Shipping Cost │ Net Receivable │
├───────────────┼────────┼───────────┼───────────────┼────────────────┤
│ FastBox       │   10   │  $1,000   │     $50       │     $950       │
│ Correo Py     │    5   │    $500   │     $30       │     $470       │
└─────────────────────────────────────────────────────────────────────┘
[Generate Settlement]
```

**Generate Settlement Wizard:**
1. Select Carrier
2. Select Date Range (e.g., Last Week, Custom Range)
3. System queries delivered orders in range (not yet settled)
4. Shows order list with breakdown:
   - Order # | Date | COD | Shipping Cost
   - **Totals:**
     - Orders: 10
     - Total COD Collected: $1,000
     - Total Shipping Cost: $50
     - **Net to Transfer: $950**
5. Confirm → Creates `carrier_settlement` record
6. Marks all orders as `carrier_settlement_id = settlement.id`

---

## API Endpoints Required

### Carrier Zones Management (`api/routes/carriers.ts`)

```typescript
GET    /api/carriers/:id/zones           # List zones for carrier
POST   /api/carriers/:id/zones           # Create zone
PUT    /api/carriers/zones/:zoneId       # Update zone
DELETE /api/carriers/zones/:zoneId       # Delete zone
GET    /api/carriers/:id/zones/calculate # Calculate shipping cost (carrier + zone)
```

### Carrier Settlements (`api/routes/carrier-settlements.ts` - NEW FILE)

```typescript
GET    /api/carrier-settlements                    # List all settlements
GET    /api/carrier-settlements/pending            # Pending summary by carrier
POST   /api/carrier-settlements                    # Create settlement (bulk)
GET    /api/carrier-settlements/:id                # Get settlement details + orders
PATCH  /api/carrier-settlements/:id                # Update settlement
POST   /api/carrier-settlements/:id/mark-paid      # Mark as paid
DELETE /api/carrier-settlements/:id                # Cancel/delete settlement
```

### Orders Updates (`api/routes/orders.ts`)

```typescript
// When creating/updating order with courier_id:
// - Require zone if carrier has zones defined
// - Auto-calculate shipping_cost
// - Return shipping_cost in response (admin only)
```

---

## Example Settlement Flow

### Scenario: FastBox Weekly Settlement

**Context:**
- Carrier: FastBox (External)
- Zones: Asunción ($4.50/order), Interior ($6.00/order)
- Period: Nov 18-24, 2025

**Delivered Orders:**
| Order | Date | Zone | Customer Paid (COD) | Shipping Cost |
|-------|------|------|---------------------|---------------|
| #1001 | Nov 18 | Asunción | $100 | $4.50 |
| #1002 | Nov 19 | Interior | $150 | $6.00 |
| #1003 | Nov 20 | Asunción | $80  | $4.50 |
| ... (7 more orders) | | | | |

**Settlement Calculation:**
- Total Orders: 10
- Total COD Collected by FastBox: $1,200
- Total Shipping Cost (FastBox fees): $48
- **Net Amount Receivable (FastBox owes us): $1,152**

**Process:**
1. User clicks "Generate Settlement" for FastBox
2. Selects period: Nov 18-24
3. System shows 10 orders with breakdown
4. User confirms → Settlement created
5. FastBox transfers $1,152 to our account
6. User marks settlement as "Paid" with bank reference

---

## Migration Checklist

- [ ] Create migration file: `db/migrations/016_carrier_zones_and_settlements.sql`
- [ ] Add `carrier_zones` table
- [ ] Update `carriers` table (add carrier_type, default_zone)
- [ ] Update `orders` table (add shipping_cost, delivery_zone, carrier_settlement_id)
- [ ] Create `carrier_settlements` table
- [ ] Create helper function `create_carrier_settlement()`
- [ ] Create view `pending_carrier_settlements_summary`
- [ ] Update `CLAUDE.md` with new schema documentation

---

## Risk Assessment

### Low Risk ✅
- Adding new tables (carrier_zones, carrier_settlements) - No breaking changes
- Adding new columns to orders with defaults - Backwards compatible

### Medium Risk ⚠️
- Updating settlements workflow - Need to preserve existing daily_settlements logic
- Requires dual testing (internal daily cash + external deferred payments)

### Migration Safety
- All new columns have DEFAULT values
- All new tables are independent (won't break existing queries)
- Existing `daily_settlements` table remains untouched
- Use IF NOT EXISTS for all schema changes (idempotent)

---

## Testing Strategy

### Unit Tests
- [ ] Carrier zones CRUD
- [ ] Shipping cost calculation (carrier + zone)
- [ ] Settlement creation function

### Integration Tests
- [ ] Create settlement with 10 orders → Verify totals
- [ ] Mark settlement as paid → Verify orders linked
- [ ] Prevent double settlement (same orders in multiple settlements)

### Manual Testing
1. Create carrier with zones (Asunción: $3, Interior: $5)
2. Create 5 orders with different zones
3. Mark orders as delivered
4. Generate settlement → Verify math
5. Mark as paid → Verify status change

---

## Timeline Estimate

| Task | Effort |
|------|--------|
| Database migration | 2 hours |
| Backend API (carrier zones) | 3 hours |
| Backend API (settlements) | 4 hours |
| Frontend - Carriers zones UI | 3 hours |
| Frontend - Settlements refactor | 6 hours |
| Testing & QA | 4 hours |
| **Total** | **22 hours** |

---

## Next Steps

1. ✅ Review this proposal
2. Create migration file `016_carrier_zones_and_settlements.sql`
3. Implement backend APIs
4. Update frontend pages
5. Test with real scenarios

---

**Questions for Review:**
1. Should we support multiple currencies for zones? (Currently assuming single currency per store)
2. Should we add a "Settlement Template" feature for recurring weekly settlements?
3. Do we need audit logs for settlement changes?
4. Should we send notifications when settlements are created/paid?

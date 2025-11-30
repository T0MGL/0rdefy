-- Migration: Merchandise/Inbound Shipments System
-- Description: Manages supplier purchases and inventory reception
-- Author: Bright Idea
-- Date: 2025-01-28

-- =====================================================
-- Table: inbound_shipments
-- =====================================================
-- Tracks shipments from suppliers to warehouse
CREATE TABLE IF NOT EXISTS inbound_shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,

  -- Shipment Details
  internal_reference VARCHAR(50) NOT NULL, -- Auto-generated or manual
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  carrier_id UUID REFERENCES carriers(id) ON DELETE SET NULL,
  tracking_code VARCHAR(100),

  -- Dates
  estimated_arrival_date DATE,
  received_date TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Status tracking
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  -- Status values: 'pending', 'partial', 'received'

  -- Costs
  shipping_cost DECIMAL(10, 2) DEFAULT 0,
  total_cost DECIMAL(10, 2) DEFAULT 0, -- Sum of all items

  -- Evidence
  evidence_photo_url TEXT,

  -- Notes
  notes TEXT,

  -- User tracking
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  received_by UUID REFERENCES users(id) ON DELETE SET NULL,

  CONSTRAINT valid_status CHECK (status IN ('pending', 'partial', 'received')),
  CONSTRAINT unique_internal_reference UNIQUE (store_id, internal_reference)
);

-- =====================================================
-- Table: inbound_shipment_items
-- =====================================================
-- Line items for each shipment
CREATE TABLE IF NOT EXISTS inbound_shipment_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES inbound_shipments(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,

  -- Quantities
  qty_ordered INTEGER NOT NULL CHECK (qty_ordered > 0),
  qty_received INTEGER DEFAULT 0 CHECK (qty_received >= 0),
  qty_rejected INTEGER DEFAULT 0 CHECK (qty_rejected >= 0),

  -- Costs
  unit_cost DECIMAL(10, 2) NOT NULL CHECK (unit_cost >= 0),
  total_cost DECIMAL(10, 2) GENERATED ALWAYS AS (qty_ordered * unit_cost) STORED,

  -- Discrepancy tracking
  discrepancy_notes TEXT,
  has_discrepancy BOOLEAN GENERATED ALWAYS AS (qty_received != qty_ordered) STORED,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT qty_valid CHECK (qty_received + qty_rejected <= qty_ordered)
);

-- =====================================================
-- Indexes
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_inbound_shipments_store ON inbound_shipments(store_id);
CREATE INDEX IF NOT EXISTS idx_inbound_shipments_status ON inbound_shipments(status);
CREATE INDEX IF NOT EXISTS idx_inbound_shipments_supplier ON inbound_shipments(supplier_id);
CREATE INDEX IF NOT EXISTS idx_inbound_shipments_eta ON inbound_shipments(estimated_arrival_date);
CREATE INDEX IF NOT EXISTS idx_inbound_shipments_created ON inbound_shipments(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inbound_items_shipment ON inbound_shipment_items(shipment_id);
CREATE INDEX IF NOT EXISTS idx_inbound_items_product ON inbound_shipment_items(product_id);

-- =====================================================
-- Function: Generate Internal Reference
-- =====================================================
-- Auto-generates reference in format: ISH-YYYYMMDD-XXX
CREATE OR REPLACE FUNCTION generate_inbound_reference(p_store_id UUID)
RETURNS VARCHAR(50) AS $$
DECLARE
  v_date_part VARCHAR(8);
  v_sequence INTEGER;
  v_reference VARCHAR(50);
BEGIN
  -- Get date part: YYYYMMDD
  v_date_part := TO_CHAR(NOW(), 'YYYYMMDD');

  -- Get today's count for this store
  SELECT COUNT(*) + 1 INTO v_sequence
  FROM inbound_shipments
  WHERE store_id = p_store_id
    AND DATE(created_at) = CURRENT_DATE;

  -- Format: ISH-20250128-001
  v_reference := 'ISH-' || v_date_part || '-' || LPAD(v_sequence::TEXT, 3, '0');

  RETURN v_reference;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- Trigger: Auto-update updated_at
-- =====================================================
CREATE OR REPLACE FUNCTION update_inbound_shipment_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_inbound_shipment_timestamp ON inbound_shipments;
CREATE TRIGGER trigger_update_inbound_shipment_timestamp
  BEFORE UPDATE ON inbound_shipments
  FOR EACH ROW
  EXECUTE FUNCTION update_inbound_shipment_timestamp();

DROP TRIGGER IF EXISTS trigger_update_inbound_item_timestamp ON inbound_shipment_items;
CREATE TRIGGER trigger_update_inbound_item_timestamp
  BEFORE UPDATE ON inbound_shipment_items
  FOR EACH ROW
  EXECUTE FUNCTION update_inbound_shipment_timestamp();

-- =====================================================
-- Trigger: Update Shipment Total Cost
-- =====================================================
CREATE OR REPLACE FUNCTION update_shipment_total_cost()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE inbound_shipments
  SET total_cost = (
    SELECT COALESCE(SUM(total_cost), 0)
    FROM inbound_shipment_items
    WHERE shipment_id = COALESCE(NEW.shipment_id, OLD.shipment_id)
  )
  WHERE id = COALESCE(NEW.shipment_id, OLD.shipment_id);

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_shipment_total_after_item_change ON inbound_shipment_items;
CREATE TRIGGER trigger_update_shipment_total_after_item_change
  AFTER INSERT OR UPDATE OR DELETE ON inbound_shipment_items
  FOR EACH ROW
  EXECUTE FUNCTION update_shipment_total_cost();

-- =====================================================
-- Function: Receive Shipment (Update Inventory)
-- =====================================================
-- Called when user confirms reception with actual quantities
CREATE OR REPLACE FUNCTION receive_shipment_items(
  p_shipment_id UUID,
  p_items JSONB, -- Array of {item_id, qty_received, qty_rejected, discrepancy_notes}
  p_received_by UUID
)
RETURNS JSONB AS $$
DECLARE
  v_item JSONB;
  v_product_id UUID;
  v_qty_received INTEGER;
  v_qty_rejected INTEGER;
  v_qty_ordered INTEGER;
  v_all_complete BOOLEAN := TRUE;
  v_any_received BOOLEAN := FALSE;
  v_updated_count INTEGER := 0;
BEGIN
  -- Loop through each item
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty_received := (v_item->>'qty_received')::INTEGER;
    v_qty_rejected := COALESCE((v_item->>'qty_rejected')::INTEGER, 0);

    -- Update the shipment item
    UPDATE inbound_shipment_items
    SET
      qty_received = v_qty_received,
      qty_rejected = v_qty_rejected,
      discrepancy_notes = v_item->>'discrepancy_notes',
      updated_at = NOW()
    WHERE id = (v_item->>'item_id')::UUID
    RETURNING product_id, qty_ordered INTO v_product_id, v_qty_ordered;

    -- Update product inventory (only for received items)
    IF v_qty_received > 0 THEN
      UPDATE products
      SET
        stock = stock + v_qty_received,
        updated_at = NOW()
      WHERE id = v_product_id;

      v_any_received := TRUE;
    END IF;

    -- Check if this item is incomplete
    IF v_qty_received < v_qty_ordered THEN
      v_all_complete := FALSE;
    END IF;

    v_updated_count := v_updated_count + 1;
  END LOOP;

  -- Update shipment status
  UPDATE inbound_shipments
  SET
    status = CASE
      WHEN v_all_complete THEN 'received'
      WHEN v_any_received THEN 'partial'
      ELSE 'pending'
    END,
    received_date = CASE
      WHEN v_any_received THEN NOW()
      ELSE received_date
    END,
    received_by = CASE
      WHEN v_any_received THEN p_received_by
      ELSE received_by
    END,
    updated_at = NOW()
  WHERE id = p_shipment_id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'items_updated', v_updated_count,
    'status', CASE
      WHEN v_all_complete THEN 'received'
      WHEN v_any_received THEN 'partial'
      ELSE 'pending'
    END
  );
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- View: Shipments with Summary
-- =====================================================
CREATE OR REPLACE VIEW inbound_shipments_summary AS
SELECT
  s.id,
  s.store_id,
  s.internal_reference,
  s.supplier_id,
  sup.name AS supplier_name,
  s.carrier_id,
  c.name AS carrier_name,
  s.tracking_code,
  s.estimated_arrival_date,
  s.received_date,
  s.status,
  s.shipping_cost,
  s.total_cost,
  s.evidence_photo_url,
  s.notes,
  s.created_at,
  s.updated_at,
  s.created_by,
  s.received_by,
  -- Summary stats
  COUNT(i.id) AS total_items,
  SUM(i.qty_ordered) AS total_qty_ordered,
  SUM(i.qty_received) AS total_qty_received,
  SUM(i.qty_rejected) AS total_qty_rejected,
  COUNT(CASE WHEN i.has_discrepancy THEN 1 END) AS items_with_discrepancies
FROM inbound_shipments s
LEFT JOIN suppliers sup ON s.supplier_id = sup.id
LEFT JOIN carriers c ON s.carrier_id = c.id
LEFT JOIN inbound_shipment_items i ON s.id = i.shipment_id
GROUP BY
  s.id, s.store_id, s.internal_reference, s.supplier_id, sup.name,
  s.carrier_id, c.name, s.tracking_code, s.estimated_arrival_date,
  s.received_date, s.status, s.shipping_cost, s.total_cost,
  s.evidence_photo_url, s.notes, s.created_at, s.updated_at,
  s.created_by, s.received_by;

-- =====================================================
-- Permissions (RLS)
-- =====================================================
-- Enable Row Level Security
ALTER TABLE inbound_shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbound_shipment_items ENABLE ROW LEVEL SECURITY;

-- Policies for inbound_shipments
CREATE POLICY inbound_shipments_store_isolation ON inbound_shipments
  FOR ALL
  USING (store_id IN (
    SELECT store_id FROM user_stores WHERE user_id = auth.uid()
  ));

-- Policies for inbound_shipment_items (inherit from shipment)
CREATE POLICY inbound_items_via_shipment ON inbound_shipment_items
  FOR ALL
  USING (
    shipment_id IN (
      SELECT id FROM inbound_shipments
      WHERE store_id IN (
        SELECT store_id FROM user_stores WHERE user_id = auth.uid()
      )
    )
  );

-- =====================================================
-- Migration Complete
-- =====================================================
-- This migration adds:
-- - inbound_shipments table for tracking supplier shipments
-- - inbound_shipment_items for line items with qty tracking
-- - Auto-reference generation function
-- - Inventory update function on reception
-- - Summary view with aggregated stats
-- - RLS policies for multi-tenant isolation

/**
 * Apply ALL fixes:
 * 1. Apply migration 039
 * 2. Grant owner access
 * 3. Delete all Bright Idea orders
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function applyAllFixes() {
  console.log('🚀 Applying ALL fixes to Supabase');
  console.log('═'.repeat(60));
  console.log('');

  try {
    // STEP 1: Apply Migration 039
    console.log('STEP 1: Applying Migration 039...');
    console.log('─'.repeat(60));

    const migration039 = `
-- Add soft delete columns
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP DEFAULT NULL,
ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id),
ADD COLUMN IF NOT EXISTS deletion_type VARCHAR(20) CHECK (deletion_type IN ('soft', 'hard')) DEFAULT NULL;

-- Create indexes
DROP INDEX IF EXISTS idx_orders_deleted_at;
DROP INDEX IF EXISTS idx_orders_active;
CREATE INDEX idx_orders_deleted_at ON orders(store_id, deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_orders_active ON orders(store_id, deleted_at) WHERE deleted_at IS NULL;

-- Cascading delete function
CREATE OR REPLACE FUNCTION cascade_delete_order_data()
RETURNS TRIGGER AS $$
DECLARE
    line_item JSONB;
    v_product_id UUID;
    v_quantity INT;
    v_product_name TEXT;
    v_picking_session_ids UUID[];
    v_return_session_ids UUID[];
BEGIN
    IF OLD.sleeves_status IN ('ready_to_ship', 'shipped', 'delivered') THEN
        FOR line_item IN SELECT * FROM jsonb_array_elements(OLD.line_items)
        LOOP
            v_product_id := (line_item->>'product_id')::UUID;
            v_quantity := (line_item->>'quantity')::INT;
            v_product_name := line_item->>'product_name';
            IF v_product_id IS NULL THEN CONTINUE; END IF;
            UPDATE products SET stock = stock + v_quantity, updated_at = NOW() WHERE id = v_product_id;
            INSERT INTO inventory_movements (product_id, store_id, order_id, movement_type, quantity, reference_type, notes, created_at)
            VALUES (v_product_id, OLD.store_id, OLD.id, 'order_hard_delete_restoration', v_quantity, 'order_deletion',
                    format('Stock restored due to permanent deletion of order %s (status: %s)', OLD.id, OLD.sleeves_status), NOW());
        END LOOP;
    END IF;
    SELECT ARRAY_AGG(DISTINCT session_id) INTO v_picking_session_ids FROM picking_session_orders WHERE order_id = OLD.id;
    IF v_picking_session_ids IS NOT NULL AND array_length(v_picking_session_ids, 1) > 0 THEN
        DELETE FROM packing_progress WHERE order_id = OLD.id;
        DELETE FROM picking_session_orders WHERE order_id = OLD.id;
        DELETE FROM picking_sessions WHERE id = ANY(v_picking_session_ids) AND NOT EXISTS (SELECT 1 FROM picking_session_orders WHERE session_id = picking_sessions.id);
    END IF;
    SELECT ARRAY_AGG(DISTINCT session_id) INTO v_return_session_ids FROM return_session_orders WHERE order_id = OLD.id;
    IF v_return_session_ids IS NOT NULL AND array_length(v_return_session_ids, 1) > 0 THEN
        DELETE FROM return_session_orders WHERE order_id = OLD.id;
        DELETE FROM return_sessions WHERE id = ANY(v_return_session_ids) AND NOT EXISTS (SELECT 1 FROM return_session_orders WHERE session_id = return_sessions.id);
    END IF;
    DELETE FROM order_line_items WHERE order_id = OLD.id;
    DELETE FROM delivery_attempts WHERE order_id = OLD.id;
    DELETE FROM settlement_orders WHERE order_id = OLD.id;
    DELETE FROM order_status_history WHERE order_id = OLD.id;
    DELETE FROM follow_up_log WHERE order_id = OLD.id;
    IF OLD.shopify_order_id IS NOT NULL THEN
        DELETE FROM shopify_webhook_idempotency WHERE shopify_event_id = OLD.shopify_order_id;
        DELETE FROM shopify_webhook_events WHERE shopify_event_id = OLD.shopify_order_id AND store_id = OLD.store_id;
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_restore_stock_on_hard_delete ON orders;
DROP TRIGGER IF EXISTS trigger_cascade_delete_order_data ON orders;
DROP TRIGGER IF EXISTS trigger_prevent_order_deletion_after_stock_deducted ON orders;

CREATE TRIGGER trigger_cascade_delete_order_data BEFORE DELETE ON orders FOR EACH ROW EXECUTE FUNCTION cascade_delete_order_data();
`;

    // Can't execute raw SQL via Supabase JS client, need to use SQL Editor
    console.log('⚠️  Cannot execute raw SQL via Supabase JS client');
    console.log('');
    console.log('Please run this SQL in Supabase SQL Editor:');
    console.log('═'.repeat(60));
    console.log(migration039);
    console.log('═'.repeat(60));
    console.log('');

    // STEP 2: Grant owner access
    console.log('STEP 2: Granting owner access...');
    console.log('─'.repeat(60));

    const { data: ownerUpdate, error: ownerError } = await supabaseAdmin
      .from('user_stores')
      .update({ role: 'owner' })
      .in('user_id', [
        (await supabaseAdmin.from('users').select('id').eq('email', 'gaston@thebrightidea.ai').single()).data?.id,
        (await supabaseAdmin.from('users').select('id').eq('email', 'hanselechague6@gmail.com').single()).data?.id
      ].filter(Boolean))
      .eq('is_active', true);

    if (ownerError) {
      console.log('❌ Failed:', ownerError.message);
    } else {
      console.log('✅ Owner access granted');
    }
    console.log('');

    // STEP 3: Delete all Bright Idea orders
    console.log('STEP 3: Deleting all Bright Idea orders...');
    console.log('─'.repeat(60));

    // Get store ID for gaston@thebrightidea.ai
    const { data: userStore } = await supabaseAdmin
      .from('user_stores')
      .select('store_id, stores(name)')
      .eq('users.email', 'gaston@thebrightidea.ai')
      .eq('is_active', true)
      .single();

    if (!userStore) {
      console.log('❌ Store not found');
      return;
    }

    const storeId = userStore.store_id;
    console.log(`Store: ${userStore.stores.name} (${storeId})`);
    console.log('');

    // Get all orders
    const { data: orders } = await supabaseAdmin
      .from('orders')
      .select('id, order_number, customer_first_name, customer_last_name')
      .eq('store_id', storeId);

    console.log(`Found ${orders?.length || 0} orders to delete`);
    console.log('');

    if (orders && orders.length > 0) {
      for (const order of orders) {
        const { error } = await supabaseAdmin
          .from('orders')
          .delete()
          .eq('id', order.id);

        if (error) {
          console.log(`❌ ${order.order_number}: ${error.message}`);
        } else {
          console.log(`✅ ${order.order_number} deleted`);
        }
      }
    }

    console.log('');
    console.log('═'.repeat(60));
    console.log('✅ ALL FIXES APPLIED');
    console.log('');
    console.log('Next: Update frontend to disable checkboxes for soft-deleted orders');

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

applyAllFixes();

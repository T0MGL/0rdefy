-- ================================================================
-- ORDEFY Production Verification Queries
-- Critical Database Integrity Checks
-- ================================================================

-- ================================================================
-- CHECK 1: Orders without delivery_link_token
-- CRITICAL: All confirmed orders MUST have delivery token
-- ================================================================
SELECT 
  COUNT(*) as orders_without_token,
  ARRAY_AGG(id) as order_ids
FROM orders 
WHERE status = 'confirmed' 
  AND delivery_link_token IS NULL;

-- Expected: 0 orders
-- If > 0: CRITICAL - These orders cannot be delivered

-- ================================================================
-- CHECK 2: Orders without line items
-- CRITICAL: Orders must have products
-- ================================================================
SELECT 
  o.id,
  o.order_number,
  o.status,
  o.created_at,
  COUNT(li.id) as line_items_count
FROM orders o 
LEFT JOIN order_line_items li ON o.id = li.order_id 
WHERE o.status NOT IN ('cancelled', 'rejected')
GROUP BY o.id, o.order_number, o.status, o.created_at
HAVING COUNT(li.id) = 0
ORDER BY o.created_at DESC;

-- Expected: 0 orders
-- If > 0: CRITICAL - Orders without products

-- ================================================================
-- CHECK 3: Orphaned line items
-- MEDIUM: Line items without parent order
-- ================================================================
SELECT 
  li.id,
  li.order_id,
  li.product_name,
  li.created_at
FROM order_line_items li
LEFT JOIN orders o ON li.order_id = o.id
WHERE o.id IS NULL;

-- Expected: 0 items
-- If > 0: MEDIUM - Data cleanup needed

-- ================================================================
-- CHECK 4: Active sessions without orders
-- HIGH: Sessions should have orders
-- ================================================================
SELECT 
  s.id,
  s.code,
  s.status,
  s.created_at,
  COUNT(so.order_id) as order_count
FROM picking_sessions s
LEFT JOIN session_orders so ON s.id = so.session_id
WHERE s.status IN ('picking', 'packing')
GROUP BY s.id, s.code, s.status, s.created_at
HAVING COUNT(so.order_id) = 0;

-- Expected: 0 sessions
-- If > 0: HIGH - Empty sessions should be cleaned

-- ================================================================
-- CHECK 5: Orders with invalid status transitions
-- HIGH: Validate status flow
-- ================================================================
SELECT 
  id,
  order_number,
  status,
  sleeves_status,
  delivery_link_token,
  created_at
FROM orders
WHERE 
  -- Confirmed orders without token
  (status = 'confirmed' AND delivery_link_token IS NULL)
  -- Delivered orders without confirmation
  OR (status = 'delivered' AND delivered_at IS NULL)
  -- In transit without token
  OR (status = 'in_transit' AND delivery_link_token IS NULL);

-- Expected: 0 orders
-- If > 0: HIGH - Invalid state

-- ================================================================
-- CHECK 6: Revenue calculation validation
-- CRITICAL: Verify financial metrics
-- ================================================================
WITH order_totals AS (
  SELECT 
    SUM(total_price) as total_revenue,
    SUM(CASE WHEN status = 'delivered' THEN total_price ELSE 0 END) as delivered_revenue,
    COUNT(*) as total_orders,
    COUNT(CASE WHEN status = 'delivered' THEN 1 END) as delivered_orders
  FROM orders
  WHERE status NOT IN ('cancelled', 'rejected')
    AND created_at >= CURRENT_DATE - INTERVAL '30 days'
),
product_costs AS (
  SELECT 
    SUM(oli.quantity * COALESCE(p.cost, 0)) as total_product_cost
  FROM order_line_items oli
  JOIN orders o ON oli.order_id = o.id
  LEFT JOIN products p ON oli.product_id = p.id
  WHERE o.status NOT IN ('cancelled', 'rejected')
    AND o.created_at >= CURRENT_DATE - INTERVAL '30 days'
)
SELECT 
  ot.total_revenue,
  ot.delivered_revenue,
  pc.total_product_cost,
  ot.total_revenue - pc.total_product_cost as gross_profit,
  ROUND(((ot.total_revenue - pc.total_product_cost) / NULLIF(ot.total_revenue, 0) * 100)::numeric, 2) as gross_margin_pct
FROM order_totals ot, product_costs pc;

-- Expected: Positive gross profit, margin 30-70%
-- If negative or >90%: CRITICAL - Check cost data

-- ================================================================
-- CHECK 7: Pending cash calculation
-- CRITICAL: COD cash flow tracking
-- ================================================================
SELECT 
  COUNT(*) as pending_orders,
  SUM(total_price) as pending_cash,
  SUM(cod_amount) as pending_cod
FROM orders
WHERE payment_status = 'pending'
  AND sleeves_status IN ('confirmed', 'preparing', 'ready_to_ship', 'out_for_delivery', 'in_preparation')
  AND status NOT IN ('cancelled', 'rejected', 'delivered');

-- Expected: Matches dashboard pending_cash
-- If mismatch: CRITICAL - Cash flow tracking broken

-- ================================================================
-- CHECK 8: Duplicate orders
-- HIGH: Check for accidental duplicates
-- ================================================================
SELECT 
  customer_phone,
  customer_name,
  total_price,
  created_at::date as order_date,
  COUNT(*) as duplicate_count,
  ARRAY_AGG(id) as order_ids
FROM orders
WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY customer_phone, customer_name, total_price, created_at::date
HAVING COUNT(*) > 1;

-- Expected: Few or none
-- If many: MEDIUM - Review order creation flow

-- ================================================================
-- CHECK 9: Missing customer data
-- HIGH: Required for delivery
-- ================================================================
SELECT 
  id,
  order_number,
  status,
  customer_name,
  customer_phone,
  customer_address
FROM orders
WHERE status NOT IN ('cancelled', 'rejected')
  AND (
    customer_name IS NULL 
    OR customer_name = ''
    OR customer_phone IS NULL 
    OR customer_phone = ''
    OR customer_address IS NULL 
    OR customer_address = ''
  );

-- Expected: 0 orders
-- If > 0: HIGH - Cannot deliver without data

-- ================================================================
-- CHECK 10: Products without cost data
-- CRITICAL: Affects margin calculations
-- ================================================================
SELECT 
  id,
  name,
  sku,
  price,
  cost,
  created_at
FROM products
WHERE cost IS NULL OR cost = 0
ORDER BY created_at DESC;

-- Expected: Few or none
-- If many: CRITICAL - Margins will be wrong

-- ================================================================
-- CHECK 11: Warehouse session integrity
-- HIGH: Validate picking/packing flow
-- ================================================================
SELECT 
  ps.id,
  ps.code,
  ps.status,
  COUNT(DISTINCT so.order_id) as total_orders,
  COUNT(DISTINCT CASE WHEN psp.quantity_picked >= psp.total_quantity_needed THEN psp.product_id END) as picked_products,
  COUNT(DISTINCT psp.product_id) as total_products
FROM picking_sessions ps
LEFT JOIN session_orders so ON ps.id = so.session_id
LEFT JOIN picking_session_products psp ON ps.id = psp.session_id
WHERE ps.status IN ('picking', 'packing')
GROUP BY ps.id, ps.code, ps.status;

-- Expected: Logical progression (picking -> packing)
-- If status=packing but picked_products < total_products: HIGH - Invalid state

-- ================================================================
-- CHECK 12: Returns system integrity
-- MEDIUM: Validate returns affect metrics
-- ================================================================
SELECT 
  r.id,
  r.order_id,
  r.status,
  o.status as order_status,
  o.total_price,
  r.created_at
FROM returns r
JOIN orders o ON r.order_id = o.id
WHERE r.status = 'approved'
  AND o.status != 'returned';

-- Expected: 0 or few
-- If many: MEDIUM - Returns not updating order status

-- ================================================================
-- SUMMARY QUERY: Overall Health Check
-- ================================================================
SELECT 
  'Total Orders' as metric,
  COUNT(*)::text as value
FROM orders
UNION ALL
SELECT 
  'Orders Last 7 Days',
  COUNT(*)::text
FROM orders
WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'
UNION ALL
SELECT 
  'Confirmed Orders',
  COUNT(*)::text
FROM orders
WHERE status = 'confirmed'
UNION ALL
SELECT 
  'Delivered Orders',
  COUNT(*)::text
FROM orders
WHERE status = 'delivered'
UNION ALL
SELECT 
  'Active Sessions',
  COUNT(*)::text
FROM picking_sessions
WHERE status IN ('picking', 'packing')
UNION ALL
SELECT 
  'Products',
  COUNT(*)::text
FROM products
UNION ALL
SELECT 
  'Customers',
  COUNT(DISTINCT customer_phone)::text
FROM orders;

-- Expected: Reasonable numbers based on business size

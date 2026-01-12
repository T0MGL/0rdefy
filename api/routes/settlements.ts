import { Router, Response } from 'express';
import { supabaseAdmin } from '../db/connection';
import { verifyToken, extractStoreId, AuthRequest } from '../middleware/auth';
import { extractUserRole, requireModule, PermissionRequest } from '../middleware/permissions';
import { requireFeature } from '../middleware/planLimits';
import { Module } from '../permissions';
import * as settlementsService from '../services/settlements.service';

export const settlementsRouter = Router();

// All routes require authentication and store context
settlementsRouter.use(verifyToken);
settlementsRouter.use(extractStoreId);
settlementsRouter.use(extractUserRole);
// Settlements are related to carriers module
settlementsRouter.use(requireModule(Module.CARRIERS));

// Apply plan feature check - settlements requires warehouse feature (Starter+ plan)
settlementsRouter.use(requireFeature('warehouse'));

// ================================================================
// GET /api/settlements - List all settlements
// Query params: date, carrier_id, status, limit, offset
// ================================================================
settlementsRouter.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const { date, carrier_id, status, limit = '50', offset = '0' } = req.query;

    console.log('💰 [SETTLEMENTS] Fetching settlements:', {
      store_id: req.storeId,
      date,
      carrier_id,
      status
    });

    let query = supabaseAdmin
      .from('daily_settlements')
      .select(`
        *,
        carriers(name),
        users(name)
      `, { count: 'exact' })
      .eq('store_id', req.storeId)
      .order('settlement_date', { ascending: false });

    if (date) {
      query = query.eq('settlement_date', date);
    }

    if (carrier_id) {
      query = query.eq('carrier_id', carrier_id);
    }

    if (status) {
      query = query.eq('status', status);
    }

    query = query.range(
      parseInt(offset as string),
      parseInt(offset as string) + parseInt(limit as string) - 1
    );

    const { data, error, count } = await query;

    if (error) {
      console.error('❌ [SETTLEMENTS] Error:', error);
      return res.status(500).json({ error: 'Failed to fetch settlements' });
    }

    res.json({
      data,
      pagination: {
        total: count || 0,
        limit: parseInt(limit as string),
        offset: parseInt(offset as string),
        hasMore: count ? count > parseInt(offset as string) + parseInt(limit as string) : false
      }
    });
  } catch (error: any) {
    console.error('💥 [SETTLEMENTS] Unexpected error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ================================================================
// GET /api/settlements/today - Get today's settlement
// ================================================================
settlementsRouter.get('/today', async (req: AuthRequest, res: Response) => {
  try {
    const { carrier_id } = req.query;
    const today = new Date().toISOString().split('T')[0];

    console.log('📅 [SETTLEMENTS] Fetching today settlement:', { today, carrier_id });

    let query = supabaseAdmin
      .from('daily_settlements')
      .select(`
        *,
        carriers(name),
        users(name)
      `)
      .eq('store_id', req.storeId)
      .eq('settlement_date', today);

    if (carrier_id) {
      query = query.eq('carrier_id', carrier_id);
    }

    const { data, error } = await query;

    if (error) {
      console.error('❌ [SETTLEMENTS] Error:', error);
      return res.status(500).json({ error: 'Failed to fetch today settlement' });
    }

    // Get delivered orders for today
    const { data: deliveredOrders, error: ordersError } = await supabaseAdmin
      .from('orders')
      .select('id, shopify_order_number, customer_first_name, customer_last_name, total_price, payment_status')
      .eq('store_id', req.storeId)
      .eq('sleeves_status', 'delivered')
      .gte('updated_at', today)
      .lt('updated_at', new Date(new Date().setDate(new Date().getDate() + 1)).toISOString().split('T')[0]);

    if (ordersError) {
      console.error('⚠️ [SETTLEMENTS] Error fetching orders:', ordersError);
    }

    res.json({
      settlement: data && data.length > 0 ? data[0] : null,
      delivered_orders: deliveredOrders || [],
      expected_cash: deliveredOrders?.reduce((sum, o) => sum + Number(o.total_price || 0), 0) || 0
    });
  } catch (error: any) {
    console.error('💥 [SETTLEMENTS] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ================================================================
// DISPATCH SESSIONS - New dispatch/settlement workflow
// IMPORTANT: These routes MUST be defined BEFORE /:id to avoid conflicts
// ================================================================

/**
 * GET /api/settlements/orders-to-dispatch
 * Get orders ready to be dispatched (confirmed status, not in any dispatch session)
 */
settlementsRouter.get('/orders-to-dispatch', async (req: AuthRequest, res: Response) => {
  try {
    const { carrier_id } = req.query;

    const result = await settlementsService.getOrdersToDispatch(
      req.storeId!,
      carrier_id as string
    );

    res.json(result);
  } catch (error: any) {
    console.error('❌ [DISPATCH] Error fetching orders to dispatch:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/settlements/dispatch-sessions
 * List all dispatch sessions
 */
settlementsRouter.get('/dispatch-sessions', async (req: AuthRequest, res: Response) => {
  try {
    const { status, carrier_id, start_date, end_date, limit, offset } = req.query;

    const result = await settlementsService.getDispatchSessions(req.storeId!, {
      status: status as string,
      carrierId: carrier_id as string,
      startDate: start_date as string,
      endDate: end_date as string,
      limit: limit ? parseInt(limit as string) : undefined,
      offset: offset ? parseInt(offset as string) : undefined
    });

    res.json(result);
  } catch (error: any) {
    console.error('❌ [DISPATCH] Error fetching dispatch sessions:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/settlements/dispatch-sessions/:id
 * Get dispatch session by ID with orders
 */
settlementsRouter.get('/dispatch-sessions/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const session = await settlementsService.getDispatchSessionById(id, req.storeId!);
    res.json(session);
  } catch (error: any) {
    console.error('❌ [DISPATCH] Error fetching dispatch session:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/settlements/dispatch-sessions
 * Create new dispatch session with orders
 */
settlementsRouter.post('/dispatch-sessions', async (req: AuthRequest, res: Response) => {
  try {
    const { carrier_id, order_ids } = req.body;

    if (!carrier_id) {
      return res.status(400).json({ error: 'carrier_id is required' });
    }
    if (!order_ids || !Array.isArray(order_ids) || order_ids.length === 0) {
      return res.status(400).json({ error: 'order_ids array is required' });
    }

    console.log('📦 [DISPATCH] Creating dispatch session:', {
      carrier_id,
      order_count: order_ids.length
    });

    const session = await settlementsService.createDispatchSession(
      req.storeId!,
      carrier_id,
      order_ids,
      req.userId!
    );

    console.log('✅ [DISPATCH] Session created:', session.session_code);

    res.status(201).json(session);
  } catch (error: any) {
    console.error('❌ [DISPATCH] Error creating dispatch session:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/settlements/dispatch-sessions/:id/export
 * Export dispatch session as CSV for courier
 */
settlementsRouter.get('/dispatch-sessions/:id/export', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const csv = await settlementsService.exportDispatchCSV(id, req.storeId!);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="despacho-${id}.csv"`);
    res.send('\uFEFF' + csv); // Add BOM for Excel UTF-8 compatibility
  } catch (error: any) {
    console.error('❌ [DISPATCH] Error exporting CSV:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/settlements/dispatch-sessions/:id/import
 * Import delivery results from CSV
 */
settlementsRouter.post('/dispatch-sessions/:id/import', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { results } = req.body;

    if (!results || !Array.isArray(results)) {
      return res.status(400).json({ error: 'results array is required' });
    }

    console.log('📥 [DISPATCH] Importing results for session:', id, 'rows:', results.length);

    const importResult = await settlementsService.importDispatchResults(id, req.storeId!, results);

    console.log('✅ [DISPATCH] Import complete:', importResult);

    res.json(importResult);
  } catch (error: any) {
    console.error('❌ [DISPATCH] Error importing results:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/settlements/dispatch-sessions/:id/process
 * Process dispatch session and create settlement
 */
settlementsRouter.post('/dispatch-sessions/:id/process', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    console.log('💰 [DISPATCH] Processing settlement for session:', id);

    const settlement = await settlementsService.processSettlement(id, req.storeId!, req.userId!);

    console.log('✅ [DISPATCH] Settlement created:', settlement.settlement_code);

    res.status(201).json(settlement);
  } catch (error: any) {
    console.error('❌ [DISPATCH] Error processing settlement:', error);
    res.status(500).json({ error: error.message });
  }
});

// ================================================================
// DAILY SETTLEMENTS (NEW v2) - Enhanced endpoints
// ================================================================

/**
 * GET /api/settlements/v2
 * List all daily settlements with enhanced info
 */
settlementsRouter.get('/v2', async (req: AuthRequest, res: Response) => {
  try {
    const { status, carrier_id, start_date, end_date, limit, offset } = req.query;

    const result = await settlementsService.getDailySettlements(req.storeId!, {
      status: status as string,
      carrierId: carrier_id as string,
      startDate: start_date as string,
      endDate: end_date as string,
      limit: limit ? parseInt(limit as string) : undefined,
      offset: offset ? parseInt(offset as string) : undefined
    });

    res.json(result);
  } catch (error: any) {
    console.error('❌ [SETTLEMENTS V2] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/settlements/v2/:id
 * Get settlement by ID with full details
 */
settlementsRouter.get('/v2/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const settlement = await settlementsService.getSettlementById(id, req.storeId!);
    res.json(settlement);
  } catch (error: any) {
    console.error('❌ [SETTLEMENTS V2] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/settlements/v2/:id/pay
 * Record payment for settlement
 */
settlementsRouter.post('/v2/:id/pay', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { amount, method, reference, notes } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Valid amount is required' });
    }
    if (!method) {
      return res.status(400).json({ error: 'Payment method is required' });
    }

    const settlement = await settlementsService.markSettlementPaid(id, req.storeId!, {
      amount,
      method,
      reference,
      notes
    });

    console.log('✅ [SETTLEMENTS V2] Payment recorded:', id, amount);

    res.json(settlement);
  } catch (error: any) {
    console.error('❌ [SETTLEMENTS V2] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ================================================================
// CARRIER ZONES
// ================================================================

/**
 * GET /api/settlements/zones
 * Get all carrier zones
 */
settlementsRouter.get('/zones', async (req: AuthRequest, res: Response) => {
  try {
    const { carrier_id } = req.query;

    const zones = await settlementsService.getCarrierZones(
      req.storeId!,
      carrier_id as string
    );

    res.json(zones);
  } catch (error: any) {
    console.error('❌ [ZONES] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/settlements/zones
 * Create or update carrier zone
 */
settlementsRouter.post('/zones', async (req: AuthRequest, res: Response) => {
  try {
    const { carrier_id, zone_name, zone_code, rate, is_active } = req.body;

    if (!carrier_id) {
      return res.status(400).json({ error: 'carrier_id is required' });
    }
    if (!zone_name) {
      return res.status(400).json({ error: 'zone_name is required' });
    }
    if (rate === undefined || rate < 0) {
      return res.status(400).json({ error: 'Valid rate is required' });
    }

    const zone = await settlementsService.upsertCarrierZone(req.storeId!, carrier_id, {
      zone_name,
      zone_code,
      rate,
      is_active
    });

    console.log('✅ [ZONES] Zone created/updated:', zone_name, rate);

    res.status(201).json(zone);
  } catch (error: any) {
    console.error('❌ [ZONES] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/settlements/zones/bulk
 * Bulk import carrier zones (from Excel)
 */
settlementsRouter.post('/zones/bulk', async (req: AuthRequest, res: Response) => {
  try {
    const { carrier_id, zones } = req.body;

    if (!carrier_id) {
      return res.status(400).json({ error: 'carrier_id is required' });
    }
    if (!zones || !Array.isArray(zones) || zones.length === 0) {
      return res.status(400).json({ error: 'zones array is required' });
    }

    console.log('📥 [ZONES] Bulk importing zones for carrier:', carrier_id, 'count:', zones.length);

    const result = await settlementsService.bulkUpsertCarrierZones(req.storeId!, carrier_id, zones);

    console.log('✅ [ZONES] Bulk import complete:', result);

    res.json(result);
  } catch (error: any) {
    console.error('❌ [ZONES] Bulk import error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/settlements/zones/:id
 * Delete carrier zone
 */
settlementsRouter.delete('/zones/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    await settlementsService.deleteCarrierZone(id, req.storeId!);

    console.log('🗑️ [ZONES] Zone deleted:', id);

    res.json({ success: true });
  } catch (error: any) {
    console.error('❌ [ZONES] Delete error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ================================================================
// MANUAL RECONCILIATION FLOW (must be before /:id)
// ================================================================

/**
 * GET /api/settlements/shipped-orders-grouped - Get shipped orders grouped by carrier/date
 * For the new manual reconciliation flow
 */
settlementsRouter.get('/shipped-orders-grouped', async (req: AuthRequest, res: Response) => {
  try {
    console.log('📦 [SETTLEMENTS] Fetching shipped orders grouped by carrier/date');

    const groups = await settlementsService.getShippedOrdersGrouped(req.storeId!);

    res.json({ data: groups });
  } catch (error: any) {
    console.error('💥 [SETTLEMENTS] Error fetching grouped orders:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * POST /api/settlements/manual-reconciliation - Process manual reconciliation
 * Without CSV - using checkbox UI
 */
settlementsRouter.post('/manual-reconciliation', async (req: AuthRequest, res: Response) => {
  try {
    const { carrier_id, dispatch_date, orders, total_amount_collected, discrepancy_notes, confirm_discrepancy } = req.body;

    console.log('📝 [SETTLEMENTS] Processing manual reconciliation:', {
      carrier_id,
      dispatch_date,
      orders_count: orders?.length,
      total_amount_collected
    });

    if (!carrier_id || !dispatch_date || !orders || !Array.isArray(orders)) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (total_amount_collected === undefined || total_amount_collected === null) {
      return res.status(400).json({ error: 'total_amount_collected is required' });
    }

    const settlement = await settlementsService.processManualReconciliation(
      req.storeId!,
      req.userId!,
      {
        carrier_id,
        dispatch_date,
        orders,
        total_amount_collected,
        discrepancy_notes,
        confirm_discrepancy: confirm_discrepancy || false
      }
    );

    console.log('✅ [SETTLEMENTS] Manual reconciliation completed:', settlement.settlement_code);

    res.json({ data: settlement });
  } catch (error: any) {
    console.error('💥 [SETTLEMENTS] Error in manual reconciliation:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ================================================================
// ANALYTICS / DASHBOARD
// ================================================================

/**
 * GET /api/settlements/summary/v2
 * Get enhanced settlements summary for dashboard
 */
settlementsRouter.get('/summary/v2', async (req: AuthRequest, res: Response) => {
  try {
    const { start_date, end_date } = req.query;

    const summary = await settlementsService.getSettlementsSummary(
      req.storeId!,
      start_date as string,
      end_date as string
    );

    res.json(summary);
  } catch (error: any) {
    console.error('❌ [SETTLEMENTS] Summary error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/settlements/pending-by-carrier
 * Get pending balances grouped by carrier
 */
settlementsRouter.get('/pending-by-carrier', async (req: AuthRequest, res: Response) => {
  try {
    const pending = await settlementsService.getPendingByCarrier(req.storeId!);
    res.json(pending);
  } catch (error: any) {
    console.error('❌ [SETTLEMENTS] Pending by carrier error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ================================================================
// GET /api/settlements/stats - Get settlement statistics
// MUST be before /:id to avoid route conflicts
// ================================================================
settlementsRouter.get('/stats/summary', async (req: AuthRequest, res: Response) => {
  try {
    const { start_date, end_date } = req.query;

    console.log('📊 [SETTLEMENTS] Fetching stats');

    let query = supabaseAdmin
      .from('daily_settlements')
      .select('expected_cash, collected_cash, status')
      .eq('store_id', req.storeId);

    if (start_date) {
      query = query.gte('settlement_date', start_date);
    }

    if (end_date) {
      query = query.lte('settlement_date', end_date);
    }

    const { data, error } = await query;

    if (error) {
      console.error('❌ [SETTLEMENTS] Error:', error);
      return res.status(500).json({ error: 'Failed to fetch stats' });
    }

    const stats = {
      total_expected: data?.reduce((sum, s) => sum + Number(s.expected_cash || 0), 0) || 0,
      total_collected: data?.reduce((sum, s) => sum + Number(s.collected_cash || 0), 0) || 0,
      total_difference: 0,
      pending_count: data?.filter(s => s.status === 'pending').length || 0,
      completed_count: data?.filter(s => s.status === 'completed').length || 0,
      with_issues_count: data?.filter(s => s.status === 'with_issues').length || 0
    };

    stats.total_difference = stats.total_collected - stats.total_expected;

    res.json(stats);
  } catch (error: any) {
    console.error('💥 [SETTLEMENTS] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ================================================================
// GET /api/settlements/:id - Get single settlement with orders
// IMPORTANT: This MUST be AFTER all specific routes to avoid conflicts
// ================================================================
settlementsRouter.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const { data: settlement, error: settlementError } = await supabaseAdmin
      .from('daily_settlements')
      .select(`
        *,
        carriers(name),
        users(name)
      `)
      .eq('id', id)
      .eq('store_id', req.storeId)
      .single();

    if (settlementError || !settlement) {
      return res.status(404).json({ error: 'Settlement not found' });
    }

    // Get settlement orders
    const { data: orders, error: ordersError } = await supabaseAdmin
      .from('settlement_orders')
      .select(`
        *,
        orders(shopify_order_number, customer_first_name, customer_last_name, total_price)
      `)
      .eq('settlement_id', id);

    if (ordersError) {
      console.error('⚠️ [SETTLEMENTS] Error fetching orders:', ordersError);
    }

    res.json({
      ...settlement,
      orders: orders || []
    });
  } catch (error: any) {
    console.error('💥 [SETTLEMENTS] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ================================================================
// POST /api/settlements - Create new settlement
// ================================================================
settlementsRouter.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const {
      settlement_date,
      carrier_id,
      order_ids = [],
      notes
    } = req.body;

    if (!settlement_date) {
      return res.status(400).json({ error: 'settlement_date is required' });
    }

    console.log('💰 [SETTLEMENTS] Creating settlement:', {
      settlement_date,
      carrier_id,
      orders_count: order_ids.length
    });

    // Calculate expected cash from order IDs
    let expected_cash = 0;
    if (order_ids.length > 0) {
      const { data: orders } = await supabaseAdmin
        .from('orders')
        .select('id, total_price')
        .eq('store_id', req.storeId)
        .in('id', order_ids);

      expected_cash = orders?.reduce((sum, o) => sum + Number(o.total_price || 0), 0) || 0;
    }

    // Create settlement
    const insertData: any = {
      store_id: req.storeId,
      settlement_date,
      expected_cash,
      collected_cash: 0,
      status: 'pending',
      notes,
    };

    // Only add settled_by if userId is available and is a valid UUID
    if (req.userId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.userId)) {
      insertData.settled_by = req.userId;
    }

    // Only add carrier_id if provided and is a valid UUID
    if (carrier_id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(carrier_id)) {
      insertData.carrier_id = carrier_id;
    }

    const { data: settlement, error: settlementError } = await supabaseAdmin
      .from('daily_settlements')
      .insert(insertData)
      .select()
      .single();

    if (settlementError || !settlement) {
      console.error('❌ [SETTLEMENTS] Error creating:', settlementError);
      return res.status(500).json({
        error: 'Failed to create settlement',
        message: settlementError?.message || 'Unknown error',
        details: settlementError?.details || settlementError?.hint || null
      });
    }

    // Link orders to settlement
    if (order_ids.length > 0) {
      const { data: orders } = await supabaseAdmin
        .from('orders')
        .select('id, total_price')
        .eq('store_id', req.storeId)
        .in('id', order_ids);

      const settlementOrders = orders?.map(order => ({
        settlement_id: settlement.id,
        order_id: order.id,
        amount: order.total_price
      })) || [];

      const { error: linkError } = await supabaseAdmin
        .from('settlement_orders')
        .insert(settlementOrders);

      if (linkError) {
        console.error('⚠️ [SETTLEMENTS] Error linking orders:', linkError);
      }
    }

    console.log('✅ [SETTLEMENTS] Created:', settlement.id);

    res.status(201).json({
      message: 'Settlement created',
      data: settlement
    });
  } catch (error: any) {
    console.error('💥 [SETTLEMENTS] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ================================================================
// PUT /api/settlements/:id - Update settlement
// ================================================================
settlementsRouter.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Remove fields that shouldn't be updated
    delete updates.id;
    delete updates.store_id;
    delete updates.created_at;
    delete updates.difference; // This is a generated column

    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from('daily_settlements')
      .update(updates)
      .eq('id', id)
      .eq('store_id', req.storeId)
      .select()
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Settlement not found' });
    }

    console.log('✅ [SETTLEMENTS] Updated:', id);

    res.json({
      message: 'Settlement updated',
      data
    });
  } catch (error: any) {
    console.error('💥 [SETTLEMENTS] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ================================================================
// POST /api/settlements/:id/complete - Complete/close settlement
// ================================================================
settlementsRouter.post('/:id/complete', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { collected_cash, notes } = req.body;

    if (collected_cash === undefined || collected_cash === null) {
      return res.status(400).json({ error: 'collected_cash is required' });
    }

    console.log('✅ [SETTLEMENTS] Completing settlement:', id);

    const { data, error } = await supabaseAdmin
      .from('daily_settlements')
      .update({
        collected_cash: Number(collected_cash),
        status: 'completed',
        notes: notes || null,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .eq('store_id', req.storeId)
      .select()
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Settlement not found' });
    }

    const difference = Number(collected_cash) - Number(data.expected_cash);

    console.log('💰 [SETTLEMENTS] Completed:', {
      id,
      expected: data.expected_cash,
      collected: collected_cash,
      difference
    });

    res.json({
      message: 'Settlement completed',
      data: {
        ...data,
        difference
      }
    });
  } catch (error: any) {
    console.error('💥 [SETTLEMENTS] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ================================================================
// DELETE /api/settlements/:id - Delete settlement
// ================================================================
settlementsRouter.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    // Delete settlement (cascade will delete settlement_orders)
    const { error } = await supabaseAdmin
      .from('daily_settlements')
      .delete()
      .eq('id', id)
      .eq('store_id', req.storeId);

    if (error) {
      console.error('❌ [SETTLEMENTS] Error deleting:', error);
      return res.status(500).json({ error: 'Failed to delete settlement' });
    }

    console.log('🗑️ [SETTLEMENTS] Deleted:', id);

    res.json({ message: 'Settlement deleted' });
  } catch (error: any) {
    console.error('💥 [SETTLEMENTS] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

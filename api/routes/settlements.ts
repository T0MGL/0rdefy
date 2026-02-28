import { Router, Response } from 'express';
import { supabaseAdmin } from '../db/connection';
import { verifyToken, extractStoreId, AuthRequest } from '../middleware/auth';
import { extractUserRole, requireModule, requirePermission, PermissionRequest } from '../middleware/permissions';
import { requireFeature } from '../middleware/planLimits';
import { Module, Permission } from '../permissions';
import * as settlementsService from '../services/settlements.service';
import { getTodayInTimezone } from '../utils/dateUtils';
import { logger } from '../utils/logger';
import { parsePagination } from '../utils/sanitize';

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
    const { date, carrier_id, status, limit: rawLimit = '50', offset: rawOffset = '0' } = req.query;
    const { limit, offset } = parsePagination(rawLimit, rawOffset);

    logger.info('SETTLEMENTS', 'Fetching settlements', {
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

    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) {
      logger.error('SETTLEMENTS', 'Error fetching settlements', error);
      return res.status(500).json({ error: 'Error al obtener liquidaciones' });
    }

    res.json({
      data,
      pagination: {
        total: count || 0,
        limit,
        offset,
        hasMore: count ? count > offset + limit : false
      }
    });
  } catch (error: any) {
    logger.error('SETTLEMENTS', 'Unexpected error', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ================================================================
// GET /api/settlements/today - Get today's settlement
// ================================================================
settlementsRouter.get('/today', async (req: AuthRequest, res: Response) => {
  try {
    const { carrier_id } = req.query;
    const today = getTodayInTimezone();

    logger.info('SETTLEMENTS', 'Fetching today settlement', { today, carrier_id });

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
      logger.error('❌ [SETTLEMENTS] Error:', error);
      return res.status(500).json({ error: 'Error al obtener liquidación de hoy' });
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
      logger.error('⚠️ [SETTLEMENTS] Error fetching orders:', ordersError);
    }

    res.json({
      settlement: data && data.length > 0 ? data[0] : null,
      delivered_orders: deliveredOrders || [],
      expected_cash: deliveredOrders?.reduce((sum, o) => sum + Number(o.total_price || 0), 0) || 0
    });
  } catch (error: any) {
    logger.error('💥 [SETTLEMENTS] Error:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
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
    logger.error('❌ [DISPATCH] Error fetching orders to dispatch:', error);
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
      limit: limit ? parseInt(limit as string, 10) : undefined,
      offset: offset ? parseInt(offset as string, 10) : undefined
    });

    res.json(result);
  } catch (error: any) {
    logger.error('❌ [DISPATCH] Error fetching dispatch sessions:', error);
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
    logger.error('❌ [DISPATCH] Error fetching dispatch session:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/settlements/dispatch-sessions
 * Create new dispatch session with orders
 */
settlementsRouter.post('/dispatch-sessions', requirePermission(Module.CARRIERS, Permission.CREATE), async (req: PermissionRequest, res: Response) => {
  try {
    const { carrier_id, order_ids } = req.body;

    if (!carrier_id) {
      return res.status(400).json({ error: 'Se requiere carrier_id' });
    }
    if (!order_ids || !Array.isArray(order_ids) || order_ids.length === 0) {
      return res.status(400).json({ error: 'Se requiere el array de order_ids' });
    }

    logger.info('DISPATCH', 'Creating dispatch session', {
      carrier_id,
      order_count: order_ids.length
    });

    const session = await settlementsService.createDispatchSession(
      req.storeId!,
      carrier_id,
      order_ids,
      req.userId!
    );

    logger.info('DISPATCH', 'Session created', { session_code: session.session_code });

    res.status(201).json(session);
  } catch (error: any) {
    logger.error('❌ [DISPATCH] Error creating dispatch session:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/settlements/dispatch-sessions/:id/export
 * Export dispatch session as Excel or CSV for courier
 * Query param: format=xlsx (default) or format=csv
 */
settlementsRouter.get('/dispatch-sessions/:id/export', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const format = (req.query.format as string)?.toLowerCase() || 'xlsx';

    if (format === 'csv') {
      // Legacy CSV export
      const csv = await settlementsService.exportDispatchCSV(id, req.storeId!);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="despacho-${id}.csv"`);
      res.send('\uFEFF' + csv); // Add BOM for Excel UTF-8 compatibility
    } else {
      // Professional Excel export (default)
      const excelBuffer = await settlementsService.exportDispatchExcel(id, req.storeId!);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="despacho-${id}.xlsx"`);
      res.send(excelBuffer);
    }
  } catch (error: any) {
    logger.error('❌ [DISPATCH] Error exporting:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/settlements/dispatch-sessions/:id/import
 * Import delivery results from CSV
 */
settlementsRouter.post('/dispatch-sessions/:id/import', requirePermission(Module.CARRIERS, Permission.EDIT), async (req: PermissionRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { results } = req.body;

    if (!results || !Array.isArray(results)) {
      return res.status(400).json({ error: 'Se requiere el array de resultados' });
    }

    logger.info('DISPATCH', 'Importing results for session', { id, rows: results.length });

    const importResult = await settlementsService.importDispatchResults(id, req.storeId!, results);

    logger.info('DISPATCH', 'Import complete', importResult);

    res.json(importResult);
  } catch (error: any) {
    logger.error('❌ [DISPATCH] Error importing results:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/settlements/dispatch-sessions/:id/process
 * Process dispatch session and create settlement
 */
settlementsRouter.post('/dispatch-sessions/:id/process', requirePermission(Module.CARRIERS, Permission.EDIT), async (req: PermissionRequest, res: Response) => {
  try {
    const { id } = req.params;

    logger.info('DISPATCH', 'Processing settlement for session', { id });

    const settlement = await settlementsService.processSettlement(id, req.storeId!, req.userId!);

    logger.info('DISPATCH', 'Settlement created', { settlement_code: settlement.settlement_code });

    res.status(201).json(settlement);
  } catch (error: any) {
    logger.error('❌ [DISPATCH] Error processing settlement:', error);
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
      limit: limit ? parseInt(limit as string, 10) : undefined,
      offset: offset ? parseInt(offset as string, 10) : undefined
    });

    res.json(result);
  } catch (error: any) {
    logger.error('❌ [SETTLEMENTS V2] Error:', error);
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
    logger.error('❌ [SETTLEMENTS V2] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/settlements/v2/:id/pay
 * Record payment for settlement
 */
settlementsRouter.post('/v2/:id/pay', requirePermission(Module.CARRIERS, Permission.EDIT), async (req: PermissionRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { amount, method, reference, notes } = req.body;

    // Validate amount is a finite positive number
    if (typeof amount !== 'number' || !isFinite(amount) || isNaN(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Se requiere un monto válido (número positivo)' });
    }
    if (amount > 999999999) {
      return res.status(400).json({ error: 'Monto excede el límite permitido' });
    }
    if (!method) {
      return res.status(400).json({ error: 'Se requiere el método de pago' });
    }

    const settlement = await settlementsService.markSettlementPaid(id, req.storeId!, {
      amount,
      method,
      reference,
      notes
    });

    logger.info('SETTLEMENTS', 'Payment recorded', { id, amount });

    res.json(settlement);
  } catch (error: any) {
    logger.error('❌ [SETTLEMENTS V2] Error:', error);
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
    logger.error('❌ [ZONES] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/settlements/zones
 * Create or update carrier zone
 */
settlementsRouter.post('/zones', requirePermission(Module.CARRIERS, Permission.CREATE), async (req: PermissionRequest, res: Response) => {
  try {
    const { carrier_id, zone_name, zone_code, rate, is_active } = req.body;

    if (!carrier_id) {
      return res.status(400).json({ error: 'Se requiere carrier_id' });
    }
    if (!zone_name) {
      return res.status(400).json({ error: 'Se requiere zone_name' });
    }
    if (rate === undefined || rate < 0) {
      return res.status(400).json({ error: 'Se requiere una tarifa válida' });
    }

    const zone = await settlementsService.upsertCarrierZone(req.storeId!, carrier_id, {
      zone_name,
      zone_code,
      rate,
      is_active
    });

    logger.info('✅ [ZONES] Zone created/updated:', zone_name, rate);

    res.status(201).json(zone);
  } catch (error: any) {
    logger.error('❌ [ZONES] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/settlements/zones/bulk
 * Bulk import carrier zones (from Excel)
 */
settlementsRouter.post('/zones/bulk', requirePermission(Module.CARRIERS, Permission.CREATE), async (req: PermissionRequest, res: Response) => {
  try {
    const { carrier_id, zones } = req.body;

    if (!carrier_id) {
      return res.status(400).json({ error: 'Se requiere carrier_id' });
    }
    if (!zones || !Array.isArray(zones) || zones.length === 0) {
      return res.status(400).json({ error: 'Se requiere el array de zonas' });
    }

    logger.info('📥 [ZONES] Bulk importing zones for carrier:', carrier_id, 'count:', zones.length);

    const result = await settlementsService.bulkUpsertCarrierZones(req.storeId!, carrier_id, zones);

    logger.info('✅ [ZONES] Bulk import complete:', result);

    res.json(result);
  } catch (error: any) {
    logger.error('❌ [ZONES] Bulk import error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/settlements/zones/:id
 * Delete carrier zone
 */
settlementsRouter.delete('/zones/:id', requirePermission(Module.CARRIERS, Permission.DELETE), async (req: PermissionRequest, res: Response) => {
  try {
    const { id } = req.params;

    await settlementsService.deleteCarrierZone(id, req.storeId!);

    logger.info('🗑️ [ZONES] Zone deleted:', id);

    res.json({ success: true });
  } catch (error: any) {
    logger.error('❌ [ZONES] Delete error:', error);
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
    logger.info('📦 [SETTLEMENTS] Fetching shipped orders grouped by carrier/date');

    const groups = await settlementsService.getShippedOrdersGrouped(req.storeId!);

    res.json({ data: groups });
  } catch (error: any) {
    logger.error('💥 [SETTLEMENTS] Error fetching grouped orders:', error);
    res.status(500).json({ error: error.message || 'Error interno del servidor' });
  }
});

// ================================================================
// DELIVERY-BASED RECONCILIATION (NEW SIMPLIFIED FLOW)
// Groups by delivery date instead of dispatch date
// ================================================================

/**
 * GET /api/settlements/pending-reconciliation - Get delivered orders pending reconciliation
 * Grouped by delivery date and carrier for simpler UX
 */
settlementsRouter.get('/pending-reconciliation', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.storeId) {
      return res.status(401).json({ error: 'Store ID requerido' });
    }

    logger.info('📅 [SETTLEMENTS] Fetching pending reconciliation (delivery-based)', {
      store_id: req.storeId
    });

    const groups = await settlementsService.getPendingReconciliation(req.storeId);

    logger.info('📅 [SETTLEMENTS] Pending reconciliation fetched', {
      store_id: req.storeId,
      groups_count: groups.length
    });

    res.json({ data: groups });
  } catch (error: any) {
    logger.error('💥 [SETTLEMENTS] Error fetching pending reconciliation:', {
      error: error.message,
      stack: error.stack,
      store_id: req.storeId
    });
    res.status(500).json({ error: 'Error al obtener conciliaciones pendientes' });
  }
});

/**
 * GET /api/settlements/pending-reconciliation/:date/:carrierId - Get orders for specific date/carrier
 */
settlementsRouter.get('/pending-reconciliation/:date/:carrierId', async (req: AuthRequest, res: Response) => {
  try {
    const { date, carrierId } = req.params;

    // Validate store ID
    if (!req.storeId) {
      return res.status(401).json({ error: 'Store ID requerido' });
    }

    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!date || !dateRegex.test(date)) {
      return res.status(400).json({ error: 'Formato de fecha invalido. Use YYYY-MM-DD' });
    }

    // Validate date is a real date
    const parsedDate = new Date(date);
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({ error: 'Fecha invalida' });
    }

    // Validate carrier ID is UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!carrierId || !uuidRegex.test(carrierId)) {
      return res.status(400).json({ error: 'ID de transportadora invalido' });
    }

    logger.info('📦 [SETTLEMENTS] Fetching orders for reconciliation:', {
      store_id: req.storeId,
      date,
      carrier_id: carrierId
    });

    const orders = await settlementsService.getPendingReconciliationOrders(
      req.storeId,
      carrierId,
      date
    );

    logger.info('📦 [SETTLEMENTS] Orders fetched for reconciliation', {
      store_id: req.storeId,
      date,
      carrier_id: carrierId,
      orders_count: orders.length
    });

    res.json({ data: orders });
  } catch (error: any) {
    logger.error('💥 [SETTLEMENTS] Error fetching reconciliation orders:', {
      error: error.message,
      stack: error.stack,
      store_id: req.storeId,
      params: req.params
    });
    res.status(500).json({ error: 'Error al obtener pedidos para conciliacion' });
  }
});

/**
 * POST /api/settlements/reconcile-delivery - Process delivery-based reconciliation
 * Simpler flow: just date, carrier, and order results
 */
settlementsRouter.post('/reconcile-delivery', requirePermission(Module.CARRIERS, Permission.EDIT), async (req: PermissionRequest, res: Response) => {
  try {
    const { carrier_id, delivery_date, orders, total_amount_collected, discrepancy_notes } = req.body;

    // Validate store ID and user ID
    if (!req.storeId || !req.userId) {
      return res.status(401).json({ error: 'Autenticacion requerida' });
    }

    // Validate carrier_id is UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!carrier_id || !uuidRegex.test(carrier_id)) {
      return res.status(400).json({ error: 'ID de transportadora invalido' });
    }

    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!delivery_date || !dateRegex.test(delivery_date)) {
      return res.status(400).json({ error: 'Formato de fecha invalido. Use YYYY-MM-DD' });
    }

    // Validate date is a real date
    const parsedDate = new Date(delivery_date);
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({ error: 'Fecha invalida' });
    }

    // Validate orders array
    if (!orders || !Array.isArray(orders) || orders.length === 0) {
      return res.status(400).json({ error: 'Se requiere al menos una orden' });
    }

    // Limit orders per request to prevent DoS
    if (orders.length > 500) {
      return res.status(400).json({ error: 'Maximo 500 ordenes por conciliacion' });
    }

    // Validate each order has required fields and valid UUID
    for (let i = 0; i < orders.length; i++) {
      const order = orders[i];
      if (!order.order_id || !uuidRegex.test(order.order_id)) {
        return res.status(400).json({ error: `Orden ${i + 1}: ID de orden invalido` });
      }
      if (typeof order.delivered !== 'boolean') {
        return res.status(400).json({ error: `Orden ${i + 1}: Campo 'delivered' debe ser booleano` });
      }
    }

    // Validate total_amount_collected
    if (total_amount_collected === undefined || total_amount_collected === null) {
      return res.status(400).json({ error: 'Se requiere monto total cobrado' });
    }

    const amountCollected = Number(total_amount_collected);
    if (isNaN(amountCollected) || !isFinite(amountCollected) || amountCollected < 0) {
      return res.status(400).json({ error: 'Monto total cobrado invalido' });
    }

    // Validate discrepancy_notes length if provided
    if (discrepancy_notes && discrepancy_notes.length > 1000) {
      return res.status(400).json({ error: 'Notas de discrepancia muy largas (max 1000 caracteres)' });
    }

    logger.info('✅ [SETTLEMENTS] Processing delivery reconciliation:', {
      store_id: req.storeId,
      user_id: req.userId,
      carrier_id,
      delivery_date,
      orders_count: orders.length,
      total_amount_collected: amountCollected
    });

    const result = await settlementsService.processDeliveryReconciliation(
      req.storeId,
      req.userId,
      {
        carrier_id,
        delivery_date,
        total_amount_collected: amountCollected,
        discrepancy_notes: discrepancy_notes?.substring(0, 1000),
        orders
      }
    );

    logger.info('✅ [SETTLEMENTS] Delivery reconciliation completed:', {
      store_id: req.storeId,
      settlement_id: result.settlement_id,
      settlement_code: result.settlement_code,
      total_orders: result.total_orders,
      total_delivered: result.total_delivered,
      net_receivable: result.net_receivable
    });

    res.json({
      message: 'Conciliacion completada',
      data: result,
      warnings: result.warnings || []
    });
  } catch (error: any) {
    logger.error('💥 [SETTLEMENTS] Error processing delivery reconciliation:', {
      error: error.message,
      stack: error.stack,
      store_id: req.storeId,
      body: {
        carrier_id: req.body?.carrier_id,
        delivery_date: req.body?.delivery_date,
        orders_count: req.body?.orders?.length
      }
    });

    // Return specific error message for known errors
    const msg = error.message || '';
    if (msg.includes('Carrier not found') || msg.includes('Transportadora no encontrada')) {
      return res.status(404).json({ error: 'Transportadora no encontrada' });
    }
    if (msg.includes('already reconciled') || msg.includes('ya fueron conciliados')) {
      return res.status(409).json({ error: msg });
    }
    if (msg.includes('no encontrados') || msg.includes('not found')) {
      return res.status(404).json({ error: msg });
    }
    if (msg.includes('No hay pedidos') || msg.includes('No valid orders')) {
      return res.status(400).json({ error: msg });
    }
    if (msg.includes('código duplicado') || msg.includes('unique_store_date_carrier')) {
      return res.status(409).json({ error: 'Ya existe una liquidación para esta transportadora en esta fecha. Contacte soporte si necesita crear otra.' });
    }

    res.status(500).json({ error: msg || 'Error al procesar la conciliacion' });
  }
});

/**
 * POST /api/settlements/manual-reconciliation - Process manual reconciliation
 * Without CSV - using checkbox UI
 */
settlementsRouter.post('/manual-reconciliation', requirePermission(Module.CARRIERS, Permission.EDIT), async (req: PermissionRequest, res: Response) => {
  try {
    const { carrier_id, dispatch_date, orders, total_amount_collected, discrepancy_notes, confirm_discrepancy } = req.body;

    logger.info('📝 [SETTLEMENTS] Processing manual reconciliation:', {
      carrier_id,
      dispatch_date,
      orders_count: orders?.length,
      total_amount_collected
    });

    if (!carrier_id || !dispatch_date || !orders || !Array.isArray(orders)) {
      return res.status(400).json({ error: 'Faltan campos requeridos' });
    }

    if (total_amount_collected === undefined || total_amount_collected === null) {
      return res.status(400).json({ error: 'Se requiere total_amount_collected' });
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

    logger.info('✅ [SETTLEMENTS] Manual reconciliation completed:', settlement.settlement_code);

    res.json({ data: settlement });
  } catch (error: any) {
    logger.error('💥 [SETTLEMENTS] Error in manual reconciliation:', error);
    res.status(500).json({ error: error.message || 'Error interno del servidor' });
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
    logger.error('❌ [SETTLEMENTS] Summary error:', error);
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
    logger.error('❌ [SETTLEMENTS] Pending by carrier error:', error);
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

    logger.info('📊 [SETTLEMENTS] Fetching stats');

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
      logger.error('❌ [SETTLEMENTS] Error:', error);
      return res.status(500).json({ error: 'Error al obtener estadísticas' });
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
    logger.error('💥 [SETTLEMENTS] Error:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ================================================================
// CARRIER ACCOUNT SYSTEM ENDPOINTS
// ================================================================
// Unified system for tracking money flow between store and carriers
// Works with both dispatch/CSV flow AND direct QR marking flow
// IMPORTANT: These routes MUST be BEFORE /:id to avoid route conflicts

// ================================================================
// GET /api/settlements/carrier-accounts - Get all carrier balances
// ================================================================
settlementsRouter.get('/carrier-accounts', async (req: AuthRequest, res: Response) => {
  try {
    logger.info('💰 [CARRIER ACCOUNTS] Fetching balances for store:', req.storeId);

    const balances = await settlementsService.getCarrierBalances(req.storeId!);

    res.json({ data: balances });
  } catch (error: any) {
    logger.error('💥 [CARRIER ACCOUNTS] Error:', error);
    res.status(500).json({ error: error.message || 'Error al obtener balances de transportadoras' });
  }
});

// ================================================================
// GET /api/settlements/carrier-accounts/summary - Get dashboard summary
// ================================================================
settlementsRouter.get('/carrier-accounts/summary', async (req: AuthRequest, res: Response) => {
  try {
    logger.info('💰 [CARRIER ACCOUNTS] Fetching summary for store:', req.storeId);

    const summary = await settlementsService.getCarrierAccountSummary(req.storeId!);

    res.json({ data: summary });
  } catch (error: any) {
    logger.error('💥 [CARRIER ACCOUNTS] Error:', error);
    res.status(500).json({ error: error.message || 'Error al obtener resumen de cuenta' });
  }
});

// ================================================================
// GET /api/settlements/carrier-accounts/:carrierId - Get carrier detail
// ================================================================
settlementsRouter.get('/carrier-accounts/:carrierId', async (req: AuthRequest, res: Response) => {
  try {
    const { carrierId } = req.params;
    const { from_date, to_date } = req.query;

    logger.info('💰 [CARRIER ACCOUNTS] Fetching detail for carrier:', carrierId);

    const [summary, config] = await Promise.all([
      settlementsService.getCarrierBalanceSummary(
        carrierId,
        from_date as string,
        to_date as string
      ),
      settlementsService.getCarrierConfig(carrierId, req.storeId!),
    ]);

    if (!summary) {
      return res.status(404).json({ error: 'Transportadora no encontrada' });
    }

    res.json({ data: { ...summary, config } });
  } catch (error: any) {
    logger.error('💥 [CARRIER ACCOUNTS] Error:', error);
    res.status(500).json({ error: error.message || 'Error al obtener detalle de transportadora' });
  }
});

// ================================================================
// GET /api/settlements/carrier-accounts/:carrierId/movements - Get movements
// ================================================================
settlementsRouter.get('/carrier-accounts/:carrierId/movements', async (req: AuthRequest, res: Response) => {
  try {
    const { carrierId } = req.params;
    const { from_date, to_date, movement_type, limit, offset } = req.query;

    logger.info('💰 [CARRIER ACCOUNTS] Fetching movements for carrier:', carrierId);

    const result = await settlementsService.getCarrierMovements(
      req.storeId!,
      carrierId,
      {
        fromDate: from_date as string,
        toDate: to_date as string,
        movementType: movement_type as string,
        limit: limit ? parseInt(limit as string, 10) : undefined,
        offset: offset ? parseInt(offset as string, 10) : undefined,
      }
    );

    res.json(result);
  } catch (error: any) {
    logger.error('💥 [CARRIER ACCOUNTS] Error:', error);
    res.status(500).json({ error: error.message || 'Error al obtener movimientos' });
  }
});

// ================================================================
// GET /api/settlements/carrier-accounts/:carrierId/unsettled - Get unsettled
// ================================================================
settlementsRouter.get('/carrier-accounts/:carrierId/unsettled', async (req: AuthRequest, res: Response) => {
  try {
    const { carrierId } = req.params;

    logger.info('💰 [CARRIER ACCOUNTS] Fetching unsettled for carrier:', carrierId);

    const movements = await settlementsService.getUnsettledMovements(req.storeId!, carrierId);

    res.json({ data: movements });
  } catch (error: any) {
    logger.error('💥 [CARRIER ACCOUNTS] Error:', error);
    res.status(500).json({ error: error.message || 'Error al obtener movimientos pendientes' });
  }
});

// ================================================================
// PATCH /api/settlements/carrier-accounts/:carrierId/config - Update config
// ================================================================
settlementsRouter.patch('/carrier-accounts/:carrierId/config', requirePermission(Module.CARRIERS, Permission.EDIT), async (req: PermissionRequest, res: Response) => {
  try {
    const { carrierId } = req.params;
    const { settlement_type, charges_failed_attempts, payment_schedule, failed_attempt_fee_percent } = req.body;

    logger.info('💰 [CARRIER ACCOUNTS] Updating config for carrier:', carrierId);

    // Validate failed_attempt_fee_percent if provided
    if (failed_attempt_fee_percent !== undefined) {
      const feePercent = Number(failed_attempt_fee_percent);
      if (isNaN(feePercent) || feePercent < 0 || feePercent > 100) {
        return res.status(400).json({ error: 'failed_attempt_fee_percent debe ser un número entre 0 y 100' });
      }
    }

    await settlementsService.updateCarrierConfig(carrierId, req.storeId!, {
      settlement_type,
      charges_failed_attempts,
      payment_schedule,
      failed_attempt_fee_percent: failed_attempt_fee_percent !== undefined ? Number(failed_attempt_fee_percent) : undefined,
    });

    res.json({ message: 'Configuración actualizada' });
  } catch (error: any) {
    logger.error('💥 [CARRIER ACCOUNTS] Error:', error);
    res.status(500).json({ error: error.message || 'Error al actualizar configuración' });
  }
});

// ================================================================
// POST /api/settlements/carrier-accounts/:carrierId/adjustment - Create adjustment
// ================================================================
settlementsRouter.post('/carrier-accounts/:carrierId/adjustment', requirePermission(Module.CARRIERS, Permission.CREATE), async (req: PermissionRequest, res: Response) => {
  try {
    const { carrierId } = req.params;
    const { amount, type, description } = req.body;

    if (!amount || !type || !description) {
      return res.status(400).json({ error: 'Se requieren amount, type y description' });
    }

    if (!['credit', 'debit'].includes(type)) {
      return res.status(400).json({ error: 'type debe ser "credit" o "debit"' });
    }

    logger.info('💰 [CARRIER ACCOUNTS] Creating adjustment for carrier:', carrierId);

    const movement = await settlementsService.createAdjustmentMovement(
      req.storeId!,
      carrierId,
      parseFloat(amount),
      type,
      description,
      req.userId
    );

    res.status(201).json({ data: movement });
  } catch (error: any) {
    logger.error('💥 [CARRIER ACCOUNTS] Error:', error);
    res.status(500).json({ error: error.message || 'Error al crear ajuste' });
  }
});

// ================================================================
// POST /api/settlements/carrier-payments - Register payment
// ================================================================
settlementsRouter.post('/carrier-payments', requirePermission(Module.CARRIERS, Permission.CREATE), async (req: PermissionRequest, res: Response) => {
  try {
    const {
      carrier_id,
      amount,
      direction,
      payment_method,
      payment_reference,
      notes,
      settlement_ids,
      movement_ids,
    } = req.body;

    if (!carrier_id || amount === undefined || amount === null || !direction || !payment_method) {
      return res.status(400).json({
        error: 'Se requieren carrier_id, amount, direction y payment_method'
      });
    }

    // Parse and validate amount robustly
    const parsedAmount = typeof amount === 'number' ? amount : parseFloat(amount);
    if (isNaN(parsedAmount) || !isFinite(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({
        error: 'El monto del pago debe ser un número positivo válido'
      });
    }

    if (parsedAmount > 999999999) {
      return res.status(400).json({
        error: 'El monto del pago excede el límite permitido'
      });
    }

    if (!['from_carrier', 'to_carrier'].includes(direction)) {
      return res.status(400).json({
        error: 'direction debe ser "from_carrier" o "to_carrier"'
      });
    }

    logger.info('💰 [CARRIER PAYMENTS] Registering payment:', {
      carrier_id,
      amount: parsedAmount,
      direction,
    });

    const result = await settlementsService.registerCarrierPayment(
      req.storeId!,
      carrier_id,
      parsedAmount,
      direction,
      payment_method,
      {
        paymentReference: payment_reference,
        notes,
        settlementIds: settlement_ids,
        movementIds: movement_ids,
        createdBy: req.userId,
      }
    );

    logger.info('✅ [CARRIER PAYMENTS] Payment registered:', result.paymentCode);

    res.status(201).json({ data: result });
  } catch (error: any) {
    logger.error('💥 [CARRIER PAYMENTS] Error:', error);
    res.status(500).json({ error: error.message || 'Error al registrar pago' });
  }
});

// ================================================================
// GET /api/settlements/carrier-payments - List payments
// ================================================================
settlementsRouter.get('/carrier-payments', async (req: AuthRequest, res: Response) => {
  try {
    const { carrier_id, from_date, to_date, status, limit, offset } = req.query;

    logger.info('💰 [CARRIER PAYMENTS] Fetching payments');

    const result = await settlementsService.getCarrierPayments(
      req.storeId!,
      carrier_id as string,
      {
        fromDate: from_date as string,
        toDate: to_date as string,
        status: status as string,
        limit: limit ? parseInt(limit as string, 10) : undefined,
        offset: offset ? parseInt(offset as string, 10) : undefined,
      }
    );

    res.json(result);
  } catch (error: any) {
    logger.error('💥 [CARRIER PAYMENTS] Error:', error);
    res.status(500).json({ error: error.message || 'Error al obtener pagos' });
  }
});

// ================================================================
// POST /api/settlements/backfill-movements - Backfill movements (admin)
// ================================================================
settlementsRouter.post('/backfill-movements', requirePermission(Module.CARRIERS, Permission.EDIT), async (req: PermissionRequest, res: Response) => {
  try {
    logger.info('💰 [CARRIER ACCOUNTS] Backfilling movements for store:', req.storeId);

    const result = await settlementsService.backfillCarrierMovements(req.storeId!);

    logger.info('✅ [CARRIER ACCOUNTS] Backfill complete:', result);

    res.json({
      message: 'Relleno completado',
      data: result,
    });
  } catch (error: any) {
    logger.error('💥 [CARRIER ACCOUNTS] Error:', error);
    res.status(500).json({ error: error.message || 'Error al rellenar movimientos' });
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
      return res.status(404).json({ error: 'Liquidación no encontrada' });
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
      logger.error('⚠️ [SETTLEMENTS] Error fetching orders:', ordersError);
    }

    res.json({
      ...settlement,
      orders: orders || []
    });
  } catch (error: any) {
    logger.error('💥 [SETTLEMENTS] Error:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ================================================================
// POST /api/settlements - Create new settlement
// ================================================================
settlementsRouter.post('/', requirePermission(Module.CARRIERS, Permission.CREATE), async (req: PermissionRequest, res: Response) => {
  try {
    const {
      settlement_date,
      carrier_id,
      order_ids = [],
      notes
    } = req.body;

    if (!settlement_date) {
      return res.status(400).json({ error: 'Se requiere settlement_date' });
    }

    logger.info('💰 [SETTLEMENTS] Creating settlement:', {
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
      logger.error('❌ [SETTLEMENTS] Error creating:', settlementError);
      return res.status(500).json({
        error: 'Error al crear liquidación',
        message: settlementError?.message || 'Error desconocido',
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
        logger.error('⚠️ [SETTLEMENTS] Error linking orders:', linkError);
      }
    }

    logger.info('✅ [SETTLEMENTS] Created:', settlement.id);

    res.status(201).json({
      message: 'Liquidación creada',
      data: settlement
    });
  } catch (error: any) {
    logger.error('💥 [SETTLEMENTS] Error:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ================================================================
// PUT /api/settlements/:id - Update settlement
// ================================================================
settlementsRouter.put('/:id', requirePermission(Module.CARRIERS, Permission.EDIT), async (req: PermissionRequest, res: Response) => {
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
      return res.status(404).json({ error: 'Liquidación no encontrada' });
    }

    logger.info('✅ [SETTLEMENTS] Updated:', id);

    res.json({
      message: 'Liquidación actualizada',
      data
    });
  } catch (error: any) {
    logger.error('💥 [SETTLEMENTS] Error:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ================================================================
// POST /api/settlements/:id/complete - Complete/close settlement
// ================================================================
settlementsRouter.post('/:id/complete', requirePermission(Module.CARRIERS, Permission.EDIT), async (req: PermissionRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { collected_cash, notes } = req.body;

    if (collected_cash === undefined || collected_cash === null) {
      return res.status(400).json({ error: 'Se requiere collected_cash' });
    }

    logger.info('✅ [SETTLEMENTS] Completing settlement:', id);

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
      return res.status(404).json({ error: 'Liquidación no encontrada' });
    }

    const difference = Number(collected_cash) - Number(data.expected_cash);

    logger.info('💰 [SETTLEMENTS] Completed:', {
      id,
      expected: data.expected_cash,
      collected: collected_cash,
      difference
    });

    res.json({
      message: 'Liquidación completada',
      data: {
        ...data,
        difference
      }
    });
  } catch (error: any) {
    logger.error('💥 [SETTLEMENTS] Error:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ================================================================
// DELETE /api/settlements/:id - Delete settlement
// ================================================================
settlementsRouter.delete('/:id', requirePermission(Module.CARRIERS, Permission.DELETE), async (req: PermissionRequest, res: Response) => {
  try {
    const { id } = req.params;

    // Delete settlement (cascade will delete settlement_orders)
    const { error } = await supabaseAdmin
      .from('daily_settlements')
      .delete()
      .eq('id', id)
      .eq('store_id', req.storeId);

    if (error) {
      logger.error('❌ [SETTLEMENTS] Error deleting:', error);
      return res.status(500).json({ error: 'Error al eliminar liquidación' });
    }

    logger.info('🗑️ [SETTLEMENTS] Deleted:', id);

    res.json({ message: 'Liquidación eliminada' });
  } catch (error: any) {
    logger.error('💥 [SETTLEMENTS] Error:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});


// ================================================================
// POST /api/settlements/backfill-movements - Fix incorrect carrier movements
// CRITICAL: Migration 119 - Fixes prepaid detection bug in carrier_account_movements
// ================================================================
settlementsRouter.post('/backfill-movements', requirePermission(Module.CARRIERS, Permission.EDIT), async (req: PermissionRequest, res: Response) => {
  try {
    const { dry_run = true } = req.body;
    const storeId = req.storeId;

    logger.info('🔧 [SETTLEMENTS] Backfill movements requested', {
      store_id: storeId,
      dry_run
    });

    // Call the backfill RPC
    const { data, error } = await supabaseAdmin.rpc('backfill_fix_prepaid_movements', {
      p_store_id: storeId,
      p_dry_run: dry_run
    });

    if (error) {
      logger.error('❌ [SETTLEMENTS] Backfill error:', error);
      return res.status(500).json({
        error: 'Error ejecutando backfill',
        details: error.message
      });
    }

    const result = Array.isArray(data) ? data[0] : data;

    logger.info('✅ [SETTLEMENTS] Backfill completed', {
      store_id: storeId,
      dry_run,
      result
    });

    res.json({
      message: dry_run
        ? 'Vista previa del backfill (no se aplicaron cambios)'
        : 'Backfill completado exitosamente',
      dry_run,
      data: {
        orders_checked: result?.orders_checked || 0,
        movements_deleted: result?.movements_deleted || 0,
        movements_fixed: result?.movements_fixed || 0,
        orders_affected: result?.orders_affected || []
      }
    });
  } catch (error: any) {
    logger.error('💥 [SETTLEMENTS] Backfill exception:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});


// ================================================================
// GET /api/settlements/movement-health - Check carrier movement health
// Migration 119: Monitoring endpoint for movement integrity
// ================================================================
settlementsRouter.get('/movement-health', requirePermission(Module.CARRIERS, Permission.VIEW), async (req: PermissionRequest, res: Response) => {
  try {
    const storeId = req.storeId;

    const { data, error } = await supabaseAdmin
      .from('v_carrier_movement_health')
      .select('*')
      .eq('store_id', storeId);

    if (error) {
      logger.error('❌ [SETTLEMENTS] Movement health error:', error);
      return res.status(500).json({ error: 'Error obteniendo estado de movimientos' });
    }

    const hasProblems = (data || []).length > 0;

    res.json({
      status: hasProblems ? 'PROBLEMS_DETECTED' : 'HEALTHY',
      message: hasProblems
        ? `Se encontraron ${data.length} transportadoras con problemas de movimientos`
        : 'Todos los movimientos están correctos',
      carriers_with_problems: data || []
    });
  } catch (error: any) {
    logger.error('💥 [SETTLEMENTS] Movement health exception:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});


import { Router, Response } from 'express';
import { supabaseAdmin } from '../db/connection';
import { verifyToken, extractStoreId, AuthRequest } from '../middleware/auth';

export const settlementsRouter = Router();

// All routes require authentication and store context
settlementsRouter.use(verifyToken);
settlementsRouter.use(extractStoreId);

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
// GET /api/settlements/:id - Get single settlement with orders
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
// GET /api/settlements/stats - Get settlement statistics
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

import { Router, Response } from 'express';
import { supabaseAdmin } from '../db/connection';
import { verifyToken, extractStoreId, AuthRequest } from '../middleware/auth';

export const codMetricsRouter = Router();

// All routes require authentication and store context
codMetricsRouter.use(verifyToken);
codMetricsRouter.use(extractStoreId);

// ================================================================
// GET /api/cod-metrics - Get COD metrics for dashboard
// Query params: start_date, end_date
// ================================================================
codMetricsRouter.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const { start_date, end_date } = req.query;

    console.log('📊 [COD-METRICS] Fetching metrics for store:', req.storeId);

    // Default to last 30 days if no dates provided
    const endDate = end_date ? new Date(end_date as string) : new Date();
    const startDate = start_date
      ? new Date(start_date as string)
      : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Get all orders in range
    const { data: orders, error: ordersError } = await supabaseAdmin
      .from('orders')
      .select('*')
      .eq('store_id', req.storeId)
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString());

    if (ordersError) {
      console.error('❌ [COD-METRICS] Error fetching orders:', ordersError);
      return res.status(500).json({ error: 'Failed to fetch orders' });
    }

    // Calculate confirmation rate
    const confirmedOrders = orders?.filter(o =>
      ['confirmed', 'preparing', 'out_for_delivery', 'delivered'].includes(o.sleeves_status)
    ).length || 0;
    const totalOrders = orders?.length || 0;
    const confirmation_rate = totalOrders > 0
      ? Math.round((confirmedOrders / totalOrders) * 100)
      : 0;

    // Calculate payment success rate
    const deliveredOrders = orders?.filter(o => o.sleeves_status === 'delivered').length || 0;
    const paidOrders = orders?.filter(o => o.payment_status === 'collected').length || 0;
    const payment_success_rate = deliveredOrders > 0
      ? Math.round((paidOrders / deliveredOrders) * 100)
      : 0;

    // Calculate average delivery attempts
    const ordersWithAttempts = orders?.filter(o => o.delivery_attempts && o.delivery_attempts > 0) || [];
    const totalAttempts = ordersWithAttempts.reduce((sum, o) => sum + (o.delivery_attempts || 0), 0);
    const average_delivery_attempts = ordersWithAttempts.length > 0
      ? Number((totalAttempts / ordersWithAttempts.length).toFixed(1))
      : 0;

    // Calculate failed deliveries loss
    const failedOrders = orders?.filter(o =>
      o.sleeves_status === 'delivery_failed' || o.payment_status === 'failed'
    ) || [];
    const failed_deliveries_loss = failedOrders.reduce((sum, o) =>
      sum + Number(o.total_price || 0), 0
    );

    // Calculate pending cash (out_for_delivery orders)
    const outForDeliveryOrders = orders?.filter(o =>
      o.sleeves_status === 'out_for_delivery' && o.payment_status === 'pending'
    ) || [];
    const pending_cash = outForDeliveryOrders.reduce((sum, o) =>
      sum + Number(o.total_price || 0), 0
    );

    // Calculate collected today
    const today = new Date().toISOString().split('T')[0];
    const collectedToday = orders?.filter(o =>
      o.payment_status === 'collected' &&
      o.updated_at?.startsWith(today)
    ) || [];
    const collected_today = collectedToday.reduce((sum, o) =>
      sum + Number(o.total_price || 0), 0
    );

    // Count orders in delivery
    const orders_in_delivery = outForDeliveryOrders.length;

    const metrics = {
      confirmation_rate,
      payment_success_rate,
      average_delivery_attempts,
      failed_deliveries_loss,
      pending_cash,
      collected_today,
      orders_in_delivery,
      // Additional stats
      total_orders: totalOrders,
      confirmed_orders: confirmedOrders,
      delivered_orders: deliveredOrders,
      paid_orders: paidOrders,
      failed_orders: failedOrders.length,
      period: {
        start_date: startDate.toISOString().split('T')[0],
        end_date: endDate.toISOString().split('T')[0]
      }
    };

    console.log('✅ [COD-METRICS] Metrics calculated:', metrics);

    res.json(metrics);
  } catch (error: any) {
    console.error('💥 [COD-METRICS] Unexpected error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ================================================================
// GET /api/cod-metrics/daily - Get daily breakdown
// ================================================================
codMetricsRouter.get('/daily', async (req: AuthRequest, res: Response) => {
  try {
    const { days = '7' } = req.query;

    console.log('📅 [COD-METRICS] Fetching daily breakdown for', days, 'days');

    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - parseInt(days as string) * 24 * 60 * 60 * 1000);

    const { data: orders, error } = await supabaseAdmin
      .from('orders')
      .select('created_at, status, payment_status, total_price')
      .eq('store_id', req.storeId)
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString());

    if (error) {
      console.error('❌ [COD-METRICS] Error:', error);
      return res.status(500).json({ error: 'Failed to fetch orders' });
    }

    // Group by date
    const dailyMetrics: Record<string, any> = {};

    orders?.forEach(order => {
      const date = order.created_at.split('T')[0];

      if (!dailyMetrics[date]) {
        dailyMetrics[date] = {
          date,
          total_orders: 0,
          confirmed: 0,
          delivered: 0,
          paid: 0,
          revenue: 0,
          collected: 0
        };
      }

      dailyMetrics[date].total_orders++;

      if (['confirmed', 'preparing', 'out_for_delivery', 'delivered'].includes(order.sleeves_status)) {
        dailyMetrics[date].confirmed++;
      }

      if (order.sleeves_status === 'delivered') {
        dailyMetrics[date].delivered++;
        dailyMetrics[date].revenue += Number(order.total_price || 0);
      }

      if (order.payment_status === 'collected') {
        dailyMetrics[date].paid++;
        dailyMetrics[date].collected += Number(order.total_price || 0);
      }
    });

    const dailyArray = Object.values(dailyMetrics).sort((a, b) =>
      a.date.localeCompare(b.date)
    );

    res.json({
      data: dailyArray,
      period: {
        start_date: startDate.toISOString().split('T')[0],
        end_date: endDate.toISOString().split('T')[0],
        days: parseInt(days as string)
      }
    });
  } catch (error: any) {
    console.error('💥 [COD-METRICS] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ================================================================
// GET /api/cod-metrics/by-carrier - Get metrics by carrier
// ================================================================
codMetricsRouter.get('/by-carrier', async (req: AuthRequest, res: Response) => {
  try {
    console.log('🚚 [COD-METRICS] Fetching metrics by carrier');

    const { data: orders, error } = await supabaseAdmin
      .from('orders')
      .select(`
        *,
        carriers!orders_carrier_id_fkey (
          id,
          name
        )
      `)
      .eq('store_id', req.storeId)
      .not('carrier_id', 'is', null);

    if (error) {
      console.error('❌ [COD-METRICS] Error:', error);
      return res.status(500).json({ error: 'Failed to fetch orders' });
    }

    // Group by carrier
    const carrierMetrics: Record<string, any> = {};

    orders?.forEach(order => {
      const carrier = order.carriers;
      if (!carrier) return;

      const carrierId = carrier.id;

      if (!carrierMetrics[carrierId]) {
        carrierMetrics[carrierId] = {
          carrier_id: carrierId,
          carrier_name: carrier.name,
          total_orders: 0,
          delivered: 0,
          failed: 0,
          in_delivery: 0,
          total_attempts: 0,
          success_rate: 0
        };
      }

      carrierMetrics[carrierId].total_orders++;

      if (order.sleeves_status === 'delivered') {
        carrierMetrics[carrierId].delivered++;
      }

      if (order.sleeves_status === 'delivery_failed') {
        carrierMetrics[carrierId].failed++;
      }

      if (order.sleeves_status === 'out_for_delivery') {
        carrierMetrics[carrierId].in_delivery++;
      }

      if (order.delivery_attempts) {
        carrierMetrics[carrierId].total_attempts += order.delivery_attempts;
      }
    });

    // Calculate success rate
    Object.values(carrierMetrics).forEach((metric: any) => {
      const completed = metric.delivered + metric.failed;
      metric.success_rate = completed > 0
        ? Math.round((metric.delivered / completed) * 100)
        : 0;
      metric.avg_attempts = metric.total_orders > 0
        ? Number((metric.total_attempts / metric.total_orders).toFixed(1))
        : 0;
    });

    res.json({
      data: Object.values(carrierMetrics)
    });
  } catch (error: any) {
    console.error('💥 [COD-METRICS] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

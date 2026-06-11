// ================================================================
// ORDEFY API - COD METRICS ROUTES
// ================================================================
// Cash on Delivery metrics and analytics
//
// Security: Requires ANALYTICS module access
// Roles with access: owner, admin, logistics, contador
//
// Every metric returned by this router consumes api/utils/metrics-canonical.ts.
// Routes that previously inlined status filters or hardcoded literals now
// produce numbers that match the analytics overview down to the unit.
// ================================================================

import { logger } from '../utils/logger';
import { Router, Response } from 'express';
import { supabaseAdmin } from '../db/connection';
import { verifyToken, extractStoreId, AuthRequest } from '../middleware/auth';
import { extractUserRole, requireModule } from '../middleware/permissions';
import { Module } from '../permissions';
import {
    addDaysInTimezone,
    endOfDayIso,
    formatDateInTimezone,
    getStoreTimezone,
    getTodayInTimezone,
    startOfDayIso,
} from '../utils/dateUtils';
import {
    averageOrderValue,
    carrierSuccessRate,
    confirmationRate,
    FAILED_AFTER_DISPATCH_STATUSES,
    isFailedAfterDispatch,
    isPostPending,
    isTerminalSuccess,
    pendingCash,
    revenueReal,
    type CanonicalOrder,
} from '../utils/metrics-canonical';
import { isOrderCod } from '../utils/payment';

export const codMetricsRouter = Router();

codMetricsRouter.use(verifyToken);
codMetricsRouter.use(extractStoreId);
codMetricsRouter.use(extractUserRole);
codMetricsRouter.use(requireModule(Module.ANALYTICS));

interface CodOrderRow extends CanonicalOrder {
    id: string;
    payment_status: string | null;
    payment_method: string | null;
    prepaid_method: string | null;
    reconciled_at: string | null;
    delivery_attempts: number | null;
    created_at: string;
    updated_at: string;
}

// ================================================================
// GET /api/cod-metrics
// Query params: start_date, end_date (YYYY-MM-DD, store-local)
// ================================================================
codMetricsRouter.get('/', async (req: AuthRequest, res: Response) => {
    try {
        const { start_date, end_date } = req.query;
        const storeTz = await getStoreTimezone(supabaseAdmin, req.storeId!);

        // Default window: last 30 days, anchored to store-local midnight
        // boundaries. Previously this used `new Date(...)` parsed as UTC,
        // which mis-bucketed orders at the day edge for negative-offset
        // stores like Asuncion (UTC-4).
        const endLocalDate = (end_date as string) || getTodayInTimezone(storeTz);
        const startLocalDate = (start_date as string) || addDaysInTimezone(-30, storeTz);
        const startIso = startOfDayIso(startLocalDate, storeTz);
        const endIso = endOfDayIso(endLocalDate, storeTz);

        const { data: orders, error } = await supabaseAdmin
            .from('orders')
            .select('id, sleeves_status, payment_status, payment_method, prepaid_method, reconciled_at, total_price, delivery_attempts, created_at, updated_at, shipped_at, currency, deleted_at, is_test')
            .eq('store_id', req.storeId)
            .is('deleted_at', null)
            .gte('created_at', startIso)
            .lte('created_at', endIso);

        if (error) {
            logger.error('API', '[COD-METRICS] orders query error:', error);
            return res.status(500).json({ error: 'Error al obtener pedidos' });
        }

        const list = (orders || []).filter((o: CodOrderRow) => o.is_test !== true) as CodOrderRow[];

        // confirmation_rate uses the canonical helper. Both this endpoint and
        // /api/analytics/confirmation-metrics now agree on what "confirmed"
        // means. See audit CRITICAL-3.
        const confirmation_rate_pct = confirmationRate(list);

        const deliveredOrders = list.filter((o) => isTerminalSuccess(o.sleeves_status));

        // Payment success rate (mig 183): anchored on reconciled_at instead
        // of payment_status, COD-only. See /api/analytics/logistics-metrics
        // for the parallel formula.
        const codDeliveredOrders = deliveredOrders.filter((o) =>
            isOrderCod(o.payment_method, o.prepaid_method),
        );
        const reconciledCodOrders = codDeliveredOrders.filter((o) => o.reconciled_at != null);
        // Null when there are no delivered COD orders: the rate is not
        // computable and 0 would read as "nothing ever gets paid".
        const payment_success_rate =
            codDeliveredOrders.length > 0
                ? Math.round((reconciledCodOrders.length / codDeliveredOrders.length) * 100)
                : null;

        const paidOrders = list.filter((o) => o.payment_status === 'collected');

        const ordersWithAttempts = list.filter((o) => (o.delivery_attempts ?? 0) > 0);
        const totalAttempts = ordersWithAttempts.reduce(
            (sum, o) => sum + (o.delivery_attempts || 0),
            0,
        );
        const average_delivery_attempts =
            ordersWithAttempts.length > 0
                ? Number((totalAttempts / ordersWithAttempts.length).toFixed(1))
                : null;

        // Failed deliveries loss = revenue lost on orders that left the
        // warehouse and did not pay. Pre-dispatch cancels do not count
        // because nothing was lost (no cost incurred).
        const failedOrders = list.filter((o) =>
            isFailedAfterDispatch(o.sleeves_status, o.shipped_at),
        );
        const failed_deliveries_loss = failedOrders.reduce(
            (sum, o) => sum + Number(o.total_price || 0),
            0,
        );

        const pending_cash = pendingCash(list);

        // Orders currently in delivery: any in_transit pipeline state with
        // unpaid status. Previously was hardcoded sleeves_status='shipped'
        // which post-148c always returned 0.
        const orders_in_delivery = list.filter(
            (o) =>
                isPostPending(o.sleeves_status) &&
                !isTerminalSuccess(o.sleeves_status) &&
                !FAILED_AFTER_DISPATCH_STATUSES.has(o.sleeves_status ?? '') &&
                o.payment_status === 'pending',
        ).length;

        // collected_today uses formatDateInTimezone for the comparison so
        // a payment recorded at 22:00 local on day D never lands on day D+1.
        const today = getTodayInTimezone(storeTz);
        const collectedToday = list.filter(
            (o) =>
                o.payment_status === 'collected' &&
                o.updated_at &&
                formatDateInTimezone(o.updated_at, storeTz) === today,
        );
        const collected_today = collectedToday.reduce(
            (sum, o) => sum + Number(o.total_price || 0),
            0,
        );

        const totalOrders = list.length;
        // Confirmed orders count uses the canonical post-pending set, same
        // numerator as confirmation_rate. Display value, not a separate
        // formula.
        const confirmedOrdersCount = list.filter((o) => isPostPending(o.sleeves_status)).length;

        const metrics = {
            // Canonical helper already returns null for "not computable";
            // pass it through instead of masking it as 0.
            confirmation_rate: confirmation_rate_pct === null ? null : Math.round(confirmation_rate_pct),
            payment_success_rate,
            average_delivery_attempts,
            failed_deliveries_loss,
            pending_cash,
            collected_today,
            orders_in_delivery,
            total_orders: totalOrders,
            confirmed_orders: confirmedOrdersCount,
            delivered_orders: deliveredOrders.length,
            paid_orders: paidOrders.length,
            failed_orders: failedOrders.length,
            // Headline AOV and revenue computed canonically so the COD page
            // matches the dashboard.
            average_order_value: averageOrderValue(list),
            revenue_real: revenueReal(list),
            period: {
                start_date: startLocalDate,
                end_date: endLocalDate,
            },
        };

        res.json(metrics);
    } catch (error: any) {
        logger.error('API', '[COD-METRICS] unexpected error:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// ================================================================
// GET /api/cod-metrics/daily
// Query params: days (default 7)
// ================================================================
codMetricsRouter.get('/daily', async (req: AuthRequest, res: Response) => {
    try {
        const { days = '7' } = req.query;
        const storeTz = await getStoreTimezone(supabaseAdmin, req.storeId!);

        const dayCount = Math.max(1, parseInt(days as string, 10) || 7);
        const endLocalDate = getTodayInTimezone(storeTz);
        const startLocalDate = addDaysInTimezone(-(dayCount - 1), storeTz);
        const startIso = startOfDayIso(startLocalDate, storeTz);
        const endIso = endOfDayIso(endLocalDate, storeTz);

        const { data: orders, error } = await supabaseAdmin
            .from('orders')
            .select('created_at, sleeves_status, payment_status, total_price, shipped_at, currency, deleted_at, is_test')
            .eq('store_id', req.storeId)
            .is('deleted_at', null)
            .gte('created_at', startIso)
            .lte('created_at', endIso);

        if (error) {
            logger.error('API', '[COD-METRICS/daily] error:', error);
            return res.status(500).json({ error: 'Error al obtener pedidos' });
        }

        const list = (orders || []).filter((o: any) => o.is_test !== true);

        // Group by date in store-local timezone so an order placed at 22:00
        // local on day D always aggregates into "day D".
        const dailyMetrics: Record<
            string,
            {
                date: string;
                total_orders: number;
                confirmed: number;
                delivered: number;
                paid: number;
                revenue: number;
                collected: number;
            }
        > = {};

        for (const order of list) {
            const date = formatDateInTimezone(order.created_at, storeTz);
            if (!dailyMetrics[date]) {
                dailyMetrics[date] = {
                    date,
                    total_orders: 0,
                    confirmed: 0,
                    delivered: 0,
                    paid: 0,
                    revenue: 0,
                    collected: 0,
                };
            }
            const day = dailyMetrics[date];
            day.total_orders++;

            if (isPostPending(order.sleeves_status)) day.confirmed++;
            if (isTerminalSuccess(order.sleeves_status)) {
                day.delivered++;
                day.revenue += Number(order.total_price || 0);
            }
            if (order.payment_status === 'collected') {
                day.paid++;
                day.collected += Number(order.total_price || 0);
            }
        }

        const dailyArray = Object.values(dailyMetrics).sort((a, b) =>
            a.date.localeCompare(b.date),
        );

        res.json({
            data: dailyArray,
            period: {
                start_date: startLocalDate,
                end_date: endLocalDate,
                days: dayCount,
            },
        });
    } catch (error: any) {
        logger.error('API', '[COD-METRICS/daily] error:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// ================================================================
// GET /api/cod-metrics/by-carrier
// All-time per-carrier breakdown.
// ================================================================
codMetricsRouter.get('/by-carrier', async (req: AuthRequest, res: Response) => {
    try {
        // The previous implementation joined `carriers!orders_carrier_id_fkey`
        // and filtered `.not('carrier_id', 'is', null)`. Both names are wrong:
        // the column is `courier_id` and the FK alias is
        // `orders_courier_id_fkey`. supabase-js silently returned an empty
        // join, so the entire endpoint returned [] in production. Fixed to
        // use the real column + FK.
        const { data: orders, error } = await supabaseAdmin
            .from('orders')
            .select(`
                id,
                sleeves_status,
                payment_status,
                total_price,
                shipped_at,
                delivery_attempts,
                deleted_at,
                is_test,
                carriers!orders_courier_id_fkey (
                    id,
                    name
                )
            `)
            .eq('store_id', req.storeId)
            .is('deleted_at', null)
            .not('courier_id', 'is', null);

        if (error) {
            logger.error('API', '[COD-METRICS/by-carrier] error:', error);
            return res.status(500).json({ error: 'Error al obtener pedidos' });
        }

        const list = (orders || []).filter((o: any) => o.is_test !== true);

        // Group orders by carrier id, then compute canonical success rate.
        const groups = new Map<
            string,
            { carrier_name: string; orders: any[] }
        >();
        for (const order of list) {
            const carrier = (order as any).carriers;
            if (!carrier?.id) continue;
            if (!groups.has(carrier.id)) {
                groups.set(carrier.id, {
                    carrier_name: carrier.name,
                    orders: [],
                });
            }
            groups.get(carrier.id)!.orders.push(order);
        }

        const result = Array.from(groups.entries()).map(([carrierId, g]) => {
            const delivered = g.orders.filter((o) => isTerminalSuccess(o.sleeves_status)).length;
            const failed = g.orders.filter((o) =>
                isFailedAfterDispatch(o.sleeves_status, o.shipped_at),
            ).length;
            const inDelivery = g.orders.filter(
                (o) => isPostPending(o.sleeves_status) && !isTerminalSuccess(o.sleeves_status) &&
                       !isFailedAfterDispatch(o.sleeves_status, o.shipped_at),
            ).length;
            const totalAttempts = g.orders.reduce(
                (s, o) => s + (Number(o.delivery_attempts) || 0),
                0,
            );
            const successRate = carrierSuccessRate(g.orders);
            return {
                carrier_id: carrierId,
                carrier_name: g.carrier_name,
                total_orders: g.orders.length,
                delivered,
                failed,
                in_delivery: inDelivery,
                total_attempts: totalAttempts,
                success_rate: successRate === null ? 0 : Math.round(successRate),
                avg_attempts:
                    g.orders.length > 0
                        ? Number((totalAttempts / g.orders.length).toFixed(1))
                        : 0,
            };
        });

        res.json({ data: result });
    } catch (error: any) {
        logger.error('API', '[COD-METRICS/by-carrier] error:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

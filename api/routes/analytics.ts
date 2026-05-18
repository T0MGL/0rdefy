// ================================================================
// NEONFLOW API - ANALYTICS ROUTES
// ================================================================
// Real-time business intelligence and metrics calculation
// Replaces mock data with actual database queries
// ================================================================

import { logger } from '../utils/logger';
import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../db/connection';
import { verifyToken, extractStoreId, AuthRequest } from '../middleware/auth';
import { extractUserRole, requireModule } from '../middleware/permissions';
import { Module } from '../permissions';
import {
    DEFAULT_TIMEZONE,
    addDaysInTimezone,
    endOfDayIso,
    formatDateInTimezone,
    getStartOfDayInTimezone,
    getStoreTimezone,
    getTodayInTimezone,
    startOfDayIso,
} from '../utils/dateUtils';
import {
    IN_TRANSIT_STATUSES,
    POST_PENDING_STATUSES,
    isActiveSettlement,
    isConfirmed,
    isDelivered,
    isDeliveredOrSettled,
    isDispatched,
    isFailedDelivery,
    isInPreparation,
    isInTransit,
    isPending,
    isPostPending,
    isReadyToShip,
    isReturned,
    isSettled,
} from '../utils/order-status';
import { isOrderCod } from '../utils/payment';

export const analyticsRouter = Router();

analyticsRouter.use(verifyToken, extractStoreId, extractUserRole);

// Apply module-level access check for all routes
analyticsRouter.use(requireModule(Module.ANALYTICS));

// ================================================================
// Helpers: store currency + off-currency drop
// ================================================================
//
// Every money-handling endpoint here loads the store's primary currency
// at the start and drops orders that transact in a different one. This
// is the multi-currency safety net: a store that test-runs USD orders
// against a PYG primary configuration would otherwise see USD totals
// folded into PYG headlines, producing a number that does not exist
// in any one accounting reality.
//
// NULL currency on an order means "predates the column" and is treated
// as matching the store currency. Every new write should populate it.
async function loadStoreCurrency(storeId: string): Promise<string> {
    const { data, error } = await supabaseAdmin
        .from('stores')
        .select('currency')
        .eq('id', storeId)
        .single();
    if (error) {
        logger.warn('SERVER', '[loadStoreCurrency] error', { storeId, error: error.message });
    }
    return (data?.currency as string | null) || 'PYG';
}

interface OffCurrencyDrop<T extends { currency?: string | null }> {
    inCurrency: T[];
    offCurrency: T[];
}

function dropOffCurrency<T extends { currency?: string | null }>(
    orders: T[],
    storeCurrency: string,
): OffCurrencyDrop<T> {
    const offCurrency = orders.filter(
        o => o.currency != null && o.currency !== storeCurrency,
    );
    const inCurrency = orders.filter(
        o => o.currency == null || o.currency === storeCurrency,
    );
    return { inCurrency, offCurrency };
}


// ================================================================
// GET /api/analytics/overview - Dashboard overview metrics
// ================================================================
analyticsRouter.get('/overview', async (req: AuthRequest, res: Response) => {
    try {
        const { startDate, endDate } = req.query;

        // Get store tax rate, timezone, primary currency and confirmation
        // fee from store_config. The store currency anchors money math:
        // every aggregation is filtered to orders that match the store's
        // primary currency. Cross-currency rows still appear in counters
        // (totalOrders, etc) but never in revenue, profit, or cash totals,
        // because mixing PYG with USD in a sum produces a meaningless number.
        const { data: storeData, error: storeError } = await supabaseAdmin
            .from('stores')
            .select('tax_rate, timezone, currency')
            .eq('id', req.storeId)
            .single();

        if (storeError) {
            logger.error('SERVER', '[GET /api/analytics/overview] Store query error:', storeError);
        }

        const taxRate = Number(storeData?.tax_rate) || 0;
        const storeTz: string = (storeData?.timezone as string | null) || DEFAULT_TIMEZONE;
        const storeCurrency: string = (storeData?.currency as string | null) || 'PYG';

        // Get confirmation fee from store_config
        const { data: configData } = await supabaseAdmin
            .from('store_config')
            .select('confirmation_fee')
            .eq('store_id', req.storeId)
            .single();

        const confirmationFee = Number(configData?.confirmation_fee) || 0;

        // Calculate date ranges for comparison (use provided dates or default to 7 days)
        // All day boundaries are anchored to the store's local timezone, not server UTC.
        let currentPeriodStart: Date;
        let currentPeriodEnd: Date;
        let previousPeriodStart: Date;
        let previousPeriodEnd: Date;

        if (startDate && endDate) {
            currentPeriodStart = new Date(startOfDayIso(startDate as string, storeTz));
            currentPeriodEnd = new Date(endOfDayIso(endDate as string, storeTz));

            if (isNaN(currentPeriodStart.getTime()) || isNaN(currentPeriodEnd.getTime())) {
                return res.status(400).json({ error: 'Fechas inválidas' });
            }
            if (currentPeriodStart >= currentPeriodEnd) {
                return res.status(400).json({ error: 'La fecha de inicio debe ser anterior a la fecha de fin' });
            }

            const periodDuration = currentPeriodEnd.getTime() - currentPeriodStart.getTime();
            previousPeriodStart = new Date(currentPeriodStart.getTime() - periodDuration);
            previousPeriodEnd = currentPeriodStart;
        } else {
            const now = new Date();
            currentPeriodEnd = now;
            currentPeriodStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            previousPeriodStart = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
            previousPeriodEnd = currentPeriodStart;
        }

        // Build query - fetch orders from previousPeriodStart to currentPeriodEnd
        // This ensures we have data for both current and previous periods
        // NOTE: Product costs are calculated from order_line_items table (normalized)
        const query = supabaseAdmin
            .from('orders')
            .select('id, created_at, total_price, sleeves_status, shipping_cost, confirmed_at, delivered_at, shipped_at, deleted_at, is_test, currency')
            .eq('store_id', req.storeId)
            .gte('created_at', previousPeriodStart.toISOString())
            .lte('created_at', currentPeriodEnd.toISOString());

        const { data: ordersData, error: ordersError } = await query;

        if (ordersError) throw ordersError;

        // Filter out soft-deleted and test orders, then drop off-currency
        // rows from money aggregations. See loadStoreCurrency / dropOffCurrency
        // module-level docs for rationale.
        const allOrders = (ordersData || []).filter(o =>
            !o.deleted_at && o.is_test !== true
        );
        const { inCurrency: orders, offCurrency: offCurrencyOrders } =
            dropOffCurrency(allOrders, storeCurrency);
        if (offCurrencyOrders.length > 0) {
            logger.warn('SERVER', '[GET /api/analytics/overview] Off-currency orders dropped', {
                storeId: req.storeId,
                storeCurrency,
                offCurrencyCount: offCurrencyOrders.length,
                currencies: Array.from(new Set(offCurrencyOrders.map(o => o.currency))),
            });
        }

        const last7DaysStart = currentPeriodStart;
        const previous7DaysStart = previousPeriodStart;

        // Filter orders for current period only (for total counts)
        const currentPeriodOrdersForTotal = orders.filter(o => new Date(o.created_at) >= currentPeriodStart);
        const totalOrders = currentPeriodOrdersForTotal.length;

        // Split orders into current and previous periods
        const currentPeriodOrders = orders.filter(o => new Date(o.created_at) >= last7DaysStart);
        const previousPeriodOrders = orders.filter(o => {
            const date = new Date(o.created_at);
            return date >= previous7DaysStart && date < last7DaysStart;
        });

        // ===== GET GASTO PUBLICITARIO FROM ADDITIONAL_VALUES TABLE =====
        // Marketing expenses are registered by users in the additional_values table
        // with category='marketing' and type='expense'
        const { data: marketingExpensesData, error: marketingExpensesError } = await supabaseAdmin
            .from('additional_values')
            .select('amount, date')
            .eq('store_id', req.storeId)
            .eq('category', 'marketing')
            .eq('type', 'expense')
            .gte('date', formatDateInTimezone(previousPeriodStart, storeTz))
            .lte('date', formatDateInTimezone(currentPeriodEnd, storeTz));

        if (marketingExpensesError) {
            logger.error('SERVER', '[GET /api/analytics/overview] Marketing expenses query error:', marketingExpensesError);
        }

        const marketingExpenses = marketingExpensesData || [];

        // FIX-7 (audit 2026-05-02): compare additional_values.date (YYYY-MM-DD
        // strings) against store-local day strings, not Date objects. Doing
        // `new Date('2026-04-30')` parses to UTC midnight, which lands one calendar
        // day off for stores in negative-offset timezones (Asuncion is UTC-4) and
        // mis-attributes spend at the period boundary.
        const currentStartLocal = formatDateInTimezone(last7DaysStart, storeTz);
        const currentEndLocal = formatDateInTimezone(currentPeriodEnd, storeTz);
        const previousStartLocal = formatDateInTimezone(previous7DaysStart, storeTz);

        const currentGastoPublicitarioCosts = marketingExpenses
            .filter(m => {
                const d = String(m.date).slice(0, 10);
                return d >= currentStartLocal && d <= currentEndLocal;
            })
            .reduce((sum, m) => sum + (Number(m.amount) || 0), 0);

        const previousGastoPublicitarioCosts = marketingExpenses
            .filter(m => {
                const d = String(m.date).slice(0, 10);
                return d >= previousStartLocal && d < currentStartLocal;
            })
            .reduce((sum, m) => sum + (Number(m.amount) || 0), 0);

        // ===== PRE-FETCH: Line items and additional values for ALL orders (both periods) =====
        const allOrderIds = orders.map(o => o.id);

        // Pre-fetch line items once - Migration 128: Use stored unit_cost instead of JOIN to products
        const { data: allLineItemsData } = allOrderIds.length > 0 ? await supabaseAdmin
            .from('order_line_items')
            .select('order_id, quantity, unit_cost')
            .in('order_id', allOrderIds) : { data: [] };

        // Build line items map once
        const prebuiltLineItemsByOrder = new Map<string, any[]>();
        (allLineItemsData || []).forEach(item => {
            const orderId = item.order_id;
            if (!prebuiltLineItemsByOrder.has(orderId)) {
                prebuiltLineItemsByOrder.set(orderId, []);
            }
            prebuiltLineItemsByOrder.get(orderId)!.push(item);
        });

        // Pre-fetch additional values once (income + all expenses for the full period)
        const { data: allAdditionalValuesData } = await supabaseAdmin
            .from('additional_values')
            .select('type, amount, date')
            .eq('store_id', req.storeId)
            .gte('date', formatDateInTimezone(previousPeriodStart, storeTz))
            .lte('date', formatDateInTimezone(currentPeriodEnd, storeTz));

        const allAdditionalValues = allAdditionalValuesData || [];

        // ===== HELPER FUNCTION: Calculate metrics for a set of orders =====
        const calculateMetrics = async (ordersList: any[], gastoPublicitarioCosts: number, periodStart: Date, periodEnd: Date) => {
            const count = ordersList.length;

            // 1. REVENUE (from orders)
            // Total revenue from ALL orders (for display purposes)
            let rev = ordersList.reduce((sum, order) => sum + (Number(order.total_price) || 0), 0);

            // 1.5. REAL REVENUE (only from delivered orders - actual cash received)
            // This is the money that actually entered the business
            let realRevenue = ordersList
                .filter(o => isDelivered(o.sleeves_status))
                .reduce((sum, order) => sum + (Number(order.total_price) || 0), 0);

            // 1.6. PROJECTED REVENUE (delivered + in-transit pipeline, weighted)
            // In-transit revenue is the gross value of every order still in the
            // pipeline (post-confirmation, pre-terminal). We weight it by the
            // store's historical delivery rate so the projection reflects realistic
            // upside instead of a best-case scenario.
            const inTransitOrdersList = ordersList.filter(o => isInTransit(o.sleeves_status));
            const inTransitGrossRevenue = inTransitOrdersList
                .reduce((sum, order) => sum + (Number(order.total_price) || 0), 0);

            // Canonical delivery rate: delivered / dispatched.
            // Single formula used by BOTH the headline card (returned as deliveryRate
            // below) AND the projection weighting. Previously the projection used a
            // different denominator (delivered + in_transit), which produced a higher
            // rate than the headline and made the two cards disagree by ~4pp on
            // Solenne (60.74% vs 64.51%). See metrics-definitions.md.
            const deliveredCount = ordersList.filter(o => isDelivered(o.sleeves_status)).length;
            const inTransitCount = inTransitOrdersList.length;
            const dispatched = ordersList.filter(o => isDispatched(o.sleeves_status, o.shipped_at)).length;
            const deliveryRateDecimal = dispatched > 0 && deliveredCount > 0
                ? (deliveredCount / dispatched)
                : 0.85; // Default 85% for new stores or when no dispatched orders yet

            // Projected revenue = delivered (100%, already cash) + in_transit * deliveryRate
            const inTransitProjectedRevenue = inTransitGrossRevenue * deliveryRateDecimal;
            const projectedRevenue = realRevenue + inTransitProjectedRevenue;

            // 1.7. DELIVERY COSTS (shipping costs from orders)
            // Real costs = costs already incurred (delivered orders only).
            // Projected costs = real + (in-transit shipping cost * deliveryRate).
            // Why weight in-transit shipping costs too: if 70% of in-transit orders
            // get delivered, ~70% of their shipping fees become a real expense.
            // The other 30% (failed/returned) usually still trigger a partial
            // shipping fee but at a smaller scale; weighting matches the revenue
            // side for a conservative, internally-consistent projection.
            let deliveryCosts = 0;
            let realDeliveryCosts = 0;
            let inTransitDeliveryCosts = 0;

            for (const order of ordersList) {
                const shippingCost = Number(order.shipping_cost) || 0;
                deliveryCosts += shippingCost;

                if (isDelivered(order.sleeves_status)) {
                    realDeliveryCosts += shippingCost;
                } else if (isInTransit(order.sleeves_status)) {
                    inTransitDeliveryCosts += shippingCost;
                }
            }
            const projectedDeliveryCosts = realDeliveryCosts + (inTransitDeliveryCosts * deliveryRateDecimal);

            // 1.8. CONFIRMATION FEES (cost per confirmed order)
            // Count confirmed orders (all statuses except pending, cancelled, rejected)
            // Confirmation fees are charged the moment an order leaves 'pending', so
            // they are an incurred cost for every delivered + in-transit order, plus
            // any orders that left pending and ended in returned / delivery_failed.
            // For projection symmetry we account for delivered + (in_transit weighted).
            const confirmedOrders = ordersList.filter(o =>
                !['pending', 'cancelled', 'rejected'].includes(o.sleeves_status)
            );
            const realConfirmedOrders = ordersList.filter(o =>
                isDelivered(o.sleeves_status)
            );
            const inTransitConfirmedCount = inTransitCount; // every in-transit order paid confirmation

            const confirmationCosts = confirmedOrders.length * confirmationFee;
            const realConfirmationCosts = realConfirmedOrders.length * confirmationFee;
            const projectedConfirmationCosts = realConfirmationCosts + (inTransitConfirmedCount * confirmationFee * deliveryRateDecimal);

            // 2. TAX COLLECTED (IVA incluido en el precio de venta)
            // Fórmula: IVA = precio - (precio / (1 + tasa/100))
            // Ejemplo: Si precio = 11000 y tasa = 10%, entonces IVA = 11000 - (11000 / 1.10) = 1000
            const taxCollectedValue = taxRate > 0 ? (rev - (rev / (1 + taxRate / 100))) : 0;
            const realTaxCollected = taxRate > 0 ? (realRevenue - (realRevenue / (1 + taxRate / 100))) : 0;
            const projectedTaxCollected = taxRate > 0 ? (projectedRevenue - (projectedRevenue / (1 + taxRate / 100))) : 0;

            // 3. PRODUCT COSTS - Use pre-fetched line items map (no extra DB query)
            // Same weighting logic as delivery costs: real (incurred), projected (real + weighted in-transit).
            let productCosts = 0;
            let realProductCosts = 0;
            let inTransitProductCosts = 0;

            for (const order of ordersList) {
                const items = prebuiltLineItemsByOrder.get(order.id) || [];
                let orderCost = 0;

                for (const item of items) {
                    // Migration 128: Use stored unit_cost snapshot
                    const itemCost = (Number(item.unit_cost) || 0) * Number(item.quantity || 1);
                    orderCost += itemCost;
                    productCosts += itemCost;
                }

                if (isDelivered(order.sleeves_status)) {
                    realProductCosts += orderCost;
                } else if (isInTransit(order.sleeves_status)) {
                    inTransitProductCosts += orderCost;
                }
            }
            const projectedProductCosts = realProductCosts + (inTransitProductCosts * deliveryRateDecimal);

            // 3.5. ADDITIONAL VALUES FOR THIS PERIOD (from pre-fetched data)
            const additionalValues = allAdditionalValues.filter(av => {
                const avDate = new Date(av.date);
                return avDate >= periodStart && avDate <= periodEnd;
            });

            // Add incomes to revenue
            const additionalIncome = additionalValues
                .filter(av => av.type === 'income')
                .reduce((sum, av) => sum + (Number(av.amount) || 0), 0);
            rev += additionalIncome;
            // Also add to real revenue if it's actual cash
            realRevenue += additionalIncome;

            // NOTE: Marketing expenses (category='marketing', type='expense') from additional_values
            // are now included in gastoPublicitarioCosts parameter passed to this function.
            // Other expense categories (employees, operational) are display-only and not included in analytics.

            // 4. GASTO PUBLICITARIO (from additional_values table, category='marketing')
            // Marketing spend is already incurred regardless of order outcome, so it
            // is not weighted by the delivery rate; it appears in full in real,
            // projected, and "all orders" buckets.
            const gastoPublicitario = gastoPublicitarioCosts;

            // 5. TOTAL OPERATIONAL COSTS
            // Tres buckets distintos:
            //   totalCosts          -> all-orders bucket, used for the legacy proyectado
            //                          full (sum sin ponderar). Mantengo por backwards compat.
            //   realTotalCosts      -> solo pedidos entregados, "money already spent".
            //   projectedTotalCosts -> realTotalCosts + costos in-transit ponderados por
            //                          la tasa de entrega historica del periodo.
            const totalCosts = productCosts + deliveryCosts + confirmationCosts + gastoPublicitario;
            const realTotalCosts = realProductCosts + realDeliveryCosts + realConfirmationCosts + gastoPublicitario;
            const projectedTotalCosts = projectedProductCosts + projectedDeliveryCosts + projectedConfirmationCosts + gastoPublicitario;

            // 6. GROSS PROFIT & MARGIN
            // MARGEN BRUTO = Solo resta el costo de productos (COGS)
            // Esta métrica muestra cuánto ganamos después de pagar los productos
            const grossProfit = rev - productCosts;
            const realGrossProfit = realRevenue - realProductCosts;
            const projectedGrossProfit = projectedRevenue - projectedProductCosts;

            // Gross margin = (Gross Profit / Revenue) × 100
            const grossMargin = rev > 0 ? ((grossProfit / rev) * 100) : 0;
            const realGrossMargin = realRevenue > 0 ? ((realGrossProfit / realRevenue) * 100) : 0;
            const projectedGrossMargin = projectedRevenue > 0 ? ((projectedGrossProfit / projectedRevenue) * 100) : 0;

            // 7. NET PROFIT & MARGIN
            // MARGEN NETO = Resta TODOS los costos (productos + envío + gasto publicitario)
            // Esta métrica muestra la ganancia REAL después de todos los gastos
            // IMPORTANTE: El margen neto SIEMPRE debe ser menor que el margen bruto
            const netProfit = rev - totalCosts;
            const realNetProfit = realRevenue - realTotalCosts;
            const projectedNetProfit = projectedRevenue - projectedTotalCosts;

            // Net margin = (Net Profit / Revenue) × 100
            const netMargin = rev > 0 ? ((netProfit / rev) * 100) : 0;
            const realNetMargin = realRevenue > 0 ? ((realNetProfit / realRevenue) * 100) : 0;
            const projectedNetMargin = projectedRevenue > 0 ? ((projectedNetProfit / projectedRevenue) * 100) : 0;

            // 8. ROI (Return on Investment)
            // Para proyecciones: usa todos los pedidos
            // Convertir a porcentaje multiplicando por 100
            const investment = totalCosts;
            const roiValue = investment > 0 ? (((rev - investment) / investment) * 100) : 0;

            // Para métricas reales: usa solo pedidos entregados
            const realInvestment = realTotalCosts;
            const realRoiValue = realInvestment > 0 ? (((realRevenue - realInvestment) / realInvestment) * 100) : 0;

            // 9. ROAS (Return on Ad Spend)
            // Para proyecciones: usa todos los pedidos
            const roasValue = gastoPublicitario > 0 ? (rev / gastoPublicitario) : 0;

            // Para métricas reales: usa solo pedidos entregados
            const realRoasValue = gastoPublicitario > 0 ? (realRevenue / gastoPublicitario) : 0;

            // 10. DELIVERY RATE for COD: entregados / despachados.
            // Uses the same deliveryRateDecimal calculated above (single source of
            // truth between headline card and projection weighting). Multiplied by
            // 100 here for the percentage display. See metrics-definitions.md.
            const delivRate = dispatched > 0 && deliveredCount > 0
                ? deliveryRateDecimal * 100
                : 0;

            return {
                totalOrders: count,
                revenue: rev,
                realRevenue: realRevenue,
                projectedRevenue: projectedRevenue,
                // Costos separados para transparencia
                productCosts: productCosts,
                realProductCosts: realProductCosts,
                projectedProductCosts: projectedProductCosts,
                deliveryCosts: deliveryCosts,
                realDeliveryCosts: realDeliveryCosts,
                projectedDeliveryCosts: projectedDeliveryCosts,
                confirmationCosts: confirmationCosts,
                realConfirmationCosts: realConfirmationCosts,
                projectedConfirmationCosts: projectedConfirmationCosts,
                gasto_publicitario: gastoPublicitario,
                // Costos totales (para mostrar en dashboard)
                costs: totalCosts,
                realCosts: realTotalCosts,
                projectedCosts: projectedTotalCosts,
                // Gross profit and margin (solo costo de productos)
                grossProfit: grossProfit,
                grossMargin: grossMargin,
                realGrossProfit: realGrossProfit,
                realGrossMargin: realGrossMargin,
                projectedGrossProfit: projectedGrossProfit,
                projectedGrossMargin: projectedGrossMargin,
                // Net profit and margin (todos los costos)
                netProfit: netProfit,
                netMargin: netMargin,
                realNetProfit: realNetProfit,
                realNetMargin: realNetMargin,
                projectedNetProfit: projectedNetProfit,
                projectedNetMargin: projectedNetMargin,
                // ROI y ROAS
                roi: roiValue,
                roas: roasValue,
                realRoi: realRoiValue,
                realRoas: realRoasValue,
                // Otras métricas
                deliveryRate: delivRate,
                taxCollected: taxCollectedValue,
                realTaxCollected: realTaxCollected,
                projectedTaxCollected: projectedTaxCollected,
                // Pipeline diagnostics, useful for tooltips and debugging
                inTransitOrders: inTransitCount,
                inTransitGrossRevenue,
                deliveryRateUsedForProjection: deliveryRateDecimal,
            };
        };

        // Calculate metrics for both periods
        const currentMetrics = await calculateMetrics(currentPeriodOrders, currentGastoPublicitarioCosts, currentPeriodStart, currentPeriodEnd);
        const previousMetrics = await calculateMetrics(previousPeriodOrders, previousGastoPublicitarioCosts, previousPeriodStart, previousPeriodEnd);

        // Use current period metrics as the displayed values
        const revenue = currentMetrics.revenue;
        const taxCollected = currentMetrics.taxCollected;
        const totalCosts = currentMetrics.costs;
        const gasto_publicitario = currentMetrics.gasto_publicitario;
        const grossProfit = currentMetrics.grossProfit;
        const grossMargin = currentMetrics.grossMargin;
        const netProfit = currentMetrics.netProfit;
        const netMargin = currentMetrics.netMargin;
        const roi = currentMetrics.roi;
        const roas = currentMetrics.roas;
        const deliveryRate = currentMetrics.deliveryRate;

        // Count only confirmed orders (exclude pending, cancelled, rejected)
        const confirmedOrders = currentPeriodOrders.filter(o =>
            !['pending', 'cancelled', 'rejected'].includes(o.sleeves_status)
        );
        const confirmedOrdersCount = confirmedOrders.length;

        // Cost per order: legacy variant (numerator includes all-period costs,
        // denominator excludes pending/cancelled/rejected). Kept for backwards
        // compat; UI prefers realCostPerOrder which is internally consistent.
        const costPerOrder = confirmedOrdersCount > 0 ? (totalCosts / confirmedOrdersCount) : 0;

        // Real cost per order: realCosts (delivered-only product/delivery
        // costs + confirmation fees of delivered + full marketing spend)
        // divided by delivered count. Same set in num and denom, which is
        // what the user actually wants to read in the dashboard.
        const deliveredCount = currentPeriodOrders.filter(o => isDelivered(o.sleeves_status)).length;
        const realCostPerOrder = deliveredCount > 0 ? (currentMetrics.realCosts / deliveredCount) : 0;

        const previousDeliveredCount = previousPeriodOrders.filter(o => isDelivered(o.sleeves_status)).length;
        const previousRealCostPerOrder = previousDeliveredCount > 0
            ? (previousMetrics.realCosts / previousDeliveredCount)
            : 0;

        const averageOrderValue = totalOrders > 0 ? (revenue / totalOrders) : 0;

        // ===== CALCULATE PERCENTAGE CHANGES (Current period vs Previous period) =====
        const calculateChange = (current: number, previous: number): number | null => {
            if (previous === 0) return null; // No hay datos previos para comparar
            return parseFloat((((current - previous) / previous) * 100).toFixed(1));
        };

        // Calculate previous period's costPerOrder and averageOrderValue
        const previousTotalOrders = previousMetrics.totalOrders;

        // Count confirmed orders in previous period (exclude pending, cancelled, rejected)
        const previousConfirmedOrders = previousPeriodOrders.filter(o =>
            !['pending', 'cancelled', 'rejected'].includes(o.sleeves_status)
        );
        const previousConfirmedOrdersCount = previousConfirmedOrders.length;

        const previousCostPerOrder = previousConfirmedOrdersCount > 0 ? (previousMetrics.costs / previousConfirmedOrdersCount) : 0;
        const previousAverageOrderValue = previousTotalOrders > 0 ? (previousMetrics.revenue / previousTotalOrders) : 0;

        const changes = {
            totalOrders: calculateChange(currentMetrics.totalOrders, previousMetrics.totalOrders),
            revenue: calculateChange(currentMetrics.revenue, previousMetrics.revenue),
            costs: calculateChange(currentMetrics.costs, previousMetrics.costs),
            productCosts: calculateChange(currentMetrics.productCosts, previousMetrics.productCosts),
            deliveryCosts: calculateChange(currentMetrics.deliveryCosts, previousMetrics.deliveryCosts),
            confirmationCosts: calculateChange(currentMetrics.confirmationCosts, previousMetrics.confirmationCosts),
            gasto_publicitario: calculateChange(currentMetrics.gasto_publicitario, previousMetrics.gasto_publicitario),
            grossProfit: calculateChange(currentMetrics.grossProfit, previousMetrics.grossProfit),
            grossMargin: calculateChange(currentMetrics.grossMargin, previousMetrics.grossMargin),
            netProfit: calculateChange(currentMetrics.netProfit, previousMetrics.netProfit),
            netMargin: calculateChange(currentMetrics.netMargin, previousMetrics.netMargin),
            realRevenue: calculateChange(currentMetrics.realRevenue, previousMetrics.realRevenue),
            realCosts: calculateChange(currentMetrics.realCosts, previousMetrics.realCosts),
            realProductCosts: calculateChange(currentMetrics.realProductCosts, previousMetrics.realProductCosts),
            realDeliveryCosts: calculateChange(currentMetrics.realDeliveryCosts, previousMetrics.realDeliveryCosts),
            realConfirmationCosts: calculateChange(currentMetrics.realConfirmationCosts, previousMetrics.realConfirmationCosts),
            realGrossProfit: calculateChange(currentMetrics.realGrossProfit, previousMetrics.realGrossProfit),
            realGrossMargin: calculateChange(currentMetrics.realGrossMargin, previousMetrics.realGrossMargin),
            realNetProfit: calculateChange(currentMetrics.realNetProfit, previousMetrics.realNetProfit),
            realNetMargin: calculateChange(currentMetrics.realNetMargin, previousMetrics.realNetMargin),
            projectedRevenue: calculateChange(currentMetrics.projectedRevenue, previousMetrics.projectedRevenue),
            projectedNetProfit: calculateChange(currentMetrics.projectedNetProfit, previousMetrics.projectedNetProfit),
            projectedNetMargin: calculateChange(currentMetrics.projectedNetMargin, previousMetrics.projectedNetMargin),
            projectedCosts: calculateChange(currentMetrics.projectedCosts, previousMetrics.projectedCosts),
            roi: calculateChange(currentMetrics.roi, previousMetrics.roi),
            roas: calculateChange(currentMetrics.roas, previousMetrics.roas),
            deliveryRate: calculateChange(currentMetrics.deliveryRate, previousMetrics.deliveryRate),
            taxCollected: calculateChange(currentMetrics.taxCollected, previousMetrics.taxCollected),
            realTaxCollected: calculateChange(currentMetrics.realTaxCollected, previousMetrics.realTaxCollected),
            realRoas: calculateChange(currentMetrics.realRoas, previousMetrics.realRoas),
            realRoi: calculateChange(currentMetrics.realRoi, previousMetrics.realRoi),
            realCostPerOrder: calculateChange(realCostPerOrder, previousRealCostPerOrder),
            costPerOrder: calculateChange(costPerOrder, previousCostPerOrder),
            averageOrderValue: calculateChange(averageOrderValue, previousAverageOrderValue),
        };

        res.json({
            data: {
                // Currency for every money field in this response. Frontend
                // formats with this hint instead of guessing from store
                // settings, eliminating one class of cross-tenant rendering
                // bugs (NOCTE accidentally rendering Solenne USD as PYG).
                currency: storeCurrency,
                offCurrencyDropped: offCurrencyOrders.length,
                totalOrders,
                revenue: Math.round(revenue),
                // Costos separados para transparencia
                productCosts: Math.round(currentMetrics.productCosts),
                deliveryCosts: Math.round(currentMetrics.deliveryCosts),
                confirmationCosts: Math.round(currentMetrics.confirmationCosts),
                costs: Math.round(totalCosts), // Costos totales (productos + envío + confirmación + gasto publicitario)
                gasto_publicitario,
                // Gross profit and margin (Revenue - Product Costs only)
                grossProfit: Math.round(grossProfit),
                grossMargin: parseFloat(grossMargin.toFixed(1)),
                // Net profit and margin (Revenue - All Costs)
                netProfit: Math.round(netProfit),
                netMargin: parseFloat(netMargin.toFixed(1)),
                profitMargin: parseFloat(netMargin.toFixed(1)), // Deprecated: same as netMargin for backwards compatibility
                // Real cash metrics (only delivered orders)
                realRevenue: Math.round(currentMetrics.realRevenue),
                realProductCosts: Math.round(currentMetrics.realProductCosts),
                realDeliveryCosts: Math.round(currentMetrics.realDeliveryCosts),
                realConfirmationCosts: Math.round(currentMetrics.realConfirmationCosts),
                realCosts: Math.round(currentMetrics.realCosts),
                realGrossProfit: Math.round(currentMetrics.realGrossProfit),
                realGrossMargin: parseFloat(currentMetrics.realGrossMargin.toFixed(1)),
                realNetProfit: Math.round(currentMetrics.realNetProfit),
                realNetMargin: parseFloat(currentMetrics.realNetMargin.toFixed(1)),
                realProfitMargin: parseFloat(currentMetrics.realNetMargin.toFixed(1)), // Deprecated: same as realNetMargin for backwards compatibility
                realTaxCollected: Math.round(currentMetrics.realTaxCollected),
                // Projected metrics (delivered + in-transit weighted by historical delivery rate)
                projectedRevenue: Math.round(currentMetrics.projectedRevenue),
                projectedProductCosts: Math.round(currentMetrics.projectedProductCosts),
                projectedDeliveryCosts: Math.round(currentMetrics.projectedDeliveryCosts),
                projectedConfirmationCosts: Math.round(currentMetrics.projectedConfirmationCosts),
                projectedCosts: Math.round(currentMetrics.projectedCosts),
                projectedGrossProfit: Math.round(currentMetrics.projectedGrossProfit),
                projectedGrossMargin: parseFloat(currentMetrics.projectedGrossMargin.toFixed(1)),
                projectedNetProfit: Math.round(currentMetrics.projectedNetProfit),
                projectedNetMargin: parseFloat(currentMetrics.projectedNetMargin.toFixed(1)),
                projectedTaxCollected: Math.round(currentMetrics.projectedTaxCollected),
                // Pipeline diagnostics
                inTransitOrders: currentMetrics.inTransitOrders,
                inTransitGrossRevenue: Math.round(currentMetrics.inTransitGrossRevenue),
                deliveryRateUsedForProjection: parseFloat((currentMetrics.deliveryRateUsedForProjection * 100).toFixed(1)),
                // ROI and ROAS metrics
                roi: parseFloat(roi.toFixed(2)),
                roas: parseFloat(roas.toFixed(2)),
                realRoi: parseFloat(currentMetrics.realRoi.toFixed(2)), // ROI basado en pedidos entregados
                realRoas: parseFloat(currentMetrics.realRoas.toFixed(2)), // ROAS basado en pedidos entregados
                // Other metrics
                deliveryRate: parseFloat(deliveryRate.toFixed(1)),
                costPerOrder: Math.round(costPerOrder),
                realCostPerOrder: Math.round(realCostPerOrder),
                averageOrderValue: Math.round(averageOrderValue),
                taxCollected: Math.round(taxCollected), // IVA recolectado
                taxRate: parseFloat(taxRate.toFixed(2)), // Tasa de IVA configurada
                adSpend: gasto_publicitario, // Alias for compatibility

                // Percentage changes (current period vs previous period)
                changes: {
                    totalOrders: changes.totalOrders,
                    revenue: changes.revenue,
                    costs: changes.costs,
                    productCosts: changes.productCosts,
                    deliveryCosts: changes.deliveryCosts,
                    confirmationCosts: changes.confirmationCosts,
                    gasto_publicitario: changes.gasto_publicitario,
                    grossProfit: changes.grossProfit,
                    grossMargin: changes.grossMargin,
                    netProfit: changes.netProfit,
                    netMargin: changes.netMargin,
                    realRevenue: changes.realRevenue,
                    realCosts: changes.realCosts,
                    realProductCosts: changes.realProductCosts,
                    realDeliveryCosts: changes.realDeliveryCosts,
                    realConfirmationCosts: changes.realConfirmationCosts,
                    realGrossProfit: changes.realGrossProfit,
                    realGrossMargin: changes.realGrossMargin,
                    realNetProfit: changes.realNetProfit,
                    realNetMargin: changes.realNetMargin,
                    projectedRevenue: changes.projectedRevenue,
                    projectedNetProfit: changes.projectedNetProfit,
                    projectedNetMargin: changes.projectedNetMargin,
                    projectedCosts: changes.projectedCosts,
                    roi: changes.roi,
                    roas: changes.roas,
                    deliveryRate: changes.deliveryRate,
                    taxCollected: changes.taxCollected,
                    realTaxCollected: changes.realTaxCollected,
                    realRoas: changes.realRoas,
                    realRoi: changes.realRoi,
                    realCostPerOrder: changes.realCostPerOrder,
                    costPerOrder: changes.costPerOrder,
                    averageOrderValue: changes.averageOrderValue,
                }
            }
        });
    } catch (error: any) {
        logger.error('SERVER', '[GET /api/analytics/overview] Error:', error);
        res.status(500).json({
            error: 'Error al obtener resumen analítico',
            message: error.message
        });
    }
});

// ================================================================
// GET /api/analytics/chart - Chart data (daily aggregated)
// ================================================================
// Devuelve series diarias con tres líneas:
//   realRevenue       -> caja efectiva (solo entregados + ingresos adicionales)
//   projectedRevenue  -> realRevenue + (in-transit * tasa de entrega histórica)
//   revenue           -> alias legacy. Antes era "todos los pedidos sin filtrar"
//                        (incluía cancelados/rechazados). Ahora apunta a
//                        projectedRevenue para alinearlo con la card del overview.
// Costos siguen calculándose solo sobre entregados (costos reales incurridos).
// ================================================================
//
analyticsRouter.get('/chart', async (req: AuthRequest, res: Response) => {
    try {
        const { days = '7', startDate: startDateParam, endDate: endDateParam } = req.query;

        const storeTz = await getStoreTimezone(supabaseAdmin, req.storeId!);
        const storeCurrency = await loadStoreCurrency(req.storeId!);

        // OPTIMIZATION: Only select required fields for chart data
        let query = supabaseAdmin
            .from('orders')
            .select('id, created_at, total_price, sleeves_status, shipping_cost, deleted_at, is_test, currency')
            .eq('store_id', req.storeId)

        // Apply date filters
        if (startDateParam && endDateParam) {
            query = query
                .gte('created_at', startOfDayIso(startDateParam as string, storeTz))
                .lte('created_at', endOfDayIso(endDateParam as string, storeTz));
        } else {
            const daysCount = parseInt(days as string, 10);
            const startIso = startOfDayIso(addDaysInTimezone(-daysCount, storeTz), storeTz);
            query = query.gte('created_at', startIso);
        }

        const { data: ordersData, error: ordersError } = await query;

        if (ordersError) throw ordersError;

        // Filter out soft-deleted, test, and off-currency orders.
        const allOrders = (ordersData || []).filter(o => !o.deleted_at && o.is_test !== true);
        const { inCurrency: orders } = dropOffCurrency(allOrders, storeCurrency);

        // Get gasto publicitario from additional_values table (category='marketing', type='expense')
        const { data: marketingExpensesData, error: marketingExpensesError } = await supabaseAdmin
            .from('additional_values')
            .select('amount, date')
            .eq('store_id', req.storeId)
            .eq('category', 'marketing')
            .eq('type', 'expense');

        if (marketingExpensesError) {
            logger.error('SERVER', '[GET /api/analytics/chart] Marketing expenses query error:', marketingExpensesError);
        }

        const marketingExpenses = marketingExpensesData || [];

        // Group marketing expenses by date
        const dailyMarketingCosts: Record<string, number> = {};
        for (const expense of marketingExpenses) {
            const date = expense.date; // already in YYYY-MM-DD format
            if (!dailyMarketingCosts[date]) {
                dailyMarketingCosts[date] = 0;
            }
            dailyMarketingCosts[date] += Number(expense.amount) || 0;
        }

        // Batch-fetch line items - Migration 128: Use stored unit_cost
        const orderIds = orders.map(o => o.id);
        const { data: allLineItemsData } = orderIds.length > 0 ? await supabaseAdmin
            .from('order_line_items')
            .select('order_id, quantity, unit_cost')
            .in('order_id', orderIds) : { data: [] };

        // Build line items map by order
        const lineItemsByOrder = new Map<string, any[]>();
        (allLineItemsData || []).forEach(item => {
            const orderId = item.order_id;
            if (!lineItemsByOrder.has(orderId)) {
                lineItemsByOrder.set(orderId, []);
            }
            lineItemsByOrder.get(orderId)!.push(item);
        });

        // Get additional values for the date range
        let additionalValuesQuery = supabaseAdmin
            .from('additional_values')
            .select('date, type, amount')
            .eq('store_id', req.storeId);

        if (startDateParam) {
            additionalValuesQuery = additionalValuesQuery.gte('date', startDateParam);
        }
        if (endDateParam) {
            additionalValuesQuery = additionalValuesQuery.lte('date', endDateParam);
        } else if (!startDateParam) {
            const daysCount = parseInt(days as string, 10);
            additionalValuesQuery = additionalValuesQuery.gte('date', addDaysInTimezone(-daysCount, storeTz));
        }

        const { data: additionalValuesData } = await additionalValuesQuery;
        const additionalValues = additionalValuesData || [];

        // Group additional values by date
        const dailyAdditionalValues: Record<string, { income: number; expense: number }> = {};
        for (const av of additionalValues) {
            const date = av.date;
            if (!dailyAdditionalValues[date]) {
                dailyAdditionalValues[date] = { income: 0, expense: 0 };
            }
            if (av.type === 'income') {
                dailyAdditionalValues[date].income += Number(av.amount) || 0;
            } else if (av.type === 'expense') {
                dailyAdditionalValues[date].expense += Number(av.amount) || 0;
            }
        }

        // Group orders by date.
        //   realRevenue        -> only delivered orders + additional income.
        //   inTransitRevenue   -> gross revenue from live pipeline orders that day.
        //   inTransitCount     -> count for that day's pipeline.
        //   deliveredCount     -> for the per-day delivery rate calc.
        // After the loop we compute a global delivery rate over the period and
        // weight inTransitRevenue with it to produce projectedRevenue per day.
        const dailyData: Record<string, {
            realRevenue: number;
            inTransitRevenue: number;
            productCosts: number;
            shippingCosts: number;
            gasto_publicitario: number;
        }> = {};

        let totalDeliveredForRate = 0;
        let totalInTransitForRate = 0;

        for (const order of orders) {
            const date = formatDateInTimezone(order.created_at, storeTz);

            if (!dailyData[date]) {
                dailyData[date] = { realRevenue: 0, inTransitRevenue: 0, productCosts: 0, shippingCosts: 0, gasto_publicitario: 0 };
            }

            const status = order.sleeves_status;
            const total = Number(order.total_price) || 0;

            if (isDelivered(status)) {
                dailyData[date].realRevenue += total;
                dailyData[date].shippingCosts += Number(order.shipping_cost) || 0;
                totalDeliveredForRate += 1;

                // Migration 128: Use stored unit_cost snapshot
                const orderLineItems = lineItemsByOrder.get(order.id) || [];
                for (const item of orderLineItems) {
                    dailyData[date].productCosts += (Number(item.unit_cost) || 0) * (Number(item.quantity) || 1);
                }
            } else if (isInTransit(status)) {
                dailyData[date].inTransitRevenue += total;
                totalInTransitForRate += 1;
            }
            // pending / cancelled / rejected / returned / delivery_failed se omiten
            // del proyectado: no es plata "en camino", es ruido o fracaso.
        }

        // Single delivery rate for the whole period, applied uniformly to every
        // day's in-transit bucket. Mirrors the /overview logic.
        const periodDeliveryDenominator = totalDeliveredForRate + totalInTransitForRate;
        const deliveryRateDecimal = periodDeliveryDenominator > 0 && totalDeliveredForRate > 0
            ? (totalDeliveredForRate / periodDeliveryDenominator)
            : 0.85;

        // Add additional values to revenue and costs for each day
        for (const date in dailyAdditionalValues) {
            if (!dailyData[date]) {
                dailyData[date] = { realRevenue: 0, inTransitRevenue: 0, productCosts: 0, shippingCosts: 0, gasto_publicitario: 0 };
            }
            // Ingresos adicionales son caja efectiva, van directo a real (y por
            // construcción, también al proyectado al sumarlo abajo).
            dailyData[date].realRevenue += dailyAdditionalValues[date].income;
            // Los gastos adicionales se suman a costos de producto
            dailyData[date].productCosts += dailyAdditionalValues[date].expense;
        }

        // Add gasto publicitario costs from marketing expenses for each day
        for (const date in dailyData) {
            dailyData[date].gasto_publicitario = Math.round(dailyMarketingCosts[date] || 0);
        }

        // Calculate chart data with real profit (only delivered orders)
        // Profit = Ingresos reales - Costos de producto - Costos de envío - Gasto publicitario
        const chartData = Object.entries(dailyData).map(([date, data]) => {
            const totalCosts = data.productCosts + data.shippingCosts + data.gasto_publicitario;
            const realProfit = data.realRevenue - totalCosts;
            const projectedRevenue = data.realRevenue + (data.inTransitRevenue * deliveryRateDecimal);

            return {
                date,
                // Legacy alias mantenido para consumidores que aún leen `revenue`.
                // Apunta a projectedRevenue para alinear con la card del overview.
                revenue: Math.round(projectedRevenue),
                // Revenue real (solo entregados + ingresos adicionales)
                realRevenue: Math.round(data.realRevenue),
                // Revenue proyectado (entregados + in-transit ponderado)
                projectedRevenue: Math.round(projectedRevenue),
                // Costos totales (solo de entregados)
                costs: Math.round(data.productCosts + data.shippingCosts),
                productCosts: Math.round(data.productCosts),
                shippingCosts: Math.round(data.shippingCosts),
                gasto_publicitario: data.gasto_publicitario,
                // Profit real (solo de entregados)
                profit: Math.round(realProfit),
            };
        }).sort((a, b) => a.date.localeCompare(b.date));

        res.json({
            currency: storeCurrency,
            data: chartData,
        });
    } catch (error: any) {
        logger.error('SERVER', '[GET /api/analytics/chart] Error:', error);
        res.status(500).json({
            error: 'Error al obtener datos del gráfico',
            message: error.message
        });
    }
});

// ================================================================
// GET /api/analytics/confirmation-metrics - Order confirmation stats
// ================================================================
analyticsRouter.get('/confirmation-metrics', async (req: AuthRequest, res: Response) => {
    try {
        const { startDate, endDate } = req.query;
        const storeTz = await getStoreTimezone(supabaseAdmin, req.storeId!);

        // Build query - OPTIMIZATION: Only select required fields
        let query = supabaseAdmin
            .from('orders')
            .select('id, created_at, sleeves_status, confirmed_at, delivered_at, deleted_at, is_test')
            .eq('store_id', req.storeId)

        // Apply date filters if provided (interpreted in store's local timezone)
        if (startDate) {
            query = query.gte('created_at', startOfDayIso(startDate as string, storeTz));
        }
        if (endDate) {
            query = query.lte('created_at', endOfDayIso(endDate as string, storeTz));
        }

        const { data: ordersData, error: ordersError } = await query;

        if (ordersError) throw ordersError;

        const orders = ordersData || [];
        const totalOrders = orders.length;

        const confirmedOrders = orders.filter(o =>
            POST_PENDING_STATUSES.has(o.sleeves_status)
        ).length;

        const pendingOrders = orders.filter(o => isPending(o.sleeves_status)).length;

        // "Today" anchored to store's local timezone, not server UTC. An order
        // placed at 22:00 Asuncion must still count as "today" even if the
        // server clock already rolled past midnight UTC.
        const todayStr = getTodayInTimezone(storeTz);
        const todayOrders = orders.filter(o =>
            formatDateInTimezone(o.created_at, storeTz) === todayStr,
        );

        // todayConfirmed uses the same set as totalConfirmed below: any state
        // past pending, success or failure. Previously this list was hardcoded
        // to ['confirmed','shipped','delivered'] which undercounted by 25-40%
        // on a normal day for stores with in_transit/settled/returned/etc.
        // Aligning the formula matches the canonical confirmation rate the
        // /api/cod-metrics endpoint serves; the audit's CRITICAL-3 finding
        // was exactly two endpoints disagreeing on this count.
        const todayConfirmed = todayOrders.filter(o => isPostPending(o.sleeves_status)).length;

        const todayPending = todayOrders.filter(o => isPending(o.sleeves_status)).length;

        // Calculate average confirmation time
        const confirmedOrdersWithTime = orders.filter(o => o.confirmed_at && o.created_at);
        let avgConfirmationTime = 0;
        if (confirmedOrdersWithTime.length > 0) {
            const totalTime = confirmedOrdersWithTime.reduce((sum, order) => {
                const created = new Date(order.created_at).getTime();
                const confirmed = new Date(order.confirmed_at).getTime();
                const hours = (confirmed - created) / (1000 * 60 * 60);
                return sum + hours;
            }, 0);
            avgConfirmationTime = totalTime / confirmedOrdersWithTime.length;
        }

        // Calculate average delivery time (from created_at to delivered_at)
        // Only for orders that have been delivered
        const deliveredOrders = orders.filter(o =>
            isDelivered(o.sleeves_status) &&
            o.delivered_at &&
            o.created_at
        );

        let avgDeliveryTime = 0;
        if (deliveredOrders.length > 0) {
            const totalDeliveryTime = deliveredOrders.reduce((sum, order) => {
                const created = new Date(order.created_at).getTime();
                const delivered = new Date(order.delivered_at).getTime();
                // Calculate days
                const days = (delivered - created) / (1000 * 60 * 60 * 24);
                return sum + days;
            }, 0);
            avgDeliveryTime = totalDeliveryTime / deliveredOrders.length;
        }

        // Calculate previous week confirmation rate for comparison
        const last7Days = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const previous7Days = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

        const currentWeekOrders = orders.filter(o => new Date(o.created_at) >= last7Days);
        const previousWeekOrders = orders.filter(o => {
            const date = new Date(o.created_at);
            return date >= previous7Days && date < last7Days;
        });

        const currentWeekConfirmed = currentWeekOrders.filter(o => isPostPending(o.sleeves_status)).length;

        const previousWeekConfirmed = previousWeekOrders.filter(o => isPostPending(o.sleeves_status)).length;

        const currentConfirmRate = currentWeekOrders.length > 0
            ? (currentWeekConfirmed / currentWeekOrders.length) * 100
            : 0;

        const previousConfirmRate = previousWeekOrders.length > 0
            ? (previousWeekConfirmed / previousWeekOrders.length) * 100
            : 0;

        const confirmationRateChange = previousConfirmRate > 0
            ? parseFloat((((currentConfirmRate - previousConfirmRate) / previousConfirmRate) * 100).toFixed(1))
            : null;

        res.json({
            data: {
                totalPending: pendingOrders,
                totalConfirmed: confirmedOrders,
                confirmationRate: totalOrders > 0 ? parseFloat(((confirmedOrders / totalOrders) * 100).toFixed(1)) : 0,
                avgConfirmationTime: parseFloat(avgConfirmationTime.toFixed(1)),
                avgDeliveryTime: parseFloat(avgDeliveryTime.toFixed(1)),
                confirmationsToday: todayConfirmed,
                pendingToday: todayPending,
                confirmationRateChange: confirmationRateChange,
            }
        });
    } catch (error: any) {
        logger.error('SERVER', '[GET /api/analytics/confirmation-metrics] Error:', error);
        res.status(500).json({
            error: 'Error al obtener métricas de confirmación',
            message: error.message
        });
    }
});

// ================================================================
// GET /api/analytics/top-products - Top selling products
// ================================================================
// IMPORTANT: Solo cuenta ventas de pedidos ENTREGADOS
// Esto refleja las ventas reales (dinero efectivamente cobrado)
// ================================================================
analyticsRouter.get('/top-products', async (req: AuthRequest, res: Response) => {
    try {
        const { limit = '5', startDate, endDate } = req.query;

        logger.info('SERVER', `[GET /api/analytics/top-products] Request received - Store: ${req.storeId}, Limit: ${limit}, Date Range: ${startDate || 'none'} to ${endDate || 'none'}`);

        // Validate storeId
        if (!req.storeId) {
            logger.error('SERVER', '[GET /api/analytics/top-products] Missing store ID');
            return res.status(400).json({
                error: 'Store ID is required',
                message: 'Missing store_id in request'
            });
        }

        const storeTz = await getStoreTimezone(supabaseAdmin, req.storeId);

        // FIX-1 (audit 2026-05-02): Source of truth is `order_line_items` joined to
        // `products` and `product_variants`. The previous implementation read the
        // legacy `orders.line_items` JSONB which was lossy (only one item per order
        // for many historical rows) and undercounted real sales by ~50% on NOCTE.
        //
        // Aggregation rules:
        //   - quantity counts physical units sold: pack_qty * units_per_pack when
        //     the line is a shared-stock bundle, else pack_qty.
        //   - revenue uses the line item's persisted unit_price * quantity.
        //   - exclude lines that map to "service" products (is_service=true) or to
        //     placeholder products with cost=0 AND price>0 (e.g. ENVIO PRIORITARIO),
        //     they pollute rankings without representing inventory turnover.
        //   - default window: 365 days, anchored to the store's local calendar.
        const orderIdsQuery = supabaseAdmin
            .from('orders')
            .select('id')
            .eq('store_id', req.storeId)
            .eq('sleeves_status', 'delivered')
            .is('deleted_at', null)
            .or('is_test.is.null,is_test.eq.false');

        if (startDate) {
            orderIdsQuery.gte('created_at', startOfDayIso(startDate as string, storeTz));
        }
        if (endDate) {
            orderIdsQuery.lte('created_at', endOfDayIso(endDate as string, storeTz));
        }
        if (!startDate && !endDate) {
            orderIdsQuery.gte('created_at', startOfDayIso(addDaysInTimezone(-365, storeTz), storeTz));
        }

        const { data: deliveredOrderIds, error: ordersIdsError } = await orderIdsQuery;
        if (ordersIdsError) {
            logger.error('SERVER', '[GET /api/analytics/top-products] Order IDs query error:', ordersIdsError);
            throw ordersIdsError;
        }

        const orderIds = (deliveredOrderIds || []).map(o => o.id);
        logger.info('SERVER', `[GET /api/analytics/top-products] ${orderIds.length} delivered orders in window`);

        if (orderIds.length === 0) {
            return res.json({ data: [] });
        }

        // Fetch line items for all delivered orders in window. Joined to product
        // and variant so we can resolve physical units and exclude services.
        const { data: lineItemsData, error: lineItemsError } = await supabaseAdmin
            .from('order_line_items')
            .select(`
                product_id,
                variant_id,
                quantity,
                unit_price,
                units_per_pack,
                product:products!order_line_items_product_id_fkey (
                    id, name, price, cost, packaging_cost, additional_costs,
                    image_url, stock, is_service, sku
                ),
                variant:product_variants!order_line_items_variant_id_fkey (
                    id, units_per_pack, uses_shared_stock, variant_type
                )
            `)
            .in('order_id', orderIds);

        if (lineItemsError) {
            logger.error('SERVER', '[GET /api/analytics/top-products] Line items query error:', lineItemsError);
            throw lineItemsError;
        }

        // Aggregate per product_id. Track BOTH pack quantity (what the customer
        // bought as a SKU line) and physical units (what came out of inventory),
        // because the frontend uses `sales` for revenue display (sales * price)
        // and that has to match `pack_qty * unit_price`, not physical units.
        type Aggregate = {
            product_id: string;
            product: any;
            packQty: number;        // pack-level quantity = lines sold to customers
            physicalUnits: number;  // unit-level quantity = inventory drained
            revenue: number;        // sum unit_price * pack_qty (sales-side truth)
        };

        const productSales = new Map<string, Aggregate>();

        for (const line of lineItemsData || []) {
            const product: any = (line as any).product;
            const variant: any = (line as any).variant;
            const productId: string | null = (line as any).product_id;

            if (!productId || !product) continue;

            // Exclude service / placeholder products. `is_service=true` is the
            // primary signal; cost=0 with price>0 is a fallback for legacy rows
            // (NOCTE ENVIO PRIORITARIO is the canonical example).
            const productCost = Number(product.cost) || 0;
            const productPrice = Number(product.price) || 0;
            if (product.is_service === true) continue;
            if (productCost === 0 && productPrice > 0) continue;

            const packQty = Number((line as any).quantity) || 0;
            if (packQty <= 0) continue;

            // Physical units: prefer the variant's units_per_pack when the line
            // is a shared-stock bundle. Fall back to the line's persisted value
            // (set when the order was created) and finally to 1.
            let unitsPerPack = 1;
            if (variant && variant.uses_shared_stock === true) {
                unitsPerPack = Number(variant.units_per_pack) || 1;
            } else if ((line as any).units_per_pack) {
                unitsPerPack = Number((line as any).units_per_pack) || 1;
            }
            const physicalUnits = packQty * unitsPerPack;
            const lineRevenue = (Number((line as any).unit_price) || 0) * packQty;

            const existing = productSales.get(productId);
            if (existing) {
                existing.packQty += packQty;
                existing.physicalUnits += physicalUnits;
                existing.revenue += lineRevenue;
            } else {
                productSales.set(productId, {
                    product_id: productId,
                    product,
                    packQty,
                    physicalUnits,
                    revenue: lineRevenue,
                });
            }
        }

        const topAggregates = Array.from(productSales.values())
            .sort((a, b) => b.packQty - a.packQty)
            .slice(0, parseInt(limit as string, 10));

        if (topAggregates.length === 0) {
            return res.json({ data: [] });
        }

        const topProducts = topAggregates.map(({ product, packQty, physicalUnits, revenue }) => {
            const price = Number(product.price) || 0;
            const baseCost = Number(product.cost) || 0;
            const packagingCost = Number(product.packaging_cost) || 0;
            const additionalCosts = Number(product.additional_costs) || 0;
            const totalCost = baseCost + packagingCost + additionalCosts;
            const profitability = price > 0
                ? parseFloat((((price - totalCost) / price) * 100).toFixed(1))
                : 0;

            return {
                id: product.id,
                name: product.name,
                price,
                cost: baseCost,
                packaging_cost: packagingCost,
                additional_costs: additionalCosts,
                image_url: product.image_url,
                stock: product.stock,
                // `sales` keeps backwards-compatible meaning: pack quantity that
                // the customer bought (one line item == one "sale"). Frontend
                // multiplies sales * price for displayed revenue.
                sales: packQty,
                // physical_units is the new inventory-side number and is what
                // the audit asked for (correct accounting of bundles).
                physical_units: physicalUnits,
                sales_revenue: revenue,
                total_cost: totalCost,
                profitability,
            };
        }).sort((a, b) => b.sales - a.sales);

        res.json({
            data: topProducts
        });
    } catch (error: any) {
        logger.error('SERVER', '[GET /api/analytics/top-products] Error:', error);
        res.status(500).json({
            error: 'Error al obtener productos destacados',
            message: error.message
        });
    }
});

// ================================================================
// GET /api/analytics/cash-projection - Advanced cash flow projection
// ================================================================
// Calculates cash projection based on:
// 1. Historical delivery rate
// 2. Orders in different stages (confirmed, in_preparation, ready_to_ship, shipped)
// 3. Real cash already received (delivered orders)
// ================================================================
analyticsRouter.get('/cash-projection', async (req: AuthRequest, res: Response) => {
    try {
        const { lookbackDays = '30' } = req.query;
        const storeTz = await getStoreTimezone(supabaseAdmin, req.storeId!);
        const storeCurrency = await loadStoreCurrency(req.storeId!);

        // Lookback window anchored to store-local midnight, not UTC. Same
        // window an Asuncion merchant sees on their dashboard.
        const lookbackDays_n = Math.max(1, parseInt(lookbackDays as string, 10) || 30);
        const lookbackStartLocal = addDaysInTimezone(-lookbackDays_n, storeTz);

        const { data: historicalOrders, error: historicalError } = await supabaseAdmin
            .from('orders')
            .select('id, created_at, total_price, sleeves_status, shipped_at, currency')
            .eq('store_id', req.storeId)
            .is('deleted_at', null)
            .or('is_test.is.null,is_test.eq.false')
            .gte('created_at', startOfDayIso(lookbackStartLocal, storeTz))

        if (historicalError) throw historicalError;

        const { data: activeOrders, error: activeError } = await supabaseAdmin
            .from('orders')
            .select('id, total_price, sleeves_status, shipped_at, currency')
            .eq('store_id', req.storeId)
            .is('deleted_at', null)
            .or('is_test.is.null,is_test.eq.false')
            .neq('sleeves_status', 'cancelled')
            .neq('sleeves_status', 'rejected')

        if (activeError) throw activeError;

        // Drop off-currency rows so the projection sums make sense.
        const { inCurrency: historical } = dropOffCurrency(historicalOrders || [], storeCurrency);
        const { inCurrency: active } = dropOffCurrency(activeOrders || [], storeCurrency);

        // Historical delivery rate uses the canonical isDispatched + isDelivered
        // helpers. The previous formula (delivered / [shipped, delivered])
        // returned 100% for every store post-148c because no row carries the
        // legacy 'shipped' status. This produced a falsely optimistic cash
        // projection across the board.
        const dispatchedOrders = historical.filter(o => isDispatched(o.sleeves_status, o.shipped_at)).length;
        const deliveredOrders = historical.filter(o => isDeliveredOrSettled(o.sleeves_status)).length;
        const historicalDeliveryRate = dispatchedOrders > 0
            ? (deliveredOrders / dispatchedOrders)
            : 0.85;

        // Cash already in: delivered + settled.
        const deliveredRevenue = active
            .filter(o => isDeliveredOrSettled(o.sleeves_status))
            .reduce((sum, o) => sum + (Number(o.total_price) || 0), 0);

        // Cash in transit: any in_transit_statuses pipeline state. Previously
        // hardcoded sleeves_status='shipped' which post-148c always returned 0.
        const shippedRevenue = active
            .filter(o => isInTransit(o.sleeves_status))
            .reduce((sum, o) => sum + (Number(o.total_price) || 0), 0);

        const expectedFromShipped = shippedRevenue * historicalDeliveryRate;

        // ===== CASH PIPELINE (Ready to ship, In preparation, Confirmed) =====
        const readyToShipRevenue = active
            .filter(o => isReadyToShip(o.sleeves_status))
            .reduce((sum, o) => sum + (Number(o.total_price) || 0), 0);

        const inPreparationRevenue = active
            .filter(o => isInPreparation(o.sleeves_status))
            .reduce((sum, o) => sum + (Number(o.total_price) || 0), 0);

        const confirmedRevenue = active
            .filter(o => isConfirmed(o.sleeves_status))
            .reduce((sum, o) => sum + (Number(o.total_price) || 0), 0);

        // Orders awaiting carrier assignment (separate confirmation flow).
        // 'awaiting_carrier' is a legacy pre-148c status; helper-free direct
        // comparison is intentional here so 148c-clean stores skip the filter.
        const awaitingCarrierRevenue = active
            .filter(o => o.sleeves_status === 'awaiting_carrier')
            .reduce((sum, o) => sum + (Number(o.total_price) || 0), 0);

        // Apply probability weights based on status
        // Ready to ship: 90% probability (very likely to be delivered)
        // In preparation: 80% probability (likely to be delivered)
        // Confirmed: 70% probability (fairly likely to be delivered)
        // Awaiting carrier: 65% probability (confirmed but needs carrier assignment)
        const expectedFromReadyToShip = readyToShipRevenue * 0.90 * historicalDeliveryRate;
        const expectedFromInPreparation = inPreparationRevenue * 0.80 * historicalDeliveryRate;
        const expectedFromConfirmed = confirmedRevenue * 0.70 * historicalDeliveryRate;
        const expectedFromAwaitingCarrier = awaitingCarrierRevenue * 0.65 * historicalDeliveryRate;

        // ===== TOTAL PROJECTIONS =====
        // Conservative projection (only high-probability sources)
        const conservativeProjection = deliveredRevenue + expectedFromShipped + expectedFromReadyToShip;

        // Moderate projection (includes in_preparation)
        const moderateProjection = conservativeProjection + expectedFromInPreparation;

        // Optimistic projection (includes everything - confirmed + awaiting_carrier)
        const optimisticProjection = moderateProjection + expectedFromConfirmed + expectedFromAwaitingCarrier;

        // Average daily revenue from terminal-success orders in the last 30
        // days (store-local). Used as the daily-pace input to future-period
        // projections. Counts settled alongside delivered.
        const last30LocalStart = addDaysInTimezone(-30, storeTz);
        const last30StartIso = startOfDayIso(last30LocalStart, storeTz);

        const recentDelivered = historical.filter(o =>
            isDeliveredOrSettled(o.sleeves_status) &&
            o.created_at >= last30StartIso
        );

        const avgDailyRevenue = recentDelivered.length > 0
            ? recentDelivered.reduce((sum, o) => sum + (Number(o.total_price) || 0), 0) / 30
            : 0;

        // Project revenue for next 7, 14, 30 days
        const projection7Days = optimisticProjection + (avgDailyRevenue * 7);
        const projection14Days = optimisticProjection + (avgDailyRevenue * 14);
        const projection30Days = optimisticProjection + (avgDailyRevenue * 30);

        res.json({
            data: {
                currency: storeCurrency,
                // Current cash status
                cashInHand: Math.round(deliveredRevenue),
                cashInTransit: Math.round(shippedRevenue),
                expectedFromTransit: Math.round(expectedFromShipped),

                // Pipeline breakdown
                pipeline: {
                    readyToShip: {
                        total: Math.round(readyToShipRevenue),
                        expected: Math.round(expectedFromReadyToShip),
                        probability: 90,
                    },
                    inPreparation: {
                        total: Math.round(inPreparationRevenue),
                        expected: Math.round(expectedFromInPreparation),
                        probability: 80,
                    },
                    confirmed: {
                        total: Math.round(confirmedRevenue),
                        expected: Math.round(expectedFromConfirmed),
                        probability: 70,
                    },
                    awaitingCarrier: {
                        total: Math.round(awaitingCarrierRevenue),
                        expected: Math.round(expectedFromAwaitingCarrier),
                        probability: 65,
                    },
                },

                // Projections
                projections: {
                    conservative: Math.round(conservativeProjection),
                    moderate: Math.round(moderateProjection),
                    optimistic: Math.round(optimisticProjection),
                },

                // Future projections (next 7, 14, 30 days)
                futureProjections: {
                    next7Days: Math.round(projection7Days),
                    next14Days: Math.round(projection14Days),
                    next30Days: Math.round(projection30Days),
                },

                // Metrics
                historicalDeliveryRate: parseFloat((historicalDeliveryRate * 100).toFixed(1)),
                avgDailyRevenue: Math.round(avgDailyRevenue),
                lookbackDays: parseInt(lookbackDays as string, 10),
            }
        });
    } catch (error: any) {
        logger.error('SERVER', '[GET /api/analytics/cash-projection] Error:', error);
        res.status(500).json({
            error: 'Error al obtener proyección de efectivo',
            message: error.message
        });
    }
});

// ================================================================
// GET /api/analytics/order-status-distribution - Order status breakdown
// ================================================================
analyticsRouter.get('/order-status-distribution', async (req: AuthRequest, res: Response) => {
    try {
        const { startDate, endDate } = req.query;
        const storeTz = await getStoreTimezone(supabaseAdmin, req.storeId!);

        // Build query - exclude deleted and test orders
        let query = supabaseAdmin
            .from('orders')
            .select('sleeves_status')
            .eq('store_id', req.storeId)
            .is('deleted_at', null)
            .or('is_test.is.null,is_test.eq.false');

        // Apply date filters if provided (store-local day boundaries)
        if (startDate) {
            query = query.gte('created_at', startOfDayIso(startDate as string, storeTz));
        }
        if (endDate) {
            query = query.lte('created_at', endOfDayIso(endDate as string, storeTz));
        }

        // Default 90-day window anchored to the store's local calendar
        if (!startDate && !endDate) {
            query = query.gte('created_at', startOfDayIso(addDaysInTimezone(-90, storeTz), storeTz));
        }

        const { data: ordersData, error: ordersError } = await query;

        if (ordersError) throw ordersError;

        const orders = ordersData || [];
        const statusCounts: Record<string, number> = {};

        for (const order of orders) {
            const status = order.sleeves_status || 'pending';
            statusCounts[status] = (statusCounts[status] || 0) + 1;
        }

        const distribution = Object.entries(statusCounts).map(([status, count]) => ({
            status,
            count,
            percentage: orders.length > 0 ? parseFloat(((count / orders.length) * 100).toFixed(1)) : 0
        }));

        res.json({
            data: distribution
        });
    } catch (error: any) {
        logger.error('SERVER', '[GET /api/analytics/order-status-distribution] Error:', error);
        res.status(500).json({
            error: 'Error al obtener distribución de estados',
            message: error.message
        });
    }
});

// ================================================================
// GET /api/analytics/cash-flow-timeline - Cash flow projection with timeline
// ================================================================
// Calculates when orders will be collected based on their status
// and subtracts costs to show net cash flow over time
// ================================================================
analyticsRouter.get('/cash-flow-timeline', async (req: AuthRequest, res: Response) => {
    try {
        const { periodType = 'week' } = req.query; // 'day' or 'week'
        const storeTz = await getStoreTimezone(supabaseAdmin, req.storeId!);
        const storeCurrency = await loadStoreCurrency(req.storeId!);

        // Default 90-day projection window, anchored to the store's local calendar
        const ninetyDaysAgoIso = startOfDayIso(addDaysInTimezone(-90, storeTz), storeTz);

        const { data: activeOrders, error: ordersError } = await supabaseAdmin
            .from('orders')
            .select('id, total_price, sleeves_status, shipping_cost, currency')
            .eq('store_id', req.storeId)
            .not('sleeves_status', 'in', '(cancelled,returned)')
            .gte('created_at', ninetyDaysAgoIso)

        if (ordersError) throw ordersError;

        const { inCurrency: orders } = dropOffCurrency(activeOrders || [], storeCurrency);

        // FIX-10 (audit 2026-05-02): marketing spend is no longer pre-allocated
        // per order. The previous implementation pulled a 30-day expense window
        // and divided uniformly across the 90-day order set, which prorated
        // historical campaigns against future orders and inflated cost per order.
        // Marketing is now subtracted at the aggregate level after the timeline
        // is built (see "marketing distribution" block below).
        const ninetyDaysAgoLocalDate = addDaysInTimezone(-90, storeTz);
        const { data: marketingExpensesData } = await supabaseAdmin
            .from('additional_values')
            .select('amount, date')
            .eq('store_id', req.storeId)
            .eq('category', 'marketing')
            .eq('type', 'expense')
            .gte('date', ninetyDaysAgoLocalDate);
        const marketingExpenses = (marketingExpensesData || []) as Array<{ amount: number | string; date: string }>;
        const gastoPublicitarioPerOrder = 0; // not prorated per-order anymore

        // Migration 128: Fetch line items with stored unit_cost (fixes bug where order.line_items was undefined)
        const orderIds = orders.map(o => o.id);
        const { data: cashFlowLineItems } = orderIds.length > 0 ? await supabaseAdmin
            .from('order_line_items')
            .select('order_id, quantity, unit_cost')
            .in('order_id', orderIds) : { data: [] };

        const lineItemsByOrder = new Map<string, any[]>();
        (cashFlowLineItems || []).forEach(item => {
            if (!lineItemsByOrder.has(item.order_id)) {
                lineItemsByOrder.set(item.order_id, []);
            }
            lineItemsByOrder.get(item.order_id)!.push(item);
        });

        // Helper function: Calculate days until collection based on order status
        const getDaysUntilCollection = (status: string): { min: number; max: number; probability: number } => {
            switch (status) {
                case 'delivered':
                    return { min: 0, max: 0, probability: 1.0 }; // Already collected
                case 'shipped':
                    return { min: 1, max: 3, probability: 0.90 }; // High probability
                case 'ready_to_ship':
                    return { min: 2, max: 5, probability: 0.85 };
                case 'in_preparation':
                    return { min: 3, max: 7, probability: 0.80 };
                case 'confirmed':
                    return { min: 5, max: 10, probability: 0.70 };
                case 'pending':
                    return { min: 7, max: 14, probability: 0.50 }; // Low probability
                default:
                    return { min: 7, max: 14, probability: 0.50 };
            }
        };

        // Period key computed in the store's local timezone. For week buckets we
        // derive year/week from the local YYYY-MM-DD so a delivery at 22:00
        // Asuncion never leaks into the next calendar week on the UTC clock.
        const getPeriodKey = (date: Date): string => {
            const localDateStr = formatDateInTimezone(date, storeTz);
            if (periodType === 'day') {
                return localDateStr;
            }
            const [yearStr, monthStr, dayStr] = localDateStr.split('-');
            const year = Number(yearStr);
            const localDate = new Date(Date.UTC(year, Number(monthStr) - 1, Number(dayStr)));
            const firstDayOfYear = new Date(Date.UTC(year, 0, 1));
            const pastDaysOfYear = (localDate.getTime() - firstDayOfYear.getTime()) / 86400000;
            const weekNumber = Math.ceil((pastDaysOfYear + firstDayOfYear.getUTCDay() + 1) / 7);
            return `${year}-W${String(weekNumber).padStart(2, '0')}`;
        };

        // Initialize timeline data structure
        const timeline: Record<string, {
            period: string;
            revenue: { conservative: number; moderate: number; optimistic: number };
            costs: { conservative: number; moderate: number; optimistic: number };
            netCashFlow: { conservative: number; moderate: number; optimistic: number };
            ordersCount: { conservative: number; moderate: number; optimistic: number };
        }> = {};

        const today = getStartOfDayInTimezone(storeTz);

        // Process each order
        for (const order of orders) {
            const status = order.sleeves_status || 'pending';
            const { min, max, probability } = getDaysUntilCollection(status);

            // Migration 128: Use stored unit_cost from line items
            let productCosts = 0;
            const items = lineItemsByOrder.get(order.id) || [];
            for (const item of items) {
                productCosts += (Number(item.unit_cost) || 0) * (Number(item.quantity) || 1);
            }

            const shippingCost = Number(order.shipping_cost) || 0;
            const totalCosts = productCosts + shippingCost + gastoPublicitarioPerOrder;
            const revenue = Number(order.total_price) || 0;

            // Calculate collection dates (conservative, moderate, optimistic)
            const conservativeDate = new Date(today);
            conservativeDate.setDate(conservativeDate.getDate() + max); // Pessimistic (max days)

            const moderateDate = new Date(today);
            moderateDate.setDate(moderateDate.getDate() + Math.ceil((min + max) / 2)); // Average

            const optimisticDate = new Date(today);
            optimisticDate.setDate(optimisticDate.getDate() + min); // Optimistic (min days)

            // Get period keys
            const conservativePeriod = getPeriodKey(conservativeDate);
            const moderatePeriod = getPeriodKey(moderateDate);
            const optimisticPeriod = getPeriodKey(optimisticDate);

            // Initialize periods if needed
            [conservativePeriod, moderatePeriod, optimisticPeriod].forEach(period => {
                if (!timeline[period]) {
                    timeline[period] = {
                        period,
                        revenue: { conservative: 0, moderate: 0, optimistic: 0 },
                        costs: { conservative: 0, moderate: 0, optimistic: 0 },
                        netCashFlow: { conservative: 0, moderate: 0, optimistic: 0 },
                        ordersCount: { conservative: 0, moderate: 0, optimistic: 0 },
                    };
                }
            });

            // Add to timeline (weighted by probability)
            // Conservative scenario: max days, reduced probability
            timeline[conservativePeriod].revenue.conservative += revenue * (probability * 0.8);
            timeline[conservativePeriod].costs.conservative += totalCosts * (probability * 0.8);
            timeline[conservativePeriod].ordersCount.conservative += probability * 0.8;

            // Moderate scenario: average days, normal probability
            timeline[moderatePeriod].revenue.moderate += revenue * probability;
            timeline[moderatePeriod].costs.moderate += totalCosts * probability;
            timeline[moderatePeriod].ordersCount.moderate += probability;

            // Optimistic scenario: min days, full probability
            timeline[optimisticPeriod].revenue.optimistic += revenue * probability;
            timeline[optimisticPeriod].costs.optimistic += totalCosts * probability;
            timeline[optimisticPeriod].ordersCount.optimistic += probability;
        }

        // Calculate net cash flow for each period
        const timelineArray = Object.values(timeline).map(period => ({
            ...period,
            revenue: {
                conservative: Math.round(period.revenue.conservative),
                moderate: Math.round(period.revenue.moderate),
                optimistic: Math.round(period.revenue.optimistic),
            },
            costs: {
                conservative: Math.round(period.costs.conservative),
                moderate: Math.round(period.costs.moderate),
                optimistic: Math.round(period.costs.optimistic),
            },
            netCashFlow: {
                conservative: Math.round(period.revenue.conservative - period.costs.conservative),
                moderate: Math.round(period.revenue.moderate - period.costs.moderate),
                optimistic: Math.round(period.revenue.optimistic - period.costs.optimistic),
            },
            ordersCount: {
                conservative: Math.round(period.ordersCount.conservative * 10) / 10,
                moderate: Math.round(period.ordersCount.moderate * 10) / 10,
                optimistic: Math.round(period.ordersCount.optimistic * 10) / 10,
            },
        })).sort((a, b) => a.period.localeCompare(b.period));

        // Calculate cumulative cash flow
        let cumulativeConservative = 0;
        let cumulativeModerate = 0;
        let cumulativeOptimistic = 0;

        const timelineWithCumulative = timelineArray.map(period => {
            cumulativeConservative += period.netCashFlow.conservative;
            cumulativeModerate += period.netCashFlow.moderate;
            cumulativeOptimistic += period.netCashFlow.optimistic;

            return {
                ...period,
                cumulativeCashFlow: {
                    conservative: Math.round(cumulativeConservative),
                    moderate: Math.round(cumulativeModerate),
                    optimistic: Math.round(cumulativeOptimistic),
                },
            };
        });

        // FIX-11 (audit 2026-05-02): summary derives from the timeline that the
        // client renders, not from arbitrary 0.6 / 0.75 / 0.9 multipliers.
        // The multipliers ignored the actual probability and days-to-collect
        // weighting applied per order, producing inflated optimistic and
        // unrealistic conservative scenarios that did not match the chart.
        const summaryRevenue = timelineWithCumulative.reduce(
            (acc, p) => ({
                conservative: acc.conservative + p.revenue.conservative,
                moderate: acc.moderate + p.revenue.moderate,
                optimistic: acc.optimistic + p.revenue.optimistic,
            }),
            { conservative: 0, moderate: 0, optimistic: 0 },
        );
        const summaryNet = timelineWithCumulative.reduce(
            (acc, p) => ({
                conservative: acc.conservative + p.netCashFlow.conservative,
                moderate: acc.moderate + p.netCashFlow.moderate,
                optimistic: acc.optimistic + p.netCashFlow.optimistic,
            }),
            { conservative: 0, moderate: 0, optimistic: 0 },
        );

        // FIX-10 (continued): marketing spend is subtracted at the aggregate
        // level (against the 90-day window of expenses), not prorated per order.
        const totalMarketingSpend = marketingExpenses.reduce(
            (sum, m) => sum + (Number(m.amount) || 0),
            0,
        );

        const summary = {
            totalRevenue: {
                conservative: Math.round(summaryRevenue.conservative),
                moderate: Math.round(summaryRevenue.moderate),
                optimistic: Math.round(summaryRevenue.optimistic),
            },
            totalNetCashFlow: {
                conservative: Math.round(summaryNet.conservative - totalMarketingSpend),
                moderate: Math.round(summaryNet.moderate - totalMarketingSpend),
                optimistic: Math.round(summaryNet.optimistic - totalMarketingSpend),
            },
            totalMarketingSpend: Math.round(totalMarketingSpend),
            totalOrders: orders.length,
            periodType,
            periodsCount: timelineWithCumulative.length,
        };

        res.json({
            data: {
                currency: storeCurrency,
                timeline: timelineWithCumulative,
                summary,
            }
        });
    } catch (error: any) {
        logger.error('SERVER', '[GET /api/analytics/cash-flow-timeline] Error:', error);
        res.status(500).json({
            error: 'Error al obtener flujo de caja',
            message: error.message
        });
    }
});

// ================================================================
// GET /api/analytics/logistics-metrics - Métricas de logística avanzadas
// ================================================================
// Métricas críticas para e-commerce COD:
// - Tasa de pedidos fallidos
// - Pedidos despachados
// - Tasa de rechazo en puerta
// - Cash collection efficiency
// ================================================================
analyticsRouter.get('/logistics-metrics', async (req: AuthRequest, res: Response) => {
    try {
        const { startDate, endDate } = req.query;
        const storeTz = await getStoreTimezone(supabaseAdmin, req.storeId!);
        const storeCurrency = await loadStoreCurrency(req.storeId!);

        // Build date filter with store-local day boundaries
        let dateFilter: { start: Date; end: Date };
        if (startDate && endDate) {
            dateFilter = {
                start: new Date(startOfDayIso(startDate as string, storeTz)),
                end: new Date(endOfDayIso(endDate as string, storeTz))
            };
        } else {
            // Default: last 30 days (store-local)
            dateFilter = {
                end: new Date(),
                start: new Date(startOfDayIso(addDaysInTimezone(-30, storeTz), storeTz))
            };
        }

        // Soft-deleted and test orders filtered at the DB level so logistics
        // metrics agree with the rest of the dashboard (mig 183).
        const { data: ordersData, error: ordersError } = await supabaseAdmin
            .from('orders')
            .select('id, sleeves_status, shipped_at, total_price, delivery_status, failed_reason, payment_status, payment_method, prepaid_method, reconciled_at, created_at, delivered_at, delivery_attempts, shipping_cost, currency')
            .eq('store_id', req.storeId)
            .is('deleted_at', null)
            .or('is_test.is.null,is_test.eq.false')
            .gte('created_at', dateFilter.start.toISOString())
            .lte('created_at', dateFilter.end.toISOString())

        if (ordersError) throw ordersError;

        // Drop off-currency rows so failedOrdersValue / collectedCash sums
        // stay coherent.
        const { inCurrency: orders } = dropOffCurrency(ordersData || [], storeCurrency);

        // Pedidos despachados: canonical isDispatched. Includes the full set
        // (ready_to_ship, in_transit, shipped legacy, delivered, settled,
        // returned, delivery_failed, not_delivered, plus cancelled-with-shipped_at).
        // Three previous formulas in this codebase undercounted by 30-50%
        // post-148c because they hardcoded a 4-status list.
        const dispatchedOrders = orders.filter(o => isDispatched(o.sleeves_status, o.shipped_at));
        const totalDispatched = dispatchedOrders.length;

        // Failed after dispatch: isFailedDelivery (returned, delivery_failed,
        // not_delivered) plus cancelled-with-shipped_at. Pre-dispatch
        // cancellations do not count.
        const failedAfterDispatch = orders.filter(o => {
            if (o.sleeves_status === 'cancelled' && o.shipped_at) return true;
            return isFailedDelivery(o.sleeves_status);
        });
        const totalFailed = failedAfterDispatch.length;

        const failedRate = totalDispatched > 0
            ? parseFloat(((totalFailed / totalDispatched) * 100).toFixed(1))
            : 0;

        const failedOrdersValue = failedAfterDispatch.reduce((sum, o) =>
            sum + (Number(o.total_price) || 0), 0
        );

        // Door rejection: refused at the door. Heuristic over failed_reason
        // and delivery_status text. Brittle but matches existing behaviour;
        // a future migration should normalize these into an enum.
        const doorRejections = orders.filter(o => {
            const rejectionReasons = ['customer_refused', 'rechazado', 'no_acepta', 'refused'];
            const failedReason = (o.failed_reason || '').toLowerCase();
            const deliveryStatus = (o.delivery_status || '').toLowerCase();

            return o.sleeves_status === 'delivery_failed' ||  // legacy pre-148c, not in canonical enum
                rejectionReasons.some(r => failedReason.includes(r) || deliveryStatus.includes(r));
        });

        // Delivery attempts: every order that left the warehouse. Reuse the
        // canonical dispatched set so the door rejection rate denominator
        // matches the totalDispatched headline.
        const deliveryAttempts = totalDispatched;

        const doorRejectionRate = deliveryAttempts > 0
            ? parseFloat(((doorRejections.length / deliveryAttempts) * 100).toFixed(1))
            : 0;

        // Cash collection (mig 183): anchored on reconciled_at (objective
        // courier-closeout evidence) instead of payment_status (a mutable
        // flag the legacy reconciliation paths forgot to set). Denominator
        // is COD-only, since prepaid is already settled before shipping.
        const codTerminalOrders = orders.filter(o =>
            isDeliveredOrSettled(o.sleeves_status) &&
            isOrderCod(o.payment_method, o.prepaid_method)
        );
        const expectedCash = codTerminalOrders.reduce((sum, o) =>
            sum + (Number(o.total_price) || 0), 0
        );

        const reconciledCodOrders = codTerminalOrders.filter(o => o.reconciled_at != null);
        const collectedCash = reconciledCodOrders.reduce((sum, o) =>
            sum + (Number(o.total_price) || 0), 0
        );

        const cashCollectionRate = expectedCash > 0
            ? parseFloat(((collectedCash / expectedCash) * 100).toFixed(1))
            : 0;

        const pendingCollection = codTerminalOrders.filter(o => o.reconciled_at == null);
        const pendingCashAmount = pendingCollection.reduce((sum, o) =>
            sum + (Number(o.total_price) || 0), 0
        );

        const deliveredOrders = orders.filter(o =>
            isDeliveredOrSettled(o.sleeves_status)
        );

        // En transito: canonical isInTransit. Previously hardcoded
        // sleeves_status='shipped' which post-148c always returns 0.
        const inTransitOrders = orders.filter(o => isInTransit(o.sleeves_status));
        const inTransitValue = inTransitOrders.reduce((sum, o) =>
            sum + (Number(o.total_price) || 0), 0
        );

        // Tiempo promedio de entrega (días)
        const deliveredWithDates = deliveredOrders.filter(o => o.created_at && o.delivered_at);
        let avgDeliveryDays = 0;
        if (deliveredWithDates.length > 0) {
            const totalDays = deliveredWithDates.reduce((sum, o) => {
                const created = new Date(o.created_at).getTime();
                const delivered = new Date(o.delivered_at).getTime();
                return sum + (delivered - created) / (1000 * 60 * 60 * 24);
            }, 0);
            avgDeliveryDays = parseFloat((totalDays / deliveredWithDates.length).toFixed(1));
        }

        // Intentos promedio de entrega
        const ordersWithAttempts = orders.filter(o => o.delivery_attempts && o.delivery_attempts > 0);
        const avgDeliveryAttempts = ordersWithAttempts.length > 0
            ? parseFloat((ordersWithAttempts.reduce((sum, o) => sum + (o.delivery_attempts || 0), 0) / ordersWithAttempts.length).toFixed(1))
            : 1;

        // Costo por intento fallido (estimado)
        // Asumimos costo de envío promedio × intentos fallidos
        const avgShippingCost = orders.length > 0
            ? orders.reduce((sum, o) => sum + (Number(o.shipping_cost) || 0), 0) / orders.length
            : 0;
        const costPerFailedAttempt = avgShippingCost * avgDeliveryAttempts;

        res.json({
            data: {
                currency: storeCurrency,
                // Pedidos despachados
                totalDispatched,
                dispatchedValue: Math.round(dispatchedOrders.reduce((sum, o) => sum + (Number(o.total_price) || 0), 0)),

                // Tasa de fallidos
                failedRate,
                totalFailed,
                failedOrdersValue: Math.round(failedOrdersValue),

                // Tasa de rechazo en puerta
                doorRejectionRate,
                doorRejections: doorRejections.length,
                deliveryAttempts,

                // Cash collection
                cashCollectionRate,
                expectedCash: Math.round(expectedCash),
                collectedCash: Math.round(collectedCash),
                pendingCashAmount: Math.round(pendingCashAmount),
                pendingCollectionOrders: pendingCollection.length,

                // Métricas adicionales
                inTransitOrders: inTransitOrders.length,
                inTransitValue: Math.round(inTransitValue),
                avgDeliveryDays,
                avgDeliveryAttempts,
                costPerFailedAttempt: Math.round(costPerFailedAttempt),

                // Totales para contexto
                totalOrders: orders.length,
                deliveredOrders: deliveredOrders.length,
            }
        });
    } catch (error: any) {
        logger.error('SERVER', '[GET /api/analytics/logistics-metrics] Error:', error);
        res.status(500).json({
            error: 'Error al obtener métricas logísticas',
            message: error.message
        });
    }
});

// ================================================================
// GET /api/analytics/returns-metrics - Métricas de devoluciones
// ================================================================
analyticsRouter.get('/returns-metrics', async (req: AuthRequest, res: Response) => {
    try {
        const { startDate, endDate } = req.query;
        const storeTz = await getStoreTimezone(supabaseAdmin, req.storeId!);
        const storeCurrency = await loadStoreCurrency(req.storeId!);

        let dateFilter: { start: Date; end: Date };
        if (startDate && endDate) {
            dateFilter = {
                start: new Date(startOfDayIso(startDate as string, storeTz)),
                end: new Date(endOfDayIso(endDate as string, storeTz))
            };
        } else {
            dateFilter = {
                end: new Date(),
                start: new Date(startOfDayIso(addDaysInTimezone(-30, storeTz), storeTz))
            };
        }

        // Get all orders in the period - OPTIMIZATION: Only required fields
        const { data: ordersData, error: ordersError } = await supabaseAdmin
            .from('orders')
            .select('id, sleeves_status, total_price, currency')
            .eq('store_id', req.storeId)
            .gte('created_at', dateFilter.start.toISOString())
            .lte('created_at', dateFilter.end.toISOString())

        if (ordersError) throw ordersError;

        const { inCurrency: orders } = dropOffCurrency(ordersData || [], storeCurrency);

        // ===== TASA DE DEVOLUCIÓN =====
        // Devoluciones sobre pedidos entregados
        // Tasa = (Pedidos Devueltos / Pedidos Entregados + Devueltos) × 100

        const deliveredOrders = orders.filter(o => isDelivered(o.sleeves_status));
        const returnedOrders = orders.filter(o => isReturned(o.sleeves_status));

        const totalDeliveredAndReturned = deliveredOrders.length + returnedOrders.length;
        const returnRate = totalDeliveredAndReturned > 0
            ? parseFloat(((returnedOrders.length / totalDeliveredAndReturned) * 100).toFixed(1))
            : 0;

        // Valor de devoluciones
        const returnedValue = returnedOrders.reduce((sum, o) =>
            sum + (Number(o.total_price) || 0), 0
        );

        // Get return sessions for more detailed metrics
        const { data: returnSessions, error: sessionsError } = await supabaseAdmin
            .from('return_sessions')
            .select('id, status, created_at')
            .eq('store_id', req.storeId)
            .gte('created_at', dateFilter.start.toISOString())
            .lte('created_at', dateFilter.end.toISOString());

        if (sessionsError) {
            logger.error('SERVER', '[GET /api/analytics/returns-metrics] Sessions query error:', sessionsError);
        }

        const sessions = returnSessions || [];
        const completedSessions = sessions.filter(s => s.status === 'completed');

        // Get return items for acceptance/rejection breakdown
        let items: any[] = [];
        if (sessions.length > 0) {
            const { data: returnItems, error: itemsError } = await supabaseAdmin
                .from('return_session_items')
                .select('quantity_accepted, quantity_rejected, rejection_reason')
                .in('session_id', sessions.map(s => s.id));

            if (itemsError) {
                logger.error('SERVER', '[GET /api/analytics/returns-metrics] Items query error:', itemsError);
            }
            items = returnItems || [];
        }

        // Calculate acceptance vs rejection
        const totalAccepted = items.reduce((sum, i) => sum + (i.quantity_accepted || 0), 0);
        const totalRejected = items.reduce((sum, i) => sum + (i.quantity_rejected || 0), 0);
        const totalItems = totalAccepted + totalRejected;

        const acceptanceRate = totalItems > 0
            ? parseFloat(((totalAccepted / totalItems) * 100).toFixed(1))
            : 0;

        // Rejection reasons breakdown
        const rejectionReasons: Record<string, number> = {};
        items.forEach(item => {
            if (item.rejection_reason && item.quantity_rejected > 0) {
                rejectionReasons[item.rejection_reason] = (rejectionReasons[item.rejection_reason] || 0) + item.quantity_rejected;
            }
        });

        res.json({
            data: {
                currency: storeCurrency,
                // Tasa de devolución principal
                returnRate,
                returnedOrders: returnedOrders.length,
                returnedValue: Math.round(returnedValue),
                deliveredOrders: deliveredOrders.length,

                // Sesiones de devolución
                totalSessions: sessions.length,
                completedSessions: completedSessions.length,
                inProgressSessions: sessions.filter(s => s.status === 'in_progress').length,

                // Items procesados
                totalItemsProcessed: totalItems,
                itemsAccepted: totalAccepted,
                itemsRejected: totalRejected,
                acceptanceRate,

                // Razones de rechazo
                rejectionReasons,

                // Contexto
                totalOrders: orders.length,
            }
        });
    } catch (error: any) {
        logger.error('SERVER', '[GET /api/analytics/returns-metrics] Error:', error);
        res.status(500).json({
            error: 'Error al obtener métricas de devoluciones',
            message: error.message
        });
    }
});

// ================================================================
// GET /api/analytics/incidents-metrics - Métricas de incidencias
// ================================================================
analyticsRouter.get('/incidents-metrics', async (req: AuthRequest, res: Response) => {
    try {
        const { startDate, endDate } = req.query;
        const storeTz = await getStoreTimezone(supabaseAdmin, req.storeId!);

        let dateFilter: { start: Date; end: Date };
        if (startDate && endDate) {
            dateFilter = {
                start: new Date(startOfDayIso(startDate as string, storeTz)),
                end: new Date(endOfDayIso(endDate as string, storeTz))
            };
        } else {
            dateFilter = {
                end: new Date(),
                start: new Date(startOfDayIso(addDaysInTimezone(-30, storeTz), storeTz))
            };
        }

        // Get all incidents in the period - OPTIMIZATION: Select specific fields if delivery_incidents table exists
        const { data: incidentsData, error: incidentsError } = await supabaseAdmin
            .from('delivery_incidents')
            .select('id, created_at, status, resolution_type, current_retry_count')
            .eq('store_id', req.storeId)
            .gte('created_at', dateFilter.start.toISOString())
            .lte('created_at', dateFilter.end.toISOString())

        if (incidentsError) throw incidentsError;

        const incidents = incidentsData || [];

        // ===== TOTAL DE INCIDENCIAS =====
        const totalIncidents = incidents.length;

        // ===== INCIDENCIAS POR ESTADO =====
        const activeIncidents = incidents.filter(i => i.status === 'active');
        const resolvedIncidents = incidents.filter(i => i.status === 'resolved');
        const expiredIncidents = incidents.filter(i => i.status === 'expired');

        // ===== TIPOS DE RESOLUCIÓN =====
        const deliveredResolutions = resolvedIncidents.filter(i => i.resolution_type === 'delivered');
        const cancelledResolutions = resolvedIncidents.filter(i => i.resolution_type === 'cancelled');
        const customerRejectedResolutions = resolvedIncidents.filter(i => i.resolution_type === 'customer_rejected');

        // ===== TASA DE RESOLUCIÓN EXITOSA =====
        // Resolución exitosa = entregados después de incidencia
        const successRate = resolvedIncidents.length > 0
            ? parseFloat(((deliveredResolutions.length / resolvedIncidents.length) * 100).toFixed(1))
            : 0;

        // ===== REINTENTOS PROMEDIO =====
        const avgRetries = incidents.length > 0
            ? parseFloat((incidents.reduce((sum, i) => sum + (i.current_retry_count || 0), 0) / incidents.length).toFixed(1))
            : 0;

        res.json({
            data: {
                // Total de incidencias
                totalIncidents,

                // Estados
                activeIncidents: activeIncidents.length,
                resolvedIncidents: resolvedIncidents.length,
                expiredIncidents: expiredIncidents.length,

                // Resoluciones
                deliveredAfterIncident: deliveredResolutions.length,
                cancelledIncidents: cancelledResolutions.length,
                customerRejectedIncidents: customerRejectedResolutions.length,

                // Tasas
                successRate,
                avgRetries,
            }
        });
    } catch (error: any) {
        logger.error('SERVER', '[GET /api/analytics/incidents-metrics] Error:', error);
        res.status(500).json({
            error: 'Error al obtener métricas de incidentes',
            message: error.message
        });
    }
});

// ================================================================
// GET /api/analytics/shipping-costs - Métricas de Costos de Envío
// ================================================================
// Métricas críticas para gestión de pagos a transportistas:
// - Costos de pedidos entregados (A PAGAR a couriers)
// - Costos de pedidos liquidados (YA PAGADOS a couriers)
// - Costos pendientes (pedidos en tránsito)
// - Desglose por carrier
// ================================================================
analyticsRouter.get('/shipping-costs', async (req: AuthRequest, res: Response) => {
    try {
        const { startDate, endDate } = req.query;
        const storeTz = await getStoreTimezone(supabaseAdmin, req.storeId!);
        const storeCurrency = await loadStoreCurrency(req.storeId!);

        let dateFilter: { start: Date; end: Date };
        if (startDate && endDate) {
            dateFilter = {
                start: new Date(startOfDayIso(startDate as string, storeTz)),
                end: new Date(endOfDayIso(endDate as string, storeTz))
            };
        } else {
            dateFilter = {
                end: new Date(),
                start: new Date(startOfDayIso(addDaysInTimezone(-30, storeTz), storeTz))
            };
        }

        // ===== 1. GET ORDERS DATA =====
        // Use left join to handle orders without assigned courier
        // OPTIMIZATION: Already using specific fields, just adding LIMIT
        const { data: ordersData, error: ordersError } = await supabaseAdmin
            .from('orders')
            .select(`
                id,
                order_number,
                sleeves_status,
                shipping_cost,
                total_price,
                courier_id,
                shipped_at,
                delivered_at,
                created_at,
                reconciled_at,
                currency,
                carriers!left(id, name)
            `)
            .eq('store_id', req.storeId)
            .gte('created_at', dateFilter.start.toISOString())
            .lte('created_at', dateFilter.end.toISOString())

        if (ordersError) throw ordersError;
        const { inCurrency: orders } = dropOffCurrency((ordersData || []) as any[], storeCurrency);

        // ===== 2. GET SETTLEMENTS DATA (actual payments to carriers) =====
        // settlement_date is a DATE column, so compare against store-local calendar days.
        const { data: settlementsData, error: settlementsError } = await supabaseAdmin
            .from('daily_settlements')
            .select(`
                id,
                carrier_id,
                total_carrier_fees,
                amount_paid,
                balance_due,
                status,
                settlement_date,
                total_delivered,
                carriers!left(id, name)
            `)
            .eq('store_id', req.storeId)
            .gte('settlement_date', formatDateInTimezone(dateFilter.start, storeTz))
            .lte('settlement_date', formatDateInTimezone(dateFilter.end, storeTz));

        if (settlementsError) throw settlementsError;
        const settlements = settlementsData || [];

        // ===== 3. CALCULATE SHIPPING COSTS BY ORDER STATUS =====

        // Delivered orders: terminal-success set (delivered + settled). Settled
        // orders have already been paid by the carrier so their shipping cost
        // is reconciled by definition. We keep them in the headline count
        // because the merchant's "Total delivered" card includes them.
        const allDeliveredOrders = orders.filter(o =>
            isDeliveredOrSettled(o.sleeves_status)
        );

        // Unreconciled delivered orders: costs that MUST be paid to carriers.
        // Settled orders are already paid (by definition) so they drop out.
        // Strict isDelivered (not isDeliveredOrSettled) is intentional here.
        const unreconciledDeliveredOrders = allDeliveredOrders.filter(o =>
            !o.reconciled_at && isDelivered(o.sleeves_status)
        );
        const deliveredCosts = unreconciledDeliveredOrders.reduce((sum, o) => sum + (Number(o.shipping_cost) || 0), 0);

        const deliveredOrders = allDeliveredOrders;

        // In-transit orders: canonical isInTransit. Previously hardcoded
        // sleeves_status='shipped' which post-148c always returns 0 because
        // the canonical state is 'in_transit'.
        const inTransitOrders = orders.filter(o => isInTransit(o.sleeves_status));
        const inTransitCosts = inTransitOrders.reduce((sum, o) => sum + (Number(o.shipping_cost) || 0), 0);

        // Ready to ship - orders about to incur shipping costs
        const readyToShipOrders = orders.filter(o => isReadyToShip(o.sleeves_status));
        const readyToShipCosts = readyToShipOrders.reduce((sum, o) => sum + (Number(o.shipping_cost) || 0), 0);

        // ===== 4. CALCULATE ACTUAL PAYMENTS FROM SETTLEMENTS =====

        // Total carrier fees from settlements (what we owe/owed)
        const totalSettlementFees = settlements.reduce((sum, s) => sum + (Number(s.total_carrier_fees) || 0), 0);

        // Actually paid to carriers
        const paidToCarriers = settlements
            .filter(s => s.status === 'paid')
            .reduce((sum, s) => sum + (Number(s.total_carrier_fees) || 0), 0);

        // Pending payment (settlements created but not yet paid).
        // isActiveSettlement = pending or partial (the two "still owe money" states).
        const pendingPayment = settlements
            .filter(s => isActiveSettlement(s.status))
            .reduce((sum, s) => sum + (Number(s.balance_due) || 0), 0);

        // ===== 5. BREAKDOWN BY CARRIER =====
        const carrierMap = new Map<string, {
            id: string;
            name: string;
            deliveredOrders: number;
            deliveredCosts: number;       // From delivered orders (shipping_cost)
            inTransitOrders: number;
            inTransitCosts: number;       // From in-transit orders
            settledCosts: number;         // From settlements (total_carrier_fees)
            paidCosts: number;            // Actually paid (from paid settlements)
            pendingPaymentCosts: number;  // Settlements pending payment
        }>();

        // Process orders for delivery-based costs
        orders.forEach((order: any) => {
            const carrierId = order.courier_id || 'unknown';
            const carrierName = order.carriers?.name || 'Sin Transportista';
            const shippingCost = Number(order.shipping_cost) || 0;

            if (!carrierMap.has(carrierId)) {
                carrierMap.set(carrierId, {
                    id: carrierId,
                    name: carrierName,
                    deliveredOrders: 0,
                    deliveredCosts: 0,
                    inTransitOrders: 0,
                    inTransitCosts: 0,
                    settledCosts: 0,
                    paidCosts: 0,
                    pendingPaymentCosts: 0,
                });
            }

            const carrier = carrierMap.get(carrierId)!;

            if (isDeliveredOrSettled(order.sleeves_status)) {
                // Only count unreconciled delivered orders in toPayCarriers.
                // Settled orders are already paid (terminal state), so they
                // drop out of the to-pay bucket regardless of reconciled_at.
                if (!order.reconciled_at && isDelivered(order.sleeves_status)) {
                    carrier.deliveredOrders++;
                    carrier.deliveredCosts += shippingCost;
                }
            } else if (isInTransit(order.sleeves_status)) {
                carrier.inTransitOrders++;
                carrier.inTransitCosts += shippingCost;
            }
        });

        // Process settlements for actual payment tracking
        settlements.forEach((settlement: any) => {
            const carrierId = settlement.carrier_id || 'unknown';
            const carrierName = settlement.carriers?.name || 'Sin Transportista';

            if (!carrierMap.has(carrierId)) {
                carrierMap.set(carrierId, {
                    id: carrierId,
                    name: carrierName,
                    deliveredOrders: 0,
                    deliveredCosts: 0,
                    inTransitOrders: 0,
                    inTransitCosts: 0,
                    settledCosts: 0,
                    paidCosts: 0,
                    pendingPaymentCosts: 0,
                });
            }

            const carrier = carrierMap.get(carrierId)!;
            carrier.settledCosts += Number(settlement.total_carrier_fees) || 0;

            if (settlement.status === 'paid') {
                carrier.paidCosts += Number(settlement.total_carrier_fees) || 0;
            } else if (isActiveSettlement(settlement.status)) {
                carrier.pendingPaymentCosts += Number(settlement.balance_due) || 0;
            }
        });

        const carrierBreakdown = Array.from(carrierMap.values())
            .filter(c => c.id !== 'unknown')
            .sort((a, b) => b.deliveredCosts - a.deliveredCosts);

        // ===== 6. CALCULATE AVERAGES =====
        const avgCostPerDelivery = deliveredOrders.length > 0
            ? Math.round(deliveredCosts / deliveredOrders.length)
            : 0;

        const totalDeliveredFromSettlements = settlements.reduce((sum, s) => sum + (s.total_delivered || 0), 0);
        const avgCostPerSettledDelivery = totalDeliveredFromSettlements > 0
            ? Math.round(totalSettlementFees / totalDeliveredFromSettlements)
            : 0;

        // Success rate uses canonical isDispatched. Three previous "dispatched"
        // formulas in this codebase used different 3- or 4-status hardcoded
        // lists; aligning here makes shipping-costs success rate match
        // Dashboard delivery rate down to the unit.
        const dispatchedCount = orders.filter(o => isDispatched(o.sleeves_status, o.shipped_at)).length;

        const successRate = dispatchedCount > 0
            ? parseFloat(((deliveredOrders.length / dispatchedCount) * 100).toFixed(1))
            : 0;

        // ===== 8. AVERAGE DELIVERY TIME =====
        const deliveredWithDates = deliveredOrders.filter((o: any) => o.created_at && o.delivered_at);
        let avgDeliveryDays = 0;
        if (deliveredWithDates.length > 0) {
            const totalDays = deliveredWithDates.reduce((sum: number, o: any) => {
                const created = new Date(o.created_at).getTime();
                const delivered = new Date(o.delivered_at).getTime();
                return sum + (delivered - created) / (1000 * 60 * 60 * 24);
            }, 0);
            avgDeliveryDays = parseFloat((totalDays / deliveredWithDates.length).toFixed(1));
        }

        // ===== 9. RETURN RESPONSE =====
        res.json({
            data: {
                currency: storeCurrency,
                // Main Cost Metrics
                costs: {
                    // Costs from UNRECONCILED delivered orders (pending reconciliation/payment)
                    toPayCarriers: Math.round(deliveredCosts),
                    toPayCarriersOrders: unreconciledDeliveredOrders.length,

                    // Costs already settled and PAID to carriers
                    paidToCarriers: Math.round(paidToCarriers),

                    // Settlements created but payment pending
                    pendingPayment: Math.round(pendingPayment),

                    // In-transit costs (future obligations)
                    inTransit: Math.round(inTransitCosts),
                    inTransitOrders: inTransitOrders.length,

                    // Ready to ship (about to incur costs)
                    readyToShip: Math.round(readyToShipCosts),
                    readyToShipOrders: readyToShipOrders.length,

                    // Total costs (delivered + in-transit)
                    totalCommitted: Math.round(deliveredCosts + inTransitCosts),

                    // Grand total including ready to ship
                    grandTotal: Math.round(deliveredCosts + inTransitCosts + readyToShipCosts),
                },

                // Averages
                averages: {
                    costPerDelivery: avgCostPerDelivery,
                    costPerSettledDelivery: avgCostPerSettledDelivery,
                    deliveryDays: avgDeliveryDays,
                },

                // Performance
                performance: {
                    successRate,
                    totalDispatched: dispatchedCount,
                    totalDelivered: deliveredOrders.length,
                },

                // Settlements Summary
                settlements: {
                    total: settlements.length,
                    paid: settlements.filter(s => s.status === 'paid').length,
                    pending: settlements.filter(s => s.status === 'pending').length,
                    partial: settlements.filter(s => s.status === 'partial').length,
                    totalFees: Math.round(totalSettlementFees),
                    totalPaid: Math.round(paidToCarriers),
                    totalPending: Math.round(pendingPayment),
                },

                // Carrier Breakdown
                carrierBreakdown,

                // Period info (store-local calendar dates for display)
                period: {
                    start: formatDateInTimezone(dateFilter.start, storeTz),
                    end: formatDateInTimezone(dateFilter.end, storeTz),
                }
            }
        });
    } catch (error: any) {
        logger.error('SERVER', '[GET /api/analytics/shipping-costs] Error:', error);
        res.status(500).json({
            error: 'Error al obtener métricas de costos de envío',
            message: error.message
        });
    }
});

// ================================================================
// GET /api/analytics/notification-data - Lightweight data for notification engine
// ================================================================
// Returns only the minimal fields needed for notification generation
// Optimized to avoid loading full order details (line_items, etc.)
// ================================================================
analyticsRouter.get('/notification-data', async (req: AuthRequest, res: Response) => {
    try {
        const storeId = req.storeId;

        // The notification engine consumes four arrays to build counts and
        // deep-link metadata. Each query is intentionally narrow so the wire
        // payload stays in the low double-digit kilobytes even for busy stores.
        //
        // Orders: only records that can produce an alert in the last 7 days
        // (pending + awaiting_carrier + tomorrow's confirmed/ready_to_ship).
        // The shape only carries the columns the engine reads. Hard-capped
        // at 100 rows so a single noisy store does not balloon the response.
        //
        // Products: low/out-of-stock only (stock <= threshold). The engine
        // partitions this into out-of-stock and warning buckets locally.
        //
        // Ads + carriers: lightweight, both already small per store.
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        const dayAfterTomorrow = new Date(tomorrow);
        dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 1);

        const ALERT_STATUSES = ['pending', 'awaiting_carrier', 'confirmed', 'ready_to_ship'];
        const STOCK_ALERT_THRESHOLD = 10;
        const ORDERS_LIMIT = 100;
        const PRODUCTS_LIMIT = 100;

        const [ordersRes, productsRes, adsRes, carriersRes] = await Promise.all([
            supabaseAdmin
                .from('orders')
                .select('id, sleeves_status, created_at, customer_first_name, customer_last_name, delivery_preferences')
                .eq('store_id', storeId)
                .in('sleeves_status', ALERT_STATUSES)
                .gte('created_at', sevenDaysAgo.toISOString())
                .order('created_at', { ascending: false })
                .limit(ORDERS_LIMIT),
            supabaseAdmin
                .from('products')
                .select('id, name, stock')
                .eq('store_id', storeId)
                .eq('is_active', true)
                .lte('stock', STOCK_ALERT_THRESHOLD)
                .order('stock', { ascending: true })
                .limit(PRODUCTS_LIMIT),
            supabaseAdmin
                .from('campaigns')
                .select('id, status, campaign_name, investment')
                .eq('store_id', storeId)
                .in('status', ['active', 'scheduled']),
            supabaseAdmin
                .from('carriers')
                .select('id, name')
                .eq('store_id', storeId)
                .eq('is_active', true),
        ]);

        if (ordersRes.error) {
            logger.error('SERVER', '[GET /api/analytics/notification-data] Orders error:', ordersRes.error);
            throw ordersRes.error;
        }
        if (productsRes.error) {
            logger.error('SERVER', '[GET /api/analytics/notification-data] Products error:', productsRes.error);
            throw productsRes.error;
        }
        if (adsRes.error) {
            logger.error('SERVER', '[GET /api/analytics/notification-data] Ads error:', adsRes.error);
            throw adsRes.error;
        }
        if (carriersRes.error) {
            logger.error('SERVER', '[GET /api/analytics/notification-data] Carriers error:', carriersRes.error);
            throw carriersRes.error;
        }

        const transformedOrders = (ordersRes.data || []).map(o => {
            const prefs = o.delivery_preferences as { not_before_date?: string } | null;
            return {
                id: o.id,
                status: o.sleeves_status,
                date: o.created_at,
                customer: `${o.customer_first_name || ''} ${o.customer_last_name || ''}`.trim() || 'Cliente',
                delivery_date: prefs?.not_before_date,
            };
        });

        const transformedProducts = (productsRes.data || []).map(p => ({
            id: p.id,
            name: p.name,
            stock: p.stock,
        }));

        const transformedAds = (adsRes.data || []).map(a => ({
            id: a.id,
            status: a.status,
            name: a.campaign_name,
            investment: a.investment,
        }));

        const transformedCarriers = (carriersRes.data || []).map(c => ({
            id: c.id,
            name: c.name,
        }));

        // Cache for the polling window. The header refreshes every 30 minutes;
        // letting the browser reuse the response inside that window protects
        // against accidental double-fetches (tab focus storms, mount loops).
        res.set('Cache-Control', 'private, max-age=60');

        res.json({
            success: true,
            data: {
                orders: transformedOrders,
                products: transformedProducts,
                ads: transformedAds,
                carriers: transformedCarriers,
            }
        });
    } catch (error: any) {
        logger.error('SERVER', '[GET /api/analytics/notification-data] Error:', error);
        res.status(500).json({
            error: 'Error al obtener datos de notificaciones',
            message: error.message
        });
    }
});

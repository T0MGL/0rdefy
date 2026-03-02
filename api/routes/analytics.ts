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

export const analyticsRouter = Router();

analyticsRouter.use(verifyToken, extractStoreId, extractUserRole);

// Apply module-level access check for all routes
analyticsRouter.use(requireModule(Module.ANALYTICS));

// Helper function to convert date string to end of day ISO string
const toEndOfDay = (dateString: string): string => {
    const date = new Date(dateString);
    date.setHours(23, 59, 59, 999);
    return date.toISOString();
};


// ================================================================
// GET /api/analytics/overview - Dashboard overview metrics
// ================================================================
analyticsRouter.get('/overview', async (req: AuthRequest, res: Response) => {
    try {
        const { startDate, endDate } = req.query;

        // Get store tax rate and confirmation fee from store_config
        const { data: storeData, error: storeError } = await supabaseAdmin
            .from('stores')
            .select('tax_rate')
            .eq('id', req.storeId)
            .single();

        if (storeError) {
            logger.error('SERVER', '[GET /api/analytics/overview] Store query error:', storeError);
        }

        const taxRate = Number(storeData?.tax_rate) || 0;

        // Get confirmation fee from store_config
        const { data: configData } = await supabaseAdmin
            .from('store_config')
            .select('confirmation_fee')
            .eq('store_id', req.storeId)
            .single();

        const confirmationFee = Number(configData?.confirmation_fee) || 0;

        // Calculate date ranges for comparison (use provided dates or default to 7 days)
        let currentPeriodStart: Date;
        let currentPeriodEnd: Date;
        let previousPeriodStart: Date;
        let previousPeriodEnd: Date;

        if (startDate && endDate) {
            currentPeriodStart = new Date(startDate as string);
            // Convert endDate to end of day to include all orders from that day
            currentPeriodEnd = new Date(toEndOfDay(endDate as string));

            // Validate dates are valid and start < end
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
            .select('id, created_at, total_price, sleeves_status, shipping_cost, confirmed_at, delivered_at, shipped_at, deleted_at, is_test')
            .eq('store_id', req.storeId)
            .gte('created_at', previousPeriodStart.toISOString())
            .lte('created_at', currentPeriodEnd.toISOString());

        const { data: ordersData, error: ordersError } = await query;

        if (ordersError) throw ordersError;

        // Filter out soft-deleted and test orders in memory (columns may not exist in all DBs)
        const orders = (ordersData || []).filter(o =>
            !o.deleted_at && o.is_test !== true
        );

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
            .gte('date', previousPeriodStart.toISOString().split('T')[0])
            .lte('date', currentPeriodEnd.toISOString().split('T')[0]);

        if (marketingExpensesError) {
            logger.error('SERVER', '[GET /api/analytics/overview] Marketing expenses query error:', marketingExpensesError);
        }

        const marketingExpenses = marketingExpensesData || [];

        // Calculate gasto publicitario costs for current period
        const currentGastoPublicitarioCosts = marketingExpenses
            .filter(m => {
                const expenseDate = new Date(m.date);
                return expenseDate >= last7DaysStart && expenseDate <= currentPeriodEnd;
            })
            .reduce((sum, m) => sum + (Number(m.amount) || 0), 0);

        // Calculate gasto publicitario costs for previous period
        const previousGastoPublicitarioCosts = marketingExpenses
            .filter(m => {
                const expenseDate = new Date(m.date);
                return expenseDate >= previous7DaysStart && expenseDate < last7DaysStart;
            })
            .reduce((sum, m) => sum + (Number(m.amount) || 0), 0);

        // ===== PRE-FETCH: Line items and additional values for ALL orders (both periods) =====
        const allOrderIds = orders.map(o => o.id);

        // Pre-fetch line items once (eliminates duplicate query inside calculateMetrics)
        const { data: allLineItemsData } = allOrderIds.length > 0 ? await supabaseAdmin
            .from('order_line_items')
            .select(`
                order_id,
                product_id,
                variant_id,
                quantity,
                products:product_id (id, cost, packaging_cost, additional_costs),
                variants:variant_id (id, cost)
            `)
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
            .gte('date', previousPeriodStart.toISOString().split('T')[0])
            .lte('date', currentPeriodEnd.toISOString().split('T')[0]);

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
                .filter(o => o.sleeves_status === 'delivered')
                .reduce((sum, order) => sum + (Number(order.total_price) || 0), 0);

            // 1.6. PROJECTED REVENUE (delivered + shipped adjusted by delivery rate)
            // Calculate revenue from shipped orders (in transit)
            const shippedRevenue = ordersList
                .filter(o => o.sleeves_status === 'shipped')
                .reduce((sum, order) => sum + (Number(order.total_price) || 0), 0);

            // Calculate delivery rate for projection
            const shippedOrDelivered = ordersList.filter(o =>
                o.sleeves_status === 'shipped' || o.sleeves_status === 'delivered'
            ).length;
            const delivered = ordersList.filter(o => o.sleeves_status === 'delivered').length;
            // Use historical delivery rate if available, otherwise use 85% default
            // If there are shipped orders but no deliveries yet, still use the 85% default
            const deliveryRateDecimal = shippedOrDelivered > 0 && delivered > 0
                ? (delivered / shippedOrDelivered)
                : 0.85; // Default 85% for new stores or when no deliveries yet

            // Projected revenue = delivered (100%) + shipped (adjusted by delivery rate)
            const projectedRevenue = realRevenue + (shippedRevenue * deliveryRateDecimal);

            // 1.7. DELIVERY COSTS (shipping costs from orders)
            // These are costs that must be subtracted from profit
            let deliveryCosts = 0;
            let realDeliveryCosts = 0;

            for (const order of ordersList) {
                const shippingCost = Number(order.shipping_cost) || 0;
                deliveryCosts += shippingCost;

                // Only count delivery costs for delivered orders
                if (order.sleeves_status === 'delivered') {
                    realDeliveryCosts += shippingCost;
                }
            }

            // 1.8. CONFIRMATION FEES (cost per confirmed order)
            // Count confirmed orders (all statuses except pending, cancelled, rejected)
            const confirmedOrders = ordersList.filter(o =>
                !['pending', 'cancelled', 'rejected'].includes(o.sleeves_status)
            );
            const realConfirmedOrders = ordersList.filter(o =>
                o.sleeves_status === 'delivered'
            );

            const confirmationCosts = confirmedOrders.length * confirmationFee;
            const realConfirmationCosts = realConfirmedOrders.length * confirmationFee;

            // 2. TAX COLLECTED (IVA incluido en el precio de venta)
            // Fórmula: IVA = precio - (precio / (1 + tasa/100))
            // Ejemplo: Si precio = 11000 y tasa = 10%, entonces IVA = 11000 - (11000 / 1.10) = 1000
            const taxCollectedValue = taxRate > 0 ? (rev - (rev / (1 + taxRate / 100))) : 0;

            // 3. PRODUCT COSTS - Use pre-fetched line items map (no extra DB query)
            // Calculate product costs
            let productCosts = 0;
            let realProductCosts = 0;

            for (const order of ordersList) {
                const items = prebuiltLineItemsByOrder.get(order.id) || [];
                let orderCost = 0;

                for (const item of items) {
                    let itemUnitCost = 0;

                    // Check variant cost first (if variant exists and has cost)
                    if (item.variants && item.variants.cost !== null && item.variants.cost !== undefined) {
                        itemUnitCost = Number(item.variants.cost) || 0;
                    }
                    // Fall back to product cost
                    else if (item.products) {
                        const baseCost = Number(item.products.cost) || 0;
                        const packaging = Number(item.products.packaging_cost) || 0;
                        const additional = Number(item.products.additional_costs) || 0;
                        itemUnitCost = baseCost + packaging + additional;
                    }

                    const itemCost = itemUnitCost * Number(item.quantity || 1);
                    orderCost += itemCost;
                    productCosts += itemCost;
                }

                // Only count costs for delivered orders (real money spent)
                if (order.sleeves_status === 'delivered') {
                    realProductCosts += orderCost;
                }
            }

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
            const gastoPublicitario = gastoPublicitarioCosts;

            // 5. TOTAL OPERATIONAL COSTS
            // Para e-commerce COD, los costos totales incluyen:
            // - Costo de productos (COGS)
            // - Costos de envío (shipping_cost)
            // - Costos de confirmación (confirmation_fee × confirmed orders)
            // - Gasto Publicitario (campaigns)
            // IMPORTANTE: Estos son los costos TOTALES operativos
            const totalCosts = productCosts + deliveryCosts + confirmationCosts + gastoPublicitario;
            const realTotalCosts = realProductCosts + realDeliveryCosts + realConfirmationCosts + gastoPublicitario;

            // 6. GROSS PROFIT & MARGIN
            // MARGEN BRUTO = Solo resta el costo de productos (COGS)
            // Esta métrica muestra cuánto ganamos después de pagar los productos
            const grossProfit = rev - productCosts;
            const realGrossProfit = realRevenue - realProductCosts;

            // Gross margin = (Gross Profit / Revenue) × 100
            const grossMargin = rev > 0 ? ((grossProfit / rev) * 100) : 0;
            const realGrossMargin = realRevenue > 0 ? ((realGrossProfit / realRevenue) * 100) : 0;

            // 7. NET PROFIT & MARGIN
            // MARGEN NETO = Resta TODOS los costos (productos + envío + gasto publicitario)
            // Esta métrica muestra la ganancia REAL después de todos los gastos
            // IMPORTANTE: El margen neto SIEMPRE debe ser menor que el margen bruto
            const netProfit = rev - totalCosts;
            const realNetProfit = realRevenue - realTotalCosts;

            // Net margin = (Net Profit / Revenue) × 100
            const netMargin = rev > 0 ? ((netProfit / rev) * 100) : 0;
            const realNetMargin = realRevenue > 0 ? ((realNetProfit / realRevenue) * 100) : 0;

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

            // 10. DELIVERY RATE
            // ✅ CORREGIDO: Tasa de entrega para COD
            // Total despachados = todos los pedidos que salieron del almacén
            // (ready_to_ship, shipped, delivered, returned, cancelled después de envío, delivery_failed)
            const dispatched = ordersList.filter(o => {
                const status = o.sleeves_status;
                return ['ready_to_ship', 'shipped', 'delivered', 'returned', 'delivery_failed'].includes(status) ||
                    (status === 'cancelled' && o.shipped_at); // Cancelados después de despacho
            }).length;
            // Tasa de entrega = (Entregados / Total Despachados) × 100
            const delivRate = dispatched > 0 ? ((delivered / dispatched) * 100) : 0;

            return {
                totalOrders: count,
                revenue: rev,
                realRevenue: realRevenue,
                projectedRevenue: projectedRevenue,
                // Costos separados para transparencia
                productCosts: productCosts,
                realProductCosts: realProductCosts,
                deliveryCosts: deliveryCosts,
                realDeliveryCosts: realDeliveryCosts,
                confirmationCosts: confirmationCosts,
                realConfirmationCosts: realConfirmationCosts,
                gasto_publicitario: gastoPublicitario,
                // Costos totales (para mostrar en dashboard)
                costs: totalCosts,
                realCosts: realTotalCosts,
                // Gross profit and margin (solo costo de productos)
                grossProfit: grossProfit,
                grossMargin: grossMargin,
                realGrossProfit: realGrossProfit,
                realGrossMargin: realGrossMargin,
                // Net profit and margin (todos los costos)
                netProfit: netProfit,
                netMargin: netMargin,
                realNetProfit: realNetProfit,
                realNetMargin: realNetMargin,
                // ROI y ROAS
                roi: roiValue,
                roas: roasValue,
                realRoi: realRoiValue,
                realRoas: realRoasValue,
                // Otras métricas
                deliveryRate: delivRate,
                taxCollected: taxCollectedValue,
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

        // Cost per order should only count confirmed orders (orders that incurred real costs)
        const costPerOrder = confirmedOrdersCount > 0 ? (totalCosts / confirmedOrdersCount) : 0;
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
            roi: calculateChange(currentMetrics.roi, previousMetrics.roi),
            roas: calculateChange(currentMetrics.roas, previousMetrics.roas),
            deliveryRate: calculateChange(currentMetrics.deliveryRate, previousMetrics.deliveryRate),
            taxCollected: calculateChange(currentMetrics.taxCollected, previousMetrics.taxCollected),
            costPerOrder: calculateChange(costPerOrder, previousCostPerOrder),
            averageOrderValue: calculateChange(averageOrderValue, previousAverageOrderValue),
        };

        res.json({
            data: {
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
                projectedRevenue: Math.round(currentMetrics.projectedRevenue),
                realProductCosts: Math.round(currentMetrics.realProductCosts),
                realDeliveryCosts: Math.round(currentMetrics.realDeliveryCosts),
                realConfirmationCosts: Math.round(currentMetrics.realConfirmationCosts),
                realCosts: Math.round(currentMetrics.realCosts),
                realGrossProfit: Math.round(currentMetrics.realGrossProfit),
                realGrossMargin: parseFloat(currentMetrics.realGrossMargin.toFixed(1)),
                realNetProfit: Math.round(currentMetrics.realNetProfit),
                realNetMargin: parseFloat(currentMetrics.realNetMargin.toFixed(1)),
                realProfitMargin: parseFloat(currentMetrics.realNetMargin.toFixed(1)), // Deprecated: same as realNetMargin for backwards compatibility
                // ROI and ROAS metrics
                roi: parseFloat(roi.toFixed(2)),
                roas: parseFloat(roas.toFixed(2)),
                realRoi: parseFloat(currentMetrics.realRoi.toFixed(2)), // ROI basado en pedidos entregados
                realRoas: parseFloat(currentMetrics.realRoas.toFixed(2)), // ROAS basado en pedidos entregados
                // Other metrics
                deliveryRate: parseFloat(deliveryRate.toFixed(1)),
                costPerOrder: Math.round(costPerOrder),
                averageOrderValue: Math.round(averageOrderValue),
                taxCollected: Math.round(taxCollected), // IVA recolectado
                taxRate: parseFloat(taxRate.toFixed(2)), // Tasa de IVA configurada
                adSpend: gasto_publicitario, // Alias for compatibility
                adRevenue: revenue, // Placeholder
                conversionRate: deliveryRate, // Placeholder

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
                    roi: changes.roi,
                    roas: changes.roas,
                    deliveryRate: changes.deliveryRate,
                    taxCollected: changes.taxCollected,
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
// Muestra datos de TODOS los pedidos para proyección de caja
// Pero calcula costos SOLO de pedidos entregados (costos reales incurridos)
// ================================================================
analyticsRouter.get('/chart', async (req: AuthRequest, res: Response) => {
    try {
        const { days = '7', startDate: startDateParam, endDate: endDateParam } = req.query;

        // OPTIMIZATION: Only select required fields for chart data
        let query = supabaseAdmin
            .from('orders')
            .select('id, created_at, total_price, sleeves_status, shipping_cost, deleted_at, is_test')
            .eq('store_id', req.storeId)

        // Apply date filters
        if (startDateParam && endDateParam) {
            // Convert endDate to end of day to include all orders from that day
            query = query.gte('created_at', startDateParam).lte('created_at', toEndOfDay(endDateParam as string));
        } else {
            const daysCount = parseInt(days as string, 10);
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - daysCount);
            query = query.gte('created_at', startDate.toISOString());
        }

        const { data: ordersData, error: ordersError } = await query;

        if (ordersError) throw ordersError;

        // Filter out soft-deleted and test orders (same as overview endpoint)
        const orders = (ordersData || []).filter(o => !o.deleted_at && o.is_test !== true);

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

        // Batch-fetch line items with product/variant costs (same pattern as overview endpoint)
        const orderIds = orders.map(o => o.id);
        const { data: allLineItemsData } = orderIds.length > 0 ? await supabaseAdmin
            .from('order_line_items')
            .select(`
                order_id,
                product_id,
                variant_id,
                quantity,
                products:product_id (id, cost, packaging_cost, additional_costs),
                variants:variant_id (id, cost)
            `)
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
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - daysCount);
            additionalValuesQuery = additionalValuesQuery.gte('date', startDate.toISOString().split('T')[0]);
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

        // Group orders by date
        // Revenue proyectado = todos los pedidos (para saber cuánto puede entrar)
        // Costos reales = solo pedidos entregados (dinero que ya salió)
        const dailyData: Record<string, {
            projectedRevenue: number; // Todos los pedidos
            realRevenue: number;      // Solo entregados
            productCosts: number;     // Solo entregados
            shippingCosts: number;    // Solo entregados
            gasto_publicitario: number;
        }> = {};

        for (const order of orders) {
            const date = new Date(order.created_at).toISOString().split('T')[0];

            if (!dailyData[date]) {
                dailyData[date] = { projectedRevenue: 0, realRevenue: 0, productCosts: 0, shippingCosts: 0, gasto_publicitario: 0 };
            }

            // Proyección: suma todos los pedidos
            dailyData[date].projectedRevenue += Number(order.total_price) || 0;

            // Solo sumar costos e ingresos reales para pedidos entregados
            if (order.sleeves_status === 'delivered') {
                dailyData[date].realRevenue += Number(order.total_price) || 0;
                dailyData[date].shippingCosts += Number(order.shipping_cost) || 0;

                // Calculate product costs from pre-fetched line items
                const orderLineItems = lineItemsByOrder.get(order.id) || [];
                for (const item of orderLineItems) {
                    let itemUnitCost = 0;
                    // Check variant cost first, then product cost
                    const variant = item.variants;
                    const product = item.products;
                    if (variant && variant.cost !== null && variant.cost !== undefined) {
                        itemUnitCost = Number(variant.cost) || 0;
                    } else if (product) {
                        const baseCost = Number(product.cost) || 0;
                        const packaging = Number(product.packaging_cost) || 0;
                        const additional = Number(product.additional_costs) || 0;
                        itemUnitCost = baseCost + packaging + additional;
                    }
                    dailyData[date].productCosts += itemUnitCost * (Number(item.quantity) || 1);
                }
            }
        }

        // Add additional values to revenue and costs for each day
        for (const date in dailyAdditionalValues) {
            if (!dailyData[date]) {
                dailyData[date] = { projectedRevenue: 0, realRevenue: 0, productCosts: 0, shippingCosts: 0, gasto_publicitario: 0 };
            }
            // Los ingresos adicionales se suman a ambos (proyectado y real)
            dailyData[date].projectedRevenue += dailyAdditionalValues[date].income;
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

            return {
                date,
                // Revenue proyectado (todos los pedidos) para ver tendencia
                revenue: Math.round(data.projectedRevenue),
                // Revenue real (solo entregados)
                realRevenue: Math.round(data.realRevenue),
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
            data: chartData
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

        // Build query - OPTIMIZATION: Only select required fields
        let query = supabaseAdmin
            .from('orders')
            .select('id, created_at, sleeves_status, confirmed_at, delivered_at, deleted_at, is_test')
            .eq('store_id', req.storeId)

        // Apply date filters if provided
        if (startDate) {
            query = query.gte('created_at', startDate);
        }
        if (endDate) {
            // Convert endDate to end of day to include all orders from that day
            query = query.lte('created_at', toEndOfDay(endDate as string));
        }

        const { data: ordersData, error: ordersError } = await query;

        if (ordersError) throw ordersError;

        const orders = ordersData || [];
        const totalOrders = orders.length;

        const confirmedOrders = orders.filter(o =>
            o.sleeves_status === 'confirmed' ||
            o.sleeves_status === 'shipped' ||
            o.sleeves_status === 'delivered'
        ).length;

        const pendingOrders = orders.filter(o => o.sleeves_status === 'pending').length;

        // Get today's orders
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayOrders = orders.filter(o => {
            const orderDate = new Date(o.created_at);
            orderDate.setHours(0, 0, 0, 0);
            return orderDate.getTime() === today.getTime();
        });

        const todayConfirmed = todayOrders.filter(o =>
            o.sleeves_status === 'confirmed' ||
            o.sleeves_status === 'shipped' ||
            o.sleeves_status === 'delivered'
        ).length;

        const todayPending = todayOrders.filter(o => o.sleeves_status === 'pending').length;

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
            o.sleeves_status === 'delivered' &&
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

        const currentWeekConfirmed = currentWeekOrders.filter(o =>
            o.sleeves_status === 'confirmed' ||
            o.sleeves_status === 'shipped' ||
            o.sleeves_status === 'delivered'
        ).length;

        const previousWeekConfirmed = previousWeekOrders.filter(o =>
            o.sleeves_status === 'confirmed' ||
            o.sleeves_status === 'shipped' ||
            o.sleeves_status === 'delivered'
        ).length;

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

        // Build query - SOLO pedidos entregados (ventas reales)
        let query = supabaseAdmin
            .from('orders')
            .select('line_items')
            .eq('store_id', req.storeId)
            .eq('sleeves_status', 'delivered'); // Solo pedidos entregados

        // Apply date filters if provided
        if (startDate) {
            query = query.gte('created_at', startDate);
        }
        if (endDate) {
            // Convert endDate to end of day to include all orders from that day
            query = query.lte('created_at', toEndOfDay(endDate as string));
        }

        // Add default 1-year window for top products analysis
        if (!startDate && !endDate) {
            const oneYearAgo = new Date();
            oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
            query = query.gte('created_at', oneYearAgo.toISOString());
        }

        const { data: ordersData, error: ordersError } = await query;

        if (ordersError) {
            logger.error('SERVER', '[GET /api/analytics/top-products] Orders query error:', ordersError);
            throw ordersError;
        }

        logger.info('SERVER', `[GET /api/analytics/top-products] Retrieved ${ordersData?.length || 0} orders`);

        // Count product sales
        const productSales: Record<string, { product_id: string; quantity: number; revenue: number }> = {};

        for (const order of ordersData || []) {
            if (order.line_items && Array.isArray(order.line_items)) {
                for (const item of order.line_items) {
                    // Skip items with missing or invalid product_id
                    if (!item.product_id || typeof item.product_id !== 'string' || item.product_id === 'undefined' || item.product_id === 'null') {
                        continue;
                    }

                    if (!productSales[item.product_id]) {
                        productSales[item.product_id] = {
                            product_id: item.product_id,
                            quantity: 0,
                            revenue: 0
                        };
                    }
                    productSales[item.product_id].quantity += Number(item.quantity) || 0;
                    productSales[item.product_id].revenue += (Number(item.price) || 0) * (Number(item.quantity) || 0);
                }
            }
        }

        // Get product details and sort by quantity
        const topProductIds = Object.values(productSales)
            .sort((a, b) => b.quantity - a.quantity)
            .slice(0, parseInt(limit as string, 10))
            .map(p => p.product_id)
            .filter(id => {
                // Validate UUID format (basic check)
                if (!id || typeof id !== 'string') return false;
                if (id === 'undefined' || id === 'null') return false;
                // UUID should be 36 characters with dashes in specific positions
                return id.length >= 36 && id.includes('-');
            });

        if (topProductIds.length === 0) {
            return res.json({ data: [] });
        }

        logger.info('SERVER', `[GET /api/analytics/top-products] Querying ${topProductIds.length} product IDs:`, topProductIds);

        // OPTIMIZATION: Only select required fields for top products
        const { data: productsData, error: productsError } = await supabaseAdmin
            .from('products')
            .select('id, name, price, cost, packaging_cost, additional_costs, image_url, stock')
            .in('id', topProductIds);

        if (productsError) {
            logger.error('SERVER', '[GET /api/analytics/top-products] Products query error:', productsError);
            throw productsError;
        }

        // Combine product details with sales data and calculate profitability
        const topProducts = (productsData || []).map(product => {
            const price = Number(product.price) || 0;
            const baseCost = Number(product.cost) || 0;
            const packagingCost = Number(product.packaging_cost) || 0;
            const additionalCosts = Number(product.additional_costs) || 0;
            // Total unit cost includes base cost + packaging + additional costs
            const totalCost = baseCost + packagingCost + additionalCosts;
            const profitability = price > 0 ? parseFloat((((price - totalCost) / price) * 100).toFixed(1)) : 0;

            return {
                ...product,
                sales: productSales[product.id]?.quantity || 0,
                sales_revenue: productSales[product.id]?.revenue || 0,
                total_cost: totalCost, // Return total cost for frontend calculations
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

        // Get all orders for the lookback period (to calculate historical delivery rate)
        const lookbackDate = new Date();
        lookbackDate.setDate(lookbackDate.getDate() - parseInt(lookbackDays as string, 10));

        // OPTIMIZATION: Only select required fields for cash projection
        // Exclude deleted and test orders at database level
        const { data: historicalOrders, error: historicalError } = await supabaseAdmin
            .from('orders')
            .select('id, created_at, total_price, sleeves_status')
            .eq('store_id', req.storeId)
            .is('deleted_at', null)
            .or('is_test.is.null,is_test.eq.false')
            .gte('created_at', lookbackDate.toISOString())

        if (historicalError) throw historicalError;

        // Get all active orders (not cancelled) - OPTIMIZATION: Only required fields
        const { data: activeOrders, error: activeError } = await supabaseAdmin
            .from('orders')
            .select('id, total_price, sleeves_status')
            .eq('store_id', req.storeId)
            .is('deleted_at', null)
            .or('is_test.is.null,is_test.eq.false')
            .neq('sleeves_status', 'cancelled')

        if (activeError) throw activeError;

        const historical = historicalOrders || [];
        const active = activeOrders || [];

        // Calculate historical delivery rate
        const shippedOrders = historical.filter(o =>
            o.sleeves_status === 'shipped' || o.sleeves_status === 'delivered'
        ).length;
        const deliveredOrders = historical.filter(o => o.sleeves_status === 'delivered').length;
        const historicalDeliveryRate = shippedOrders > 0 ? (deliveredOrders / shippedOrders) : 0.85; // Default 85% if no data

        // ===== CASH ALREADY IN (Delivered orders) =====
        const deliveredRevenue = active
            .filter(o => o.sleeves_status === 'delivered')
            .reduce((sum, o) => sum + (Number(o.total_price) || 0), 0);

        // ===== CASH IN TRANSIT (Shipped but not delivered) =====
        const shippedRevenue = active
            .filter(o => o.sleeves_status === 'shipped')
            .reduce((sum, o) => sum + (Number(o.total_price) || 0), 0);

        // Expected cash from shipped orders (adjusted by historical delivery rate)
        const expectedFromShipped = shippedRevenue * historicalDeliveryRate;

        // ===== CASH PIPELINE (Ready to ship, In preparation, Confirmed) =====
        const readyToShipRevenue = active
            .filter(o => o.sleeves_status === 'ready_to_ship')
            .reduce((sum, o) => sum + (Number(o.total_price) || 0), 0);

        const inPreparationRevenue = active
            .filter(o => o.sleeves_status === 'in_preparation')
            .reduce((sum, o) => sum + (Number(o.total_price) || 0), 0);

        const confirmedRevenue = active
            .filter(o => o.sleeves_status === 'confirmed')
            .reduce((sum, o) => sum + (Number(o.total_price) || 0), 0);

        // Orders awaiting carrier assignment (separate confirmation flow)
        // These are confirmed sales pending carrier assignment
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

        // ===== DAILY AVERAGE (for future projections) =====
        // Calculate average daily revenue from delivered orders in last 30 days
        const last30Days = new Date();
        last30Days.setDate(last30Days.getDate() - 30);

        const recentDelivered = historical.filter(o =>
            o.sleeves_status === 'delivered' &&
            new Date(o.created_at) >= last30Days
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

        // Build query - exclude deleted and test orders
        let query = supabaseAdmin
            .from('orders')
            .select('sleeves_status')
            .eq('store_id', req.storeId)
            .is('deleted_at', null)
            .or('is_test.is.null,is_test.eq.false');

        // Apply date filters if provided
        if (startDate) {
            query = query.gte('created_at', startDate);
        }
        if (endDate) {
            // Convert endDate to end of day to include all orders from that day
            query = query.lte('created_at', toEndOfDay(endDate as string));
        }

        // Add default 90-day window for status distribution
        if (!startDate && !endDate) {
            const ninetyDaysAgo = new Date();
            ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
            query = query.gte('created_at', ninetyDaysAgo.toISOString());
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

        // Get all active orders (not cancelled or returned) - OPTIMIZATION: Only required fields
        // Add default 90-day window for cash flow projection
        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

        const { data: activeOrders, error: ordersError } = await supabaseAdmin
            .from('orders')
            .select('id, total_price, sleeves_status, shipping_cost')
            .eq('store_id', req.storeId)
            .not('sleeves_status', 'in', '(cancelled,returned)')
            .gte('created_at', ninetyDaysAgo.toISOString())

        if (ordersError) throw ordersError;

        const orders = activeOrders || [];

        // Get gasto publicitario costs (for proration) from additional_values (marketing expenses)
        // Get expenses from last 30 days for proration
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const { data: marketingExpensesData } = await supabaseAdmin
            .from('additional_values')
            .select('amount')
            .eq('store_id', req.storeId)
            .eq('category', 'marketing')
            .eq('type', 'expense')
            .gte('date', thirtyDaysAgo.toISOString().split('T')[0]);

        const totalGastoPublicitario = (marketingExpensesData || []).reduce((sum, m) => sum + (Number(m.amount) || 0), 0);
        const gastoPublicitarioPerOrder = orders.length > 0 ? totalGastoPublicitario / orders.length : 0;

        // VARIANT SUPPORT: Collect both product_ids and variant_ids for batch query
        const productIds = new Set<string>();
        const variantIds = new Set<string>();
        for (const order of orders) {
            if (order.line_items && Array.isArray(order.line_items)) {
                for (const item of order.line_items) {
                    if (item.product_id) {
                        productIds.add(item.product_id.toString());
                    }
                    if (item.variant_id) {
                        variantIds.add(item.variant_id.toString());
                    }
                }
            }
        }

        // Fetch all products in a single query
        // Use local product IDs (UUIDs) from line_items to match products
        const productCostMap = new Map<string, number>();
        if (productIds.size > 0) {
            const { data: productsData } = await supabaseAdmin
                .from('products')
                .select('id, cost, packaging_cost, additional_costs')
                .in('id', Array.from(productIds))
                .eq('store_id', req.storeId);

            if (productsData) {
                productsData.forEach(product => {
                    if (product.id) {
                        // Calculate total unit cost including packaging and extras
                        const baseCost = Number(product.cost) || 0;
                        const packaging = Number(product.packaging_cost) || 0;
                        const additional = Number(product.additional_costs) || 0;
                        const totalUnitCost = baseCost + packaging + additional;
                        productCostMap.set(product.id, totalUnitCost);
                    }
                });
            }
        }

        // VARIANT SUPPORT: Fetch variant costs
        const variantCostMap = new Map<string, number>();
        if (variantIds.size > 0) {
            const { data: variantsData } = await supabaseAdmin
                .from('product_variants')
                .select('id, cost')
                .in('id', Array.from(variantIds));

            if (variantsData) {
                variantsData.forEach(variant => {
                    if (variant.id && variant.cost !== null && variant.cost !== undefined) {
                        variantCostMap.set(variant.id, Number(variant.cost) || 0);
                    }
                });
            }
        }

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

        // Helper function: Get period key from date
        const getPeriodKey = (date: Date): string => {
            if (periodType === 'day') {
                return date.toISOString().split('T')[0]; // YYYY-MM-DD
            } else {
                // Week format: YYYY-WXX (e.g., 2025-W01)
                const year = date.getFullYear();
                const firstDayOfYear = new Date(year, 0, 1);
                const pastDaysOfYear = (date.getTime() - firstDayOfYear.getTime()) / 86400000;
                const weekNumber = Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
                return `${year}-W${String(weekNumber).padStart(2, '0')}`;
            }
        };

        // Initialize timeline data structure
        const timeline: Record<string, {
            period: string;
            revenue: { conservative: number; moderate: number; optimistic: number };
            costs: { conservative: number; moderate: number; optimistic: number };
            netCashFlow: { conservative: number; moderate: number; optimistic: number };
            ordersCount: { conservative: number; moderate: number; optimistic: number };
        }> = {};

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Process each order
        for (const order of orders) {
            const status = order.sleeves_status || 'pending';
            const { min, max, probability } = getDaysUntilCollection(status);

            // VARIANT SUPPORT: Calculate order costs, checking variant cost first
            let productCosts = 0;
            if (order.line_items && Array.isArray(order.line_items)) {
                for (const item of order.line_items) {
                    let itemUnitCost = 0;
                    if (item.variant_id && variantCostMap.has(item.variant_id.toString())) {
                        itemUnitCost = variantCostMap.get(item.variant_id.toString()) || 0;
                    } else {
                        itemUnitCost = productCostMap.get(item.product_id?.toString()) || 0;
                    }
                    productCosts += itemUnitCost * (Number(item.quantity) || 1);
                }
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

        // Calculate summary
        const summary = {
            totalRevenue: {
                conservative: Math.round(orders.reduce((sum, o) => sum + (Number(o.total_price) || 0) * 0.6, 0)),
                moderate: Math.round(orders.reduce((sum, o) => sum + (Number(o.total_price) || 0) * 0.75, 0)),
                optimistic: Math.round(orders.reduce((sum, o) => sum + (Number(o.total_price) || 0) * 0.9, 0)),
            },
            totalOrders: orders.length,
            periodType,
            periodsCount: timelineWithCumulative.length,
        };

        res.json({
            data: {
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

        // Build date filter
        let dateFilter: { start: Date; end: Date };
        if (startDate && endDate) {
            dateFilter = {
                start: new Date(startDate as string),
                end: new Date(toEndOfDay(endDate as string))
            };
        } else {
            // Default: last 30 days
            const now = new Date();
            dateFilter = {
                end: now,
                start: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
            };
        }

        // Get all orders in the period - OPTIMIZATION: Only required fields
        const { data: ordersData, error: ordersError } = await supabaseAdmin
            .from('orders')
            .select('id, sleeves_status, shipped_at, total_price, delivery_status, failed_reason, payment_collected')
            .eq('store_id', req.storeId)
            .gte('created_at', dateFilter.start.toISOString())
            .lte('created_at', dateFilter.end.toISOString())

        if (ordersError) throw ordersError;

        const orders = ordersData || [];

        // ===== PEDIDOS DESPACHADOS =====
        // Pedidos que salieron del almacén (ready_to_ship, shipped, delivered, cancelled después de envío, returned)
        const dispatchedStatuses = ['ready_to_ship', 'shipped', 'delivered', 'returned'];
        const dispatchedOrders = orders.filter(o => dispatchedStatuses.includes(o.sleeves_status));
        const totalDispatched = dispatchedOrders.length;

        // ===== TASA DE PEDIDOS FALLIDOS =====
        // Fallidos = Cancelados después de despacho + Devueltos + Entregas fallidas
        // Un pedido "fallido" es aquel donde se invirtió en logística pero no se recuperó el dinero
        const failedAfterDispatch = orders.filter(o => {
            // Cancelled después de que fue despachado (tiene shipped_at o fue enviado)
            if (o.sleeves_status === 'cancelled' && o.shipped_at) return true;
            // Returned
            if (o.sleeves_status === 'returned') return true;
            // Delivery failed
            if (o.sleeves_status === 'delivery_failed') return true;
            return false;
        });
        const totalFailed = failedAfterDispatch.length;

        // Tasa de fallidos = (Fallidos / Total Despachados) × 100
        const failedRate = totalDispatched > 0
            ? parseFloat(((totalFailed / totalDispatched) * 100).toFixed(1))
            : 0;

        // Valor perdido en pedidos fallidos
        const failedOrdersValue = failedAfterDispatch.reduce((sum, o) =>
            sum + (Number(o.total_price) || 0), 0
        );

        // ===== TASA DE RECHAZO EN PUERTA =====
        // Pedidos rechazados por el cliente al momento de la entrega
        // Típicamente: customer_refused, delivery_failed con razón de rechazo
        const doorRejections = orders.filter(o => {
            // Buscar en el campo de razón de fallo o status específico
            const rejectionReasons = ['customer_refused', 'rechazado', 'no_acepta', 'refused'];
            const failedReason = (o.failed_reason || '').toLowerCase();
            const deliveryStatus = (o.delivery_status || '').toLowerCase();

            return o.sleeves_status === 'delivery_failed' ||
                rejectionReasons.some(r => failedReason.includes(r) || deliveryStatus.includes(r));
        });

        // Intentos de entrega = Pedidos que llegaron a la puerta (shipped o superior)
        const deliveryAttempts = orders.filter(o =>
            ['shipped', 'delivered', 'delivery_failed', 'returned'].includes(o.sleeves_status)
        ).length;

        // Tasa de rechazo en puerta = (Rechazos / Intentos de entrega) × 100
        const doorRejectionRate = deliveryAttempts > 0
            ? parseFloat(((doorRejections.length / deliveryAttempts) * 100).toFixed(1))
            : 0;

        // ===== CASH COLLECTION EFFICIENCY =====
        // Eficiencia en el cobro de dinero en efectivo (COD)
        // Cash Collection = (Dinero Cobrado / Dinero Esperado de Entregados) × 100

        // Dinero esperado: Total de pedidos entregados (deberían haberse cobrado)
        const deliveredOrders = orders.filter(o => o.sleeves_status === 'delivered');
        const expectedCash = deliveredOrders.reduce((sum, o) =>
            sum + (Number(o.total_price) || 0), 0
        );

        // Dinero cobrado: Pedidos con payment_status = 'collected' o 'paid'
        const collectedOrders = orders.filter(o =>
            o.payment_status === 'collected' || o.payment_status === 'paid'
        );
        const collectedCash = collectedOrders.reduce((sum, o) =>
            sum + (Number(o.total_price) || 0), 0
        );

        // Cash collection efficiency
        const cashCollectionRate = expectedCash > 0
            ? parseFloat(((collectedCash / expectedCash) * 100).toFixed(1))
            : 0;

        // Dinero pendiente de cobro (entregado pero no cobrado)
        const pendingCollection = deliveredOrders.filter(o =>
            o.payment_status !== 'collected' && o.payment_status !== 'paid'
        );
        const pendingCashAmount = pendingCollection.reduce((sum, o) =>
            sum + (Number(o.total_price) || 0), 0
        );

        // ===== MÉTRICAS ADICIONALES ÚTILES =====
        // Pedidos en tránsito
        const inTransitOrders = orders.filter(o => o.sleeves_status === 'shipped');
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

        // Build date filter
        let dateFilter: { start: Date; end: Date };
        if (startDate && endDate) {
            dateFilter = {
                start: new Date(startDate as string),
                end: new Date(toEndOfDay(endDate as string))
            };
        } else {
            // Default: last 30 days
            const now = new Date();
            dateFilter = {
                end: now,
                start: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
            };
        }

        // Get all orders in the period - OPTIMIZATION: Only required fields
        const { data: ordersData, error: ordersError } = await supabaseAdmin
            .from('orders')
            .select('id, sleeves_status, total_price')
            .eq('store_id', req.storeId)
            .gte('created_at', dateFilter.start.toISOString())
            .lte('created_at', dateFilter.end.toISOString())

        if (ordersError) throw ordersError;

        const orders = ordersData || [];

        // ===== TASA DE DEVOLUCIÓN =====
        // Devoluciones sobre pedidos entregados
        // Tasa = (Pedidos Devueltos / Pedidos Entregados + Devueltos) × 100

        const deliveredOrders = orders.filter(o => o.sleeves_status === 'delivered');
        const returnedOrders = orders.filter(o => o.sleeves_status === 'returned');

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

        // Build date filter
        let dateFilter: { start: Date; end: Date };
        if (startDate && endDate) {
            dateFilter = {
                start: new Date(startDate as string),
                end: new Date(toEndOfDay(endDate as string))
            };
        } else {
            // Default: last 30 days
            const now = new Date();
            dateFilter = {
                end: now,
                start: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
            };
        }

        // Get all incidents in the period - OPTIMIZATION: Select specific fields if delivery_incidents table exists
        const { data: incidentsData, error: incidentsError } = await supabaseAdmin
            .from('delivery_incidents')
            .select('id, created_at, incident_type, severity, resolution_status')
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

        // Build date filter
        let dateFilter: { start: Date; end: Date };
        if (startDate && endDate) {
            dateFilter = {
                start: new Date(startDate as string),
                end: new Date(toEndOfDay(endDate as string))
            };
        } else {
            // Default: last 30 days
            const now = new Date();
            dateFilter = {
                end: now,
                start: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
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
                carriers!left(id, name)
            `)
            .eq('store_id', req.storeId)
            .gte('created_at', dateFilter.start.toISOString())
            .lte('created_at', dateFilter.end.toISOString())

        if (ordersError) throw ordersError;
        const orders = ordersData || [];

        // ===== 2. GET SETTLEMENTS DATA (actual payments to carriers) =====
        // Use left join to handle settlements without carrier (edge case)
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
            .gte('settlement_date', dateFilter.start.toISOString().split('T')[0])
            .lte('settlement_date', dateFilter.end.toISOString().split('T')[0]);

        if (settlementsError) throw settlementsError;
        const settlements = settlementsData || [];

        // ===== 3. CALCULATE SHIPPING COSTS BY ORDER STATUS =====

        // Delivered orders - all delivered for stats
        const allDeliveredOrders = orders.filter(o => o.sleeves_status === 'delivered');

        // Unreconciled delivered orders - costs that MUST be paid to carriers (pending reconciliation)
        const unreconciledDeliveredOrders = allDeliveredOrders.filter(o => !o.reconciled_at);
        const deliveredCosts = unreconciledDeliveredOrders.reduce((sum, o) => sum + (Number(o.shipping_cost) || 0), 0);

        // Keep deliveredOrders for backwards compatibility in other calculations
        const deliveredOrders = allDeliveredOrders;

        // In-transit orders - future costs (pending delivery)
        const inTransitOrders = orders.filter(o => o.sleeves_status === 'shipped');
        const inTransitCosts = inTransitOrders.reduce((sum, o) => sum + (Number(o.shipping_cost) || 0), 0);

        // Ready to ship - orders about to incur shipping costs
        const readyToShipOrders = orders.filter(o => o.sleeves_status === 'ready_to_ship');
        const readyToShipCosts = readyToShipOrders.reduce((sum, o) => sum + (Number(o.shipping_cost) || 0), 0);

        // ===== 4. CALCULATE ACTUAL PAYMENTS FROM SETTLEMENTS =====

        // Total carrier fees from settlements (what we owe/owed)
        const totalSettlementFees = settlements.reduce((sum, s) => sum + (Number(s.total_carrier_fees) || 0), 0);

        // Actually paid to carriers
        const paidToCarriers = settlements
            .filter(s => s.status === 'paid')
            .reduce((sum, s) => sum + (Number(s.total_carrier_fees) || 0), 0);

        // Pending payment (settlements created but not yet paid)
        const pendingPayment = settlements
            .filter(s => s.status === 'pending' || s.status === 'partial')
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

            if (order.sleeves_status === 'delivered') {
                // Only count unreconciled delivered orders in toPayCarriers
                if (!order.reconciled_at) {
                    carrier.deliveredOrders++;
                    carrier.deliveredCosts += shippingCost;
                }
            } else if (order.sleeves_status === 'shipped') {
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
            } else if (settlement.status === 'pending' || settlement.status === 'partial') {
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

        // ===== 7. SUCCESS RATE AND PERFORMANCE =====
        const dispatchedOrders = orders.filter(o =>
            ['shipped', 'delivered', 'returned'].includes(o.sleeves_status)
        ).length;

        const successRate = dispatchedOrders > 0
            ? parseFloat(((deliveredOrders.length / dispatchedOrders) * 100).toFixed(1))
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
                    totalDispatched: dispatchedOrders,
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

                // Period info
                period: {
                    start: dateFilter.start.toISOString().split('T')[0],
                    end: dateFilter.end.toISOString().split('T')[0],
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

        // 1. Get minimal order data (only fields needed for notifications)
        // Only fetch orders from last 7 days to reduce query size
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const { data: orders, error: ordersError } = await supabaseAdmin
            .from('orders')
            .select('id, sleeves_status, created_at, customer_first_name, customer_last_name')
            .eq('store_id', storeId)
            .gte('created_at', sevenDaysAgo.toISOString())
            .order('created_at', { ascending: false });

        if (ordersError) {
            logger.error('SERVER', '[GET /api/analytics/notification-data] Orders error:', ordersError);
            throw ordersError;
        }

        // 2. Get minimal product data (only stock for low stock alerts)
        // Limit to 500 - notification engine only needs to check stock levels
        const { data: products, error: productsError } = await supabaseAdmin
            .from('products')
            .select('id, name, stock, is_active')
            .eq('store_id', storeId)
            .eq('is_active', true)
            .limit(500);

        if (productsError) {
            logger.error('SERVER', '[GET /api/analytics/notification-data] Products error:', productsError);
            throw productsError;
        }

        // 3. Get minimal ads data (only for active campaign tracking)
        const { data: ads, error: adsError } = await supabaseAdmin
            .from('campaigns')
            .select('id, status, campaign_name, investment')
            .eq('store_id', storeId)
            .in('status', ['active', 'scheduled']);

        if (adsError) {
            logger.error('SERVER', '[GET /api/analytics/notification-data] Ads error:', adsError);
            throw adsError;
        }

        // 4. Get carrier data (minimal)
        const { data: carriers, error: carriersError } = await supabaseAdmin
            .from('carriers')
            .select('id, name, is_active')
            .eq('store_id', storeId)
            .eq('is_active', true);

        if (carriersError) {
            logger.error('SERVER', '[GET /api/analytics/notification-data] Carriers error:', carriersError);
            throw carriersError;
        }

        // Transform to frontend format (minimal)
        const transformedOrders = (orders || []).map(o => ({
            id: o.id,
            status: o.sleeves_status,
            date: o.created_at,
            customer: `${o.customer_first_name || ''} ${o.customer_last_name || ''}`.trim() || 'Cliente',
        }));

        const transformedProducts = (products || []).map(p => ({
            id: p.id,
            name: p.name,
            stock: p.stock,
        }));

        const transformedAds = (ads || []).map(a => ({
            id: a.id,
            status: a.status,
            name: a.campaign_name,
            investment: a.investment,
        }));

        const transformedCarriers = (carriers || []).map(c => ({
            id: c.id,
            name: c.name,
        }));

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

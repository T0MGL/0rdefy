// ================================================================
// NEONFLOW API - ANALYTICS ROUTES
// ================================================================
// Real-time business intelligence and metrics calculation
// Replaces mock data with actual database queries
// ================================================================

import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../db/connection';
import { verifyToken, extractStoreId, AuthRequest } from '../middleware/auth';

export const analyticsRouter = Router();

analyticsRouter.use(verifyToken, extractStoreId);

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

        // Get store tax rate
        const { data: storeData, error: storeError } = await supabaseAdmin
            .from('stores')
            .select('tax_rate')
            .eq('id', req.storeId)
            .single();

        if (storeError) {
            console.error('[GET /api/analytics/overview] Store query error:', storeError);
        }

        const taxRate = Number(storeData?.tax_rate) || 0;

        // Calculate date ranges for comparison (use provided dates or default to 7 days)
        let currentPeriodStart: Date;
        let currentPeriodEnd: Date;
        let previousPeriodStart: Date;
        let previousPeriodEnd: Date;

        if (startDate && endDate) {
            currentPeriodStart = new Date(startDate as string);
            // Convert endDate to end of day to include all orders from that day
            currentPeriodEnd = new Date(toEndOfDay(endDate as string));
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
        const query = supabaseAdmin
            .from('orders')
            .select('*')
            .eq('store_id', req.storeId)
            .gte('created_at', previousPeriodStart.toISOString())
            .lte('created_at', currentPeriodEnd.toISOString());

        const { data: ordersData, error: ordersError } = await query;

        if (ordersError) throw ordersError;

        const orders = ordersData || [];

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

        // ===== GET MARKETING COSTS FROM CAMPAIGNS TABLE =====
        // Get all campaigns for this store (active campaigns only)
        const { data: campaignsData, error: campaignsError } = await supabaseAdmin
            .from('campaigns')
            .select('investment, created_at, status')
            .eq('store_id', req.storeId);

        if (campaignsError) {
            console.error('[GET /api/analytics/overview] Campaign query error:', campaignsError);
        }

        const campaigns = campaignsData || [];

        // Calculate marketing costs for current period
        const currentMarketingCosts = campaigns
            .filter(c => {
                const campaignDate = new Date(c.created_at);
                return campaignDate >= last7DaysStart && c.status === 'active';
            })
            .reduce((sum, c) => sum + (Number(c.investment) || 0), 0);

        // Calculate marketing costs for previous period
        const previousMarketingCosts = campaigns
            .filter(c => {
                const campaignDate = new Date(c.created_at);
                return campaignDate >= previous7DaysStart && campaignDate < last7DaysStart && c.status === 'active';
            })
            .reduce((sum, c) => sum + (Number(c.investment) || 0), 0);

        // Calculate total marketing costs (all active campaigns)
        const totalMarketingCosts = campaigns
            .filter(c => c.status === 'active')
            .reduce((sum, c) => sum + (Number(c.investment) || 0), 0);

        // ===== HELPER FUNCTION: Calculate metrics for a set of orders =====
        const calculateMetrics = async (ordersList: any[], marketingCosts: number, periodStart: Date, periodEnd: Date) => {
            const count = ordersList.length;

            // 1. REVENUE (from orders)
            // Total revenue from ALL orders (for display purposes)
            let rev = ordersList.reduce((sum, order) => sum + (Number(order.total_price) || 0), 0);

            // 1.5. REAL REVENUE (only from delivered orders - actual cash received)
            // This is the money that actually entered the business
            let realRevenue = ordersList
                .filter(o => o.sleeves_status === 'delivered')
                .reduce((sum, order) => sum + (Number(order.total_price) || 0), 0);

            // 1.6. DELIVERY COSTS (shipping costs from orders)
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

            // 2. TAX COLLECTED (IVA incluido en el precio de venta)
            // Fórmula: IVA = precio - (precio / (1 + tasa/100))
            // Ejemplo: Si precio = 11000 y tasa = 10%, entonces IVA = 11000 - (11000 / 1.10) = 1000
            const taxCollectedValue = taxRate > 0 ? (rev - (rev / (1 + taxRate / 100))) : 0;

            // 3. PRODUCT COSTS (Optimized: batch query instead of N+1)
            // Collect all unique product IDs first
            const productIds = new Set<string>();
            for (const order of ordersList) {
                if (order.line_items && Array.isArray(order.line_items)) {
                    for (const item of order.line_items) {
                        if (item.product_id) {
                            productIds.add(item.product_id.toString());
                        }
                    }
                }
            }

            // Fetch all products in a single query
            // FIX: Match by shopify_product_id instead of internal id
            const productCostMap = new Map<string, number>();
            if (productIds.size > 0) {
                const { data: productsData } = await supabaseAdmin
                    .from('products')
                    .select('shopify_product_id, cost')
                    .in('shopify_product_id', Array.from(productIds))
                    .eq('store_id', req.storeId);

                if (productsData) {
                    productsData.forEach(product => {
                        if (product.shopify_product_id) {
                            productCostMap.set(product.shopify_product_id, Number(product.cost) || 0);
                        }
                    });
                }
            }

            // Calculate product costs using the cached product data
            // Total product costs (all orders)
            let productCosts = 0;
            // Real product costs (only delivered orders - actual money spent)
            let realProductCosts = 0;

            for (const order of ordersList) {
                if (order.line_items && Array.isArray(order.line_items)) {
                    let orderCost = 0;
                    for (const item of order.line_items) {
                        // Use product_id (which is the Shopify ID) to look up cost
                        const productCost = productCostMap.get(item.product_id?.toString()) || 0;
                        const itemCost = productCost * Number(item.quantity || 1);
                        orderCost += itemCost;
                        productCosts += itemCost;
                    }

                    // Only count costs for delivered orders (real money out)
                    if (order.sleeves_status === 'delivered') {
                        realProductCosts += orderCost;
                    }
                }
            }

            // 3.5. GET ADDITIONAL VALUES FOR THIS PERIOD
            const { data: additionalValuesData } = await supabaseAdmin
                .from('additional_values')
                .select('type, amount')
                .eq('store_id', req.storeId)
                .gte('date', periodStart.toISOString().split('T')[0])
                .lte('date', periodEnd.toISOString().split('T')[0]);

            const additionalValues = additionalValuesData || [];

            // Add incomes to revenue
            const additionalIncome = additionalValues
                .filter(av => av.type === 'income')
                .reduce((sum, av) => sum + (Number(av.amount) || 0), 0);
            rev += additionalIncome;
            // Also add to real revenue if it's actual cash
            realRevenue += additionalIncome;

            // Add expenses to product costs
            const additionalExpenses = additionalValues
                .filter(av => av.type === 'expense')
                .reduce((sum, av) => sum + (Number(av.amount) || 0), 0);
            productCosts += additionalExpenses;
            realProductCosts += additionalExpenses;

            // 4. MARKETING (from campaigns table)
            const mktg = marketingCosts;

            // 5. TOTAL OPERATIONAL COSTS
            // Para e-commerce COD, los costos totales incluyen:
            // - Costo de productos
            // - Costos de envío
            // - Marketing
            // IMPORTANTE: Estos son los costos TOTALES operativos
            const totalCosts = productCosts + deliveryCosts + mktg;
            const realTotalCosts = realProductCosts + realDeliveryCosts + mktg;

            // 6. GROSS PROFIT & MARGIN
            // MARGEN BRUTO = Solo resta el costo de productos (COGS)
            // Esta métrica muestra cuánto ganamos después de pagar los productos
            const grossProfit = rev - productCosts;
            const realGrossProfit = realRevenue - realProductCosts;

            // Gross margin = (Gross Profit / Revenue) × 100
            const grossMargin = rev > 0 ? ((grossProfit / rev) * 100) : 0;
            const realGrossMargin = realRevenue > 0 ? ((realGrossProfit / realRevenue) * 100) : 0;

            // 7. NET PROFIT & MARGIN
            // MARGEN NETO = Resta TODOS los costos (productos + envío + marketing)
            // Esta métrica muestra la ganancia REAL después de todos los gastos
            // IMPORTANTE: El margen neto SIEMPRE debe ser menor que el margen bruto
            const netProfit = rev - totalCosts;
            const realNetProfit = realRevenue - realTotalCosts;

            // Net margin = (Net Profit / Revenue) × 100
            const netMargin = rev > 0 ? ((netProfit / rev) * 100) : 0;
            const realNetMargin = realRevenue > 0 ? ((realNetProfit / realRevenue) * 100) : 0;

            // 8. ROI (Return on Investment)
            // Para proyecciones: usa todos los pedidos
            const investment = totalCosts;
            const roiValue = investment > 0 ? ((rev - investment) / investment) : 0;

            // Para métricas reales: usa solo pedidos entregados
            const realInvestment = realTotalCosts;
            const realRoiValue = realInvestment > 0 ? ((realRevenue - realInvestment) / realInvestment) : 0;

            // 9. ROAS (Return on Ad Spend)
            // Para proyecciones: usa todos los pedidos
            const roasValue = mktg > 0 ? (rev / mktg) : 0;

            // Para métricas reales: usa solo pedidos entregados
            const realRoasValue = mktg > 0 ? (realRevenue / mktg) : 0;

            // 10. DELIVERY RATE
            // Solo considerar pedidos que fueron despachados (shipped o delivered)
            // La tasa de entrega debe ser: (entregados / despachados) × 100
            const shipped = ordersList.filter(o =>
                o.sleeves_status === 'shipped' ||
                o.sleeves_status === 'delivered'
            ).length;
            const delivered = ordersList.filter(o => o.sleeves_status === 'delivered').length;
            const delivRate = shipped > 0 ? ((delivered / shipped) * 100) : 0;

            return {
                totalOrders: count,
                revenue: rev,
                realRevenue: realRevenue,
                // Costos separados para transparencia
                productCosts: productCosts,
                realProductCosts: realProductCosts,
                deliveryCosts: deliveryCosts,
                realDeliveryCosts: realDeliveryCosts,
                marketing: mktg,
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
        const currentMetrics = await calculateMetrics(currentPeriodOrders, currentMarketingCosts, currentPeriodStart, currentPeriodEnd);
        const previousMetrics = await calculateMetrics(previousPeriodOrders, previousMarketingCosts, previousPeriodStart, previousPeriodEnd);

        // Use current period metrics as the displayed values
        const revenue = currentMetrics.revenue;
        const taxCollected = currentMetrics.taxCollected;
        const totalCosts = currentMetrics.costs;
        const marketing = currentMetrics.marketing;
        const grossProfit = currentMetrics.grossProfit;
        const grossMargin = currentMetrics.grossMargin;
        const netProfit = currentMetrics.netProfit;
        const netMargin = currentMetrics.netMargin;
        const roi = currentMetrics.roi;
        const roas = currentMetrics.roas;
        const deliveryRate = currentMetrics.deliveryRate;
        const costPerOrder = totalOrders > 0 ? (totalCosts / totalOrders) : 0;
        const averageOrderValue = totalOrders > 0 ? (revenue / totalOrders) : 0;

        // ===== CALCULATE PERCENTAGE CHANGES (Current period vs Previous period) =====
        const calculateChange = (current: number, previous: number): number | null => {
            if (previous === 0) return null; // No hay datos previos para comparar
            return parseFloat((((current - previous) / previous) * 100).toFixed(1));
        };

        // Calculate previous period's costPerOrder and averageOrderValue
        const previousTotalOrders = previousMetrics.totalOrders;
        const previousCostPerOrder = previousTotalOrders > 0 ? (previousMetrics.costs / previousTotalOrders) : 0;
        const previousAverageOrderValue = previousTotalOrders > 0 ? (previousMetrics.revenue / previousTotalOrders) : 0;

        const changes = {
            totalOrders: calculateChange(currentMetrics.totalOrders, previousMetrics.totalOrders),
            revenue: calculateChange(currentMetrics.revenue, previousMetrics.revenue),
            costs: calculateChange(currentMetrics.costs, previousMetrics.costs),
            deliveryCosts: calculateChange(currentMetrics.deliveryCosts, previousMetrics.deliveryCosts),
            marketing: calculateChange(currentMetrics.marketing, previousMetrics.marketing),
            grossProfit: calculateChange(currentMetrics.grossProfit, previousMetrics.grossProfit),
            grossMargin: calculateChange(currentMetrics.grossMargin, previousMetrics.grossMargin),
            netProfit: calculateChange(currentMetrics.netProfit, previousMetrics.netProfit),
            netMargin: calculateChange(currentMetrics.netMargin, previousMetrics.netMargin),
            realRevenue: calculateChange(currentMetrics.realRevenue, previousMetrics.realRevenue),
            realCosts: calculateChange(currentMetrics.realCosts, previousMetrics.realCosts),
            realDeliveryCosts: calculateChange(currentMetrics.realDeliveryCosts, previousMetrics.realDeliveryCosts),
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
                costs: Math.round(totalCosts), // Costos totales (productos + envío + marketing)
                marketing,
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
                adSpend: marketing, // Alias for compatibility
                adRevenue: revenue, // Placeholder
                conversionRate: deliveryRate, // Placeholder

                // Percentage changes (current period vs previous period)
                changes: {
                    totalOrders: changes.totalOrders,
                    revenue: changes.revenue,
                    costs: changes.costs,
                    deliveryCosts: changes.deliveryCosts,
                    marketing: changes.marketing,
                    grossProfit: changes.grossProfit,
                    grossMargin: changes.grossMargin,
                    netProfit: changes.netProfit,
                    netMargin: changes.netMargin,
                    realRevenue: changes.realRevenue,
                    realCosts: changes.realCosts,
                    realDeliveryCosts: changes.realDeliveryCosts,
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
        console.error('[GET /api/analytics/overview] Error:', error);
        res.status(500).json({
            error: 'Failed to fetch analytics overview',
            message: error.message
        });
    }
});

// ================================================================
// GET /api/analytics/chart - Chart data (daily aggregated)
// ================================================================
analyticsRouter.get('/chart', async (req: AuthRequest, res: Response) => {
    try {
        const { days = '7', startDate: startDateParam, endDate: endDateParam } = req.query;

        let query = supabaseAdmin
            .from('orders')
            .select('*')
            .eq('store_id', req.storeId);

        // Apply date filters
        if (startDateParam && endDateParam) {
            // Convert endDate to end of day to include all orders from that day
            query = query.gte('created_at', startDateParam).lte('created_at', toEndOfDay(endDateParam as string));
        } else {
            const daysCount = parseInt(days as string);
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - daysCount);
            query = query.gte('created_at', startDate.toISOString());
        }

        const { data: ordersData, error: ordersError } = await query;

        if (ordersError) throw ordersError;

        const orders = ordersData || [];

        // Get marketing costs from campaigns table
        const { data: campaignsData, error: campaignsError } = await supabaseAdmin
            .from('campaigns')
            .select('investment, created_at, status')
            .eq('store_id', req.storeId)
            .eq('status', 'active');

        if (campaignsError) {
            console.error('[GET /api/analytics/chart] Campaign query error:', campaignsError);
        }

        const campaigns = campaignsData || [];

        // Group campaigns by date
        const dailyCampaignCosts: Record<string, number> = {};
        for (const campaign of campaigns) {
            const date = new Date(campaign.created_at).toISOString().split('T')[0];
            if (!dailyCampaignCosts[date]) {
                dailyCampaignCosts[date] = 0;
            }
            dailyCampaignCosts[date] += Number(campaign.investment) || 0;
        }

        // Collect all unique product IDs for batch query (performance optimization)
        const productIds = new Set<string>();
        for (const order of orders) {
            if (order.line_items && Array.isArray(order.line_items)) {
                for (const item of order.line_items) {
                    if (item.product_id) {
                        productIds.add(item.product_id.toString());
                    }
                }
            }
        }

        // Fetch all products in a single query
        // FIX: Match by shopify_product_id instead of internal id
        const productCostMap = new Map<string, number>();
        if (productIds.size > 0) {
            const { data: productsData } = await supabaseAdmin
                .from('products')
                .select('shopify_product_id, cost')
                .in('shopify_product_id', Array.from(productIds))
                .eq('store_id', req.storeId);

            if (productsData) {
                productsData.forEach(product => {
                    if (product.shopify_product_id) {
                        productCostMap.set(product.shopify_product_id, Number(product.cost) || 0);
                    }
                });
            }
        }

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
            const daysCount = parseInt(days as string);
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
        const dailyData: Record<string, { revenue: number; costs: number; marketing: number; profit: number }> = {};

        for (const order of orders) {
            const date = new Date(order.created_at).toISOString().split('T')[0];

            if (!dailyData[date]) {
                dailyData[date] = { revenue: 0, costs: 0, marketing: 0, profit: 0 };
            }

            dailyData[date].revenue += order.total_price || 0;

            // Calculate costs using cached product data
            if (order.line_items && Array.isArray(order.line_items)) {
                for (const item of order.line_items) {
                    // Use product_id (which is the Shopify ID) to look up cost
                    const productCost = productCostMap.get(item.product_id?.toString()) || 0;
                    dailyData[date].costs += productCost * (item.quantity || 1);
                }
            }
        }

        // Add additional values to revenue and costs for each day
        for (const date in dailyAdditionalValues) {
            if (!dailyData[date]) {
                dailyData[date] = { revenue: 0, costs: 0, marketing: 0, profit: 0 };
            }
            dailyData[date].revenue += dailyAdditionalValues[date].income;
            dailyData[date].costs += dailyAdditionalValues[date].expense;
        }

        // Add marketing costs from campaigns for each day
        for (const date in dailyData) {
            dailyData[date].marketing = Math.round(dailyCampaignCosts[date] || 0);
        }

        // Calculate profit for each day
        const chartData = Object.entries(dailyData).map(([date, data]) => ({
            date,
            revenue: Math.round(data.revenue),
            costs: Math.round(data.costs),
            marketing: data.marketing,
            profit: Math.round(data.revenue - data.costs - data.marketing),
        })).sort((a, b) => a.date.localeCompare(b.date));

        res.json({
            data: chartData
        });
    } catch (error: any) {
        console.error('[GET /api/analytics/chart] Error:', error);
        res.status(500).json({
            error: 'Failed to fetch chart data',
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

        // Build query
        let query = supabaseAdmin
            .from('orders')
            .select('*')
            .eq('store_id', req.storeId);

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
        console.error('[GET /api/analytics/confirmation-metrics] Error:', error);
        res.status(500).json({
            error: 'Failed to fetch confirmation metrics',
            message: error.message
        });
    }
});

// ================================================================
// GET /api/analytics/top-products - Top selling products
// ================================================================
analyticsRouter.get('/top-products', async (req: AuthRequest, res: Response) => {
    try {
        const { limit = '5', startDate, endDate } = req.query;

        console.log(`[GET /api/analytics/top-products] Request received - Store: ${req.storeId}, Limit: ${limit}, Date Range: ${startDate || 'none'} to ${endDate || 'none'}`);

        // Validate storeId
        if (!req.storeId) {
            console.error('[GET /api/analytics/top-products] Missing store ID');
            return res.status(400).json({
                error: 'Store ID is required',
                message: 'Missing store_id in request'
            });
        }

        // Build query
        let query = supabaseAdmin
            .from('orders')
            .select('line_items')
            .eq('store_id', req.storeId);

        // Apply date filters if provided
        if (startDate) {
            query = query.gte('created_at', startDate);
        }
        if (endDate) {
            // Convert endDate to end of day to include all orders from that day
            query = query.lte('created_at', toEndOfDay(endDate as string));
        }

        const { data: ordersData, error: ordersError } = await query;

        if (ordersError) {
            console.error('[GET /api/analytics/top-products] Orders query error:', ordersError);
            throw ordersError;
        }

        console.log(`[GET /api/analytics/top-products] Retrieved ${ordersData?.length || 0} orders`);

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
            .slice(0, parseInt(limit as string))
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

        console.log(`[GET /api/analytics/top-products] Querying ${topProductIds.length} product IDs:`, topProductIds);

        const { data: productsData, error: productsError } = await supabaseAdmin
            .from('products')
            .select('*')
            .in('id', topProductIds);

        if (productsError) {
            console.error('[GET /api/analytics/top-products] Products query error:', productsError);
            throw productsError;
        }

        // Combine product details with sales data and calculate profitability
        const topProducts = (productsData || []).map(product => {
            const price = Number(product.price) || 0;
            const cost = Number(product.cost) || 0;
            const profitability = price > 0 ? parseFloat((((price - cost) / price) * 100).toFixed(1)) : 0;

            return {
                ...product,
                sales: productSales[product.id]?.quantity || 0,
                sales_revenue: productSales[product.id]?.revenue || 0,
                profitability,
            };
        }).sort((a, b) => b.sales - a.sales);

        res.json({
            data: topProducts
        });
    } catch (error: any) {
        console.error('[GET /api/analytics/top-products] Error:', error);
        res.status(500).json({
            error: 'Failed to fetch top products',
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
        lookbackDate.setDate(lookbackDate.getDate() - parseInt(lookbackDays as string));

        const { data: historicalOrders, error: historicalError } = await supabaseAdmin
            .from('orders')
            .select('*')
            .eq('store_id', req.storeId)
            .gte('created_at', lookbackDate.toISOString());

        if (historicalError) throw historicalError;

        // Get all active orders (not cancelled)
        const { data: activeOrders, error: activeError } = await supabaseAdmin
            .from('orders')
            .select('*')
            .eq('store_id', req.storeId)
            .neq('sleeves_status', 'cancelled');

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

        // Apply probability weights based on status
        // Ready to ship: 90% probability (very likely to be delivered)
        // In preparation: 80% probability (likely to be delivered)
        // Confirmed: 70% probability (fairly likely to be delivered)
        const expectedFromReadyToShip = readyToShipRevenue * 0.90 * historicalDeliveryRate;
        const expectedFromInPreparation = inPreparationRevenue * 0.80 * historicalDeliveryRate;
        const expectedFromConfirmed = confirmedRevenue * 0.70 * historicalDeliveryRate;

        // ===== TOTAL PROJECTIONS =====
        // Conservative projection (only high-probability sources)
        const conservativeProjection = deliveredRevenue + expectedFromShipped + expectedFromReadyToShip;

        // Moderate projection (includes in_preparation)
        const moderateProjection = conservativeProjection + expectedFromInPreparation;

        // Optimistic projection (includes everything)
        const optimisticProjection = moderateProjection + expectedFromConfirmed;

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
                lookbackDays: parseInt(lookbackDays as string),
            }
        });
    } catch (error: any) {
        console.error('[GET /api/analytics/cash-projection] Error:', error);
        res.status(500).json({
            error: 'Failed to fetch cash projection',
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

        // Build query
        let query = supabaseAdmin
            .from('orders')
            .select('sleeves_status')
            .eq('store_id', req.storeId);

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
        console.error('[GET /api/analytics/order-status-distribution] Error:', error);
        res.status(500).json({
            error: 'Failed to fetch order status distribution',
            message: error.message
        });
    }
});

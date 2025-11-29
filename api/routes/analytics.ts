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
        const calculateMetrics = async (ordersList: any[], marketingCosts: number) => {
            const count = ordersList.length;

            // 1. REVENUE
            const rev = ordersList.reduce((sum, order) => sum + (Number(order.total_price) || 0), 0);

            // 2. TAX COLLECTED (IVA incluido en el precio de venta)
            // Fórmula: IVA = precio - (precio / (1 + tasa/100))
            // Ejemplo: Si precio = 11000 y tasa = 10%, entonces IVA = 11000 - (11000 / 1.10) = 1000
            const taxCollectedValue = taxRate > 0 ? (rev - (rev / (1 + taxRate / 100))) : 0;

            // 3. COSTS
            let costs = 0;
            for (const order of ordersList) {
                if (order.line_items && Array.isArray(order.line_items)) {
                    for (const item of order.line_items) {
                        const { data: productData } = await supabaseAdmin
                            .from('products')
                            .select('cost')
                            .eq('id', item.product_id)
                            .single();

                        if (productData && productData.cost) {
                            costs += (Number(productData.cost) * Number(item.quantity || 1));
                        }
                    }
                }
            }

            // 4. MARKETING (from campaigns table)
            const mktg = marketingCosts;

            // 5. NET PROFIT
            const profit = rev - costs - mktg;

            // 6. PROFIT MARGIN
            const margin = rev > 0 ? ((profit / rev) * 100) : 0;

            // 7. ROI
            const investment = costs + mktg;
            const roiValue = investment > 0 ? (rev / investment) : 0;

            // 8. ROAS (Return on Ad Spend)
            const roasValue = mktg > 0 ? (rev / mktg) : 0;

            // 9. DELIVERY RATE
            const delivered = ordersList.filter(o => o.sleeves_status === 'delivered').length;
            const delivRate = count > 0 ? ((delivered / count) * 100) : 0;

            return {
                totalOrders: count,
                revenue: rev,
                costs: costs,
                marketing: mktg,
                netProfit: profit,
                profitMargin: margin,
                roi: roiValue,
                roas: roasValue,
                deliveryRate: delivRate,
                taxCollected: taxCollectedValue,
            };
        };

        // Calculate metrics for both periods
        const currentMetrics = await calculateMetrics(currentPeriodOrders, currentMarketingCosts);
        const previousMetrics = await calculateMetrics(previousPeriodOrders, previousMarketingCosts);

        // Use current period metrics as the displayed values
        const revenue = currentMetrics.revenue;
        const taxCollected = currentMetrics.taxCollected;
        const totalCosts = currentMetrics.costs;
        const marketing = currentMetrics.marketing;
        const netProfit = currentMetrics.netProfit;
        const profitMargin = currentMetrics.profitMargin;
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

        const changes = {
            totalOrders: calculateChange(currentMetrics.totalOrders, previousMetrics.totalOrders),
            revenue: calculateChange(currentMetrics.revenue, previousMetrics.revenue),
            costs: calculateChange(currentMetrics.costs, previousMetrics.costs),
            marketing: calculateChange(currentMetrics.marketing, previousMetrics.marketing),
            netProfit: calculateChange(currentMetrics.netProfit, previousMetrics.netProfit),
            profitMargin: calculateChange(currentMetrics.profitMargin, previousMetrics.profitMargin),
            roi: calculateChange(currentMetrics.roi, previousMetrics.roi),
            roas: calculateChange(currentMetrics.roas, previousMetrics.roas),
            deliveryRate: calculateChange(currentMetrics.deliveryRate, previousMetrics.deliveryRate),
            taxCollected: calculateChange(currentMetrics.taxCollected, previousMetrics.taxCollected),
        };

        res.json({
            data: {
                totalOrders,
                revenue: Math.round(revenue),
                costs: Math.round(totalCosts),
                marketing,
                netProfit: Math.round(netProfit),
                profitMargin: parseFloat(profitMargin.toFixed(1)),
                roi: parseFloat(roi.toFixed(2)),
                roas: parseFloat(roas.toFixed(2)),
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
                    marketing: changes.marketing,
                    netProfit: changes.netProfit,
                    profitMargin: changes.profitMargin,
                    roi: changes.roi,
                    roas: changes.roas,
                    deliveryRate: changes.deliveryRate,
                    taxCollected: changes.taxCollected,
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

        // Group orders by date
        const dailyData: Record<string, { revenue: number; costs: number; marketing: number; profit: number }> = {};

        for (const order of orders) {
            const date = new Date(order.created_at).toISOString().split('T')[0];

            if (!dailyData[date]) {
                dailyData[date] = { revenue: 0, costs: 0, marketing: 0, profit: 0 };
            }

            dailyData[date].revenue += order.total_price || 0;

            // Calculate costs for this order
            if (order.line_items && Array.isArray(order.line_items)) {
                for (const item of order.line_items) {
                    const { data: productData } = await supabaseAdmin
                        .from('products')
                        .select('cost')
                        .eq('id', item.product_id)
                        .single();

                    if (productData) {
                        dailyData[date].costs += (productData.cost || 0) * (item.quantity || 1);
                    }
                }
            }
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

        // Validate storeId
        if (!req.storeId) {
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

        if (ordersError) throw ordersError;

        // Count product sales
        const productSales: Record<string, { product_id: string; quantity: number; revenue: number }> = {};

        for (const order of ordersData || []) {
            if (order.line_items && Array.isArray(order.line_items)) {
                for (const item of order.line_items) {
                    if (!productSales[item.product_id]) {
                        productSales[item.product_id] = {
                            product_id: item.product_id,
                            quantity: 0,
                            revenue: 0
                        };
                    }
                    productSales[item.product_id].quantity += item.quantity || 0;
                    productSales[item.product_id].revenue += (item.price || 0) * (item.quantity || 0);
                }
            }
        }

        // Get product details and sort by quantity
        const topProductIds = Object.values(productSales)
            .sort((a, b) => b.quantity - a.quantity)
            .slice(0, parseInt(limit as string))
            .map(p => p.product_id)
            .filter(id => id && id !== 'undefined'); // Filter out invalid UUIDs

        if (topProductIds.length === 0) {
            return res.json({ data: [] });
        }

        const { data: productsData, error: productsError } = await supabaseAdmin
            .from('products')
            .select('*')
            .in('id', topProductIds);

        if (productsError) throw productsError;

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

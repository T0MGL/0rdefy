// ================================================================
// UNIFIED GLOBAL VIEW ROUTER
// ================================================================
// Aggregates data across all stores for a user
// OPTIMIZED for performance: Selects only essential columns
// ================================================================

import { logger } from '../utils/logger';
import { Router, Response } from 'express';
import { supabaseAdmin } from '../db/connection';
import { verifyToken, AuthRequest } from '../middleware/auth';

export const unifiedRouter = Router();

// Middleware: Authenticate user, but DO NOT filter by single store
// We will filter by the list of stores the user has access to
unifiedRouter.use(verifyToken);

// Helper: Get user's accessible store IDs
const getUserStoreIds = async (userId: string) => {
    // In a real implementation with RLS, this might be implicit,
    // but here we explicit fetch mapping if needed.
    // Assuming 'verifyToken' populates req.user.id and we can trust the 'stores' claim or fetch fresh.

    // For safety, let's fetch fresh store list for this user
    // IMPORTANT: Only fetch active store relationships (is_active = true)
    const { data: userStores, error } = await supabaseAdmin
        .from('user_stores')
        .select('store_id')
        .eq('user_id', userId)
        .eq('is_active', true);

    if (error) {
        logger.error('API', '[getUserStoreIds] Error fetching stores:', error);
        return [];
    }

    if (!userStores || userStores.length === 0) {
        logger.info('API', `[getUserStoreIds] No stores found for user ${userId}`);
        return [];
    }

    const storeIds = userStores.map(s => s.store_id);
    logger.info('API', `[getUserStoreIds] User ${userId} has access to ${storeIds.length} stores:`, storeIds);
    return storeIds;
};

// ================================================================
// WAREHOUSE: Ready for Picking (ALL STORES)
// ================================================================
unifiedRouter.get('/warehouse/ready', async (req: AuthRequest, res: Response) => {
    try {
        if (!req.user || !req.user.id) {
            return res.status(401).json({ error: 'User not authenticated' });
        }
        const storeIds = await getUserStoreIds(req.user.id);

        if (storeIds.length === 0) {
            return res.json({ data: [] });
        }

        // Optimized Query: Only fetch essentials for the list view
        const { data, error } = await supabaseAdmin
            .from('orders')
            .select(`
                id, 
                order_number, 
                customer_first_name, 
                customer_last_name, 
                store_id,
                created_at,
                order_line_items (count),
                stores (name)
            `)
            .in('store_id', storeIds)
            .eq('sleeves_status', 'confirmed') // Ready for picking
            .order('created_at', { ascending: false });

        if (error) throw error;

        // Transform
        const transformed = data.map(order => ({
            id: order.id,
            order_number: order.order_number,
            customer_name: `${order.customer_first_name || ''} ${order.customer_last_name || ''}`.trim(),
            store_id: order.store_id,
            store_name: Array.isArray(order.stores) ? (order.stores as any)[0]?.name : (order.stores as any)?.name || 'Unknown Store',
            created_at: order.created_at,
            total_items: order.order_line_items?.[0]?.count || 0
        }));

        res.json({ data: transformed });

    } catch (error) {
        logger.error('API', '[GET /api/unified/warehouse/ready] Error:', error);
        res.status(500).json({
            error: 'Error al obtener datos unificados de bodega',
            details: error instanceof Error ? error.message : String(error),
            raw: error
        });
    }
});

// ================================================================
// WAREHOUSE: Active Sessions (ALL STORES)
// ================================================================
unifiedRouter.get('/warehouse/sessions', async (req: AuthRequest, res: Response) => {
    try {
        if (!req.user || !req.user.id) {
            return res.status(401).json({ error: 'User not authenticated' });
        }
        const storeIds = await getUserStoreIds(req.user.id);
        if (storeIds.length === 0) return res.json({ data: [] });

        const { data, error } = await supabaseAdmin
            .from('picking_sessions')
            .select(`
                id, 
                code, 
                status, 
                created_at, 
                store_id,
                stores (name)
            `)
            .in('store_id', storeIds)
            .in('status', ['picking', 'packing'])
            .order('created_at', { ascending: false });

        if (error) throw error;

        const transformed = data.map(session => ({
            id: session.id,
            code: session.code,
            status: session.status,
            created_at: session.created_at,
            store_id: session.store_id,
            store_name: Array.isArray(session.stores) ? (session.stores as any)[0]?.name : (session.stores as any)?.name
        }));

        res.json({ data: transformed });

    } catch (error) {
        logger.error('API', '[GET /api/unified/warehouse/sessions] Error:', error);
        res.status(500).json({
            error: 'Error al obtener sesiones unificadas',
            details: error instanceof Error ? error.message : String(error),
            raw: error
        });
    }
});

// ================================================================
// ORDERS: Consolidated List (ALL STORES)
// ================================================================
unifiedRouter.get('/orders', async (req: AuthRequest, res: Response) => {
    if (!req.user || !req.user.id) {
        return res.status(401).json({ error: 'User not authenticated' });
    }
    try {
        const { limit = '50', offset = '0', status, startDate, endDate } = req.query;
        const storeIds = await getUserStoreIds(req.user.id);
        logger.info('API', `[GET /api/unified/orders] User: ${req.user.id}, Found Stores: ${storeIds.length}`, storeIds);

        if (storeIds.length === 0) {
            logger.info('API', '[GET /api/unified/orders] No stores found for user');
            return res.json({ data: [], pagination: { total: 0, limit: 50, offset: 0, hasMore: false } });
        }

        let query = supabaseAdmin
            .from('orders')
            .select(`
                id,
                order_number,
                customer_first_name,
                customer_last_name,
                customer_phone,
                total_price,
                sleeves_status,
                payment_status,
                payment_gateway,
                financial_status,
                created_at,
                store_id,
                courier_id,
                shopify_order_id,
                shopify_order_name,
                shopify_order_number,
                delivery_link_token,
                deleted_at,
                is_test,
                stores (name),
                order_line_items (id, product_name, quantity, image_url)
            `, { count: 'exact' })
            .in('store_id', storeIds)
            .order('created_at', { ascending: false })
            .range(parseInt(offset as string, 10), parseInt(offset as string, 10) + parseInt(limit as string, 10) - 1);

        if (status) {
            query = query.eq('sleeves_status', status);
        }

        // Date range filtering
        if (startDate) {
            query = query.gte('created_at', startDate as string);
        }
        if (endDate) {
            // Add one day to endDate to include the full day
            const endDateTime = new Date(endDate as string);
            endDateTime.setDate(endDateTime.getDate() + 1);
            query = query.lt('created_at', endDateTime.toISOString());
        }

        const { data, error, count } = await query;
        if (error) {
            logger.error('API', '[GET /api/unified/orders] Query Error:', error);
            throw error;
        }
        logger.info('API', `[GET /api/unified/orders] Fetched ${data?.length} orders (Total: ${count})`);

        // Fetch carrier names for all unique courier_ids
        const courierIds = [...new Set(data?.map((o: any) => o.courier_id).filter(Boolean))];
        let carriersMap: { [key: string]: string } = {};

        if (courierIds.length > 0) {
            const { data: carriers } = await supabaseAdmin
                .from('carriers')
                .select('id, name')
                .in('id', courierIds);

            if (carriers) {
                carriersMap = carriers.reduce((acc: any, c: any) => {
                    acc[c.id] = c.name;
                    return acc;
                }, {});
            }
        }

        const transformed = data.map(order => {
            // Construct product string for legacy display
            const productStr = order.order_line_items
                ?.map((item: any) => `${item.quantity}x ${item.product_name}`)
                .join(', ') || 'Sin productos';

            // Safely access array properties from join
            const storeData = Array.isArray(order.stores) ? order.stores[0] : order.stores;

            return {
                id: order.id,
                order_number: order.order_number,
                customer: `${order.customer_first_name || ''} ${order.customer_last_name || ''}`.trim(),
                phone: order.customer_phone || '',
                product: productStr,
                carrier: order.courier_id ? (carriersMap[order.courier_id] || 'Pendiente') : 'Pendiente',
                total: order.total_price,
                status: order.sleeves_status,
                payment_status: order.payment_status,
                payment_gateway: order.payment_gateway,
                financial_status: order.financial_status,
                date: order.created_at,
                store_id: order.store_id,
                store_name: storeData?.name,
                // Shopify fields for order identification
                shopify_order_id: order.shopify_order_id,
                shopify_order_name: order.shopify_order_name,
                shopify_order_number: order.shopify_order_number,
                // Line items with images for ProductThumbnails component
                order_line_items: order.order_line_items,
                // Delivery and status fields
                delivery_link_token: order.delivery_link_token,
                deleted_at: order.deleted_at,
                is_test: order.is_test,
            };
        });

        const parsedLimit = parseInt(limit as string, 10);
        const parsedOffset = parseInt(offset as string, 10);

        res.json({
            data: transformed,
            pagination: {
                total: count || 0,
                limit: parsedLimit,
                offset: parsedOffset,
                hasMore: parsedOffset + (data?.length || 0) < (count || 0)
            }
        });

    } catch (error) {
        logger.error('API', '[GET /api/unified/orders] Error:', error);
        res.status(500).json({
            error: 'Error al obtener pedidos unificados',
            details: error instanceof Error ? error.message : String(error),
            raw: error
        });
    }
});

// ================================================================
// DISPATCH / SHIPPING: Ready to Ship (ALL STORES)
// ================================================================
unifiedRouter.get('/shipping/ready', async (req: AuthRequest, res: Response) => {
    try {
        if (!req.user || !req.user.id) {
            return res.status(401).json({ error: 'User not authenticated' });
        }
        const storeIds = await getUserStoreIds(req.user.id);
        if (storeIds.length === 0) return res.json({ data: [] });

        const { data, error } = await supabaseAdmin
            .from('orders')
            .select(`
                id,
                order_number,
                customer_first_name,
                customer_last_name,
                customer_address,
                customer_phone,
                carriers!orders_carrier_id_fkey (name),
                payment_method,
                cod_amount,
                store_id,
                stores (name)
            `)
            .in('store_id', storeIds)
            .eq('sleeves_status', 'ready_to_ship') // Status for dispatch
            .order('created_at', { ascending: false });

        if (error) throw error;

        const transformed = data.map(order => ({
            id: order.id,
            order_number: order.order_number,
            customer: `${order.customer_first_name || ''} ${order.customer_last_name || ''}`.trim(),
            address: order.customer_address,
            carrier_name: Array.isArray(order.carriers) ? (order.carriers as any)[0]?.name : (order.carriers as any)?.name || 'Pending',
            cod_amount: order.cod_amount,
            store_id: order.store_id,
            store_name: Array.isArray(order.stores) ? (order.stores as any)[0]?.name : (order.stores as any)?.name
        }));

        res.json({ data: transformed });

    } catch (error) {
        logger.error('API', '[GET /api/unified/shipping/ready] Error:', error);
        res.status(500).json({
            error: 'Error al obtener datos de despacho unificados',
            details: error instanceof Error ? error.message : String(error),
            raw: error
        });
    }
});

// ================================================================
// ANALYTICS: Consolidated Overview (ALL STORES)
// ================================================================
// Returns aggregated metrics across all user's stores
// This is READ-ONLY and safe for Global View
// ================================================================

// Helper function to convert date string to end of day ISO string
const toEndOfDay = (dateString: string): string => {
    const date = new Date(dateString);
    date.setHours(23, 59, 59, 999);
    return date.toISOString();
};

unifiedRouter.get('/analytics/overview', async (req: AuthRequest, res: Response) => {
    try {
        if (!req.user || !req.user.id) {
            return res.status(401).json({ error: 'User not authenticated' });
        }

        const storeIds = await getUserStoreIds(req.user.id);
        logger.info('API', `[GET /api/unified/analytics/overview] User: ${req.user.id}, Found Stores: ${storeIds.length}`, storeIds);

        if (storeIds.length === 0) {
            logger.info('API', '[GET /api/unified/analytics/overview] No stores found for user');
            return res.json({ data: null, stores: [], storeCount: 0 });
        }

        const { startDate, endDate } = req.query;

        // Get store info for display
        const { data: storesData } = await supabaseAdmin
            .from('stores')
            .select('id, name, tax_rate')
            .in('id', storeIds);

        const stores = storesData || [];
        const storeNames = stores.map(s => ({ id: s.id, name: s.name }));

        // Use average tax rate across stores (or 0 if none configured)
        const taxRates = stores.map(s => Number(s.tax_rate) || 0).filter(r => r > 0);
        const avgTaxRate = taxRates.length > 0
            ? taxRates.reduce((a, b) => a + b, 0) / taxRates.length
            : 0;

        // Get confirmation fees from all stores
        const { data: configsData } = await supabaseAdmin
            .from('store_config')
            .select('store_id, confirmation_fee')
            .in('store_id', storeIds);

        const confirmationFeeMap = new Map<string, number>();
        (configsData || []).forEach(c => {
            confirmationFeeMap.set(c.store_id, Number(c.confirmation_fee) || 0);
        });

        // Calculate date ranges
        let currentPeriodStart: Date;
        let currentPeriodEnd: Date;
        let previousPeriodStart: Date;
        let previousPeriodEnd: Date;

        if (startDate && endDate) {
            currentPeriodStart = new Date(startDate as string);
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

        // Fetch orders from all stores
        const { data: ordersData, error: ordersError } = await supabaseAdmin
            .from('orders')
            .select('*, store_id')
            .in('store_id', storeIds)
            .gte('created_at', previousPeriodStart.toISOString())
            .lte('created_at', currentPeriodEnd.toISOString());

        if (ordersError) throw ordersError;

        // Filter out soft-deleted and test orders
        const orders = (ordersData || []).filter(o => !o.deleted_at && o.is_test !== true);

        // Fetch campaigns from all stores
        const { data: campaignsData } = await supabaseAdmin
            .from('campaigns')
            .select('investment, created_at, status, store_id')
            .in('store_id', storeIds);

        const campaigns = campaignsData || [];

        // Split orders into periods
        const currentPeriodOrders = orders.filter(o => new Date(o.created_at) >= currentPeriodStart);
        const previousPeriodOrders = orders.filter(o => {
            const date = new Date(o.created_at);
            return date >= previousPeriodStart && date < currentPeriodStart;
        });

        // Calculate gasto publicitario for each period
        const currentGasto = campaigns
            .filter(c => new Date(c.created_at) >= currentPeriodStart && c.status === 'active')
            .reduce((sum, c) => sum + (Number(c.investment) || 0), 0);

        const previousGasto = campaigns
            .filter(c => {
                const d = new Date(c.created_at);
                return d >= previousPeriodStart && d < currentPeriodStart && c.status === 'active';
            })
            .reduce((sum, c) => sum + (Number(c.investment) || 0), 0);

        // Helper to calculate metrics for a period
        const calculateMetrics = async (ordersList: any[], gastoPublicitario: number) => {
            const count = ordersList.length;

            // Revenue
            const rev = ordersList.reduce((sum, o) => sum + (Number(o.total_price) || 0), 0);

            // Real Revenue (only delivered)
            const realRevenue = ordersList
                .filter(o => o.sleeves_status === 'delivered')
                .reduce((sum, o) => sum + (Number(o.total_price) || 0), 0);

            // Projected Revenue
            const shippedRevenue = ordersList
                .filter(o => o.sleeves_status === 'shipped')
                .reduce((sum, o) => sum + (Number(o.total_price) || 0), 0);

            const shippedOrDelivered = ordersList.filter(o =>
                o.sleeves_status === 'shipped' || o.sleeves_status === 'delivered'
            ).length;
            const deliveredCount = ordersList.filter(o => o.sleeves_status === 'delivered').length;
            const deliveryRateDecimal = shippedOrDelivered > 0 && deliveredCount > 0
                ? (deliveredCount / shippedOrDelivered)
                : 0.85;

            const projectedRevenue = realRevenue + (shippedRevenue * deliveryRateDecimal);

            // Delivery costs
            let deliveryCosts = 0;
            let realDeliveryCosts = 0;
            for (const order of ordersList) {
                const sc = Number(order.shipping_cost) || 0;
                deliveryCosts += sc;
                if (order.sleeves_status === 'delivered') {
                    realDeliveryCosts += sc;
                }
            }

            // Confirmation costs (per store)
            const confirmedOrders = ordersList.filter(o =>
                !['pending', 'cancelled', 'rejected'].includes(o.sleeves_status)
            );
            const realConfirmedOrders = ordersList.filter(o => o.sleeves_status === 'delivered');

            let confirmationCosts = 0;
            let realConfirmationCosts = 0;
            for (const order of confirmedOrders) {
                confirmationCosts += confirmationFeeMap.get(order.store_id) || 0;
            }
            for (const order of realConfirmedOrders) {
                realConfirmationCosts += confirmationFeeMap.get(order.store_id) || 0;
            }

            // Tax collected
            const taxCollectedValue = avgTaxRate > 0 ? (rev - (rev / (1 + avgTaxRate / 100))) : 0;

            // Product costs - batch fetch
            const productIds = new Set<string>();
            for (const order of ordersList) {
                if (order.line_items && Array.isArray(order.line_items)) {
                    for (const item of order.line_items) {
                        if (item.product_id) productIds.add(item.product_id.toString());
                    }
                }
            }

            const productCostMap = new Map<string, number>();
            if (productIds.size > 0) {
                const { data: productsData } = await supabaseAdmin
                    .from('products')
                    .select('id, cost, packaging_cost, additional_costs')
                    .in('id', Array.from(productIds))
                    .in('store_id', storeIds);

                if (productsData) {
                    productsData.forEach(p => {
                        const total = (Number(p.cost) || 0) + (Number(p.packaging_cost) || 0) + (Number(p.additional_costs) || 0);
                        productCostMap.set(p.id, total);
                    });
                }
            }

            let productCosts = 0;
            let realProductCosts = 0;
            for (const order of ordersList) {
                if (order.line_items && Array.isArray(order.line_items)) {
                    let orderCost = 0;
                    for (const item of order.line_items) {
                        const pc = productCostMap.get(item.product_id?.toString()) || 0;
                        const itemCost = pc * Number(item.quantity || 1);
                        orderCost += itemCost;
                        productCosts += itemCost;
                    }
                    if (order.sleeves_status === 'delivered') {
                        realProductCosts += orderCost;
                    }
                }
            }

            // Total costs
            const totalCosts = productCosts + deliveryCosts + confirmationCosts + gastoPublicitario;
            const realTotalCosts = realProductCosts + realDeliveryCosts + realConfirmationCosts + gastoPublicitario;

            // Margins
            const grossProfit = rev - productCosts;
            const realGrossProfit = realRevenue - realProductCosts;
            const grossMargin = rev > 0 ? ((grossProfit / rev) * 100) : 0;
            const realGrossMargin = realRevenue > 0 ? ((realGrossProfit / realRevenue) * 100) : 0;

            const netProfit = rev - totalCosts;
            const realNetProfit = realRevenue - realTotalCosts;
            const netMargin = rev > 0 ? ((netProfit / rev) * 100) : 0;
            const realNetMargin = realRevenue > 0 ? ((realNetProfit / realRevenue) * 100) : 0;

            // ROI & ROAS
            const roi = totalCosts > 0 ? (((rev - totalCosts) / totalCosts) * 100) : 0;
            const realRoi = realTotalCosts > 0 ? (((realRevenue - realTotalCosts) / realTotalCosts) * 100) : 0;
            const roas = gastoPublicitario > 0 ? (rev / gastoPublicitario) : 0;
            const realRoas = gastoPublicitario > 0 ? (realRevenue / gastoPublicitario) : 0;

            // Delivery rate
            const dispatched = ordersList.filter(o => {
                const s = o.sleeves_status;
                return ['ready_to_ship', 'shipped', 'delivered', 'returned', 'delivery_failed'].includes(s) ||
                    (s === 'cancelled' && o.shipped_at);
            }).length;
            const deliveryRate = dispatched > 0 ? ((deliveredCount / dispatched) * 100) : 0;

            return {
                totalOrders: count,
                revenue: rev,
                realRevenue,
                projectedRevenue,
                productCosts,
                realProductCosts,
                deliveryCosts,
                realDeliveryCosts,
                confirmationCosts,
                realConfirmationCosts,
                gasto_publicitario: gastoPublicitario,
                costs: totalCosts,
                realCosts: realTotalCosts,
                grossProfit,
                grossMargin,
                realGrossProfit,
                realGrossMargin,
                netProfit,
                netMargin,
                realNetProfit,
                realNetMargin,
                roi,
                roas,
                realRoi,
                realRoas,
                deliveryRate,
                taxCollected: taxCollectedValue,
            };
        };

        const currentMetrics = await calculateMetrics(currentPeriodOrders, currentGasto);
        const previousMetrics = await calculateMetrics(previousPeriodOrders, previousGasto);

        const totalOrders = currentPeriodOrders.length;
        const confirmedOrdersCount = currentPeriodOrders.filter(o =>
            !['pending', 'cancelled', 'rejected'].includes(o.sleeves_status)
        ).length;

        const costPerOrder = confirmedOrdersCount > 0 ? (currentMetrics.costs / confirmedOrdersCount) : 0;
        const averageOrderValue = totalOrders > 0 ? (currentMetrics.revenue / totalOrders) : 0;

        // Calculate changes
        const calculateChange = (current: number, previous: number): number | null => {
            if (previous === 0) return null;
            return parseFloat((((current - previous) / previous) * 100).toFixed(1));
        };

        const prevConfirmedCount = previousPeriodOrders.filter(o =>
            !['pending', 'cancelled', 'rejected'].includes(o.sleeves_status)
        ).length;
        const prevCostPerOrder = prevConfirmedCount > 0 ? (previousMetrics.costs / prevConfirmedCount) : 0;
        const prevAvgOrderValue = previousMetrics.totalOrders > 0 ? (previousMetrics.revenue / previousMetrics.totalOrders) : 0;

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
            realRoi: calculateChange(currentMetrics.realRoi, previousMetrics.realRoi),
            realRoas: calculateChange(currentMetrics.realRoas, previousMetrics.realRoas),
            deliveryRate: calculateChange(currentMetrics.deliveryRate, previousMetrics.deliveryRate),
            taxCollected: calculateChange(currentMetrics.taxCollected, previousMetrics.taxCollected),
            costPerOrder: calculateChange(costPerOrder, prevCostPerOrder),
            averageOrderValue: calculateChange(averageOrderValue, prevAvgOrderValue),
        };

        logger.info('API', `[GET /api/unified/analytics/overview] Returning data for ${storeNames.length} stores:`, storeNames.map(s => s.name));
        logger.info('API', `[GET /api/unified/analytics/overview] Total Orders: ${totalOrders}, Revenue: ${currentMetrics.revenue}, Stores: ${storeIds.length}`);

        res.json({
            data: {
                totalOrders,
                revenue: Math.round(currentMetrics.revenue),
                productCosts: Math.round(currentMetrics.productCosts),
                deliveryCosts: Math.round(currentMetrics.deliveryCosts),
                confirmationCosts: Math.round(currentMetrics.confirmationCosts),
                costs: Math.round(currentMetrics.costs),
                gasto_publicitario: currentMetrics.gasto_publicitario,
                grossProfit: Math.round(currentMetrics.grossProfit),
                grossMargin: parseFloat(currentMetrics.grossMargin.toFixed(1)),
                netProfit: Math.round(currentMetrics.netProfit),
                netMargin: parseFloat(currentMetrics.netMargin.toFixed(1)),
                profitMargin: parseFloat(currentMetrics.netMargin.toFixed(1)),
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
                realProfitMargin: parseFloat(currentMetrics.realNetMargin.toFixed(1)),
                roi: parseFloat(currentMetrics.roi.toFixed(2)),
                roas: parseFloat(currentMetrics.roas.toFixed(2)),
                realRoi: parseFloat(currentMetrics.realRoi.toFixed(2)),
                realRoas: parseFloat(currentMetrics.realRoas.toFixed(2)),
                deliveryRate: parseFloat(currentMetrics.deliveryRate.toFixed(1)),
                costPerOrder: Math.round(costPerOrder),
                averageOrderValue: Math.round(averageOrderValue),
                taxCollected: Math.round(currentMetrics.taxCollected),
                taxRate: parseFloat(avgTaxRate.toFixed(2)),
                adSpend: currentMetrics.gasto_publicitario,
                adRevenue: currentMetrics.revenue,
                conversionRate: currentMetrics.deliveryRate,
                changes,
            },
            stores: storeNames,
            storeCount: storeIds.length,
        });

    } catch (error) {
        logger.error('API', '[GET /api/unified/analytics/overview] Error:', error);
        res.status(500).json({
            error: 'Error al obtener analíticas unificadas',
            details: error instanceof Error ? error.message : String(error),
        });
    }
});

// ================================================================
// ANALYTICS: Chart Data (ALL STORES)
// ================================================================
unifiedRouter.get('/analytics/chart', async (req: AuthRequest, res: Response) => {
    try {
        if (!req.user || !req.user.id) {
            return res.status(401).json({ error: 'User not authenticated' });
        }

        const storeIds = await getUserStoreIds(req.user.id);
        if (storeIds.length === 0) {
            return res.json({ data: [] });
        }

        const { days = '7', startDate: startDateParam, endDate: endDateParam } = req.query;

        let query = supabaseAdmin
            .from('orders')
            .select('created_at, total_price, sleeves_status, shipping_cost, store_id, line_items')
            .in('store_id', storeIds);

        if (startDateParam && endDateParam) {
            query = query
                .gte('created_at', startDateParam as string)
                .lte('created_at', toEndOfDay(endDateParam as string));
        } else {
            const daysCount = parseInt(days as string, 10);
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - daysCount);
            query = query.gte('created_at', startDate.toISOString());
        }

        const { data: orders, error } = await query;
        if (error) throw error;

        // Filter out test/deleted
        const filteredOrders = (orders || []).filter(o => !o.deleted_at && o.is_test !== true);

        // Fetch campaigns
        const { data: campaignsData } = await supabaseAdmin
            .from('campaigns')
            .select('investment, created_at, status')
            .in('store_id', storeIds)
            .eq('status', 'active');

        const campaigns = campaignsData || [];

        // Collect product IDs
        const productIds = new Set<string>();
        for (const order of filteredOrders) {
            if (order.line_items && Array.isArray(order.line_items)) {
                for (const item of order.line_items) {
                    if (item.product_id) productIds.add(item.product_id.toString());
                }
            }
        }

        const productCostMap = new Map<string, number>();
        if (productIds.size > 0) {
            const { data: productsData } = await supabaseAdmin
                .from('products')
                .select('id, cost, packaging_cost, additional_costs')
                .in('id', Array.from(productIds))
                .in('store_id', storeIds);

            if (productsData) {
                productsData.forEach(p => {
                    const total = (Number(p.cost) || 0) + (Number(p.packaging_cost) || 0) + (Number(p.additional_costs) || 0);
                    productCostMap.set(p.id, total);
                });
            }
        }

        // Group by date
        const dailyData: { [key: string]: { revenue: number; realRevenue: number; costs: number; gasto_publicitario: number; profit: number } } = {};

        for (const order of filteredOrders) {
            const date = new Date(order.created_at).toISOString().split('T')[0];
            if (!dailyData[date]) {
                dailyData[date] = { revenue: 0, realRevenue: 0, costs: 0, gasto_publicitario: 0, profit: 0 };
            }

            const total = Number(order.total_price) || 0;
            dailyData[date].revenue += total;

            if (order.sleeves_status === 'delivered') {
                dailyData[date].realRevenue += total;
                dailyData[date].costs += Number(order.shipping_cost) || 0;

                if (order.line_items && Array.isArray(order.line_items)) {
                    for (const item of order.line_items) {
                        const pc = productCostMap.get(item.product_id?.toString()) || 0;
                        dailyData[date].costs += pc * Number(item.quantity || 1);
                    }
                }
            }
        }

        // Add campaign costs per day
        for (const campaign of campaigns) {
            const date = new Date(campaign.created_at).toISOString().split('T')[0];
            if (dailyData[date]) {
                dailyData[date].gasto_publicitario += Number(campaign.investment) || 0;
            }
        }

        // Calculate profit
        for (const date of Object.keys(dailyData)) {
            dailyData[date].profit = dailyData[date].realRevenue - dailyData[date].costs - dailyData[date].gasto_publicitario;
        }

        // Sort and format
        const chartData = Object.entries(dailyData)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, data]) => ({
                date: new Date(date).toLocaleDateString('es-ES', { month: 'short', day: 'numeric' }),
                ...data,
            }));

        res.json({ data: chartData });

    } catch (error) {
        logger.error('API', '[GET /api/unified/analytics/chart] Error:', error);
        res.status(500).json({
            error: 'Error al obtener datos de gráficos unificados',
            details: error instanceof Error ? error.message : String(error),
        });
    }
});

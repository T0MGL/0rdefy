// ================================================================
// UNIFIED GLOBAL VIEW ROUTER
// ================================================================
// Aggregates data across all stores for a user
// OPTIMIZED for performance: Selects only essential columns
// ================================================================

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

    if (error || !userStores) return [];
    return userStores.map(s => s.store_id);
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
        console.error('[GET /api/unified/warehouse/ready] Error:', error);
        res.status(500).json({
            error: 'Failed to fetch unified warehouse data',
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
        console.error('[GET /api/unified/warehouse/sessions] Error:', error);
        res.status(500).json({
            error: 'Failed to fetch unified sessions',
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
        const { limit = '50', offset = '0', status } = req.query;
        const storeIds = await getUserStoreIds(req.user.id);
        console.log(`[GET /api/unified/orders] User: ${req.user.id}, Found Stores: ${storeIds.length}`, storeIds);

        if (storeIds.length === 0) {
            console.log('[GET /api/unified/orders] No stores found for user');
            return res.json({ data: [], pagination: { total: 0 } });
        }

        let query = supabaseAdmin
            .from('orders')
            .select(`
                id,
                order_number,
                customer_first_name,
                customer_last_name,
                total_price,
                sleeves_status,
                payment_status,
                created_at,
                store_id,
                courier_id,
                stores (name),
                order_line_items (product_name, quantity)
            `, { count: 'exact' })
            .in('store_id', storeIds)
            .order('created_at', { ascending: false })
            .range(parseInt(offset as string), parseInt(offset as string) + parseInt(limit as string) - 1);

        if (status) {
            query = query.eq('sleeves_status', status);
        }

        const { data, error, count } = await query;
        if (error) {
            console.error('[GET /api/unified/orders] Query Error:', error);
            throw error;
        }
        console.log(`[GET /api/unified/orders] Fetched ${data?.length} orders (Total: ${count})`);

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
            // Construct product string
            const productStr = order.order_line_items
                ?.map((item: any) => `${item.quantity}x ${item.product_name}`)
                .join(', ') || 'Sin productos';

            // Safely access array properties from join
            const storeData = Array.isArray(order.stores) ? order.stores[0] : order.stores;

            return {
                id: order.id,
                order_number: order.order_number,
                customer: `${order.customer_first_name || ''} ${order.customer_last_name || ''}`.trim(),
                product: productStr,
                carrier: order.courier_id ? (carriersMap[order.courier_id] || 'Pendiente') : 'Pendiente',
                total: order.total_price,
                status: order.sleeves_status,
                payment_status: order.payment_status,
                date: order.created_at,
                store_id: order.store_id,
                store_name: storeData?.name
            };
        });

        res.json({
            data: transformed,
            pagination: {
                total: count || 0,
                limit: parseInt(limit as string),
                offset: parseInt(offset as string)
            }
        });

    } catch (error) {
        console.error('[GET /api/unified/orders] Error:', error);
        res.status(500).json({
            error: 'Failed to fetch unified orders',
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
        console.error('[GET /api/unified/shipping/ready] Error:', error);
        res.status(500).json({
            error: 'Failed to fetch unified dispatch data',
            details: error instanceof Error ? error.message : String(error),
            raw: error
        });
    }
});

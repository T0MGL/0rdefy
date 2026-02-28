// ================================================================
// NEONFLOW API - CUSTOMERS ROUTES
// ================================================================
// Customer management with aggregate stats and order history
// MVP: Uses hardcoded store_id, no authentication
// Uses Supabase JS client for database operations
// ================================================================

import { logger } from '../utils/logger';
import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../db/connection';
import { verifyToken, extractStoreId, AuthRequest } from '../middleware/auth';
import { extractUserRole, requireModule, requirePermission, PermissionRequest } from '../middleware/permissions';
import { Module, Permission } from '../permissions';
import { sanitizeSearchInput, validateUUIDParam, parsePagination } from '../utils/sanitize';

export const customersRouter = Router();

customersRouter.use(verifyToken, extractStoreId, extractUserRole);

// Apply module-level access check for all routes
customersRouter.use(requireModule(Module.CUSTOMERS));

// Using req.storeId from middleware

// ================================================================
// GET /api/customers - List all customers
// ================================================================
customersRouter.get('/', async (req: AuthRequest, res: Response) => {
    try {
        const {
            limit: rawLimit = '50',
            offset: rawOffset = '0',
            search,
            min_orders,
            min_spent,
            sort_by = 'created_at',
            sort_order = 'DESC'
        } = req.query;
        const { limit, offset } = parsePagination(rawLimit, rawOffset);

        // Build base query with count
        let query = supabaseAdmin
            .from('customers')
            .select('*', { count: 'exact' })
            .eq('store_id', req.storeId);

        // Apply search filter (sanitized to prevent SQL injection)
        if (search) {
            const sanitized = sanitizeSearchInput(search as string);
            query = query.or(`first_name.ilike.%${sanitized}%,last_name.ilike.%${sanitized}%,email.ilike.%${sanitized}%,phone.ilike.%${sanitized}%`);
        }

        // Apply min_orders filter
        if (min_orders) {
            query = query.gte('total_orders', parseInt(min_orders as string, 10));
        }

        // Apply min_spent filter
        if (min_spent) {
            query = query.gte('total_spent', parseFloat(min_spent as string));
        }

        // Validate and apply sorting
        const validSortFields = ['created_at', 'total_orders', 'total_spent', 'first_name', 'last_name'];
        const sortField = validSortFields.includes(sort_by as string) ? sort_by as string : 'created_at';
        const sortDirection = sort_order === 'ASC';

        query = query
            .order(sortField, { ascending: sortDirection })
            .range(offset, offset + limit - 1);

        const { data, error, count } = await query;

        if (error) {
            throw error;
        }

        res.json({
            data: data || [],
            pagination: {
                total: count || 0,
                limit,
                offset,
                hasMore: offset + (data?.length || 0) < (count || 0)
            }
        });
    } catch (error: any) {
        logger.error('API', '[GET /api/customers] Error:', error);
        res.status(500).json({
            error: 'Error al obtener clientes',
            message: error.message
        });
    }
});

// ================================================================
// GET /api/customers/:id - Get single customer
// ================================================================
customersRouter.get('/:id', validateUUIDParam('id'), async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;

        const { data, error } = await supabaseAdmin
            .from('customers')
            .select('*')
            .eq('id', id)
            .eq('store_id', req.storeId)
            .single();

        if (error || !data) {
            return res.status(404).json({
                error: 'Customer not found'
            });
        }

        res.json(data);
    } catch (error: any) {
        logger.error('API', `[GET /api/customers/${req.params.id}] Error:`, error);
        res.status(500).json({
            error: 'Error al obtener cliente',
            message: error.message
        });
    }
});

// ================================================================
// GET /api/customers/:id/orders - Get customer order history
// ================================================================
customersRouter.get('/:id/orders', validateUUIDParam('id'), async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { limit: rawLimit = '20', offset: rawOffset = '0' } = req.query;
        const { limit, offset } = parsePagination(rawLimit, rawOffset);

        const { data, error, count } = await supabaseAdmin
            .from('orders')
            .select(`
                *,
                customers!orders_customer_id_fkey (
                    first_name,
                    last_name
                )
            `, { count: 'exact' })
            .eq('customer_id', id)
            .eq('store_id', req.storeId)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) {
            throw error;
        }

        // Transform data to include customer_full_name
        const transformedData = data?.map(order => ({
            ...order,
            customer_full_name: order.customers
                ? `${order.customers.first_name} ${order.customers.last_name}`
                : null
        })) || [];

        res.json({
            data: transformedData,
            pagination: {
                total: count || 0,
                limit,
                offset,
                hasMore: offset + (data?.length || 0) < (count || 0)
            }
        });
    } catch (error: any) {
        logger.error('API', `[GET /api/customers/${req.params.id}/orders] Error:`, error);
        res.status(500).json({
            error: 'Error al obtener pedidos del cliente',
            message: error.message
        });
    }
});

// ================================================================
// POST /api/customers - Create new customer
// ================================================================
customersRouter.post('/', requirePermission(Module.CUSTOMERS, Permission.CREATE), async (req: PermissionRequest, res: Response) => {
    try {
        const {
            shopify_customer_id,
            email,
            phone,
            first_name,
            last_name
        } = req.body;

        // Validation
        if (!email && !phone) {
            return res.status(400).json({
                error: 'Validation failed',
                message: 'Either email or phone is required'
            });
        }

        const { data, error } = await supabaseAdmin
            .from('customers')
            .insert([{
                store_id: req.storeId,
                shopify_customer_id,
                email,
                phone,
                first_name,
                last_name,
                total_orders: 0,
                total_spent: 0
            }])
            .select()
            .single();

        if (error) {
            // Handle duplicate email or phone
            if (error.code === '23505') {
                return res.status(409).json({
                    error: 'Duplicate customer',
                    message: 'A customer with this email or phone already exists in this store'
                });
            }
            throw error;
        }

        res.status(201).json({
            message: 'Customer created successfully',
            data
        });
    } catch (error: any) {
        logger.error('API', '[POST /api/customers] Error:', error);
        res.status(500).json({
            error: 'Error al crear cliente',
            message: error.message
        });
    }
});

// ================================================================
// PUT /api/customers/:id - Update customer
// ================================================================
customersRouter.put('/:id', validateUUIDParam('id'), requirePermission(Module.CUSTOMERS, Permission.EDIT), async (req: PermissionRequest, res: Response) => {
    try {
        const { id } = req.params;
        const {
            email,
            phone,
            first_name,
            last_name,
            shopify_customer_id
        } = req.body;

        // Build update object with only provided fields
        const updateData: any = {
            updated_at: new Date().toISOString()
        };

        if (email !== undefined) updateData.email = email;
        if (phone !== undefined) updateData.phone = phone;
        if (first_name !== undefined) updateData.first_name = first_name;
        if (last_name !== undefined) updateData.last_name = last_name;
        if (shopify_customer_id !== undefined) updateData.shopify_customer_id = shopify_customer_id;

        const { data, error } = await supabaseAdmin
            .from('customers')
            .update(updateData)
            .eq('id', id)
            .eq('store_id', req.storeId)
            .select()
            .single();

        if (error || !data) {
            return res.status(404).json({
                error: 'Customer not found'
            });
        }

        res.json({
            message: 'Customer updated successfully',
            data
        });
    } catch (error: any) {
        logger.error('API', `[PUT /api/customers/${req.params.id}] Error:`, error);
        res.status(500).json({
            error: 'Error al actualizar cliente',
            message: error.message
        });
    }
});

// ================================================================
// GET /api/customers/stats/overview - Get customer statistics
// ================================================================
customersRouter.get('/stats/overview', async (req: AuthRequest, res: Response) => {
    try {
        // Get all customers to calculate aggregate stats
        const { data: allCustomers, error: customersError } = await supabaseAdmin
            .from('customers')
            .select('total_orders, total_spent')
            .eq('store_id', req.storeId);

        if (customersError) {
            throw customersError;
        }

        // Calculate aggregate statistics
        const totalCustomers = allCustomers?.length || 0;
        const repeatCustomers = allCustomers?.filter(c => c.total_orders > 1).length || 0;
        const avgOrdersPerCustomer = totalCustomers > 0
            ? allCustomers.reduce((sum, c) => sum + c.total_orders, 0) / totalCustomers
            : 0;
        const avgLifetimeValue = totalCustomers > 0
            ? allCustomers.reduce((sum, c) => sum + c.total_spent, 0) / totalCustomers
            : 0;
        const totalCustomerValue = allCustomers?.reduce((sum, c) => sum + c.total_spent, 0) || 0;

        // Get top customers by spend
        const { data: topCustomers, error: topError } = await supabaseAdmin
            .from('customers')
            .select('id, first_name, last_name, email, phone, total_orders, total_spent')
            .eq('store_id', req.storeId)
            .order('total_spent', { ascending: false })
            .limit(10);

        if (topError) {
            throw topError;
        }

        // Get recent customers
        const { data: recentCustomers, error: recentError } = await supabaseAdmin
            .from('customers')
            .select('id, first_name, last_name, email, phone, created_at')
            .eq('store_id', req.storeId)
            .order('created_at', { ascending: false })
            .limit(10);

        if (recentError) {
            throw recentError;
        }

        // Transform customer data to include name field
        const topCustomersWithName = topCustomers?.map(c => ({
            ...c,
            name: `${c.first_name} ${c.last_name}`
        })) || [];

        const recentCustomersWithName = recentCustomers?.map(c => ({
            ...c,
            name: `${c.first_name} ${c.last_name}`
        })) || [];

        res.json({
            data: {
                overview: {
                    total_customers: totalCustomers,
                    repeat_customers: repeatCustomers,
                    avg_orders_per_customer: avgOrdersPerCustomer,
                    avg_lifetime_value: avgLifetimeValue,
                    total_customer_value: totalCustomerValue
                },
                top_customers: topCustomersWithName,
                recent_customers: recentCustomersWithName
            }
        });
    } catch (error: any) {
        logger.error('API', '[GET /api/customers/stats/overview] Error:', error);
        res.status(500).json({
            error: 'Error al obtener estadísticas del cliente',
            message: error.message
        });
    }
});

// ================================================================
// GET /api/customers/search - Search customers by phone or email
// ================================================================
customersRouter.get('/search', async (req: AuthRequest, res: Response) => {
    try {
        const { q } = req.query;

        if (!q) {
            return res.status(400).json({
                error: 'Validation failed',
                message: 'Query parameter "q" is required'
            });
        }

        const sanitized = sanitizeSearchInput(q as string);
        const { data, error } = await supabaseAdmin
            .from('customers')
            .select('*')
            .eq('store_id', req.storeId)
            .or(`email.ilike.%${sanitized}%,phone.ilike.%${sanitized}%,first_name.ilike.%${sanitized}%,last_name.ilike.%${sanitized}%`)
            .order('total_orders', { ascending: false })
            .limit(20);

        if (error) {
            throw error;
        }

        res.json({
            data: data || []
        });
    } catch (error: any) {
        logger.error('API', '[GET /api/customers/search] Error:', error);
        res.status(500).json({
            error: 'Error al buscar clientes',
            message: error.message
        });
    }
});

// ================================================================
// DELETE /api/customers/:id - Delete customer
// ================================================================
customersRouter.delete('/:id', validateUUIDParam('id'), requirePermission(Module.CUSTOMERS, Permission.DELETE), async (req: PermissionRequest, res: Response) => {
    try {
        const { id } = req.params;

        // Check if customer has orders (scoped to current store)
        const { count, error: countError } = await supabaseAdmin
            .from('orders')
            .select('*', { count: 'exact', head: true })
            .eq('customer_id', id)
            .eq('store_id', req.storeId);

        if (countError) {
            throw countError;
        }

        if (count && count > 0) {
            return res.status(409).json({
                error: 'No se puede eliminar el cliente',
                message: 'El cliente tiene pedidos asociados. No es posible eliminarlo.'
            });
        }

        const { data, error } = await supabaseAdmin
            .from('customers')
            .delete()
            .eq('id', id)
            .eq('store_id', req.storeId)
            .select('id')
            .single();

        if (error || !data) {
            return res.status(404).json({
                error: 'Customer not found'
            });
        }

        res.json({
            message: 'Customer deleted successfully',
            id: data.id
        });
    } catch (error: any) {
        logger.error('API', `[DELETE /api/customers/${req.params.id}] Error:`, error);
        res.status(500).json({
            error: 'Error al eliminar cliente',
            message: error.message
        });
    }
});

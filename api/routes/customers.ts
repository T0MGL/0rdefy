// ================================================================
// NEONFLOW API - CUSTOMERS ROUTES
// ================================================================
// Customer management with aggregate stats and order history
// Uses Supabase JS client for database operations
// ================================================================

import { z } from 'zod';
import { logger } from '../utils/logger';
import { Router, Response } from 'express';
import { supabaseAdmin } from '../db/connection';
import { verifyToken, extractStoreId, AuthRequest } from '../middleware/auth';
import { extractUserRole, requireModule, requirePermission, PermissionRequest } from '../middleware/permissions';
import { Module, Permission } from '../permissions';
import { sanitizeSearchInput, validateUUIDParam, parsePagination } from '../utils/sanitize';
import { validate } from '../utils/validate';

export const customersRouter = Router();

customersRouter.use(verifyToken, extractStoreId, extractUserRole);

// Apply module-level access check for all routes
customersRouter.use(requireModule(Module.CUSTOMERS));

// Explicit column lists (no SELECT *)
const CUSTOMER_LIST_COLUMNS = 'id, first_name, last_name, email, phone, total_orders, total_spent, accepts_marketing, last_order_at, created_at, updated_at, city, country, tags, notes';
const CUSTOMER_DETAIL_COLUMNS = 'id, first_name, last_name, email, phone, total_orders, total_spent, accepts_marketing, last_order_at, created_at, updated_at, address, city, state, postal_code, country, notes, tags, name, shopify_customer_id';
const CUSTOMER_SEARCH_COLUMNS = CUSTOMER_DETAIL_COLUMNS;
const ORDER_HISTORY_COLUMNS = 'id, order_number, shopify_order_number, status, financial_status, fulfillment_status, total, subtotal, total_discounts, total_tax, currency, created_at, updated_at, customer_id, shipping_address, billing_address, note';

// ================================================================
// Zod Schemas
// ================================================================

const CreateCustomerSchema = z.object({
    shopify_customer_id: z.string().optional(),
    email: z.string().email('Invalid email format').optional(),
    phone: z.string().min(1).optional(),
    first_name: z.string().max(100).optional(),
    last_name: z.string().max(100).optional(),
    address: z.string().max(500).optional(),
    city: z.string().max(100).optional(),
    state: z.string().max(100).optional(),
    postal_code: z.string().max(20).optional(),
    country: z.string().max(100).optional(),
    notes: z.string().max(2000).optional(),
    tags: z.union([z.array(z.string()), z.string()]).optional(),
    accepts_marketing: z.boolean().optional(),
}).refine(
    (data) => data.email || data.phone,
    { message: 'Either email or phone is required', path: ['email'] }
);

const UpdateCustomerSchema = z.object({
    email: z.string().email('Invalid email format').optional(),
    phone: z.string().min(1).optional(),
    first_name: z.string().max(100).optional(),
    last_name: z.string().max(100).optional(),
    shopify_customer_id: z.string().optional(),
    address: z.string().max(500).optional(),
    city: z.string().max(100).optional(),
    state: z.string().max(100).optional(),
    postal_code: z.string().max(20).optional(),
    country: z.string().max(100).optional(),
    notes: z.string().max(2000).optional(),
    tags: z.union([z.array(z.string()), z.string()]).optional(),
    accepts_marketing: z.boolean().optional(),
});

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
            sort_order = 'DESC',
            city,
            accepts_marketing,
            last_order_before
        } = req.query;
        const { limit, offset } = parsePagination(rawLimit, rawOffset);

        // Build base query with count
        let query = supabaseAdmin
            .from('customers')
            .select(CUSTOMER_LIST_COLUMNS, { count: 'exact' })
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

        // Apply city filter
        if (city) {
            query = query.ilike('city', `%${sanitizeSearchInput(city as string)}%`);
        }

        // Apply accepts_marketing filter
        if (accepts_marketing) {
            query = query.eq('accepts_marketing', accepts_marketing === 'true');
        }

        // Apply last_order_before filter (ISO date string)
        if (last_order_before) {
            query = query.lt('last_order_at', last_order_before as string);
        }

        // Validate and apply sorting
        const validSortFields = ['created_at', 'total_orders', 'total_spent', 'first_name', 'last_name'];
        const sortField = validSortFields.includes(sort_by as string) ? sort_by as string : 'created_at';
        const sortDirection = (sort_order as string)?.toUpperCase() === 'ASC';

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
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error('API', '[GET /api/customers] Error:', error);
        res.status(500).json({
            error: 'Error al obtener clientes',
            message
        });
    }
});

// ================================================================
// GET /api/customers/stats/overview - Get customer statistics
// MUST be registered before /:id to avoid Express param capture
// ================================================================
customersRouter.get('/stats/overview', async (req: AuthRequest, res: Response) => {
    try {
        const [statsResult, topResult, recentResult] = await Promise.all([
            supabaseAdmin.rpc('get_customer_stats', { p_store_id: req.storeId }),
            supabaseAdmin
                .from('customers')
                .select('id, first_name, last_name, email, phone, total_orders, total_spent')
                .eq('store_id', req.storeId)
                .order('total_spent', { ascending: false })
                .limit(10),
            supabaseAdmin
                .from('customers')
                .select('id, first_name, last_name, email, phone, created_at')
                .eq('store_id', req.storeId)
                .order('created_at', { ascending: false })
                .limit(10),
        ]);

        if (statsResult.error) {
            throw statsResult.error;
        }
        if (topResult.error) {
            throw topResult.error;
        }
        if (recentResult.error) {
            throw recentResult.error;
        }

        const stats = statsResult.data?.[0] ?? {
            total_customers: 0,
            repeat_customers: 0,
            avg_orders_per_customer: 0,
            avg_lifetime_value: 0,
            total_customer_value: 0,
        };

        const topCustomersWithName = topResult.data?.map(c => ({
            ...c,
            name: `${c.first_name} ${c.last_name}`
        })) || [];

        const recentCustomersWithName = recentResult.data?.map(c => ({
            ...c,
            name: `${c.first_name} ${c.last_name}`
        })) || [];

        res.json({
            data: {
                overview: {
                    total_customers: Number(stats.total_customers),
                    repeat_customers: Number(stats.repeat_customers),
                    avg_orders_per_customer: Number(stats.avg_orders_per_customer),
                    avg_lifetime_value: Number(stats.avg_lifetime_value),
                    total_customer_value: Number(stats.total_customer_value),
                },
                top_customers: topCustomersWithName,
                recent_customers: recentCustomersWithName
            }
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error('API', '[GET /api/customers/stats/overview] Error:', error);
        res.status(500).json({
            error: 'Error al obtener estadisticas del cliente',
            message
        });
    }
});

// ================================================================
// GET /api/customers/search - Search customers by phone or email
// MUST be registered before /:id to avoid Express param capture
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
            .select(CUSTOMER_SEARCH_COLUMNS)
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
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error('API', '[GET /api/customers/search] Error:', error);
        res.status(500).json({
            error: 'Error al buscar clientes',
            message
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
            .select(CUSTOMER_DETAIL_COLUMNS)
            .eq('id', id)
            .eq('store_id', req.storeId)
            .single();

        if (error || !data) {
            return res.status(404).json({
                error: 'Customer not found'
            });
        }

        res.json(data);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error('API', `[GET /api/customers/${req.params.id}] Error:`, error);
        res.status(500).json({
            error: 'Error al obtener cliente',
            message
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
                ${ORDER_HISTORY_COLUMNS},
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
        const transformedData = data?.map(order => {
            const customer = Array.isArray(order.customers)
                ? order.customers[0]
                : order.customers;
            return {
                ...order,
                customer_full_name: customer
                    ? `${customer.first_name} ${customer.last_name}`
                    : null
            };
        }) || [];

        res.json({
            data: transformedData,
            pagination: {
                total: count || 0,
                limit,
                offset,
                hasMore: offset + (data?.length || 0) < (count || 0)
            }
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error('API', `[GET /api/customers/${req.params.id}/orders] Error:`, error);
        res.status(500).json({
            error: 'Error al obtener pedidos del cliente',
            message
        });
    }
});

// ================================================================
// POST /api/customers - Create new customer
// ================================================================
customersRouter.post('/', requirePermission(Module.CUSTOMERS, Permission.CREATE), validate(CreateCustomerSchema), async (req: PermissionRequest, res: Response) => {
    try {
        const {
            shopify_customer_id,
            email,
            phone,
            first_name,
            last_name,
            address,
            city,
            state,
            postal_code,
            country,
            notes,
            tags,
            accepts_marketing
        } = req.body;

        const insertData: Record<string, string | number | boolean | string[]> = {
            store_id: req.storeId as string,
            total_orders: 0,
            total_spent: 0
        };

        if (shopify_customer_id !== undefined) insertData.shopify_customer_id = shopify_customer_id;
        if (email !== undefined) insertData.email = email;
        if (phone !== undefined) insertData.phone = phone;
        if (first_name !== undefined) insertData.first_name = first_name;
        if (last_name !== undefined) insertData.last_name = last_name;
        if (address !== undefined) insertData.address = address;
        if (city !== undefined) insertData.city = city;
        if (state !== undefined) insertData.state = state;
        if (postal_code !== undefined) insertData.postal_code = postal_code;
        if (country !== undefined) insertData.country = country;
        if (notes !== undefined) insertData.notes = notes;
        if (tags !== undefined) insertData.tags = tags;
        if (accepts_marketing !== undefined) insertData.accepts_marketing = accepts_marketing;

        const { data, error } = await supabaseAdmin
            .from('customers')
            .insert([insertData])
            .select(CUSTOMER_DETAIL_COLUMNS)
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
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error('API', '[POST /api/customers] Error:', error);
        res.status(500).json({
            error: 'Error al crear cliente',
            message
        });
    }
});

// ================================================================
// PUT /api/customers/:id - Update customer
// ================================================================
customersRouter.put('/:id', validateUUIDParam('id'), requirePermission(Module.CUSTOMERS, Permission.EDIT), validate(UpdateCustomerSchema), async (req: PermissionRequest, res: Response) => {
    try {
        const { id } = req.params;
        const {
            email,
            phone,
            first_name,
            last_name,
            shopify_customer_id,
            address,
            city,
            state,
            postal_code,
            country,
            notes,
            tags,
            accepts_marketing
        } = req.body;

        // Build update object with only provided fields
        const updateData: Record<string, string | boolean | string[]> = {
            updated_at: new Date().toISOString()
        };

        if (email !== undefined) updateData.email = email;
        if (phone !== undefined) updateData.phone = phone;
        if (first_name !== undefined) updateData.first_name = first_name;
        if (last_name !== undefined) updateData.last_name = last_name;
        if (shopify_customer_id !== undefined) updateData.shopify_customer_id = shopify_customer_id;
        if (address !== undefined) updateData.address = address;
        if (city !== undefined) updateData.city = city;
        if (state !== undefined) updateData.state = state;
        if (postal_code !== undefined) updateData.postal_code = postal_code;
        if (country !== undefined) updateData.country = country;
        if (notes !== undefined) updateData.notes = notes;
        if (tags !== undefined) updateData.tags = tags;
        if (accepts_marketing !== undefined) updateData.accepts_marketing = accepts_marketing;

        const { data, error } = await supabaseAdmin
            .from('customers')
            .update(updateData)
            .eq('id', id)
            .eq('store_id', req.storeId)
            .select(CUSTOMER_DETAIL_COLUMNS)
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
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error('API', `[PUT /api/customers/${req.params.id}] Error:`, error);
        res.status(500).json({
            error: 'Error al actualizar cliente',
            message
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
            .select('id', { count: 'exact', head: true })
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
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error('API', `[DELETE /api/customers/${req.params.id}] Error:`, error);
        res.status(500).json({
            error: 'Error al eliminar cliente',
            message
        });
    }
});

// ================================================================
// NEONFLOW API - STORES ROUTES
// ================================================================
// Store management and configuration endpoints
// MVP: Uses hardcoded store_id, no authentication
// Uses Supabase JS client for database operations
// ================================================================

import { Router, Request, Response } from 'express';
import { supabaseAdmin, getStore, getStoreConfig } from '../db/connection';
import { verifyToken, extractStoreId, AuthRequest } from '../middleware/auth';

export const storesRouter = Router();

storesRouter.use(verifyToken, extractStoreId);


// ================================================================
// GET /api/stores - List all stores (for multi-store dashboard)
// ================================================================
storesRouter.get('/', async (req: AuthRequest, res: Response) => {
    try {
        const { is_active } = req.query;

        // Build query
        let query = supabaseAdmin
            .from('stores')
            .select('*')
            .order('created_at', { ascending: false });

        if (is_active !== undefined) {
            query = query.eq('is_active', is_active === 'true');
        }

        const { data, error } = await query;

        if (error) {
            throw error;
        }

        res.json({
            data: data || []
        });
    } catch (error: any) {
        console.error('[GET /api/stores] Error:', error);
        res.status(500).json({
            error: 'Failed to fetch stores',
            message: error.message
        });
    }
});

// ================================================================
// GET /api/stores/current - Get current store (hardcoded for MVP)
// ================================================================
storesRouter.get('/current', async (req: AuthRequest, res: Response) => {
    try {
        const store = await getStore(req.storeId);

        if (!store) {
            return res.status(404).json({
                error: 'Store not found',
                message: `Store with ID ${req.storeId} does not exist or is inactive`
            });
        }

        res.json(store);
    } catch (error: any) {
        console.error('[GET /api/stores/current] Error:', error);
        res.status(500).json({
            error: 'Failed to fetch current store',
            message: error.message
        });
    }
});

// ================================================================
// GET /api/stores/:id - Get single store
// ================================================================
storesRouter.get('/:id', async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;

        const { data, error } = await supabaseAdmin
            .from('stores')
            .select('*')
            .eq('id', id)
            .single();

        if (error || !data) {
            return res.status(404).json({
                error: 'Store not found'
            });
        }

        res.json(data);
    } catch (error: any) {
        console.error(`[GET /api/stores/${req.params.id}] Error:`, error);
        res.status(500).json({
            error: 'Failed to fetch store',
            message: error.message
        });
    }
});

// ================================================================
// POST /api/stores - Create new store
// ================================================================
storesRouter.post('/', async (req: AuthRequest, res: Response) => {
    try {
        const {
            name,
            country = 'PY',
            timezone = 'America/Asuncion',
            currency = 'USD',
            tax_rate = 10.00,
            admin_fee = 0.00,
            is_active = true
        } = req.body;

        // Validation
        if (!name) {
            return res.status(400).json({
                error: 'Validation failed',
                message: 'Store name is required'
            });
        }

        if (!req.userId) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'User ID not found in token'
            });
        }

        // Create the store
        const { data: newStore, error: storeError } = await supabaseAdmin
            .from('stores')
            .insert([{
                name,
                country,
                timezone,
                currency,
                tax_rate,
                admin_fee,
                is_active
            }])
            .select()
            .single();

        if (storeError || !newStore) {
            throw storeError || new Error('Failed to create store');
        }

        // Associate the store with the current user as owner
        const { error: associationError } = await supabaseAdmin
            .from('user_stores')
            .insert([{
                user_id: req.userId,
                store_id: newStore.id,
                role: 'owner'
            }]);

        if (associationError) {
            // Rollback: delete the created store
            await supabaseAdmin
                .from('stores')
                .delete()
                .eq('id', newStore.id);

            throw associationError;
        }

        console.log(`✅ [POST /api/stores] Store created and associated with user ${req.userId}`);

        res.status(201).json({
            message: 'Store created successfully',
            data: newStore
        });
    } catch (error: any) {
        console.error('[POST /api/stores] Error:', error);
        res.status(500).json({
            error: 'Failed to create store',
            message: error.message
        });
    }
});

// ================================================================
// PUT /api/stores/:id - Update store
// ================================================================
storesRouter.put('/:id', async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const {
            name,
            country,
            timezone,
            currency,
            is_active
        } = req.body;

        // Build update object with only provided fields
        const updateData: any = {
            updated_at: new Date().toISOString()
        };

        if (name !== undefined) updateData.name = name;
        if (country !== undefined) updateData.country = country;
        if (timezone !== undefined) updateData.timezone = timezone;
        if (currency !== undefined) updateData.currency = currency;
        if (is_active !== undefined) updateData.is_active = is_active;

        const { data, error } = await supabaseAdmin
            .from('stores')
            .update(updateData)
            .eq('id', id)
            .select()
            .single();

        if (error || !data) {
            return res.status(404).json({
                error: 'Store not found'
            });
        }

        res.json({
            message: 'Store updated successfully',
            data
        });
    } catch (error: any) {
        console.error(`[PUT /api/stores/${req.params.id}] Error:`, error);
        res.status(500).json({
            error: 'Failed to update store',
            message: error.message
        });
    }
});

// ================================================================
// GET /api/stores/:id/config - Get store configuration
// ================================================================
storesRouter.get('/:id/config', async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;

        const config = await getStoreConfig(id);

        if (!config) {
            return res.status(404).json({
                error: 'Store configuration not found',
                message: 'This store does not have a configuration yet'
            });
        }

        res.json(config);
    } catch (error: any) {
        console.error(`[GET /api/stores/${req.params.id}/config] Error:`, error);
        res.status(500).json({
            error: 'Failed to fetch store configuration',
            message: error.message
        });
    }
});

// ================================================================
// PUT /api/stores/:id/config - Update store configuration
// ================================================================
storesRouter.put('/:id/config', async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const {
            shopify_store_url,
            shopify_access_token,
            whatsapp_phone_number_id,
            whatsapp_business_account_id,
            whatsapp_api_token,
            n8n_webhook_url,
            agent_name,
            follow_up_template_1,
            follow_up_template_2,
            follow_up_template_3,
            follow_up_1_delay_hours,
            follow_up_2_delay_hours,
            follow_up_3_delay_hours,
            confirmation_timeout_hours,
            auto_reject_after_hours
        } = req.body;

        // Check if config exists
        const { data: existingConfig } = await supabaseAdmin
            .from('store_config')
            .select('id')
            .eq('store_id', id)
            .single();

        let data, error;
        if (!existingConfig) {
            // Create new config
            const insertResult = await supabaseAdmin
                .from('store_config')
                .insert([{
                    store_id: id,
                    shopify_store_url,
                    shopify_access_token,
                    whatsapp_phone_number_id,
                    whatsapp_business_account_id,
                    whatsapp_api_token,
                    n8n_webhook_url,
                    agent_name,
                    follow_up_template_1,
                    follow_up_template_2,
                    follow_up_template_3,
                    follow_up_1_delay_hours: follow_up_1_delay_hours || 2,
                    follow_up_2_delay_hours: follow_up_2_delay_hours || 24,
                    follow_up_3_delay_hours: follow_up_3_delay_hours || 48,
                    confirmation_timeout_hours: confirmation_timeout_hours || 72,
                    auto_reject_after_hours: auto_reject_after_hours || 96
                }])
                .select()
                .single();
            data = insertResult.data;
            error = insertResult.error;
        } else {
            // Update existing config - build update object with only provided fields
            const updateData: any = {
                updated_at: new Date().toISOString()
            };

            if (shopify_store_url !== undefined) updateData.shopify_store_url = shopify_store_url;
            if (shopify_access_token !== undefined) updateData.shopify_access_token = shopify_access_token;
            if (whatsapp_phone_number_id !== undefined) updateData.whatsapp_phone_number_id = whatsapp_phone_number_id;
            if (whatsapp_business_account_id !== undefined) updateData.whatsapp_business_account_id = whatsapp_business_account_id;
            if (whatsapp_api_token !== undefined) updateData.whatsapp_api_token = whatsapp_api_token;
            if (n8n_webhook_url !== undefined) updateData.n8n_webhook_url = n8n_webhook_url;
            if (agent_name !== undefined) updateData.agent_name = agent_name;
            if (follow_up_template_1 !== undefined) updateData.follow_up_template_1 = follow_up_template_1;
            if (follow_up_template_2 !== undefined) updateData.follow_up_template_2 = follow_up_template_2;
            if (follow_up_template_3 !== undefined) updateData.follow_up_template_3 = follow_up_template_3;
            if (follow_up_1_delay_hours !== undefined) updateData.follow_up_1_delay_hours = follow_up_1_delay_hours;
            if (follow_up_2_delay_hours !== undefined) updateData.follow_up_2_delay_hours = follow_up_2_delay_hours;
            if (follow_up_3_delay_hours !== undefined) updateData.follow_up_3_delay_hours = follow_up_3_delay_hours;
            if (confirmation_timeout_hours !== undefined) updateData.confirmation_timeout_hours = confirmation_timeout_hours;
            if (auto_reject_after_hours !== undefined) updateData.auto_reject_after_hours = auto_reject_after_hours;

            const updateResult = await supabaseAdmin
                .from('store_config')
                .update(updateData)
                .eq('store_id', id)
                .select()
                .single();
            data = updateResult.data;
            error = updateResult.error;
        }

        if (error) {
            throw error;
        }

        res.json({
            message: 'Store configuration updated successfully',
            data
        });
    } catch (error: any) {
        console.error(`[PUT /api/stores/${req.params.id}/config] Error:`, error);
        res.status(500).json({
            error: 'Failed to update store configuration',
            message: error.message
        });
    }
});

// ================================================================
// GET /api/stores/:id/stats - Get store statistics
// ================================================================
storesRouter.get('/:id/stats', async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;

        // Get all orders for this store
        const { data: orders, error: ordersError } = await supabaseAdmin
            .from('orders')
            .select('sleeves_status, total_price')
            .eq('store_id', id);

        if (ordersError) {
            throw ordersError;
        }

        // Calculate order stats
        const orderStats = {
            total_orders: orders?.length || 0,
            pending_orders: orders?.filter(o => o.sleeves_status === 'pending').length || 0,
            confirmed_orders: orders?.filter(o => o.sleeves_status === 'confirmed').length || 0,
            rejected_orders: orders?.filter(o => o.sleeves_status === 'rejected').length || 0,
            shipped_orders: orders?.filter(o => o.sleeves_status === 'shipped').length || 0,
            delivered_orders: orders?.filter(o => o.sleeves_status === 'delivered').length || 0,
            total_revenue: orders?.reduce((sum, o) => sum + (parseFloat(o.total_price) || 0), 0) || 0,
            average_order_value: orders?.length ?
                orders.reduce((sum, o) => sum + (parseFloat(o.total_price) || 0), 0) / orders.length : 0
        };

        // Get all customers for this store
        const { data: customers, error: customersError } = await supabaseAdmin
            .from('customers')
            .select('total_orders')
            .eq('store_id', id);

        if (customersError) {
            throw customersError;
        }

        // Calculate customer stats
        const customerStats = {
            total_customers: customers?.length || 0,
            repeat_customers: customers?.filter(c => (c.total_orders || 0) > 1).length || 0
        };

        // Get all products for this store
        const { data: products, error: productsError } = await supabaseAdmin
            .from('products')
            .select('is_active, stock_quantity')
            .eq('store_id', id);

        if (productsError) {
            throw productsError;
        }

        // Calculate product stats
        const productStats = {
            total_products: products?.length || 0,
            active_products: products?.filter(p => p.is_active === true).length || 0,
            out_of_stock_products: products?.filter(p => (p.stock_quantity || 0) === 0).length || 0
        };

        res.json({
            data: {
                orders: orderStats,
                customers: customerStats,
                products: productStats
            }
        });
    } catch (error: any) {
        console.error(`[GET /api/stores/${req.params.id}/stats] Error:`, error);
        res.status(500).json({
            error: 'Failed to fetch store statistics',
            message: error.message
        });
    }
});

// ================================================================
// DELETE /api/stores/:id - Deactivate store (soft delete)
// ================================================================
storesRouter.delete('/:id', async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;

        // Soft delete: set is_active to false
        const { data, error } = await supabaseAdmin
            .from('stores')
            .update({
                is_active: false,
                updated_at: new Date().toISOString()
            })
            .eq('id', id)
            .select('id')
            .single();

        if (error || !data) {
            return res.status(404).json({
                error: 'Store not found'
            });
        }

        res.json({
            message: 'Store deactivated successfully',
            id: data.id
        });
    } catch (error: any) {
        console.error(`[DELETE /api/stores/${req.params.id}] Error:`, error);
        res.status(500).json({
            error: 'Failed to deactivate store',
            message: error.message
        });
    }
});

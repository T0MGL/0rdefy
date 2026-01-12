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
import { extractUserRole, requireModule, requirePermission, PermissionRequest } from '../middleware/permissions';
import { Module, Permission } from '../permissions';

export const storesRouter = Router();

// Apply verifyToken to all routes
// Note: extractUserRole and requireModule are applied per-route since POST /api/stores
// doesn't require a Store ID (user is creating a new store)


// ================================================================
// GET /api/stores - List stores the user has access to (for multi-store dashboard)
// ================================================================
storesRouter.get('/', verifyToken, async (req: AuthRequest, res: Response) => {
    try {
        if (!req.userId) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'User ID not found in token'
            });
        }

        // Get stores the user has access to via user_stores
        const { data: userStores, error: userStoresError } = await supabaseAdmin
            .from('user_stores')
            .select(`
                store_id,
                role,
                stores!inner(
                    id,
                    name,
                    country,
                    timezone,
                    currency,
                    tax_rate,
                    admin_fee,
                    is_active,
                    created_at,
                    updated_at
                )
            `)
            .eq('user_id', req.userId)
            .eq('is_active', true);

        if (userStoresError) {
            throw userStoresError;
        }

        // For each store, get the owner's subscription plan
        const storesWithPlan = await Promise.all(
            (userStores || []).map(async (us: any) => {
                // Get the owner of this store
                const { data: ownerData } = await supabaseAdmin
                    .from('user_stores')
                    .select('user_id')
                    .eq('store_id', us.store_id)
                    .eq('role', 'owner')
                    .eq('is_active', true)
                    .single();

                let subscription_plan = 'free'; // Default

                if (ownerData) {
                    // Get the owner's primary subscription
                    const { data: subscription } = await supabaseAdmin
                        .from('subscriptions')
                        .select('plan')
                        .eq('user_id', ownerData.user_id)
                        .eq('is_primary', true)
                        .single();

                    if (subscription) {
                        subscription_plan = subscription.plan;
                    }
                }

                return {
                    ...us.stores,
                    user_role: us.role,
                    subscription_plan
                };
            })
        );

        // Sort by created_at descending
        storesWithPlan.sort((a: any, b: any) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );

        res.json({
            data: storesWithPlan
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
storesRouter.get('/current', verifyToken, extractStoreId, extractUserRole, requireModule(Module.SETTINGS), async (req: AuthRequest, res: Response) => {
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
storesRouter.get('/:id', verifyToken, async (req: AuthRequest, res: Response) => {
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
// Note: Only requires verifyToken - no Store ID needed (user is creating a new store)
// ================================================================
storesRouter.post('/', verifyToken, async (req: AuthRequest, res: Response) => {
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

        // Check if user can create more stores (user-level subscription)
        const { data: canCreateResult, error: canCreateError } = await supabaseAdmin
            .rpc('can_create_store', {
                p_user_id: req.userId
            });

        if (canCreateError) {
            console.error('[POST /api/stores] Error checking store limit:', canCreateError);
            throw canCreateError;
        }

        const canCreate = canCreateResult && canCreateResult.length > 0 ? canCreateResult[0] : null;

        if (!canCreate || !canCreate.can_create) {
            const planNames: Record<number, string> = {
                1: 'Free, Starter o Growth',
                3: 'Professional'
            };
            const planName = planNames[canCreate?.max_stores || 1] || canCreate?.plan || 'tu plan actual';

            return res.status(403).json({
                error: 'Store limit reached',
                message: canCreate?.reason || `Has alcanzado el límite de tiendas para ${planName}. Actualiza tu plan para crear más tiendas.`,
                current_stores: canCreate?.current_stores || 0,
                max_stores: canCreate?.max_stores || 1,
                plan: canCreate?.plan || 'free'
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
storesRouter.put('/:id', verifyToken, extractStoreId, extractUserRole, requireModule(Module.SETTINGS), async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const {
            name,
            country,
            timezone,
            currency,
            tax_rate,
            admin_fee,
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
        if (tax_rate !== undefined) updateData.tax_rate = tax_rate;
        if (admin_fee !== undefined) updateData.admin_fee = admin_fee;
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
storesRouter.get('/:id/config', verifyToken, extractStoreId, extractUserRole, requireModule(Module.SETTINGS), async (req: AuthRequest, res: Response) => {
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
storesRouter.put('/:id/config', verifyToken, extractStoreId, extractUserRole, requireModule(Module.SETTINGS), async (req: AuthRequest, res: Response) => {
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
storesRouter.get('/:id/stats', verifyToken, extractStoreId, extractUserRole, requireModule(Module.SETTINGS), async (req: AuthRequest, res: Response) => {
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
// DELETE /api/stores/:id - Delete store (with validations)
// ================================================================
storesRouter.delete('/:id', verifyToken, extractStoreId, extractUserRole, requireModule(Module.SETTINGS), async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;

        if (!req.userId) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'User ID not found in token'
            });
        }

        // 1. Check if the user owns this store
        const { data: userStore, error: userStoreError } = await supabaseAdmin
            .from('user_stores')
            .select('*')
            .eq('user_id', req.userId)
            .eq('store_id', id)
            .single();

        if (userStoreError || !userStore) {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'No tienes permiso para eliminar esta tienda'
            });
        }

        // 2. Check if this is the user's last store
        const { data: userStores, error: userStoresError } = await supabaseAdmin
            .from('user_stores')
            .select('store_id')
            .eq('user_id', req.userId);

        if (userStoresError) {
            throw userStoresError;
        }

        if (!userStores || userStores.length <= 1) {
            return res.status(400).json({
                error: 'Cannot delete last store',
                message: 'No puedes eliminar tu última tienda. Debes tener al menos una tienda activa.'
            });
        }

        // 3. Delete the store association first
        const { error: deleteAssociationError } = await supabaseAdmin
            .from('user_stores')
            .delete()
            .eq('user_id', req.userId)
            .eq('store_id', id);

        if (deleteAssociationError) {
            throw deleteAssociationError;
        }

        // 4. Check if there are other users associated with this store
        const { data: otherUsers, error: otherUsersError } = await supabaseAdmin
            .from('user_stores')
            .select('user_id')
            .eq('store_id', id);

        if (otherUsersError) {
            throw otherUsersError;
        }

        // 5. If no other users, delete the store and all related data
        if (!otherUsers || otherUsers.length === 0) {
            // Delete related data in the correct order (respecting foreign keys)

            // Delete store config
            await supabaseAdmin
                .from('store_config')
                .delete()
                .eq('store_id', id);

            // Delete orders
            await supabaseAdmin
                .from('orders')
                .delete()
                .eq('store_id', id);

            // Delete products
            await supabaseAdmin
                .from('products')
                .delete()
                .eq('store_id', id);

            // Delete customers
            await supabaseAdmin
                .from('customers')
                .delete()
                .eq('store_id', id);

            // Delete campaigns
            await supabaseAdmin
                .from('campaigns')
                .delete()
                .eq('store_id', id);

            // Finally, delete the store itself
            const { error: deleteStoreError } = await supabaseAdmin
                .from('stores')
                .delete()
                .eq('id', id);

            if (deleteStoreError) {
                throw deleteStoreError;
            }

            console.log(`✅ [DELETE /api/stores/${id}] Store and all related data deleted`);
        } else {
            console.log(`✅ [DELETE /api/stores/${id}] User disassociated from store (other users still exist)`);
        }

        res.json({
            message: 'Tienda eliminada exitosamente',
            id
        });
    } catch (error: any) {
        console.error(`[DELETE /api/stores/${req.params.id}] Error:`, error);
        res.status(500).json({
            error: 'Failed to delete store',
            message: error.message
        });
    }
});

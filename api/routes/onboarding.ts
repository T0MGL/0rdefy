/**
 * Onboarding Routes
 * Handles onboarding progress tracking and checklist management
 */

import { Router, Response } from 'express';
import { supabaseAdmin } from '../db/connection';
import { verifyToken, extractStoreId, AuthRequest } from '../middleware/auth';

export const onboardingRouter = Router();

/**
 * GET /api/onboarding/progress
 * Get the current onboarding progress for the user's store
 */
onboardingRouter.get('/progress', verifyToken, extractStoreId, async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.userId;
        const storeId = req.storeId;

        if (!userId || !storeId) {
            return res.status(400).json({
                success: false,
                error: 'User ID and Store ID are required'
            });
        }

        // Get user's role in this store
        const { data: userStore } = await supabaseAdmin
            .from('user_stores')
            .select('role')
            .eq('user_id', userId)
            .eq('store_id', storeId)
            .single();

        const userRole = userStore?.role || 'owner';

        // Use the database function to compute progress
        const { data, error } = await supabaseAdmin.rpc('get_onboarding_progress', {
            p_store_id: storeId,
            p_user_id: userId
        });

        if (error) {
            console.error('Error fetching onboarding progress:', error);

            // Fallback: compute progress manually if function doesn't exist
            return await computeProgressManually(storeId, userId, userRole, res);
        }

        // Add user role to response for frontend decision making
        return res.json({
            ...data,
            userRole
        });
    } catch (error) {
        console.error('Error in onboarding progress endpoint:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to fetch onboarding progress'
        });
    }
});

/**
 * POST /api/onboarding/dismiss
 * Dismiss the onboarding checklist for the user
 */
onboardingRouter.post('/dismiss', verifyToken, extractStoreId, async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.userId;
        const storeId = req.storeId;

        if (!userId || !storeId) {
            return res.status(400).json({
                success: false,
                error: 'User ID and Store ID are required'
            });
        }

        // Use the database function to dismiss
        const { error } = await supabaseAdmin.rpc('dismiss_onboarding_checklist', {
            p_store_id: storeId,
            p_user_id: userId
        });

        if (error) {
            console.error('Error dismissing onboarding:', error);

            // Fallback: insert/update directly
            await supabaseAdmin
                .from('onboarding_progress')
                .upsert({
                    store_id: storeId,
                    user_id: userId,
                    checklist_dismissed: true,
                    dismissed_at: new Date().toISOString()
                }, {
                    onConflict: 'store_id,user_id'
                });
        }

        return res.json({
            success: true,
            message: 'Onboarding checklist dismissed'
        });
    } catch (error) {
        console.error('Error dismissing onboarding:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to dismiss onboarding checklist'
        });
    }
});

/**
 * POST /api/onboarding/visit-module
 * Mark a module as visited (for first-time tooltips)
 */
onboardingRouter.post('/visit-module', verifyToken, extractStoreId, async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.userId;
        const storeId = req.storeId;
        const { moduleId } = req.body;

        if (!userId || !storeId) {
            return res.status(400).json({
                success: false,
                error: 'User ID and Store ID are required'
            });
        }

        if (!moduleId || typeof moduleId !== 'string') {
            return res.status(400).json({
                success: false,
                error: 'Module ID is required'
            });
        }

        // Use the database function to mark as visited
        const { error } = await supabaseAdmin.rpc('mark_module_visited', {
            p_store_id: storeId,
            p_user_id: userId,
            p_module_id: moduleId
        });

        if (error) {
            console.error('Error marking module visited:', error);
            // Non-critical, return success anyway
        }

        return res.json({
            success: true,
            message: 'Module marked as visited'
        });
    } catch (error) {
        console.error('Error marking module visited:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to mark module as visited'
        });
    }
});

/**
 * GET /api/onboarding/is-first-visit/:moduleId
 * Check if this is the first visit to a module
 */
onboardingRouter.get('/is-first-visit/:moduleId', verifyToken, extractStoreId, async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.userId;
        const storeId = req.storeId;
        const { moduleId } = req.params;

        if (!userId || !storeId) {
            return res.status(400).json({
                success: false,
                error: 'User ID and Store ID are required'
            });
        }

        // Use the database function to check
        const { data, error } = await supabaseAdmin.rpc('is_first_module_visit', {
            p_store_id: storeId,
            p_user_id: userId,
            p_module_id: moduleId
        });

        if (error) {
            console.error('Error checking first visit:', error);
            // Assume it's a first visit if we can't check
            return res.json({ isFirstVisit: true });
        }

        return res.json({ isFirstVisit: data });
    } catch (error) {
        console.error('Error checking first visit:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to check first visit status'
        });
    }
});

/**
 * POST /api/onboarding/increment-visit
 * Increment visit count for a module (DB-backed)
 */
onboardingRouter.post('/increment-visit', verifyToken, extractStoreId, async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.userId;
        const storeId = req.storeId;
        const { moduleId } = req.body;

        if (!userId || !storeId) {
            return res.status(400).json({
                success: false,
                error: 'User ID and Store ID are required'
            });
        }

        if (!moduleId || typeof moduleId !== 'string') {
            return res.status(400).json({
                success: false,
                error: 'Module ID is required'
            });
        }

        // Use the database function to increment visit count
        const { data, error } = await supabaseAdmin.rpc('increment_module_visit_count', {
            p_store_id: storeId,
            p_user_id: userId,
            p_module_id: moduleId
        });

        if (error) {
            console.error('Error incrementing visit count:', error);
            // Non-critical, return success anyway
            return res.json({ success: true, count: 1 });
        }

        return res.json({
            success: true,
            count: data
        });
    } catch (error) {
        console.error('Error incrementing visit count:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to increment visit count'
        });
    }
});

/**
 * POST /api/onboarding/first-action
 * Mark first action completed for a module (hides future tips)
 */
onboardingRouter.post('/first-action', verifyToken, extractStoreId, async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.userId;
        const storeId = req.storeId;
        const { moduleId } = req.body;

        if (!userId || !storeId) {
            return res.status(400).json({
                success: false,
                error: 'User ID and Store ID are required'
            });
        }

        if (!moduleId || typeof moduleId !== 'string') {
            return res.status(400).json({
                success: false,
                error: 'Module ID is required'
            });
        }

        // Use the database function to mark first action
        const { error } = await supabaseAdmin.rpc('mark_first_action_completed', {
            p_store_id: storeId,
            p_user_id: userId,
            p_module_id: moduleId
        });

        if (error) {
            console.error('Error marking first action:', error);
            // Non-critical, return success anyway
        }

        return res.json({
            success: true,
            message: 'First action marked as completed'
        });
    } catch (error) {
        console.error('Error marking first action:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to mark first action'
        });
    }
});

/**
 * GET /api/onboarding/should-show-tip/:moduleId
 * Check if tip should be shown for a module (combines all conditions)
 */
onboardingRouter.get('/should-show-tip/:moduleId', verifyToken, extractStoreId, async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.userId;
        const storeId = req.storeId;
        const { moduleId } = req.params;

        if (!userId || !storeId) {
            return res.status(400).json({
                success: false,
                error: 'User ID and Store ID are required'
            });
        }

        // Use the database function to check
        const { data, error } = await supabaseAdmin.rpc('should_show_module_tip', {
            p_store_id: storeId,
            p_user_id: userId,
            p_module_id: moduleId,
            p_max_visits: 3
        });

        if (error) {
            console.error('Error checking should show tip:', error);
            // Default to showing tip if we can't check
            return res.json({ shouldShow: true });
        }

        return res.json({ shouldShow: data });
    } catch (error) {
        console.error('Error checking should show tip:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to check if tip should show'
        });
    }
});

/**
 * POST /api/onboarding/reset
 * Reset onboarding progress (for testing/dev)
 */
onboardingRouter.post('/reset', verifyToken, extractStoreId, async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.userId;
        const storeId = req.storeId;

        if (!userId || !storeId) {
            return res.status(400).json({
                success: false,
                error: 'User ID and Store ID are required'
            });
        }

        // Delete the onboarding progress record
        const { error } = await supabaseAdmin
            .from('onboarding_progress')
            .delete()
            .eq('store_id', storeId)
            .eq('user_id', userId);

        if (error) {
            console.error('Error resetting onboarding:', error);
        }

        return res.json({
            success: true,
            message: 'Onboarding progress reset'
        });
    } catch (error) {
        console.error('Error resetting onboarding:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to reset onboarding progress'
        });
    }
});

/**
 * Fallback function to compute progress when database function is not available
 */
async function computeProgressManually(storeId: string, userId: string, userRole: string, res: Response) {
    try {
        // Check carriers
        const { data: carriers } = await supabaseAdmin
            .from('carriers')
            .select('id')
            .eq('store_id', storeId)
            .eq('is_active', true)
            .limit(1);

        // Check products
        const { data: products } = await supabaseAdmin
            .from('products')
            .select('id')
            .eq('store_id', storeId)
            .eq('is_active', true)
            .limit(1);

        // Check customers
        const { data: customers } = await supabaseAdmin
            .from('customers')
            .select('id')
            .eq('store_id', storeId)
            .limit(1);

        // Check orders (just check if any order exists for onboarding purposes)
        const { data: orders } = await supabaseAdmin
            .from('orders')
            .select('id')
            .eq('store_id', storeId)
            .limit(1);

        // Check Shopify integration (uses 'status' column, not 'is_active')
        const { data: shopify } = await supabaseAdmin
            .from('shopify_integrations')
            .select('id')
            .eq('store_id', storeId)
            .eq('status', 'active')
            .limit(1);

        // Check if dismissed
        const { data: progress } = await supabaseAdmin
            .from('onboarding_progress')
            .select('checklist_dismissed')
            .eq('store_id', storeId)
            .eq('user_id', userId)
            .single();

        const hasCarrier = carriers && carriers.length > 0;
        const hasProduct = products && products.length > 0;
        const hasCustomer = customers && customers.length > 0;
        const hasOrder = orders && orders.length > 0;
        const hasShopify = shopify && shopify.length > 0;
        const hasDismissed = progress?.checklist_dismissed || false;

        // Customer step is complete if has customer OR has Shopify (auto-creates customers)
        const customerStepComplete = hasCustomer || hasShopify;

        let completedCount = 0;
        if (hasCarrier) completedCount++;
        if (hasProduct) completedCount++;
        if (customerStepComplete) completedCount++;
        if (hasOrder) completedCount++;

        const totalCount = 4;
        const percentage = Math.round((completedCount / totalCount) * 100);

        // Dynamic customer step title/description based on Shopify status
        const customerStepTitle = hasShopify ? 'Clientes de Shopify' : 'Agregar cliente';
        const customerStepDescription = hasShopify && hasCustomer
            ? 'Clientes importados automáticamente desde Shopify'
            : hasShopify
            ? 'Los clientes se crearán al recibir pedidos de Shopify'
            : 'Registra tu primer cliente para crear pedidos';

        const steps = [
            {
                id: 'create-carrier',
                title: 'Agregar transportadora',
                description: 'Configura al menos una transportadora para enviar pedidos',
                completed: hasCarrier,
                route: '/carriers',
                priority: 1,
                category: 'setup'
            },
            {
                id: 'add-product',
                title: 'Agregar primer producto',
                description: 'Crea un producto o importa desde Shopify',
                completed: hasProduct,
                route: '/products',
                priority: 2,
                category: 'setup'
            },
            {
                id: 'add-customer',
                title: customerStepTitle,
                description: customerStepDescription,
                completed: customerStepComplete,
                route: '/customers',
                priority: 3,
                category: 'setup'
            },
            {
                id: 'first-order',
                title: 'Crear primer pedido',
                description: 'Crea tu primer pedido para ver el flujo completo',
                completed: hasOrder,
                route: '/orders',
                priority: 4,
                category: 'operation'
            }
        ];

        return res.json({
            steps,
            completedCount,
            totalCount,
            percentage,
            isComplete: completedCount === totalCount,
            hasShopify,
            hasDismissed,
            userRole
        });
    } catch (error) {
        console.error('Error computing progress manually:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to compute onboarding progress'
        });
    }
}

export default onboardingRouter;

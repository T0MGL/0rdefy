// ================================================================
// ORDEFY API - INVENTORY MOVEMENTS ROUTES
// ================================================================
// Provides read-only access to inventory movement history
// Includes filtering by product, date range, and movement type
//
// Security: Requires PRODUCTS module access (inventory is part of products)
// Roles with access: owner, admin, inventario, confirmador (view), contador (view)
// ================================================================

import { logger } from '../utils/logger';
import { Router, Response } from 'express';
import { supabaseAdmin } from '../db/connection';
import { verifyToken, extractStoreId, AuthRequest } from '../middleware/auth';
import { extractUserRole, requireModule, requirePermission, PermissionRequest } from '../middleware/permissions';
import { Module, Permission } from '../permissions';
import { productNotFound, databaseError, serverError } from '../utils/errorResponses';

export const inventoryRouter = Router();

// Apply authentication middleware to all routes
inventoryRouter.use(verifyToken);
inventoryRouter.use(extractStoreId);
inventoryRouter.use(extractUserRole);

// Inventory is part of PRODUCTS module
inventoryRouter.use(requireModule(Module.PRODUCTS));

// ================================================================
// GET /api/inventory/movements - Get all inventory movements
// ================================================================
// Query params:
//   - product_id: Filter by specific product
//   - date_from: Start date (ISO format)
//   - date_to: End date (ISO format)
//   - movement_type: Filter by type (order_ready, order_cancelled, order_reverted, manual_adjustment)
//   - search: Search by product name or SKU
//   - limit: Number of records (default 100, max 500)
//   - offset: Pagination offset
// ================================================================

inventoryRouter.get('/movements', async (req: AuthRequest, res: Response) => {
    try {
        const {
            product_id,
            date_from,
            date_to,
            movement_type,
            search,
            limit = '100',
            offset = '0'
        } = req.query;

        const limitNum = Math.min(parseInt(limit as string, 10) || 100, 500);
        const offsetNum = parseInt(offset as string, 10) || 0;

        logger.info('API', `📊 [INVENTORY] Fetching movements for store ${req.storeId}`);
        logger.info('API', `   Filters:`, { product_id, date_from, date_to, movement_type, search });

        // Build the query
        let query = supabaseAdmin
            .from('inventory_movements')
            .select(`
                *,
                products!inventory_movements_product_id_fkey (
                    id,
                    name,
                    sku,
                    image_url
                ),
                orders!inventory_movements_order_id_fkey (
                    id,
                    customer_first_name,
                    customer_last_name,
                    customer_phone
                )
            `)
            .eq('store_id', req.storeId)
            .order('created_at', { ascending: false });

        // Apply filters
        if (product_id) {
            query = query.eq('product_id', product_id);
        }

        if (date_from) {
            query = query.gte('created_at', date_from);
        }

        if (date_to) {
            // Add one day to include the full end date
            const endDate = new Date(date_to as string);
            endDate.setDate(endDate.getDate() + 1);
            query = query.lt('created_at', endDate.toISOString());
        }

        if (movement_type) {
            query = query.eq('movement_type', movement_type);
        }

        // If there's a search term, we need to fetch products first and filter
        if (search) {
            const { sanitizeSearchInput } = require('../utils/sanitize');
            const searchTerm = sanitizeSearchInput((search as string).toLowerCase());

            if (!searchTerm) {
                return res.json({ data: [], count: 0, limit: limitNum, offset: offsetNum });
            }

            // Get products matching the search
            const { data: matchingProducts } = await supabaseAdmin
                .from('products')
                .select('id')
                .eq('store_id', req.storeId)
                .or(`name.ilike.%${searchTerm}%,sku.ilike.%${searchTerm}%`);

            if (matchingProducts && matchingProducts.length > 0) {
                const productIds = matchingProducts.map(p => p.id);
                query = query.in('product_id', productIds);
            } else {
                // No matching products, return empty result
                return res.json({
                    data: [],
                    count: 0,
                    limit: limitNum,
                    offset: offsetNum
                });
            }
        }

        // Get total count for pagination
        const { count } = await query;

        // Apply pagination
        query = query.range(offsetNum, offsetNum + limitNum - 1);

        const { data, error } = await query;

        if (error) {
            logger.error('API', '❌ [INVENTORY] Error fetching movements:', error);
            return res.status(500).json({ error: error.message });
        }

        logger.info('API', `✓ [INVENTORY] Retrieved ${data?.length || 0} movements`);

        return res.json({
            data: data || [],
            count: count || 0,
            limit: limitNum,
            offset: offsetNum
        });
    } catch (error) {
        logger.error('API', '❌ [INVENTORY] Unexpected error:', error);
        return res.status(500).json({
            error: 'Error al obtener movimientos de inventario',
            details: error instanceof Error ? error.message : 'Error desconocido'
        });
    }
});

// ================================================================
// GET /api/inventory/movements/summary - Get summary statistics
// ================================================================
// Returns aggregated stats about inventory movements
// ================================================================

inventoryRouter.get('/movements/summary', async (req: AuthRequest, res: Response) => {
    try {
        const { date_from, date_to } = req.query;

        logger.info('API', `📊 [INVENTORY] Fetching summary for store ${req.storeId}`);

        // Build base query
        let query = supabaseAdmin
            .from('inventory_movements')
            .select('movement_type, quantity_change')
            .eq('store_id', req.storeId);

        // Apply date filters
        if (date_from) {
            query = query.gte('created_at', date_from);
        }

        if (date_to) {
            const endDate = new Date(date_to as string);
            endDate.setDate(endDate.getDate() + 1);
            query = query.lt('created_at', endDate.toISOString());
        }

        const { data, error } = await query;

        if (error) {
            logger.error('API', '❌ [INVENTORY] Error fetching summary:', error);
            return res.status(500).json({ error: error.message });
        }

        // Calculate summary stats
        const summary = {
            total_movements: data?.length || 0,
            by_type: {
                order_ready: 0,
                order_cancelled: 0,
                order_reverted: 0,
                manual_adjustment: 0,
                return_accepted: 0,
                return_rejected: 0,
                inbound_received: 0
            },
            total_decrements: 0,
            total_increments: 0,
            net_change: 0
        };

        data?.forEach((movement: any) => {
            const type = movement.movement_type;
            const change = movement.quantity_change;

            if (summary.by_type[type as keyof typeof summary.by_type] !== undefined) {
                summary.by_type[type as keyof typeof summary.by_type]++;
            }

            if (change < 0) {
                summary.total_decrements += Math.abs(change);
            } else {
                summary.total_increments += change;
            }

            summary.net_change += change;
        });

        logger.info('API', `✓ [INVENTORY] Summary calculated:`, summary);

        return res.json(summary);
    } catch (error) {
        logger.error('API', '❌ [INVENTORY] Unexpected error:', error);
        return res.status(500).json({
            error: 'Error al obtener resumen de inventario',
            details: error instanceof Error ? error.message : 'Error desconocido'
        });
    }
});

// ================================================================
// GET /api/inventory/movements/product/:id - Get movements for specific product
// ================================================================
// Returns all movements for a single product
// ================================================================

inventoryRouter.get('/movements/product/:id', async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { limit = '50', offset = '0' } = req.query;

        const limitNum = Math.min(parseInt(limit as string, 10) || 50, 200);
        const offsetNum = parseInt(offset as string, 10) || 0;

        logger.info('API', `📊 [INVENTORY] Fetching movements for product ${id}`);

        const { data, error, count } = await supabaseAdmin
            .from('inventory_movements')
            .select(`
                *,
                products!inventory_movements_product_id_fkey (
                    id,
                    name,
                    sku,
                    image_url
                ),
                orders!inventory_movements_order_id_fkey (
                    id,
                    customer_first_name,
                    customer_last_name
                )
            `, { count: 'exact' })
            .eq('store_id', req.storeId)
            .eq('product_id', id)
            .order('created_at', { ascending: false })
            .range(offsetNum, offsetNum + limitNum - 1);

        if (error) {
            logger.error('API', '❌ [INVENTORY] Error fetching product movements:', error);
            return res.status(500).json({ error: error.message });
        }

        logger.info('API', `✓ [INVENTORY] Retrieved ${data?.length || 0} movements for product`);

        return res.json({
            data: data || [],
            count: count || 0,
            limit: limitNum,
            offset: offsetNum
        });
    } catch (error) {
        logger.error('API', '❌ [INVENTORY] Unexpected error:', error);
        return res.status(500).json({
            error: 'Error al obtener movimientos del producto',
            details: error instanceof Error ? error.message : 'Error desconocido'
        });
    }
});

// ================================================================
// POST /api/inventory/adjust - Manual inventory adjustment
// ================================================================
// Allows manual adjustments to stock with audit trail
// Body: { product_id, quantity_change, notes }
// ================================================================

inventoryRouter.post('/adjust', async (req: AuthRequest, res: Response) => {
    try {
        const { product_id, quantity_change, notes } = req.body;

        if (!product_id || quantity_change === undefined || quantity_change === 0) {
            return res.status(400).json({
                error: 'Faltan campos requeridos',
                message: 'Se requiere product_id y quantity_change (debe ser diferente de cero)'
            });
        }

        logger.info('API', `📝 [INVENTORY] Manual adjustment for product ${product_id}: ${quantity_change}`);

        // Use atomic RPC function with row-level locking to prevent race conditions
        const { data: rpcResult, error: rpcError } = await supabaseAdmin
            .rpc('adjust_inventory_atomic', {
                p_store_id: req.storeId,
                p_product_id: product_id,
                p_quantity_change: quantity_change,
                p_notes: notes || 'Ajuste manual de inventario'
            });

        if (rpcError) {
            logger.error('API', '❌ [INVENTORY] RPC error:', rpcError);

            // Fallback to non-atomic approach if RPC not available (migration not run yet)
            if (rpcError.message?.includes('function') || rpcError.code === '42883') {
                logger.warn('API', '⚠️ [INVENTORY] RPC not available, using fallback (run migration 049)');

                // Get current product stock
                const { data: product, error: productError } = await supabaseAdmin
                    .from('products')
                    .select('id, name, stock')
                    .eq('id', product_id)
                    .eq('store_id', req.storeId)
                    .single();

                if (productError || !product) {
                    logger.error('API', '❌ [INVENTORY] Product not found:', productError);
                    return productNotFound(res, undefined, product_id);
                }

                const stock_before = product.stock;
                const stock_after = Math.max(0, stock_before + quantity_change);

                // Update stock
                const { error: updateError } = await supabaseAdmin
                    .from('products')
                    .update({
                        stock: stock_after,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', product_id)
                    .eq('store_id', req.storeId);

                if (updateError) {
                    logger.error('API', '❌ [INVENTORY] Error updating stock:', updateError);
                    return databaseError(res, updateError);
                }

                // Log the movement
                const { data: movement, error: movementError } = await supabaseAdmin
                    .from('inventory_movements')
                    .insert({
                        store_id: req.storeId,
                        product_id,
                        quantity_change,
                        stock_before,
                        stock_after,
                        movement_type: 'manual_adjustment',
                        notes: notes || 'Ajuste manual de inventario'
                    })
                    .select()
                    .single();

                if (movementError) {
                    logger.error('API', '❌ [INVENTORY] Error logging movement:', movementError);
                }

                logger.info('API', `✓ [INVENTORY] Stock adjusted (fallback): ${stock_before} → ${stock_after}`);

                return res.json({
                    success: true,
                    product_id,
                    product_name: product.name,
                    stock_before,
                    stock_after,
                    quantity_change,
                    movement,
                    warning: 'Used non-atomic fallback. Run migration 049 for race-condition safety.'
                });
            }

            // Check if it's a product not found error
            if (rpcError.message?.includes('Product not found')) {
                return productNotFound(res, undefined, product_id);
            }

            return databaseError(res, rpcError);
        }

        logger.info('API', `✓ [INVENTORY] Stock adjusted atomically:`, rpcResult);

        return res.json(rpcResult);
    } catch (error) {
        logger.error('API', '❌ [INVENTORY] Unexpected error:', error);
        return serverError(res, error);
    }
});

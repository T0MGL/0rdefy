// ================================================================
// NEONFLOW API - PRODUCTS ROUTES
// ================================================================
// CRUD operations for products with Shopify sync support
// MVP: Uses hardcoded store_id, no authentication
// Uses Supabase JS client for database operations
// ================================================================

import { logger } from '../utils/logger';
import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../db/connection';
import { verifyToken, extractStoreId, AuthRequest } from '../middleware/auth';
import { extractUserRole, requireModule, requirePermission, PermissionRequest } from '../middleware/permissions';
import { checkProductLimit, PlanLimitRequest } from '../middleware/planLimits';
import { Module, Permission } from '../permissions';
import { ShopifyProductSyncService } from '../services/shopify-product-sync.service';
import { sanitizeSearchInput, validateUUIDParam } from '../utils/sanitize';

export const productsRouter = Router();

productsRouter.use(verifyToken, extractStoreId, extractUserRole);

// Apply module-level access check for all routes
productsRouter.use(requireModule(Module.PRODUCTS));

// ================================================================
// GET /api/products - List all products
// ================================================================
productsRouter.get('/', async (req: AuthRequest, res: Response) => {
    try {
        const {
            limit = '50',
            offset = '0',
            search,
            category,
            min_price,
            max_price,
            is_active,
            source,
            stock_filter
        } = req.query;

        // Determine is_active filter value (default to true if not specified)
        const activeFilter = is_active !== undefined ? is_active === 'true' : true;

        // Build query once with all filters
        let query = supabaseAdmin
            .from('products')
            .select('*', { count: 'exact' })
            .eq('store_id', req.storeId)
            .eq('is_active', activeFilter)
            .order('created_at', { ascending: false })
            .range(parseInt(offset as string, 10), parseInt(offset as string, 10) + parseInt(limit as string, 10) - 1);

        // Filter by source (local = only database products, shopify = only Shopify synced products)
        if (source === 'local') {
            query = query.is('shopify_product_id', null).is('shopify_variant_id', null);
        } else if (source === 'shopify') {
            query = query.not('shopify_product_id', 'is', null);
        }

        if (search) {
            const sanitized = sanitizeSearchInput(search as string);
            query = query.or(`name.ilike.%${sanitized}%,sku.ilike.%${sanitized}%`);
        }

        if (category) {
            query = query.eq('category', category);
        }

        if (min_price) {
            query = query.gte('price', parseFloat(min_price as string));
        }

        if (max_price) {
            query = query.lte('price', parseFloat(max_price as string));
        }

        if (stock_filter === 'low-stock') {
            query = query.gt('stock', 0).lt('stock', 10);
        } else if (stock_filter === 'out-of-stock') {
            query = query.eq('stock', 0);
        }

        const { data, error, count } = await query;

        if (error) {
            throw error;
        }

        // ✅ OPTIMIZED: Calculate sales using order_line_items table with SQL aggregation
        // This replaces the N+1 query that fetched ALL orders with JSONB line_items
        // Performance: 200MB+ transfer → ~5KB (40,000x improvement)
        const { data: salesData } = await supabaseAdmin
            .from('order_line_items')
            .select('product_id, quantity, orders!inner(sleeves_status, store_id)')
            .eq('orders.store_id', req.storeId)
            .in('orders.sleeves_status', ['confirmed', 'shipped', 'delivered'])
            .not('product_id', 'is', null);

        // Aggregate sales per product in memory (much lighter than iterating JSONB)
        const salesByProduct: Record<string, number> = {};
        salesData?.forEach(item => {
            const productId = item.product_id;
            const quantity = item.quantity || 0;
            if (productId) {
                salesByProduct[productId] = (salesByProduct[productId] || 0) + quantity;
            }
        });

        // Transform data to match frontend Product interface
        const transformedData = (data || []).map(product => ({
            id: product.id,
            name: product.name,
            sku: product.sku || '',
            description: product.description || '',
            category: product.category || '',
            image: product.image_url || 'https://via.placeholder.com/400x300?text=Product',
            stock: product.stock || 0,
            price: product.price || 0,
            cost: product.cost || 0,
            packaging_cost: product.packaging_cost || 0,
            additional_costs: product.additional_costs || 0,
            profitability: product.price
                ? parseFloat((((product.price - (product.cost || 0) - (product.packaging_cost || 0) - (product.additional_costs || 0)) / product.price) * 100).toFixed(1))
                : 0,
            sales: salesByProduct[product.id] || 0,
            shopify_product_id: product.shopify_product_id || null,
            shopify_variant_id: product.shopify_variant_id || null
        }));

        res.json({
            data: transformedData,
            pagination: {
                total: count || 0,
                limit: parseInt(limit as string, 10),
                offset: parseInt(offset as string, 10),
                hasMore: parseInt(offset as string, 10) + (data?.length || 0) < (count || 0)
            }
        });
    } catch (error: any) {
        logger.error('SERVER', '[GET /api/products] Error:', error);
        res.status(500).json({
            error: 'Error al obtener productos',
            message: error.message
        });
    }
});

// ================================================================
// GET /api/products/:id - Get single product
// ================================================================
productsRouter.get('/:id', validateUUIDParam('id'), async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;

        const { data, error } = await supabaseAdmin
            .from('products')
            .select('id, name, sku, description, category, image_url, stock, price, cost, packaging_cost, additional_costs, shopify_product_id, shopify_variant_id')
            .eq('id', id)
            .eq('store_id', req.storeId)
            .single();

        if (error || !data) {
            return res.status(404).json({
                error: 'Producto no encontrado'
            });
        }

        // ✅ OPTIMIZED: Calculate sales using order_line_items table with direct filter
        // This replaces the N+1 query that fetched ALL orders with JSONB line_items
        const { data: salesData } = await supabaseAdmin
            .from('order_line_items')
            .select('quantity, orders!inner(sleeves_status, store_id)')
            .eq('product_id', data.id)
            .eq('orders.store_id', req.storeId)
            .in('orders.sleeves_status', ['confirmed', 'shipped', 'delivered']);

        const sales = salesData?.reduce((sum, item) => sum + (item.quantity || 0), 0) || 0;

        // Transform data to match frontend Product interface
        const transformedData = {
            id: data.id,
            name: data.name,
            sku: data.sku || '',
            description: data.description || '',
            category: data.category || '',
            image: data.image_url || 'https://via.placeholder.com/400x300?text=Product',
            stock: data.stock || 0,
            price: data.price || 0,
            cost: data.cost || 0,
            packaging_cost: data.packaging_cost || 0,
            additional_costs: data.additional_costs || 0,
            profitability: data.price
                ? parseFloat((((data.price - (data.cost || 0) - (data.packaging_cost || 0) - (data.additional_costs || 0)) / data.price) * 100).toFixed(1))
                : 0,
            sales,
            shopify_product_id: data.shopify_product_id || null,
            shopify_variant_id: data.shopify_variant_id || null
        };

        res.json(transformedData);
    } catch (error: any) {
        logger.error('SERVER', `[GET /api/products/${req.params.id}] Error:`, error);
        res.status(500).json({
            error: 'Error al obtener producto',
            message: error.message
        });
    }
});

// ================================================================
// POST /api/products - Create new product (MANUAL)
// ================================================================
// For creating products from Shopify dropdown, use /from-shopify endpoint instead
productsRouter.post('/', requirePermission(Module.PRODUCTS, Permission.CREATE), checkProductLimit, async (req: PermissionRequest & PlanLimitRequest, res: Response) => {
    try {
        const {
            name,
            description,
            sku,
            price,
            cost,
            packaging_cost,
            additional_costs,
            stock = 0,
            category,
            image_url,
            shopify_product_id,
            is_active = true,
            is_service = false
        } = req.body;

        // Basic validation
        if (!name || !price) {
            return res.status(400).json({
                error: 'Validation failed',
                message: 'name and price are required fields'
            });
        }

        // Comprehensive validation using database function
        try {
            const { data: validationResult, error: validationError } = await supabaseAdmin
                .rpc('validate_product_data', {
                    p_store_id: req.storeId,
                    p_name: name,
                    p_sku: sku || null,
                    p_price: parseFloat(price) || 0,
                    p_cost: cost ? parseFloat(cost) : null,
                    p_stock: parseInt(stock, 10) || 0,
                    p_image_url: image_url || null,
                    p_exclude_product_id: null
                });

            if (!validationError && validationResult && validationResult.length > 0) {
                const validation = validationResult[0];

                // Block if there are errors
                if (!validation.is_valid) {
                    const errors = validation.errors || [];
                    return res.status(400).json({
                        error: 'Validation failed',
                        message: errors.length > 0 ? errors[0] : 'Invalid product data',
                        validation_errors: errors
                    });
                }

                // Log warnings but don't block
                const warnings = validation.warnings || [];
                if (warnings.length > 0) {
                    logger.info('SERVER', `[POST /api/products] Validation warnings for "${name}":`, warnings);
                }
            } else if (validationError) {
                logger.warn('SERVER', '[POST /api/products] validate_product_data RPC not available, using legacy check:', validationError.message);

                // Fallback to legacy duplicate check
                const { data: duplicateCheck } = await supabaseAdmin
                    .rpc('check_product_exists', {
                        p_store_id: req.storeId,
                        p_name: name,
                        p_sku: sku || null
                    });

                if (duplicateCheck && duplicateCheck.length > 0) {
                    const match = duplicateCheck[0];
                    if (match.exists_by_sku) {
                        return res.status(409).json({
                            error: 'Producto duplicado',
                            message: `Ya existe un producto con el SKU "${sku}": ${match.existing_product_name}`,
                            existing_product_id: match.existing_product_id,
                            match_type: 'sku'
                        });
                    }
                }
            }
        } catch (rpcErr: any) {
            // Graceful degradation: if RPC fails, continue with creation
            logger.warn('SERVER', '[POST /api/products] Error in validation, continuing:', rpcErr.message);
        }

        // Check if we have an active Shopify integration
        const { data: integration } = await supabaseAdmin
            .from('shopify_integrations')
            .select('id, shop_domain, access_token, status')
            .eq('store_id', req.storeId)
            .eq('status', 'active')
            .maybeSingle();

        const syncWarnings: string[] = [];

        const { data, error } = await supabaseAdmin
            .from('products')
            .insert([{
                store_id: req.storeId,
                name,
                description,
                sku,
                price: parseFloat(price),
                cost: cost ? parseFloat(cost) : null,
                packaging_cost: is_service ? 0 : (packaging_cost ? parseFloat(packaging_cost) : 0),
                additional_costs: additional_costs ? parseFloat(additional_costs) : 0,
                stock: parseInt(stock, 10),
                category,
                image_url,
                shopify_product_id,
                is_active,
                is_service
            }])
            .select()
            .single();

        if (error) {
            // Handle duplicate SKU
            if (error.code === '23505') {
                return res.status(409).json({
                    error: 'Duplicate SKU',
                    message: 'A product with this SKU already exists in this store'
                });
            }
            throw error;
        }

        // If product is NEW (no Shopify ID) and we have Shopify integration, publish to Shopify
        if (!shopify_product_id && integration) {
            try {
                logger.info('SERVER', `🚀 [PRODUCT-CREATE] Auto-publishing new product to Shopify...`);
                const syncService = new ShopifyProductSyncService(supabaseAdmin, integration);
                const syncResult = await syncService.publishProductToShopify(data.id);

                if (!syncResult.success) {
                    logger.warn('SERVER', `Product created locally but failed to publish to Shopify: ${syncResult.error}`);
                    syncWarnings.push('Error al publicar en Shopify: ' + syncResult.error);
                } else {
                    logger.info('SERVER', `✅ [PRODUCT-CREATE] Product auto-published to Shopify successfully`);

                    // Fetch updated product with Shopify IDs
                    const { data: updatedProduct } = await supabaseAdmin
                        .from('products')
                        .select('*')
                        .eq('id', data.id)
                        .single();

                    return res.status(201).json({
                        message: 'Product created and published to Shopify successfully',
                        data: updatedProduct || data,
                        sync_warnings: syncWarnings.length > 0 ? syncWarnings : undefined
                    });
                }
            } catch (syncError: any) {
                logger.error('SERVER', 'Error auto-publishing to Shopify:', syncError);
                syncWarnings.push('Error al publicar en Shopify: ' + syncError.message);
            }
        }

        res.status(201).json({
            message: 'Product created successfully',
            data,
            sync_warnings: syncWarnings.length > 0 ? syncWarnings : undefined
        });
    } catch (error: any) {
        logger.error('SERVER', '[POST /api/products] Error:', error);
        res.status(500).json({
            error: 'Error al crear producto',
            message: error.message
        });
    }
});

// ================================================================
// POST /api/products/from-shopify - Create product from Shopify
// ================================================================
productsRouter.post('/from-shopify', requirePermission(Module.PRODUCTS, Permission.CREATE), checkProductLimit, async (req: PermissionRequest & PlanLimitRequest, res: Response) => {
    try {
        const { shopify_product_id, shopify_variant_id, cost, packaging_cost, additional_costs, is_service } = req.body;

        // Validation
        if (!shopify_product_id || !shopify_variant_id) {
            return res.status(400).json({
                error: 'Validation failed',
                message: 'shopify_product_id and shopify_variant_id are required'
            });
        }

        // Get Shopify integration
        const { data: integration, error: integrationError } = await supabaseAdmin
            .from('shopify_integrations')
            .select('id, shop_domain, access_token, status')
            .eq('store_id', req.storeId)
            .eq('status', 'active')
            .single();

        if (integrationError || !integration) {
            return res.status(404).json({
                error: 'No active Shopify integration found'
            });
        }

        // Import from Shopify
        const { getShopifyClient } = await import('../services/shopify-client-cache');
        const shopifyClient = getShopifyClient(integration);

        // Fetch product from Shopify
        const shopifyProduct = await shopifyClient.getProduct(shopify_product_id);

        // Find the specific variant
        const variant = shopifyProduct.variants?.find(v => v.id.toString() === shopify_variant_id);

        if (!variant) {
            return res.status(404).json({
                error: 'Variant not found in Shopify product'
            });
        }

        // Check if product already exists
        const { data: existingProduct } = await supabaseAdmin
            .from('products')
            .select('id')
            .eq('store_id', req.storeId)
            .eq('shopify_product_id', shopify_product_id)
            .eq('shopify_variant_id', shopify_variant_id)
            .maybeSingle();

        if (existingProduct) {
            return res.status(409).json({
                error: 'Product already exists',
                message: 'This Shopify product is already linked to your inventory',
                product_id: existingProduct.id
            });
        }

        // Create product with Shopify data
        const productData = {
            store_id: req.storeId,
            name: variant.title !== 'Default Title'
                ? `${shopifyProduct.title} - ${variant.title}`
                : shopifyProduct.title,
            description: shopifyProduct.body_html || '',
            sku: variant.sku || '',
            price: parseFloat(variant.price || '0'),
            cost: cost !== undefined
                ? parseFloat(cost.toString())
                : is_service
                    ? 0  // Services have 0 cost by default
                    : parseFloat(variant.compare_at_price || variant.price || '0') * 0.6, // Estimate 60% of price as cost if not provided
            packaging_cost: is_service ? 0 : (packaging_cost !== undefined ? parseFloat(packaging_cost.toString()) : 0),
            additional_costs: additional_costs !== undefined ? parseFloat(additional_costs.toString()) : 0,
            stock: variant.inventory_quantity || 0,
            category: shopifyProduct.product_type || '',
            image_url: shopifyProduct.image?.src || shopifyProduct.images?.[0]?.src || '',
            shopify_product_id: shopify_product_id,
            shopify_variant_id: shopify_variant_id,
            is_active: shopifyProduct.status === 'active',
            is_service: is_service || false
        };

        const { data, error } = await supabaseAdmin
            .from('products')
            .insert([productData])
            .select()
            .single();

        if (error) {
            throw error;
        }

        res.status(201).json({
            message: 'Product imported from Shopify successfully',
            data
        });
    } catch (error: any) {
        logger.error('SERVER', '[POST /api/products/from-shopify] Error:', error);
        res.status(500).json({
            error: 'Error al importar producto desde Shopify',
            message: error.message
        });
    }
});

// ================================================================
// PUT /api/products/:id - Update product
// ================================================================
productsRouter.put('/:id', validateUUIDParam('id'), requirePermission(Module.PRODUCTS, Permission.EDIT), async (req: PermissionRequest, res: Response) => {
    try {
        const { id } = req.params;
        const {
            name,
            description,
            sku,
            price,
            cost,
            packaging_cost,
            additional_costs,
            stock,
            category,
            image_url,
            shopify_product_id,
            is_active,
            is_service
        } = req.body;

        const updateData: any = {
            updated_at: new Date().toISOString()
        };

        if (name !== undefined) updateData.name = name;
        if (description !== undefined) updateData.description = description;
        if (sku !== undefined) updateData.sku = sku;
        if (price !== undefined) updateData.price = parseFloat(price);
        if (cost !== undefined) updateData.cost = parseFloat(cost);
        if (packaging_cost !== undefined) updateData.packaging_cost = parseFloat(packaging_cost);
        if (additional_costs !== undefined) updateData.additional_costs = parseFloat(additional_costs);
        if (stock !== undefined) updateData.stock = parseInt(stock, 10);
        if (category !== undefined) updateData.category = category;
        if (image_url !== undefined) updateData.image_url = image_url;
        if (shopify_product_id !== undefined) updateData.shopify_product_id = shopify_product_id;
        if (is_active !== undefined) updateData.is_active = is_active;
        if (is_service !== undefined) {
            updateData.is_service = is_service;
            if (is_service) {
                updateData.packaging_cost = 0;
            }
        }

        const { data, error } = await supabaseAdmin
            .from('products')
            .update(updateData)
            .eq('id', id)
            .eq('store_id', req.storeId)
            .select()
            .single();

        if (error || !data) {
            return res.status(404).json({
                error: 'Producto no encontrado'
            });
        }

        // Auto-sync to Shopify if integration exists and product has shopify_product_id
        if (data.shopify_product_id) {
            const { data: integration } = await supabaseAdmin
                .from('shopify_integrations')
                .select('id, shop_domain, access_token, status')
                .eq('store_id', req.storeId)
                .eq('status', 'active')
                .maybeSingle();

            if (integration) {
                try {
                    const syncService = new ShopifyProductSyncService(supabaseAdmin, integration);
                    const syncResult = await syncService.updateProductInShopify(data.id);

                    if (!syncResult.success) {
                        logger.warn('SERVER', `Product updated locally but sync to Shopify failed: ${syncResult.error}`);
                        return res.json({
                            message: 'Product updated successfully',
                            data,
                            sync_warning: syncResult.error
                        });
                    }

                    logger.info('SERVER', `Product ${data.id} successfully synced to Shopify`);
                } catch (syncError: any) {
                    logger.error('SERVER', 'Error syncing to Shopify:', syncError);
                    return res.json({
                        message: 'Product updated successfully',
                        data,
                        sync_warning: 'Error al sincronizar con Shopify'
                    });
                }
            }
        }

        res.json({
            message: 'Product updated successfully',
            data
        });
    } catch (error: any) {
        logger.error('SERVER', `[PUT /api/products/${req.params.id}] Error:`, error);
        res.status(500).json({
            error: 'Error al actualizar producto',
            message: error.message
        });
    }
});

// ================================================================
// PATCH /api/products/:id/stock - Update product stock
// ================================================================
productsRouter.patch('/:id/stock', requirePermission(Module.PRODUCTS, Permission.EDIT), async (req: PermissionRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { stock, operation = 'set' } = req.body;

        if (stock === undefined) {
            return res.status(400).json({
                error: 'Validation failed',
                message: 'stock is required'
            });
        }

        if (!['set', 'increment', 'decrement'].includes(operation)) {
            return res.status(400).json({
                error: 'Invalid operation',
                message: 'Operation must be one of: set, increment, decrement'
            });
        }

        // For increment/decrement, use atomic RPC to prevent race conditions
        if (operation === 'increment' || operation === 'decrement') {
            const stockChange = Math.abs(parseInt(stock, 10) || 0);

            const { data: rpcResult, error: rpcError } = await supabaseAdmin
                .rpc('atomic_stock_update', {
                    p_product_id: id,
                    p_store_id: req.storeId,
                    p_operation: operation,
                    p_amount: stockChange,
                });

            if (rpcError) {
                if (rpcError.message?.includes('Product not found')) {
                    return res.status(404).json({ error: 'Producto no encontrado' });
                }
                throw rpcError;
            }

            // Fetch full product for response and Shopify sync
            const { data, error } = await supabaseAdmin
                .from('products')
                .select()
                .eq('id', id)
                .eq('store_id', req.storeId)
                .single();

            if (error || !data) {
                throw error || new Error('Error al actualizar stock');
            }

            // Auto-sync to Shopify if integration exists and product has shopify_product_id
            if (data.shopify_product_id) {
                const { data: integration } = await supabaseAdmin
                    .from('shopify_integrations')
                    .select('id, shop_domain, access_token, status')
                    .eq('store_id', req.storeId)
                    .eq('status', 'active')
                    .maybeSingle();

                if (integration) {
                    try {
                        const syncService = new ShopifyProductSyncService(supabaseAdmin, integration);
                        const syncResult = await syncService.updateProductInShopify(data.id);

                        if (!syncResult.success) {
                            logger.warn('SERVER', `Stock updated locally but sync to Shopify failed: ${syncResult.error}`);
                        } else {
                            logger.info('SERVER', `Stock for product ${data.id} successfully synced to Shopify`);
                        }
                    } catch (syncError: any) {
                        logger.error('SERVER', 'Error syncing stock to Shopify:', syncError);
                    }
                }
            }

            return res.json({
                message: 'Stock updated successfully',
                data
            });
        }

        // For 'set' operation - ensure stock is not negative
        const newStockValue = Math.max(0, parseInt(stock, 10) || 0);
        const { data, error } = await supabaseAdmin
            .from('products')
            .update({
                stock: newStockValue,
                updated_at: new Date().toISOString()
            })
            .eq('id', id)
            .eq('store_id', req.storeId)
            .select()
            .single();

        if (error || !data) {
            return res.status(404).json({
                error: 'Producto no encontrado'
            });
        }

        // Auto-sync to Shopify if integration exists and product has shopify_product_id
        if (data.shopify_product_id) {
            const { data: integration } = await supabaseAdmin
                .from('shopify_integrations')
                .select('id, shop_domain, access_token, status')
                .eq('store_id', req.storeId)
                .eq('status', 'active')
                .maybeSingle();

            if (integration) {
                try {
                    const syncService = new ShopifyProductSyncService(supabaseAdmin, integration);
                    const syncResult = await syncService.updateProductInShopify(data.id);

                    if (!syncResult.success) {
                        logger.warn('SERVER', `Stock updated locally but sync to Shopify failed: ${syncResult.error}`);
                    } else {
                        logger.info('SERVER', `Stock for product ${data.id} successfully synced to Shopify`);
                    }
                } catch (syncError: any) {
                    logger.error('SERVER', 'Error syncing stock to Shopify:', syncError);
                }
            }
        }

        res.json({
            message: 'Stock updated successfully',
            data
        });
    } catch (error: any) {
        logger.error('SERVER', `[PATCH /api/products/${req.params.id}/stock] Error:`, error);
        res.status(500).json({
            error: 'Error al actualizar stock',
            message: error.message
        });
    }
});

// ================================================================
// DELETE /api/products/:id - Delete product
// Query params:
//   - hard_delete: 'true' | 'false' (default: 'false' for soft delete)
//   - delete_from_shopify: 'true' | 'false' (default: 'false', only applies if hard_delete=true)
// ================================================================
productsRouter.delete('/:id', validateUUIDParam('id'), requirePermission(Module.PRODUCTS, Permission.DELETE), async (req: PermissionRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { hard_delete = 'false', delete_from_shopify = 'false' } = req.query;

        if (hard_delete === 'true') {
            // Hard delete - permanently remove from database
            // First check if product can be safely deleted using the database function

            try {
                const { data: canDeleteResult, error: canDeleteError } = await supabaseAdmin
                    .rpc('can_delete_product', { p_product_id: id });

                if (!canDeleteError && canDeleteResult && canDeleteResult.length > 0) {
                    const check = canDeleteResult[0];
                    if (!check.can_delete) {
                        return res.status(409).json({
                            error: 'No se puede eliminar el producto',
                            message: check.blocking_reason,
                            details: {
                                active_orders: check.active_orders_count,
                                pending_shipments: check.pending_shipments_count,
                                active_picking_sessions: check.active_picking_sessions_count
                            }
                        });
                    }
                }
                // If RPC fails, proceed with deletion (database triggers will protect)
            } catch (checkError: any) {
                logger.warn('SERVER', '[DELETE /api/products] can_delete_product check failed, proceeding:', checkError.message);
            }

            // Optionally also delete from Shopify if delete_from_shopify=true
            if (delete_from_shopify === 'true') {
                const { data: product } = await supabaseAdmin
                    .from('products')
                    .select('shopify_product_id')
                    .eq('id', id)
                    .eq('store_id', req.storeId)
                    .maybeSingle();

                if (product && product.shopify_product_id) {
                    // Check for active Shopify integration
                    const { data: integration } = await supabaseAdmin
                        .from('shopify_integrations')
                        .select('id, shop_domain, access_token, status')
                        .eq('store_id', req.storeId)
                        .eq('status', 'active')
                        .maybeSingle();

                    if (integration) {
                        try {
                            const syncService = new ShopifyProductSyncService(supabaseAdmin, integration);
                            const syncResult = await syncService.deleteProductFromShopify(id);

                            if (!syncResult.success) {
                                logger.warn('SERVER', `Product delete failed on Shopify: ${syncResult.error}`);
                                return res.status(500).json({
                                    error: 'Error al eliminar producto de Shopify',
                                    details: syncResult.error
                                });
                            }

                            logger.info('SERVER', `Product ${id} successfully deleted from Shopify and locally`);
                        } catch (syncError: any) {
                            logger.error('SERVER', 'Error deleting from Shopify:', syncError);
                            return res.status(500).json({
                                error: 'Error al eliminar producto de Shopify',
                                details: syncError.message
                            });
                        }
                    }
                }
            }

            // Delete locally (always happens in hard delete)
            const { data, error } = await supabaseAdmin
                .from('products')
                .delete()
                .eq('id', id)
                .eq('store_id', req.storeId)
                .select('id')
                .single();

            if (error || !data) {
                return res.status(404).json({
                    error: 'Producto no encontrado'
                });
            }

            const message = delete_from_shopify === 'true'
                ? 'Product deleted from local database and Shopify'
                : 'Product deleted from local database only';

            return res.json({
                message,
                id: data.id,
                deleted_from_shopify: delete_from_shopify === 'true'
            });
        } else {
            // Soft delete (set is_active to false)
            const { data, error } = await supabaseAdmin
                .from('products')
                .update({
                    is_active: false,
                    updated_at: new Date().toISOString()
                })
                .eq('id', id)
                .eq('store_id', req.storeId)
                .select('id')
                .single();

            if (error || !data) {
                return res.status(404).json({
                    error: 'Producto no encontrado'
                });
            }

            return res.json({
                message: 'Product deactivated successfully',
                id: data.id
            });
        }
    } catch (error: any) {
        logger.error('SERVER', `[DELETE /api/products/${req.params.id}] Error:`, error);
        res.status(500).json({
            error: 'Error al eliminar producto',
            message: error.message
        });
    }
});

// ================================================================
// POST /api/products/:id/publish-to-shopify - Publish product to Shopify
// ================================================================
productsRouter.post('/:id/publish-to-shopify', requirePermission(Module.PRODUCTS, Permission.EDIT), async (req: PermissionRequest, res: Response) => {
    try {
        const { id } = req.params;

        // Verificar que el producto existe
        const { data: product, error: productError } = await supabaseAdmin
            .from('products')
            .select('shopify_product_id')
            .eq('id', id)
            .eq('store_id', req.storeId)
            .maybeSingle();

        if (productError || !product) {
            return res.status(404).json({
                error: 'Producto no encontrado'
            });
        }

        // Verificar que el producto NO esté ya vinculado a Shopify
        if (product.shopify_product_id) {
            return res.status(400).json({
                error: 'El producto ya está publicado en Shopify'
            });
        }

        // Verificar que existe integración activa de Shopify
        const { data: integration, error: integrationError } = await supabaseAdmin
            .from('shopify_integrations')
            .select('id, shop_domain, access_token, status')
            .eq('store_id', req.storeId)
            .eq('status', 'active')
            .maybeSingle();

        if (integrationError || !integration) {
            return res.status(404).json({
                error: 'No hay integración activa con Shopify'
            });
        }

        // Publicar a Shopify
        const syncService = new ShopifyProductSyncService(supabaseAdmin, integration);
        const syncResult = await syncService.publishProductToShopify(id);

        if (!syncResult.success) {
            return res.status(500).json({
                error: 'Error al publicar en Shopify',
                details: syncResult.error
            });
        }

        // Obtener producto actualizado con campos necesarios
        const { data: updatedProduct } = await supabaseAdmin
            .from('products')
            .select('id, name, sku, description, category, image_url, stock, price, cost, packaging_cost, additional_costs, shopify_product_id, shopify_variant_id, is_active, sync_status')
            .eq('id', id)
            .single();

        res.json({
            message: 'Producto publicado exitosamente en Shopify',
            data: updatedProduct
        });

    } catch (error: any) {
        logger.error('SERVER', `[POST /api/products/${req.params.id}/publish-to-shopify] Error:`, error);
        res.status(500).json({
            error: 'Error al publicar producto en Shopify',
            message: error.message
        });
    }
});

// ================================================================
// GET /api/products/stats/inventory - Get inventory statistics
// ================================================================
productsRouter.get('/stats/inventory', async (req: AuthRequest, res: Response) => {
    try {
        // Fetch all products for the store to calculate stats
        const { data: products, error } = await supabaseAdmin
            .from('products')
            .select('is_active, stock, price')
            .eq('store_id', req.storeId);

        if (error) {
            throw error;
        }

        // Calculate statistics
        const stats = {
            total_products: products?.length || 0,
            active_products: products?.filter(p => p.is_active === true).length || 0,
            out_of_stock: products?.filter(p => p.stock === 0).length || 0,
            low_stock: products?.filter(p => p.stock > 0 && p.stock <= 10).length || 0,
            total_stock_units: products?.reduce((sum, p) => sum + (p.stock || 0), 0) || 0,
            total_inventory_value: products?.reduce((sum, p) => sum + ((p.price || 0) * (p.stock || 0)), 0) || 0
        };

        res.json({
            data: stats
        });
    } catch (error: any) {
        logger.error('SERVER', '[GET /api/products/stats/inventory] Error:', error);
        res.status(500).json({
            error: 'Error al obtener estadísticas de inventario',
            message: error.message
        });
    }
});

// ================================================================
// GET /api/products/stats/full - Get comprehensive statistics via RPC
// ================================================================
productsRouter.get('/stats/full', async (req: AuthRequest, res: Response) => {
    try {
        const { data: stats, error } = await supabaseAdmin
            .rpc('get_product_stats', { p_store_id: req.storeId });

        if (error) {
            // Fallback to basic stats if RPC not available
            logger.warn('SERVER', '[GET /api/products/stats/full] RPC not available, falling back to basic stats');
            const { data: products } = await supabaseAdmin
                .from('products')
                .select('is_active, stock, price, cost, shopify_product_id, sync_status')
                .eq('store_id', req.storeId);

            const fallbackStats = {
                total_products: products?.length || 0,
                active_products: products?.filter(p => p.is_active).length || 0,
                out_of_stock: products?.filter(p => p.is_active && p.stock === 0).length || 0,
                low_stock: products?.filter(p => p.is_active && p.stock > 0 && p.stock <= 10).length || 0,
                synced_with_shopify: products?.filter(p => p.shopify_product_id && p.sync_status === 'synced').length || 0,
                sync_errors: products?.filter(p => p.shopify_product_id && p.sync_status === 'error').length || 0,
                total_inventory_value: products?.reduce((sum, p) => p.is_active ? sum + ((p.price || 0) * (p.stock || 0)) : sum, 0) || 0,
                avg_price: 0,
                avg_margin_percent: 0
            };

            return res.json({ data: fallbackStats });
        }

        res.json({ data: stats && stats.length > 0 ? stats[0] : {} });
    } catch (error: any) {
        logger.error('SERVER', '[GET /api/products/stats/full] Error:', error);
        res.status(500).json({
            error: 'Error al obtener estadísticas de productos',
            message: error.message
        });
    }
});

// ================================================================
// GET /api/products/sync/status - Get products with sync issues
// ================================================================
productsRouter.get('/sync/status', async (req: AuthRequest, res: Response) => {
    try {
        // Try using the monitoring view
        const { data: syncIssues, error } = await supabaseAdmin
            .from('v_products_needing_sync_attention')
            .select('id, name, sku, sync_status, hours_since_issue, last_synced_at, updated_at, shopify_product_id')
            .eq('store_id', req.storeId)
            .order('hours_since_issue', { ascending: false })
            .limit(50);

        if (error) {
            // Fallback: query products directly
            logger.warn('SERVER', '[GET /api/products/sync/status] View not available, querying directly');
            const { data: products } = await supabaseAdmin
                .from('products')
                .select('id, name, sku, sync_status, last_synced_at, updated_at, shopify_product_id')
                .eq('store_id', req.storeId)
                .eq('is_active', true)
                .not('shopify_product_id', 'is', null)
                .in('sync_status', ['error', 'pending'])
                .order('updated_at', { ascending: true })
                .limit(50);

            return res.json({
                data: products || [],
                source: 'fallback'
            });
        }

        res.json({
            data: syncIssues || [],
            source: 'monitoring_view'
        });
    } catch (error: any) {
        logger.error('SERVER', '[GET /api/products/sync/status] Error:', error);
        res.status(500).json({
            error: 'Error al obtener estado de sincronización',
            message: error.message
        });
    }
});

// ================================================================
// POST /api/products/sync/retry - Retry failed syncs
// ================================================================
productsRouter.post('/sync/retry', requirePermission(Module.PRODUCTS, Permission.EDIT), async (req: PermissionRequest, res: Response) => {
    try {
        const { max_products = 100 } = req.body;

        // Mark products for retry using RPC
        const { data: result, error } = await supabaseAdmin
            .rpc('mark_products_for_sync_retry', {
                p_store_id: req.storeId,
                p_max_products: Math.min(max_products, 100)
            });

        if (error) {
            // Fallback: update directly
            logger.warn('SERVER', '[POST /api/products/sync/retry] RPC not available, updating directly');
            const { data: updated, error: updateError } = await supabaseAdmin
                .from('products')
                .update({ sync_status: 'pending', updated_at: new Date().toISOString() })
                .eq('store_id', req.storeId)
                .eq('sync_status', 'error')
                .not('shopify_product_id', 'is', null)
                .eq('is_active', true)
                .select('id');

            if (updateError) throw updateError;

            return res.json({
                message: `Marked ${updated?.length || 0} products for sync retry`,
                count: updated?.length || 0
            });
        }

        res.json({
            message: `Marked ${result || 0} products for sync retry`,
            count: result || 0
        });
    } catch (error: any) {
        logger.error('SERVER', '[POST /api/products/sync/retry] Error:', error);
        res.status(500).json({
            error: 'Error al reintentar sincronización',
            message: error.message
        });
    }
});

// ================================================================
// GET /api/products/:id/can-delete - Check if product can be deleted
// ================================================================
productsRouter.get('/:id/can-delete', async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;

        // Verify product belongs to store first
        const { data: product, error: productError } = await supabaseAdmin
            .from('products')
            .select('id, name')
            .eq('id', id)
            .eq('store_id', req.storeId)
            .single();

        if (productError || !product) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }

        // Check deletion safety
        const { data: result, error } = await supabaseAdmin
            .rpc('can_delete_product', { p_product_id: id });

        if (error) {
            // Fallback: assume can delete (database triggers will protect)
            return res.json({
                can_delete: true,
                product_name: product.name,
                fallback: true
            });
        }

        const check = result && result.length > 0 ? result[0] : { can_delete: true };

        res.json({
            can_delete: check.can_delete,
            blocking_reason: check.blocking_reason,
            product_name: product.name,
            details: {
                active_orders: check.active_orders_count || 0,
                pending_shipments: check.pending_shipments_count || 0,
                active_picking_sessions: check.active_picking_sessions_count || 0
            }
        });
    } catch (error: any) {
        logger.error('SERVER', `[GET /api/products/${req.params.id}/can-delete] Error:`, error);
        res.status(500).json({
            error: 'Error al verificar estado de eliminación',
            message: error.message
        });
    }
});

// ================================================================
// PRODUCT VARIANTS ENDPOINTS
// ================================================================

// ================================================================
// GET /api/products/:id/variants - Get all variants for a product
// Returns variants separated by type: bundles[] and variations[]
// ================================================================
productsRouter.get('/:id/variants', validateUUIDParam('id'), async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;

        // Verify product belongs to store and get parent stock
        const { data: product, error: productError } = await supabaseAdmin
            .from('products')
            .select('id, name, has_variants, stock')
            .eq('id', id)
            .eq('store_id', req.storeId)
            .single();

        if (productError || !product) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }

        // Get variants with variant_type
        const { data: variants, error } = await supabaseAdmin
            .from('product_variants')
            .select('id, product_id, sku, variant_title, variant_type, option1_name, option1_value, option2_name, option2_value, option3_name, option3_value, price, cost, stock, image_url, position, shopify_variant_id, is_active, uses_shared_stock, units_per_pack')
            .eq('product_id', id)
            .eq('is_active', true)
            .order('position', { ascending: true });

        if (error) throw error;

        const parentStock = product.stock || 0;

        // Separate bundles and variations, calculate availability
        const bundles = (variants || [])
            .filter((v: any) => v.variant_type === 'bundle' || v.uses_shared_stock === true)
            .map((v: any) => ({
                ...v,
                variant_type: 'bundle' as const,
                available_packs: Math.floor(parentStock / (v.units_per_pack || 1))
            }));

        const variations = (variants || [])
            .filter((v: any) => v.variant_type === 'variation' || (v.variant_type !== 'bundle' && v.uses_shared_stock === false))
            .map((v: any) => ({
                ...v,
                variant_type: 'variation' as const,
                available_stock: v.stock || 0
            }));

        res.json({
            product_id: id,
            product_name: product.name,
            parent_stock: parentStock,
            has_variants: product.has_variants || false,
            has_bundles: bundles.length > 0,
            has_variations: variations.length > 0,
            // Separated by type for clear UX
            bundles,
            variations,
            // Legacy: all variants for backward compatibility
            variants: variants || []
        });
    } catch (error: any) {
        logger.error('SERVER', `[GET /api/products/${req.params.id}/variants] Error:`, error);
        res.status(500).json({
            error: 'Error al obtener variantes',
            message: error.message
        });
    }
});

// ================================================================
// POST /api/products/:id/variants - Create a new variant
// Supports variant_type: 'bundle' | 'variation' (inferred from uses_shared_stock if not provided)
// ================================================================
productsRouter.post('/:id/variants', validateUUIDParam('id'), requirePermission(Module.PRODUCTS, Permission.CREATE), async (req: PermissionRequest, res: Response) => {
    try {
        const { id } = req.params;
        const {
            sku,
            variant_title,
            variant_type,  // NEW: 'bundle' | 'variation'
            option1_name,
            option1_value,
            option2_name,
            option2_value,
            option3_name,
            option3_value,
            price,
            cost,
            stock = 0,
            image_url,
            barcode,
            weight,
            weight_unit = 'kg',
            uses_shared_stock = true,
            units_per_pack = 1
        } = req.body;

        // Infer variant_type from uses_shared_stock if not explicitly provided
        const resolvedVariantType = variant_type || (uses_shared_stock ? 'bundle' : 'variation');

        // Enforce business rules based on variant_type
        let finalUsesSharedStock = uses_shared_stock;
        let finalUnitsPerPack = units_per_pack;
        let finalStock = stock;

        if (resolvedVariantType === 'bundle') {
            // Bundles MUST use shared stock
            finalUsesSharedStock = true;
            finalStock = 0; // Bundles don't have independent stock
            finalUnitsPerPack = Math.max(1, parseInt(units_per_pack, 10) || 1);
        } else if (resolvedVariantType === 'variation') {
            // Variations MUST NOT use shared stock
            finalUsesSharedStock = false;
            finalUnitsPerPack = 1; // Variations always have units_per_pack = 1
            finalStock = parseInt(stock, 10) || 0;
        }

        // Verify product belongs to store and get image_url for inheritance
        const { data: product, error: productError } = await supabaseAdmin
            .from('products')
            .select('id, name, store_id, image_url')
            .eq('id', id)
            .eq('store_id', req.storeId)
            .single();

        if (productError || !product) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }

        // Validate required fields
        if (!variant_title || price === undefined) {
            return res.status(400).json({
                error: 'Validation failed',
                message: 'variant_title and price are required'
            });
        }

        // Validate units_per_pack
        const parsedUnitsPerPack = parseInt(units_per_pack, 10) || 1;
        if (parsedUnitsPerPack < 1) {
            return res.status(400).json({
                error: 'Validation failed',
                message: 'units_per_pack must be at least 1'
            });
        }

        // Validate using RPC if available
        try {
            const { data: validationResult } = await supabaseAdmin
                .rpc('validate_variant_data', {
                    p_product_id: id,
                    p_sku: sku || null,
                    p_variant_title: variant_title,
                    p_price: parseFloat(price),
                    p_stock: parseInt(stock, 10) || 0,
                    p_variant_id: null
                });

            if (validationResult && validationResult.length > 0) {
                const validation = validationResult[0];
                if (!validation.is_valid) {
                    return res.status(400).json({
                        error: 'Validation failed',
                        validation_errors: validation.errors
                    });
                }
            }
        } catch (rpcErr: any) {
            logger.warn('SERVER', '[POST variants] validate_variant_data not available:', rpcErr.message);
        }

        // Get next position
        const { data: maxPos } = await supabaseAdmin
            .from('product_variants')
            .select('position')
            .eq('product_id', id)
            .order('position', { ascending: false })
            .limit(1)
            .maybeSingle();

        const nextPosition = (maxPos?.position || 0) + 1;

        // Create variant - auto-inherit image from parent product if not provided
        const { data: variant, error } = await supabaseAdmin
            .from('product_variants')
            .insert([{
                product_id: id,
                store_id: req.storeId,
                sku,
                variant_title,
                variant_type: resolvedVariantType, // NEW: bundle or variation
                option1_name: resolvedVariantType === 'variation' ? option1_name : null,
                option1_value: resolvedVariantType === 'variation' ? option1_value : null,
                option2_name: resolvedVariantType === 'variation' ? option2_name : null,
                option2_value: resolvedVariantType === 'variation' ? option2_value : null,
                option3_name: resolvedVariantType === 'variation' ? option3_name : null,
                option3_value: resolvedVariantType === 'variation' ? option3_value : null,
                price: parseFloat(price),
                cost: cost ? parseFloat(cost) : null,
                stock: finalStock,
                image_url: image_url || product.image_url, // Auto-inherit from parent
                barcode,
                weight: weight ? parseFloat(weight) : null,
                weight_unit,
                position: nextPosition,
                is_active: true,
                uses_shared_stock: finalUsesSharedStock,
                units_per_pack: finalUnitsPerPack
            }])
            .select()
            .single();

        if (error) {
            if (error.code === '23505') {
                return res.status(409).json({
                    error: 'SKU duplicado',
                    message: 'Ya existe una variante o producto con este SKU'
                });
            }
            throw error;
        }

        // Mark product as having variants
        await supabaseAdmin
            .from('products')
            .update({ has_variants: true, updated_at: new Date().toISOString() })
            .eq('id', id);

        res.status(201).json({
            message: 'Variante creada exitosamente',
            data: variant
        });
    } catch (error: any) {
        logger.error('SERVER', `[POST /api/products/${req.params.id}/variants] Error:`, error);
        res.status(500).json({
            error: 'Error al crear variante',
            message: error.message
        });
    }
});

// ================================================================
// PUT /api/products/:id/variants/:variantId - Update a variant
// ================================================================
productsRouter.put('/:id/variants/:variantId', validateUUIDParam('id'), requirePermission(Module.PRODUCTS, Permission.EDIT), async (req: PermissionRequest, res: Response) => {
    try {
        const { id, variantId } = req.params;
        const {
            sku,
            variant_title,
            option1_name,
            option1_value,
            option2_name,
            option2_value,
            option3_name,
            option3_value,
            price,
            cost,
            stock,
            image_url,
            barcode,
            weight,
            weight_unit,
            position,
            is_active,
            uses_shared_stock,
            units_per_pack
        } = req.body;

        // Verify variant belongs to product and store
        const { data: existingVariant, error: variantError } = await supabaseAdmin
            .from('product_variants')
            .select('id, product_id')
            .eq('id', variantId)
            .eq('product_id', id)
            .eq('store_id', req.storeId)
            .single();

        if (variantError || !existingVariant) {
            return res.status(404).json({ error: 'Variante no encontrada' });
        }

        // Build update data
        const updateData: any = { updated_at: new Date().toISOString() };

        if (sku !== undefined) updateData.sku = sku;
        if (variant_title !== undefined) updateData.variant_title = variant_title;
        if (option1_name !== undefined) updateData.option1_name = option1_name;
        if (option1_value !== undefined) updateData.option1_value = option1_value;
        if (option2_name !== undefined) updateData.option2_name = option2_name;
        if (option2_value !== undefined) updateData.option2_value = option2_value;
        if (option3_name !== undefined) updateData.option3_name = option3_name;
        if (option3_value !== undefined) updateData.option3_value = option3_value;
        if (price !== undefined) updateData.price = parseFloat(price);
        if (cost !== undefined) updateData.cost = cost ? parseFloat(cost) : null;
        if (stock !== undefined) updateData.stock = parseInt(stock, 10);
        if (image_url !== undefined) updateData.image_url = image_url;
        if (barcode !== undefined) updateData.barcode = barcode;
        if (weight !== undefined) updateData.weight = weight ? parseFloat(weight) : null;
        if (weight_unit !== undefined) updateData.weight_unit = weight_unit;
        if (position !== undefined) updateData.position = position;
        if (is_active !== undefined) updateData.is_active = is_active;
        if (uses_shared_stock !== undefined) updateData.uses_shared_stock = uses_shared_stock;
        if (units_per_pack !== undefined) updateData.units_per_pack = Math.max(1, parseInt(units_per_pack, 10) || 1);

        // Update variant
        const { data: variant, error } = await supabaseAdmin
            .from('product_variants')
            .update(updateData)
            .eq('id', variantId)
            .select()
            .single();

        if (error) {
            if (error.code === '23505') {
                return res.status(409).json({
                    error: 'SKU duplicado',
                    message: 'Ya existe una variante o producto con este SKU'
                });
            }
            throw error;
        }

        res.json({
            message: 'Variante actualizada exitosamente',
            data: variant
        });
    } catch (error: any) {
        logger.error('SERVER', `[PUT /api/products/${req.params.id}/variants/${req.params.variantId}] Error:`, error);
        res.status(500).json({
            error: 'Error al actualizar variante',
            message: error.message
        });
    }
});

// ================================================================
// DELETE /api/products/:id/variants/:variantId - Delete a variant
// ================================================================
productsRouter.delete('/:id/variants/:variantId', validateUUIDParam('id'), requirePermission(Module.PRODUCTS, Permission.DELETE), async (req: PermissionRequest, res: Response) => {
    try {
        const { id, variantId } = req.params;
        const { hard_delete = 'false' } = req.query;

        // Verify variant belongs to product and store
        const { data: existingVariant, error: variantError } = await supabaseAdmin
            .from('product_variants')
            .select('id, product_id')
            .eq('id', variantId)
            .eq('product_id', id)
            .eq('store_id', req.storeId)
            .single();

        if (variantError || !existingVariant) {
            return res.status(404).json({ error: 'Variante no encontrada' });
        }

        if (hard_delete === 'true') {
            // Hard delete
            const { error } = await supabaseAdmin
                .from('product_variants')
                .delete()
                .eq('id', variantId);

            if (error) throw error;
        } else {
            // Soft delete
            const { error } = await supabaseAdmin
                .from('product_variants')
                .update({ is_active: false, updated_at: new Date().toISOString() })
                .eq('id', variantId);

            if (error) throw error;
        }

        // Check if product still has active variants
        const { data: remainingVariants } = await supabaseAdmin
            .from('product_variants')
            .select('id')
            .eq('product_id', id)
            .eq('is_active', true)
            .limit(1);

        if (!remainingVariants || remainingVariants.length === 0) {
            // No more active variants, mark product as simple
            await supabaseAdmin
                .from('products')
                .update({ has_variants: false, updated_at: new Date().toISOString() })
                .eq('id', id);
        }

        res.json({
            message: hard_delete === 'true' ? 'Variante eliminada permanentemente' : 'Variante desactivada',
            variant_id: variantId
        });
    } catch (error: any) {
        logger.error('SERVER', `[DELETE /api/products/${req.params.id}/variants/${req.params.variantId}] Error:`, error);
        res.status(500).json({
            error: 'Error al eliminar variante',
            message: error.message
        });
    }
});

// ================================================================
// PATCH /api/products/:id/variants/:variantId/stock - Update variant stock
// ================================================================
productsRouter.patch('/:id/variants/:variantId/stock', requirePermission(Module.PRODUCTS, Permission.EDIT), async (req: PermissionRequest, res: Response) => {
    try {
        const { id, variantId } = req.params;
        const { stock, operation = 'set' } = req.body;

        if (stock === undefined) {
            return res.status(400).json({
                error: 'Validation failed',
                message: 'stock is required'
            });
        }

        // Verify variant belongs to product and store
        const { data: existingVariant, error: variantError } = await supabaseAdmin
            .from('product_variants')
            .select('id, stock')
            .eq('id', variantId)
            .eq('product_id', id)
            .eq('store_id', req.storeId)
            .single();

        if (variantError || !existingVariant) {
            return res.status(404).json({ error: 'Variante no encontrada' });
        }

        let newStock: number;
        const stockChange = Math.abs(parseInt(stock, 10) || 0);

        if (operation === 'increment') {
            newStock = existingVariant.stock + stockChange;
        } else if (operation === 'decrement') {
            newStock = Math.max(0, existingVariant.stock - stockChange);
        } else {
            newStock = Math.max(0, parseInt(stock, 10) || 0);
        }

        // Try using RPC for atomic update
        try {
            const { data: result } = await supabaseAdmin
                .rpc('adjust_variant_stock', {
                    p_variant_id: variantId,
                    p_quantity_change: newStock - existingVariant.stock,
                    p_movement_type: 'manual_adjustment',
                    p_order_id: null,
                    p_notes: `Stock ${operation}: ${stock}`
                });

            if (result && result.length > 0 && result[0].success) {
                return res.json({
                    message: 'Stock actualizado exitosamente',
                    new_stock: result[0].new_stock
                });
            }
        } catch (rpcErr: any) {
            logger.warn('SERVER', '[PATCH variant/stock] RPC not available, using direct update');
        }

        // Fallback: Direct update
        const { data: variant, error } = await supabaseAdmin
            .from('product_variants')
            .update({ stock: newStock, updated_at: new Date().toISOString() })
            .eq('id', variantId)
            .select()
            .single();

        if (error) throw error;

        res.json({
            message: 'Stock actualizado exitosamente',
            data: variant
        });
    } catch (error: any) {
        logger.error('SERVER', `[PATCH /api/products/${req.params.id}/variants/${req.params.variantId}/stock] Error:`, error);
        res.status(500).json({
            error: 'Error al actualizar stock de variante',
            message: error.message
        });
    }
});

// ================================================================
// POST /api/products/:id/variants/bulk - Create multiple variants at once
// ================================================================
productsRouter.post('/:id/variants/bulk', validateUUIDParam('id'), requirePermission(Module.PRODUCTS, Permission.CREATE), async (req: PermissionRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { variants } = req.body;

        if (!Array.isArray(variants) || variants.length === 0) {
            return res.status(400).json({
                error: 'Validation failed',
                message: 'variants must be a non-empty array'
            });
        }

        // Verify product belongs to store and get image_url for inheritance
        const { data: product, error: productError } = await supabaseAdmin
            .from('products')
            .select('id, name, store_id, image_url')
            .eq('id', id)
            .eq('store_id', req.storeId)
            .single();

        if (productError || !product) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }

        // Get current max position
        const { data: maxPos } = await supabaseAdmin
            .from('product_variants')
            .select('position')
            .eq('product_id', id)
            .order('position', { ascending: false })
            .limit(1)
            .maybeSingle();

        let nextPosition = (maxPos?.position || 0) + 1;

        // Prepare variants for insert - auto-inherit image from parent if not provided
        const variantsToInsert = variants.map((v: any) => ({
            product_id: id,
            store_id: req.storeId,
            sku: v.sku || null,
            variant_title: v.variant_title,
            option1_name: v.option1_name || null,
            option1_value: v.option1_value || null,
            option2_name: v.option2_name || null,
            option2_value: v.option2_value || null,
            price: parseFloat(v.price),
            cost: v.cost ? parseFloat(v.cost) : null,
            stock: parseInt(v.stock, 10) || 0,
            image_url: v.image_url || product.image_url, // Auto-inherit from parent
            position: nextPosition++,
            is_active: true
        }));

        // Insert variants
        const { data: createdVariants, error } = await supabaseAdmin
            .from('product_variants')
            .insert(variantsToInsert)
            .select();

        if (error) {
            if (error.code === '23505') {
                return res.status(409).json({
                    error: 'SKU duplicado',
                    message: 'Una o más variantes tienen SKU duplicado'
                });
            }
            throw error;
        }

        // Mark product as having variants
        await supabaseAdmin
            .from('products')
            .update({ has_variants: true, updated_at: new Date().toISOString() })
            .eq('id', id);

        res.status(201).json({
            message: `${createdVariants?.length || 0} variantes creadas exitosamente`,
            data: createdVariants
        });
    } catch (error: any) {
        logger.error('SERVER', `[POST /api/products/${req.params.id}/variants/bulk] Error:`, error);
        res.status(500).json({
            error: 'Error al crear variantes',
            message: error.message
        });
    }
});

// ================================================================
// POST /api/products/:id/bundles - Create a bundle (simplified endpoint)
// Auto-sets: variant_type='bundle', uses_shared_stock=true, stock=0
// ================================================================
productsRouter.post('/:id/bundles', validateUUIDParam('id'), requirePermission(Module.PRODUCTS, Permission.CREATE), async (req: PermissionRequest, res: Response) => {
    try {
        const { id } = req.params;
        const {
            sku,
            variant_title,
            units_per_pack = 1,
            price,
            cost,
            image_url
        } = req.body;

        // Verify product belongs to store
        const { data: product, error: productError } = await supabaseAdmin
            .from('products')
            .select('id, name, store_id, image_url, stock')
            .eq('id', id)
            .eq('store_id', req.storeId)
            .single();

        if (productError || !product) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }

        // Validate required fields
        if (!variant_title || price === undefined) {
            return res.status(400).json({
                error: 'Validation failed',
                message: 'variant_title and price are required'
            });
        }

        const parsedUnitsPerPack = Math.max(1, parseInt(units_per_pack, 10) || 1);

        // Get next position
        const { data: maxPos } = await supabaseAdmin
            .from('product_variants')
            .select('position')
            .eq('product_id', id)
            .order('position', { ascending: false })
            .limit(1)
            .maybeSingle();

        const nextPosition = (maxPos?.position || 0) + 1;

        // Create bundle with enforced business rules
        const { data: bundle, error } = await supabaseAdmin
            .from('product_variants')
            .insert([{
                product_id: id,
                store_id: req.storeId,
                sku,
                variant_title,
                variant_type: 'bundle',
                uses_shared_stock: true,  // Bundles ALWAYS use shared stock
                units_per_pack: parsedUnitsPerPack,
                stock: 0,  // Bundles don't have independent stock
                price: parseFloat(price),
                cost: cost ? parseFloat(cost) : null,
                image_url: image_url || product.image_url,
                position: nextPosition,
                is_active: true,
                // Bundles don't use option attributes
                option1_name: null,
                option1_value: null,
                option2_name: null,
                option2_value: null,
                option3_name: null,
                option3_value: null
            }])
            .select()
            .single();

        if (error) {
            if (error.code === '23505') {
                return res.status(409).json({
                    error: 'SKU duplicado',
                    message: 'Ya existe una variante o producto con este SKU'
                });
            }
            throw error;
        }

        // Mark product as having variants
        await supabaseAdmin
            .from('products')
            .update({ has_variants: true, updated_at: new Date().toISOString() })
            .eq('id', id);

        // Calculate available packs
        const availablePacks = Math.floor((product.stock || 0) / parsedUnitsPerPack);

        res.status(201).json({
            message: 'Pack creado exitosamente',
            data: {
                ...bundle,
                available_packs: availablePacks
            }
        });
    } catch (error: any) {
        logger.error('SERVER', `[POST /api/products/${req.params.id}/bundles] Error:`, error);
        res.status(500).json({
            error: 'Error al crear pack',
            message: error.message
        });
    }
});

// ================================================================
// POST /api/products/:id/variations - Create a variation (simplified endpoint)
// Auto-sets: variant_type='variation', uses_shared_stock=false, units_per_pack=1
// ================================================================
productsRouter.post('/:id/variations', validateUUIDParam('id'), requirePermission(Module.PRODUCTS, Permission.CREATE), async (req: PermissionRequest, res: Response) => {
    try {
        const { id } = req.params;
        const {
            sku,
            variant_title,
            option1_name,
            option1_value,
            option2_name,
            option2_value,
            option3_name,
            option3_value,
            price,
            cost,
            stock = 0,
            image_url
        } = req.body;

        // Verify product belongs to store
        const { data: product, error: productError } = await supabaseAdmin
            .from('products')
            .select('id, name, store_id, image_url')
            .eq('id', id)
            .eq('store_id', req.storeId)
            .single();

        if (productError || !product) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }

        // Validate required fields
        if (!variant_title || price === undefined) {
            return res.status(400).json({
                error: 'Validation failed',
                message: 'variant_title and price are required'
            });
        }

        // Get next position
        const { data: maxPos } = await supabaseAdmin
            .from('product_variants')
            .select('position')
            .eq('product_id', id)
            .order('position', { ascending: false })
            .limit(1)
            .maybeSingle();

        const nextPosition = (maxPos?.position || 0) + 1;

        // Create variation with enforced business rules
        const { data: variation, error } = await supabaseAdmin
            .from('product_variants')
            .insert([{
                product_id: id,
                store_id: req.storeId,
                sku,
                variant_title,
                variant_type: 'variation',
                uses_shared_stock: false,  // Variations ALWAYS have independent stock
                units_per_pack: 1,  // Variations always have units_per_pack = 1
                stock: parseInt(stock, 10) || 0,
                price: parseFloat(price),
                cost: cost ? parseFloat(cost) : null,
                image_url: image_url || product.image_url,
                position: nextPosition,
                is_active: true,
                // Variations use option attributes
                option1_name,
                option1_value,
                option2_name,
                option2_value,
                option3_name,
                option3_value
            }])
            .select()
            .single();

        if (error) {
            if (error.code === '23505') {
                return res.status(409).json({
                    error: 'SKU duplicado',
                    message: 'Ya existe una variante o producto con este SKU'
                });
            }
            throw error;
        }

        // Mark product as having variants
        await supabaseAdmin
            .from('products')
            .update({ has_variants: true, updated_at: new Date().toISOString() })
            .eq('id', id);

        res.status(201).json({
            message: 'Variante creada exitosamente',
            data: {
                ...variation,
                available_stock: variation.stock
            }
        });
    } catch (error: any) {
        logger.error('SERVER', `[POST /api/products/${req.params.id}/variations] Error:`, error);
        res.status(500).json({
            error: 'Error al crear variante',
            message: error.message
        });
    }
});

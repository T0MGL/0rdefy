// ================================================================
// NEONFLOW API - PRODUCTS ROUTES
// ================================================================
// CRUD operations for products with Shopify sync support
// MVP: Uses hardcoded store_id, no authentication
// Uses Supabase JS client for database operations
// ================================================================

import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../db/connection';
import { verifyToken, extractStoreId, AuthRequest } from '../middleware/auth';
import { ShopifyProductSyncService } from '../services/shopify-product-sync.service';
import { sanitizeSearchInput } from '../utils/sanitize';

export const productsRouter = Router();

productsRouter.use(verifyToken, extractStoreId);

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
            is_active
        } = req.query;

        // Build query - only show active products by default
        let query = supabaseAdmin
            .from('products')
            .select('*', { count: 'exact' })
            .eq('store_id', req.storeId)
            .eq('is_active', true)
            .order('created_at', { ascending: false })
            .range(parseInt(offset as string), parseInt(offset as string) + parseInt(limit as string) - 1);

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

        // Allow overriding the default is_active filter with query parameter
        if (is_active !== undefined) {
            // Remove the default filter and apply the one from query param
            query = supabaseAdmin
                .from('products')
                .select('*', { count: 'exact' })
                .eq('store_id', req.storeId)
                .eq('is_active', is_active === 'true')
                .order('created_at', { ascending: false })
                .range(parseInt(offset as string), parseInt(offset as string) + parseInt(limit as string) - 1);

            // Reapply other filters (sanitized)
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
        }

        const { data, error, count } = await query;

        if (error) {
            throw error;
        }

        // Calculate sales for each product from orders
        // Fetch all confirmed/delivered orders for this store
        const { data: orders } = await supabaseAdmin
            .from('orders')
            .select('line_items')
            .eq('store_id', req.storeId)
            .in('sleeves_status', ['confirmed', 'shipped', 'delivered']);

        // Calculate sales per product
        const salesByProduct: Record<string, number> = {};
        orders?.forEach(order => {
            const lineItems = order.line_items || [];
            if (Array.isArray(lineItems)) {
                lineItems.forEach((item: any) => {
                    const productId = item.product_id;
                    const quantity = parseInt(item.quantity) || 0;
                    if (productId) {
                        salesByProduct[productId] = (salesByProduct[productId] || 0) + quantity;
                    }
                });
            }
        });

        // Transform data to match frontend Product interface
        const transformedData = (data || []).map(product => ({
            id: product.id,
            name: product.name,
            image: product.image_url || 'https://via.placeholder.com/400x300?text=Product',
            stock: product.stock || 0,
            price: product.price || 0,
            cost: product.cost || 0,
            profitability: product.cost && product.price
                ? parseFloat((((product.price - product.cost) / product.price) * 100).toFixed(1))
                : 0,
            sales: salesByProduct[product.id] || 0,
            shopify_product_id: product.shopify_product_id || null
        }));

        res.json({
            data: transformedData,
            pagination: {
                total: count || 0,
                limit: parseInt(limit as string),
                offset: parseInt(offset as string),
                hasMore: parseInt(offset as string) + (data?.length || 0) < (count || 0)
            }
        });
    } catch (error: any) {
        console.error('[GET /api/products] Error:', error);
        res.status(500).json({
            error: 'Failed to fetch products',
            message: error.message
        });
    }
});

// ================================================================
// GET /api/products/:id - Get single product
// ================================================================
productsRouter.get('/:id', async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;

        const { data, error } = await supabaseAdmin
            .from('products')
            .select('*')
            .eq('id', id)
            .eq('store_id', req.storeId)
            .single();

        if (error || !data) {
            return res.status(404).json({
                error: 'Product not found'
            });
        }

        // Calculate sales from orders
        const { data: orders } = await supabaseAdmin
            .from('orders')
            .select('line_items')
            .eq('store_id', req.storeId)
            .in('sleeves_status', ['confirmed', 'shipped', 'delivered']);

        let sales = 0;
        orders?.forEach(order => {
            const lineItems = order.line_items || [];
            if (Array.isArray(lineItems)) {
                lineItems.forEach((item: any) => {
                    if (item.product_id === data.id) {
                        sales += parseInt(item.quantity) || 0;
                    }
                });
            }
        });

        // Transform data to match frontend Product interface
        const transformedData = {
            id: data.id,
            name: data.name,
            image: data.image_url || 'https://via.placeholder.com/400x300?text=Product',
            stock: data.stock || 0,
            price: data.price || 0,
            cost: data.cost || 0,
            profitability: data.cost && data.price
                ? parseFloat((((data.price - data.cost) / data.price) * 100).toFixed(1))
                : 0,
            sales,
            shopify_product_id: data.shopify_product_id || null
        };

        res.json(transformedData);
    } catch (error: any) {
        console.error(`[GET /api/products/${req.params.id}] Error:`, error);
        res.status(500).json({
            error: 'Failed to fetch product',
            message: error.message
        });
    }
});

// ================================================================
// POST /api/products - Create new product (MANUAL)
// ================================================================
// For creating products from Shopify dropdown, use /from-shopify endpoint instead
productsRouter.post('/', async (req: AuthRequest, res: Response) => {
    try {
        const {
            name,
            description,
            sku,
            price,
            cost,
            packaging_cost,
            additional_cost,
            stock = 0,
            category,
            image_url,
            shopify_product_id,
            is_active = true,
            is_service = false
        } = req.body;

        // Validation
        if (!name || !price) {
            return res.status(400).json({
                error: 'Validation failed',
                message: 'name and price are required fields'
            });
        }

        // Check if we have an active Shopify integration
        const { data: integration } = await supabaseAdmin
            .from('shopify_integrations')
            .select('*')
            .eq('store_id', req.storeId)
            .eq('status', 'active')
            .maybeSingle();

        let syncWarnings: string[] = [];

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
                additional_cost: additional_cost ? parseFloat(additional_cost) : 0,
                stock: parseInt(stock),
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
                console.log(`🚀 [PRODUCT-CREATE] Auto-publishing new product to Shopify...`);
                const syncService = new ShopifyProductSyncService(supabaseAdmin, integration);
                const syncResult = await syncService.publishProductToShopify(data.id);

                if (!syncResult.success) {
                    console.warn(`Product created locally but failed to publish to Shopify: ${syncResult.error}`);
                    syncWarnings.push('Failed to publish to Shopify: ' + syncResult.error);
                } else {
                    console.log(`✅ [PRODUCT-CREATE] Product auto-published to Shopify successfully`);

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
                console.error('Error auto-publishing to Shopify:', syncError);
                syncWarnings.push('Failed to publish to Shopify: ' + syncError.message);
            }
        }

        res.status(201).json({
            message: 'Product created successfully',
            data,
            sync_warnings: syncWarnings.length > 0 ? syncWarnings : undefined
        });
    } catch (error: any) {
        console.error('[POST /api/products] Error:', error);
        res.status(500).json({
            error: 'Failed to create product',
            message: error.message
        });
    }
});

// ================================================================
// POST /api/products/from-shopify - Create product from Shopify
// ================================================================
productsRouter.post('/from-shopify', async (req: AuthRequest, res: Response) => {
    try {
        const { shopify_product_id, shopify_variant_id } = req.body;

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
            .select('*')
            .eq('store_id', req.storeId)
            .eq('status', 'active')
            .single();

        if (integrationError || !integration) {
            return res.status(404).json({
                error: 'No active Shopify integration found'
            });
        }

        // Import from Shopify
        const { ShopifyClientService } = await import('../services/shopify-client.service');
        const shopifyClient = new ShopifyClientService(integration);

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
            cost: parseFloat(variant.compare_at_price || variant.price || '0') * 0.6, // Estimate 60% of price as cost
            stock: variant.inventory_quantity || 0,
            category: shopifyProduct.product_type || '',
            image_url: shopifyProduct.image?.src || shopifyProduct.images?.[0]?.src || '',
            shopify_product_id: shopify_product_id,
            shopify_variant_id: shopify_variant_id,
            is_active: shopifyProduct.status === 'active'
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
        console.error('[POST /api/products/from-shopify] Error:', error);
        res.status(500).json({
            error: 'Failed to import product from Shopify',
            message: error.message
        });
    }
});

// ================================================================
// PUT /api/products/:id - Update product
// ================================================================
productsRouter.put('/:id', async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const {
            name,
            description,
            sku,
            price,
            cost,
            packaging_cost,
            additional_cost,
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
        if (additional_cost !== undefined) updateData.additional_cost = parseFloat(additional_cost);
        if (stock !== undefined) updateData.stock = parseInt(stock);
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
                error: 'Product not found'
            });
        }

        // Auto-sync to Shopify if integration exists and product has shopify_product_id
        if (data.shopify_product_id) {
            const { data: integration } = await supabaseAdmin
                .from('shopify_integrations')
                .select('*')
                .eq('store_id', req.storeId)
                .eq('status', 'active')
                .maybeSingle();

            if (integration) {
                try {
                    const syncService = new ShopifyProductSyncService(supabaseAdmin, integration);
                    const syncResult = await syncService.updateProductInShopify(data.id);

                    if (!syncResult.success) {
                        console.warn(`Product updated locally but sync to Shopify failed: ${syncResult.error}`);
                        return res.json({
                            message: 'Product updated successfully',
                            data,
                            sync_warning: syncResult.error
                        });
                    }

                    console.log(`Product ${data.id} successfully synced to Shopify`);
                } catch (syncError: any) {
                    console.error('Error syncing to Shopify:', syncError);
                    return res.json({
                        message: 'Product updated successfully',
                        data,
                        sync_warning: 'Failed to sync to Shopify'
                    });
                }
            }
        }

        res.json({
            message: 'Product updated successfully',
            data
        });
    } catch (error: any) {
        console.error(`[PUT /api/products/${req.params.id}] Error:`, error);
        res.status(500).json({
            error: 'Failed to update product',
            message: error.message
        });
    }
});

// ================================================================
// PATCH /api/products/:id/stock - Update product stock
// ================================================================
productsRouter.patch('/:id/stock', async (req: AuthRequest, res: Response) => {
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

        // For increment/decrement, we need to fetch current stock first
        if (operation === 'increment' || operation === 'decrement') {
            const { data: currentProduct, error: fetchError } = await supabaseAdmin
                .from('products')
                .select('stock')
                .eq('id', id)
                .eq('store_id', req.storeId)
                .single();

            if (fetchError || !currentProduct) {
                return res.status(404).json({
                    error: 'Product not found'
                });
            }

            let newStock = currentProduct.stock;
            if (operation === 'increment') {
                newStock += parseInt(stock);
            } else {
                newStock = Math.max(0, newStock - parseInt(stock));
            }

            const { data, error } = await supabaseAdmin
                .from('products')
                .update({
                    stock: newStock,
                    updated_at: new Date().toISOString()
                })
                .eq('id', id)
                .eq('store_id', req.storeId)
                .select()
                .single();

            if (error || !data) {
                throw error || new Error('Failed to update stock');
            }

            // Auto-sync to Shopify if integration exists and product has shopify_product_id
            if (data.shopify_product_id) {
                const { data: integration } = await supabaseAdmin
                    .from('shopify_integrations')
                    .select('*')
                    .eq('store_id', req.storeId)
                    .eq('status', 'active')
                    .maybeSingle();

                if (integration) {
                    try {
                        const syncService = new ShopifyProductSyncService(supabaseAdmin, integration);
                        const syncResult = await syncService.updateProductInShopify(data.id);

                        if (!syncResult.success) {
                            console.warn(`Stock updated locally but sync to Shopify failed: ${syncResult.error}`);
                        } else {
                            console.log(`Stock for product ${data.id} successfully synced to Shopify`);
                        }
                    } catch (syncError: any) {
                        console.error('Error syncing stock to Shopify:', syncError);
                    }
                }
            }

            return res.json({
                message: 'Stock updated successfully',
                data
            });
        }

        // For 'set' operation
        const { data, error } = await supabaseAdmin
            .from('products')
            .update({
                stock: parseInt(stock),
                updated_at: new Date().toISOString()
            })
            .eq('id', id)
            .eq('store_id', req.storeId)
            .select()
            .single();

        if (error || !data) {
            return res.status(404).json({
                error: 'Product not found'
            });
        }

        // Auto-sync to Shopify if integration exists and product has shopify_product_id
        if (data.shopify_product_id) {
            const { data: integration } = await supabaseAdmin
                .from('shopify_integrations')
                .select('*')
                .eq('store_id', req.storeId)
                .eq('status', 'active')
                .maybeSingle();

            if (integration) {
                try {
                    const syncService = new ShopifyProductSyncService(supabaseAdmin, integration);
                    const syncResult = await syncService.updateProductInShopify(data.id);

                    if (!syncResult.success) {
                        console.warn(`Stock updated locally but sync to Shopify failed: ${syncResult.error}`);
                    } else {
                        console.log(`Stock for product ${data.id} successfully synced to Shopify`);
                    }
                } catch (syncError: any) {
                    console.error('Error syncing stock to Shopify:', syncError);
                }
            }
        }

        res.json({
            message: 'Stock updated successfully',
            data
        });
    } catch (error: any) {
        console.error(`[PATCH /api/products/${req.params.id}/stock] Error:`, error);
        res.status(500).json({
            error: 'Failed to update stock',
            message: error.message
        });
    }
});

// ================================================================
// DELETE /api/products/:id - Delete product (soft delete recommended)
// ================================================================
productsRouter.delete('/:id', async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { hard_delete = 'false' } = req.query;

        if (hard_delete === 'true') {
            // Check if product has Shopify integration first
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
                    .select('*')
                    .eq('store_id', req.storeId)
                    .eq('status', 'active')
                    .maybeSingle();

                if (integration) {
                    try {
                        const syncService = new ShopifyProductSyncService(supabaseAdmin, integration);
                        const syncResult = await syncService.deleteProductFromShopify(id);

                        if (!syncResult.success) {
                            console.warn(`Product delete failed on Shopify: ${syncResult.error}`);
                            return res.status(500).json({
                                error: 'Failed to delete product from Shopify',
                                details: syncResult.error
                            });
                        }

                        console.log(`Product ${id} successfully deleted from Shopify and locally`);
                        return res.json({
                            message: 'Product deleted from Shopify and locally',
                            id
                        });
                    } catch (syncError: any) {
                        console.error('Error deleting from Shopify:', syncError);
                        return res.status(500).json({
                            error: 'Failed to delete product from Shopify',
                            details: syncError.message
                        });
                    }
                }
            }

            // Hard delete (no Shopify integration or no shopify_product_id)
            const { data, error } = await supabaseAdmin
                .from('products')
                .delete()
                .eq('id', id)
                .eq('store_id', req.storeId)
                .select('id')
                .single();

            if (error || !data) {
                return res.status(404).json({
                    error: 'Product not found'
                });
            }

            return res.json({
                message: 'Product deleted permanently',
                id: data.id
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
                    error: 'Product not found'
                });
            }

            return res.json({
                message: 'Product deactivated successfully',
                id: data.id
            });
        }
    } catch (error: any) {
        console.error(`[DELETE /api/products/${req.params.id}] Error:`, error);
        res.status(500).json({
            error: 'Failed to delete product',
            message: error.message
        });
    }
});

// ================================================================
// POST /api/products/:id/publish-to-shopify - Publish product to Shopify
// ================================================================
productsRouter.post('/:id/publish-to-shopify', async (req: AuthRequest, res: Response) => {
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
            .select('*')
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

        // Obtener producto actualizado
        const { data: updatedProduct } = await supabaseAdmin
            .from('products')
            .select('*')
            .eq('id', id)
            .single();

        res.json({
            message: 'Producto publicado exitosamente en Shopify',
            data: updatedProduct
        });

    } catch (error: any) {
        console.error(`[POST /api/products/${req.params.id}/publish-to-shopify] Error:`, error);
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
        console.error('[GET /api/products/stats/inventory] Error:', error);
        res.status(500).json({
            error: 'Failed to fetch inventory stats',
            message: error.message
        });
    }
});

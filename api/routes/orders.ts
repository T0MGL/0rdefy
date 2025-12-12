// ================================================================
// NEONFLOW API - ORDERS ROUTES
// ================================================================
// CRUD operations for orders with WhatsApp confirmation tracking
// MVP: Uses hardcoded store_id, no authentication
// Uses Supabase JS client for database operations
// ================================================================

import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../db/connection';
import { verifyToken, extractStoreId, AuthRequest } from '../middleware/auth';
import { generateDeliveryQRCode } from '../utils/qr-generator';

export const ordersRouter = Router();

// ================================================================
// PUBLIC ENDPOINTS (No authentication required)
// ================================================================

// GET /api/orders/token/:token - Get order by delivery token (public)
// This endpoint is accessible without auth for courier delivery confirmation
ordersRouter.get('/token/:token', async (req: Request, res: Response) => {
    try {
        const { token } = req.params;

        console.log(`🔍 [ORDERS] Looking up order by token ${token}`);

        const { data, error } = await supabaseAdmin
            .from('orders')
            .select(`
                *,
                customers!orders_customer_id_fkey (
                    first_name,
                    last_name,
                    phone
                ),
                carriers!orders_courier_id_fkey (
                    name,
                    phone
                )
            `)
            .eq('delivery_link_token', token)
            .single();

        if (error || !data) {
            console.error(`❌ [ORDERS] Token lookup failed:`, error);
            return res.status(404).json({
                error: 'Order not found',
                message: 'El código QR no es válido o el pedido no existe'
            });
        }

        console.log(`✅ [ORDERS] Found order ${data.id} for token ${token}`);

        // Check if order is already delivered
        if (data.delivery_status === 'confirmed' || data.sleeves_status === 'delivered') {
            return res.json({
                already_delivered: true,
                message: '¡Este pedido fue entregado! Gracias por tu compra',
                delivered_at: data.delivered_at,
                already_rated: !!data.delivery_rating,
                rating: data.delivery_rating,
                rating_comment: data.delivery_rating_comment,
                data: {
                    id: data.id,
                    carrier_name: data.carriers?.name || 'Repartidor',
                    store_id: data.store_id
                }
            });
        }

        // Check if order has incident - treat as pending with incident flag
        // This allows the courier to complete retry attempts
        if (data.sleeves_status === 'incident' || data.has_active_incident) {
            console.log(`⚠️ [ORDERS] Order ${data.id} has active incident - showing pending with incident info`);
            // Continue to return as pending delivery, the frontend will check for incident
        }

        // Check if delivery failed (but not incident - those are handled above)
        if ((data.delivery_status === 'failed' || data.sleeves_status === 'not_delivered') && data.sleeves_status !== 'incident') {
            return res.json({
                delivery_failed: true,
                message: 'Este pedido no pudo ser entregado',
                failure_reason: data.delivery_failure_reason,
                data: {
                    id: data.id,
                    customer_name: `${data.customer_first_name || ''} ${data.customer_last_name || ''}`.trim(),
                    customer_phone: data.customer_phone,
                    customer_address: data.customer_address,
                    store_id: data.store_id
                }
            });
        }

        // Return delivery information for pending deliveries (including incidents)
        const deliveryInfo = {
            id: data.id,
            customer_name: `${data.customer_first_name || ''} ${data.customer_last_name || ''}`.trim(),
            customer_phone: data.customer_phone,
            customer_address: data.customer_address,
            address_reference: data.address_reference,
            latitude: data.latitude,
            longitude: data.longitude,
            google_maps_link: data.google_maps_link,
            total_price: data.total_price,
            cod_amount: data.cod_amount || 0,
            payment_method: data.payment_method,
            line_items: data.line_items,
            delivery_status: data.delivery_status,
            sleeves_status: data.sleeves_status,
            has_active_incident: data.has_active_incident || false,
            carrier_name: data.carriers?.name,
            store_id: data.store_id
        };

        res.json({
            already_delivered: false,
            delivery_failed: false,
            data: deliveryInfo
        });
    } catch (error: any) {
        console.error(`[GET /api/orders/token/${req.params.token}] Error:`, error);
        res.status(500).json({
            error: 'Failed to fetch order',
            message: error.message
        });
    }
});

// POST /api/orders/:id/delivery-confirm - Courier confirms delivery (public)
// This endpoint is accessible without auth for courier delivery confirmation
ordersRouter.post('/:id/delivery-confirm', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { proof_photo_url, payment_method, notes } = req.body;

        console.log(`✅ [ORDERS] Courier confirming delivery for order ${id}`, {
            payment_method,
            has_notes: !!notes,
            has_photo: !!proof_photo_url
        });

        // First, get the order to verify it exists and get its store_id
        const { data: existingOrder, error: fetchError } = await supabaseAdmin
            .from('orders')
            .select('id, store_id, sleeves_status, courier_id, has_active_incident')
            .eq('id', id)
            .single();

        if (fetchError || !existingOrder) {
            console.error(`❌ [ORDERS] Order ${id} not found`);
            return res.status(404).json({
                error: 'Order not found',
                message: 'El pedido no existe'
            });
        }

        // Check if order has an active incident
        if (existingOrder.has_active_incident) {
            console.warn(`⚠️ [ORDERS] Order ${id} has an active incident - delivery must be confirmed through incident retry`);
            return res.status(400).json({
                error: 'Active incident',
                message: 'Este pedido tiene una incidencia activa. Debes completar uno de los intentos programados en lugar de confirmar directamente.'
            });
        }

        const updateData: any = {
            sleeves_status: 'delivered',
            delivery_status: 'confirmed',
            delivered_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
            // Note: Token is NOT deleted immediately to allow success page to display
            // Token should be cleaned up later via scheduled job (after 24-48 hours)
        };

        if (proof_photo_url) {
            updateData.proof_photo_url = proof_photo_url;
        }

        if (payment_method) {
            updateData.payment_method = payment_method;
        }

        if (notes) {
            updateData.courier_notes = notes;
        }

        const { data, error } = await supabaseAdmin
            .from('orders')
            .update(updateData)
            .eq('id', id)
            .select()
            .single();

        if (error || !data) {
            console.error(`❌ [ORDERS] Failed to update order ${id}:`, error);
            return res.status(500).json({
                error: 'Failed to update order'
            });
        }

        // Create delivery attempt record
        const { data: existingAttempts } = await supabaseAdmin
            .from('delivery_attempts')
            .select('attempt_number')
            .eq('order_id', id)
            .order('attempt_number', { ascending: false })
            .limit(1);

        const attempt_number = existingAttempts && existingAttempts.length > 0
            ? existingAttempts[0].attempt_number + 1
            : 1;

        await supabaseAdmin
            .from('delivery_attempts')
            .insert({
                order_id: id,
                store_id: existingOrder.store_id,
                carrier_id: existingOrder.courier_id,
                attempt_number,
                scheduled_date: new Date().toISOString().split('T')[0],
                actual_date: new Date().toISOString().split('T')[0],
                status: 'delivered',
                payment_method: payment_method || null,
                notes: notes || null,
                photo_url: proof_photo_url || null
            });

        // Log status change
        await supabaseAdmin
            .from('order_status_history')
            .insert({
                order_id: id,
                store_id: existingOrder.store_id,
                previous_status: existingOrder.sleeves_status || 'confirmed',
                new_status: 'delivered',
                changed_by: 'courier',
                change_source: 'delivery_app',
                notes: `Delivery confirmed by courier${payment_method ? ` - Payment: ${payment_method}` : ''}${notes ? ` - Notes: ${notes}` : ''}`
            });

        console.log(`✅ [ORDERS] Order ${id} marked as delivered with full data sync`);

        res.json({
            message: 'Delivery confirmed successfully',
            data
        });
    } catch (error: any) {
        console.error(`[POST /api/orders/${req.params.id}/delivery-confirm] Error:`, error);
        res.status(500).json({
            error: 'Failed to confirm delivery',
            message: error.message
        });
    }
});

// POST /api/orders/:id/delivery-fail - Courier reports failed delivery (public)
// This endpoint is accessible without auth for courier delivery confirmation
ordersRouter.post('/:id/delivery-fail', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { delivery_failure_reason, failure_notes } = req.body;

        if (!delivery_failure_reason) {
            return res.status(400).json({
                error: 'Validation failed',
                message: 'delivery_failure_reason is required'
            });
        }

        console.log(`❌ [ORDERS] Courier reporting failed delivery for order ${id}`, {
            reason: delivery_failure_reason,
            has_notes: !!failure_notes
        });

        // First, get the order to verify it exists and get its store_id
        const { data: existingOrder, error: fetchError } = await supabaseAdmin
            .from('orders')
            .select('id, store_id, sleeves_status, courier_id, has_active_incident')
            .eq('id', id)
            .single();

        if (fetchError || !existingOrder) {
            console.error(`❌ [ORDERS] Order ${id} not found`);
            return res.status(404).json({
                error: 'Order not found',
                message: 'El pedido no existe'
            });
        }

        // Check if order has an active incident
        if (existingOrder.has_active_incident) {
            console.warn(`⚠️ [ORDERS] Order ${id} has an active incident - failure must be reported through incident retry`);
            return res.status(400).json({
                error: 'Active incident',
                message: 'Este pedido tiene una incidencia activa. Debes completar uno de los intentos programados en lugar de reportar directamente.'
            });
        }

        const updateData: any = {
            sleeves_status: 'incident', // Changed to 'incident' to flag for manual review
            delivery_status: 'failed',
            delivery_failure_reason,
            updated_at: new Date().toISOString()
            // Note: Token is NOT deleted immediately to allow failure page to display
            // Token should be cleaned up later via scheduled job (after 24-48 hours)
        };

        if (failure_notes) {
            updateData.courier_notes = failure_notes;
        }

        const { data, error } = await supabaseAdmin
            .from('orders')
            .update(updateData)
            .eq('id', id)
            .select()
            .single();

        if (error || !data) {
            console.error(`❌ [ORDERS] Failed to update order ${id}:`, error);
            return res.status(500).json({
                error: 'Failed to update order'
            });
        }

        // Create delivery attempt record
        const { data: existingAttempts } = await supabaseAdmin
            .from('delivery_attempts')
            .select('attempt_number')
            .eq('order_id', id)
            .order('attempt_number', { ascending: false })
            .limit(1);

        const attempt_number = existingAttempts && existingAttempts.length > 0
            ? existingAttempts[0].attempt_number + 1
            : 1;

        await supabaseAdmin
            .from('delivery_attempts')
            .insert({
                order_id: id,
                store_id: existingOrder.store_id,
                carrier_id: existingOrder.courier_id,
                attempt_number,
                scheduled_date: new Date().toISOString().split('T')[0],
                actual_date: new Date().toISOString().split('T')[0],
                status: 'failed',
                failed_reason: delivery_failure_reason,
                failure_notes: failure_notes || null
            });

        // Log status change
        await supabaseAdmin
            .from('order_status_history')
            .insert({
                order_id: id,
                store_id: existingOrder.store_id,
                previous_status: existingOrder.sleeves_status || 'confirmed',
                new_status: 'incident',
                changed_by: 'courier',
                change_source: 'delivery_app',
                notes: `Delivery failed: ${delivery_failure_reason}${failure_notes ? ` - Additional notes: ${failure_notes}` : ''}`
            });

        console.log(`✅ [ORDERS] Order ${id} marked as incident with full data sync`);

        res.json({
            message: 'Delivery failure reported',
            data
        });
    } catch (error: any) {
        console.error(`[POST /api/orders/${req.params.id}/delivery-fail] Error:`, error);
        res.status(500).json({
            error: 'Failed to report delivery failure',
            message: error.message
        });
    }
});

// POST /api/orders/:id/rate-delivery - Customer rates delivery (public)
// This endpoint is accessible without auth for customer feedback
ordersRouter.post('/:id/rate-delivery', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { rating, comment } = req.body;

        // Validate rating
        if (!rating || rating < 1 || rating > 5) {
            return res.status(400).json({
                error: 'Validation failed',
                message: 'Rating must be between 1 and 5'
            });
        }

        console.log(`⭐ [ORDERS] Customer rating delivery for order ${id}: ${rating} stars`);

        // Get the order to verify it's delivered
        const { data: existingOrder, error: fetchError } = await supabaseAdmin
            .from('orders')
            .select('id, store_id, delivery_status, courier_id, delivery_rating')
            .eq('id', id)
            .single();

        if (fetchError || !existingOrder) {
            console.error(`❌ [ORDERS] Order ${id} not found`);
            return res.status(404).json({
                error: 'Order not found',
                message: 'El pedido no existe'
            });
        }

        // Check if order is delivered
        if (existingOrder.delivery_status !== 'confirmed') {
            return res.status(400).json({
                error: 'Order not delivered',
                message: 'Solo puedes calificar pedidos que ya fueron entregados'
            });
        }

        // Check if already rated
        if (existingOrder.delivery_rating) {
            return res.status(400).json({
                error: 'Already rated',
                message: 'Este pedido ya fue calificado'
            });
        }

        const updateData: any = {
            delivery_rating: rating,
            delivery_rating_comment: comment || null,
            rated_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            delivery_link_token: null, // DELETE TOKEN after rating
            qr_code_url: null // DELETE QR after rating
        };

        const { data, error } = await supabaseAdmin
            .from('orders')
            .update(updateData)
            .eq('id', id)
            .select()
            .single();

        if (error || !data) {
            console.error(`❌ [ORDERS] Failed to update order ${id}:`, error);
            return res.status(500).json({
                error: 'Failed to save rating'
            });
        }

        console.log(`✅ [ORDERS] Order ${id} rated with ${rating} stars, token deleted`);

        res.json({
            message: 'Gracias por tu calificación',
            data: {
                rating: data.delivery_rating,
                comment: data.delivery_rating_comment,
                rated_at: data.rated_at
            }
        });
    } catch (error: any) {
        console.error(`[POST /api/orders/${req.params.id}/rate-delivery] Error:`, error);
        res.status(500).json({
            error: 'Failed to save rating',
            message: error.message
        });
    }
});

// POST /api/orders/:id/cancel - Cancel order after failed delivery (public)
// This endpoint is accessible without auth for courier/customer to cancel after retry decision
ordersRouter.post('/:id/cancel', async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        console.log(`🚫 [ORDERS] Cancelling order ${id} after failed delivery`);

        // First, get the order to verify it exists
        const { data: existingOrder, error: fetchError } = await supabaseAdmin
            .from('orders')
            .select('id, store_id, sleeves_status, delivery_status')
            .eq('id', id)
            .single();

        if (fetchError || !existingOrder) {
            console.error(`❌ [ORDERS] Order ${id} not found`);
            return res.status(404).json({
                error: 'Order not found',
                message: 'El pedido no existe'
            });
        }

        // Only allow cancellation if delivery failed
        if (existingOrder.delivery_status !== 'failed' && existingOrder.sleeves_status !== 'not_delivered') {
            return res.status(400).json({
                error: 'Cannot cancel',
                message: 'Solo se pueden cancelar pedidos con entrega fallida'
            });
        }

        const { data, error } = await supabaseAdmin
            .from('orders')
            .update({
                sleeves_status: 'cancelled',
                cancelled_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                delivery_link_token: null, // Delete token
                qr_code_url: null // Delete QR
            })
            .eq('id', id)
            .select()
            .single();

        if (error || !data) {
            console.error(`❌ [ORDERS] Failed to cancel order ${id}:`, error);
            return res.status(500).json({
                error: 'Failed to cancel order'
            });
        }

        // Log status change
        await supabaseAdmin
            .from('order_status_history')
            .insert({
                order_id: id,
                store_id: existingOrder.store_id,
                previous_status: existingOrder.sleeves_status || 'not_delivered',
                new_status: 'cancelled',
                changed_by: 'customer',
                change_source: 'delivery_app',
                notes: 'Order cancelled after failed delivery'
            });

        console.log(`✅ [ORDERS] Order ${id} cancelled`);

        res.json({
            message: 'Order cancelled successfully',
            data
        });
    } catch (error: any) {
        console.error(`[POST /api/orders/${req.params.id}/cancel] Error:`, error);
        res.status(500).json({
            error: 'Failed to cancel order',
            message: error.message
        });
    }
});

// ================================================================
// AUTHENTICATED ENDPOINTS (Require auth token)
// ================================================================

ordersRouter.use(verifyToken, extractStoreId);

// Using req.storeId from middleware

// Helper function to map database status to frontend status
function mapStatus(dbStatus: string): 'pending' | 'confirmed' | 'in_transit' | 'delivered' | 'cancelled' {
    const statusMap: Record<string, 'pending' | 'confirmed' | 'in_transit' | 'delivered' | 'cancelled'> = {
        'pending': 'pending',
        'confirmed': 'confirmed',
        'shipped': 'in_transit',
        'delivered': 'delivered',
        'cancelled': 'cancelled',
        'rejected': 'cancelled'
    };
    return statusMap[dbStatus] || 'pending';
}

// ================================================================
// GET /api/orders - List all orders
// ================================================================
ordersRouter.get('/', async (req: AuthRequest, res: Response) => {
    try {
        const {
            status,
            limit = '50',
            offset = '0',
            customer_phone,
            shopify_order_id,
            startDate,
            endDate
        } = req.query;

        // Build query
        let query = supabaseAdmin
            .from('orders')
            .select(`
                *,
                customers!orders_customer_id_fkey (
                    first_name,
                    last_name,
                    total_orders
                ),
                order_line_items (
                    id,
                    product_id,
                    product_name,
                    variant_title,
                    sku,
                    quantity,
                    unit_price,
                    total_price,
                    shopify_product_id,
                    shopify_variant_id
                ),
                carriers!orders_courier_id_fkey (
                    id,
                    name
                )
            `, { count: 'exact' })
            .eq('store_id', req.storeId)
            .order('created_at', { ascending: false })
            .range(parseInt(offset as string), parseInt(offset as string) + parseInt(limit as string) - 1);

        if (status) {
            query = query.eq('sleeves_status', status);
        }

        if (customer_phone) {
            query = query.eq('customer_phone', customer_phone);
        }

        if (shopify_order_id) {
            query = query.eq('shopify_order_id', shopify_order_id);
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
            throw error;
        }

        // Transform data to match frontend Order interface
        const transformedData = data?.map(order => {
            // Use normalized line items if available, fallback to JSONB
            const normalizedItems = order.order_line_items || [];
            const jsonbItems = order.line_items || [];

            let lineItems = normalizedItems;
            if (normalizedItems.length === 0 && Array.isArray(jsonbItems)) {
                // Fallback to JSONB format for backwards compatibility
                lineItems = jsonbItems.map((item: any) => ({
                    product_name: item.name || item.title || 'Producto',
                    quantity: item.quantity || 1,
                    unit_price: parseFloat(item.price) || 0,
                    total_price: (item.quantity || 1) * parseFloat(item.price || 0)
                }));
            }

            // Calculate total quantity from all line items
            const totalQuantity = lineItems.reduce((sum: number, item: any) => sum + (item.quantity || 0), 0);

            // Get product name(s) - show first product or multiple indicator
            const productDisplay = lineItems.length > 0
                ? lineItems.length === 1
                    ? lineItems[0].product_name
                    : `${lineItems[0].product_name} (+${lineItems.length - 1} más)`
                : 'Producto';

            return {
                id: order.id,
                customer: `${order.customer_first_name || ''} ${order.customer_last_name || ''}`.trim() || 'Cliente',
                address: order.customer_address || '',
                product: productDisplay,
                quantity: totalQuantity || 1,
                total: order.total_price || 0,
                status: mapStatus(order.sleeves_status),
                payment_status: order.payment_status,
                carrier: order.carriers?.name || 'Sin transportadora',
                date: order.created_at,
                phone: order.customer_phone || '',
                confirmedByWhatsApp: order.sleeves_status === 'confirmed' || order.sleeves_status === 'shipped' || order.sleeves_status === 'delivered',
                confirmationTimestamp: order.confirmed_at,
                confirmationMethod: order.confirmation_method as any,
                rejectionReason: order.rejection_reason,
                delivery_link_token: order.delivery_link_token,
                latitude: order.latitude,
                longitude: order.longitude,
                google_maps_link: order.google_maps_link,
                line_items: lineItems  // Include all line items
            };
        }) || [];

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
        console.error('[GET /api/orders] Error:', error);
        res.status(500).json({
            error: 'Failed to fetch orders',
            message: error.message
        });
    }
});

// ================================================================
// GET /api/orders/:id - Get single order
// ================================================================
ordersRouter.get('/:id', async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;

        const { data, error } = await supabaseAdmin
            .from('orders')
            .select(`
                *,
                customers!orders_customer_id_fkey (
                    first_name,
                    last_name,
                    email,
                    total_orders,
                    total_spent
                ),
                order_line_items (
                    id,
                    product_id,
                    product_name,
                    variant_title,
                    sku,
                    quantity,
                    unit_price,
                    total_price,
                    discount_amount,
                    tax_amount,
                    shopify_product_id,
                    shopify_variant_id,
                    properties
                ),
                carriers!orders_courier_id_fkey (
                    id,
                    name
                )
            `)
            .eq('id', id)
            .eq('store_id', req.storeId)
            .single();

        if (error || !data) {
            return res.status(404).json({
                error: 'Order not found'
            });
        }

        // Transform data to match frontend Order interface
        // Use normalized line items if available, fallback to JSONB
        const normalizedItems = data.order_line_items || [];
        const jsonbItems = data.line_items || [];

        let lineItems = normalizedItems;
        if (normalizedItems.length === 0 && Array.isArray(jsonbItems)) {
            // Fallback to JSONB format for backwards compatibility
            lineItems = jsonbItems.map((item: any) => ({
                product_name: item.name || item.title || 'Producto',
                variant_title: item.variant_title,
                sku: item.sku,
                quantity: item.quantity || 1,
                unit_price: parseFloat(item.price) || 0,
                total_price: (item.quantity || 1) * parseFloat(item.price || 0),
                shopify_product_id: item.product_id,
                shopify_variant_id: item.variant_id
            }));
        }

        // Calculate total quantity from all line items
        const totalQuantity = lineItems.reduce((sum: number, item: any) => sum + (item.quantity || 0), 0);

        // Get product name(s) - show first product or multiple indicator
        const productDisplay = lineItems.length > 0
            ? lineItems.length === 1
                ? lineItems[0].product_name
                : `${lineItems[0].product_name} (+${lineItems.length - 1} más)`
            : 'Producto';

        const transformedData = {
            id: data.id,
            customer: `${data.customer_first_name || ''} ${data.customer_last_name || ''}`.trim() || 'Cliente',
            address: data.customer_address || '',
            product: productDisplay,
            quantity: totalQuantity || 1,
            total: data.total_price || 0,
            status: mapStatus(data.sleeves_status),
            payment_status: data.payment_status,
            carrier: data.carriers?.name || 'Sin transportadora',
            date: data.created_at,
            phone: data.customer_phone || '',
            confirmedByWhatsApp: data.sleeves_status === 'confirmed' || data.sleeves_status === 'shipped' || data.sleeves_status === 'delivered',
            confirmationTimestamp: data.confirmed_at,
            confirmationMethod: data.confirmation_method as any,
            rejectionReason: data.rejection_reason,
            delivery_link_token: data.delivery_link_token,
            latitude: data.latitude,
            longitude: data.longitude,
            line_items: lineItems,  // Include all line items with full details
            shopify_order_id: data.shopify_order_id,
            shopify_order_number: data.shopify_order_number
        };

        res.json(transformedData);
    } catch (error: any) {
        console.error(`[GET /api/orders/${req.params.id}] Error:`, error);
        res.status(500).json({
            error: 'Failed to fetch order',
            message: error.message
        });
    }
});

// ================================================================
// POST /api/orders - Create new order
// ================================================================
ordersRouter.post('/', async (req: AuthRequest, res: Response) => {
    try {
        const {
            shopify_order_id,
            shopify_order_number,
            customer_email,
            customer_phone,
            customer_first_name,
            customer_last_name,
            customer_address,
            billing_address,
            shipping_address,
            line_items,
            total_price,
            subtotal_price,
            total_tax,
            total_shipping,
            shipping_cost,
            currency = 'USD',
            financial_status,
            payment_status,
            courier_id,
            payment_method,
            shopify_raw_json
        } = req.body;

        // Validation
        if (!customer_phone && !customer_email) {
            return res.status(400).json({
                error: 'Validation failed',
                message: 'Either customer_phone or customer_email is required'
            });
        }

        console.log('🚀 [ORDERS] Creating order:', {
            customer_first_name,
            customer_last_name,
            customer_phone,
            courier_id,
            payment_method,
            payment_status,
            line_items
        });

        const { data, error } = await supabaseAdmin
            .from('orders')
            .insert([{
                store_id: req.storeId,
                shopify_order_id,
                shopify_order_number,
                customer_email,
                customer_phone,
                customer_first_name,
                customer_last_name,
                customer_address,
                billing_address,
                shipping_address,
                line_items,
                total_price,
                subtotal_price,
                total_tax: total_tax ?? 0.0,
                total_shipping: total_shipping ?? 0.0,
                shipping_cost: shipping_cost ?? 0.0,
                currency,
                financial_status: financial_status || 'pending',
                payment_status: payment_status || 'pending',
                payment_method: payment_method || 'cash',
                courier_id,
                sleeves_status: 'pending',
                shopify_raw_json: shopify_raw_json || {}
            }])
            .select()
            .single();

        if (error) {
            console.error('❌ [ORDERS] Database error:', error);
            throw error;
        }

        console.log('✅ [ORDERS] Order created successfully:', data.id);

        res.status(201).json({
            message: 'Order created successfully',
            data
        });
    } catch (error: any) {
        console.error('[POST /api/orders] Error:', error);
        res.status(500).json({
            error: 'Failed to create order',
            message: error.message
        });
    }
});

// ================================================================
// PUT /api/orders/:id - Update order
// ================================================================
ordersRouter.put('/:id', async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const {
            customer_email,
            customer_phone,
            customer_first_name,
            customer_last_name,
            customer_address,
            billing_address,
            shipping_address,
            line_items,
            total_price,
            subtotal_price,
            total_tax,
            total_shipping,
            shipping_cost,
            currency,
            upsell_added
        } = req.body;

        // Build update object with only provided fields
        const updateData: any = {
            updated_at: new Date().toISOString()
        };

        if (customer_email !== undefined) updateData.customer_email = customer_email;
        if (customer_phone !== undefined) updateData.customer_phone = customer_phone;
        if (customer_first_name !== undefined) updateData.customer_first_name = customer_first_name;
        if (customer_last_name !== undefined) updateData.customer_last_name = customer_last_name;
        if (customer_address !== undefined) updateData.customer_address = customer_address;
        if (billing_address !== undefined) updateData.billing_address = billing_address;
        if (shipping_address !== undefined) updateData.shipping_address = shipping_address;
        if (line_items !== undefined) updateData.line_items = line_items;
        if (total_price !== undefined) updateData.total_price = total_price;
        if (subtotal_price !== undefined) updateData.subtotal_price = subtotal_price;
        if (total_tax !== undefined) updateData.total_tax = total_tax;
        if (total_shipping !== undefined) updateData.total_shipping = total_shipping;
        if (shipping_cost !== undefined) updateData.shipping_cost = shipping_cost;
        if (currency !== undefined) updateData.currency = currency;
        if (upsell_added !== undefined) updateData.upsell_added = upsell_added;

        const { data, error } = await supabaseAdmin
            .from('orders')
            .update(updateData)
            .eq('id', id)
            .eq('store_id', req.storeId)
            .select(`
                *,
                carriers!orders_courier_id_fkey (
                    id,
                    name
                )
            `)
            .single();

        if (error || !data) {
            return res.status(404).json({
                error: 'Order not found'
            });
        }

        // Transform response to match frontend format
        const lineItems = data.line_items || [];
        const firstItem = Array.isArray(lineItems) && lineItems.length > 0 ? lineItems[0] : null;

        const transformedData = {
            id: data.id,
            customer: `${data.customer_first_name || ''} ${data.customer_last_name || ''}`.trim() || 'Cliente',
            address: data.customer_address || '',
            product: firstItem?.product_name || firstItem?.title || 'Producto',
            quantity: firstItem?.quantity || 1,
            total: data.total_price || 0,
            status: mapStatus(data.sleeves_status),
            payment_status: data.payment_status,
            carrier: data.carriers?.name || 'Sin transportadora',
            date: data.created_at,
            phone: data.customer_phone || '',
            confirmedByWhatsApp: data.sleeves_status === 'confirmed' || data.sleeves_status === 'shipped' || data.sleeves_status === 'delivered',
            confirmationTimestamp: data.confirmed_at,
            confirmationMethod: data.confirmation_method as any,
            rejectionReason: data.rejection_reason,
            delivery_link_token: data.delivery_link_token,
            latitude: data.latitude,
            longitude: data.longitude
        };

        res.json(transformedData);
    } catch (error: any) {
        console.error(`[PUT /api/orders/${req.params.id}] Error:`, error);
        res.status(500).json({
            error: 'Failed to update order',
            message: error.message
        });
    }
});

// ================================================================
// PATCH /api/orders/:id/status - Update order status
// ================================================================
ordersRouter.patch('/:id/status', async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const {
            sleeves_status,
            confirmed_by,
            confirmation_method,
            rejection_reason
        } = req.body;

        const validStatuses = ['pending', 'confirmed', 'in_preparation', 'ready_to_ship', 'in_transit', 'delivered', 'cancelled', 'rejected', 'returned', 'shipped'];
        if (!validStatuses.includes(sleeves_status)) {
            return res.status(400).json({
                error: 'Invalid status',
                message: `Status must be one of: ${validStatuses.join(', ')}`
            });
        }

        // Get current order status to check if reactivating from cancelled
        const { data: currentOrder, error: fetchError } = await supabaseAdmin
            .from('orders')
            .select('sleeves_status, delivery_link_token')
            .eq('id', id)
            .eq('store_id', req.storeId)
            .single();

        if (fetchError || !currentOrder) {
            return res.status(404).json({
                error: 'Order not found'
            });
        }

        const updateData: any = {
            sleeves_status,
            updated_at: new Date().toISOString()
        };

        if (sleeves_status === 'confirmed') {
            updateData.confirmed_at = new Date().toISOString();
            updateData.confirmed_by = confirmed_by || 'api';
            updateData.confirmation_method = confirmation_method || 'manual';

            // If reactivating from cancelled (token was deleted), allow trigger to regenerate token
            // The database trigger will automatically generate a new token when status is confirmed and token is null
        }

        if (sleeves_status === 'rejected' && rejection_reason) {
            updateData.rejection_reason = rejection_reason;
        }

        // Add timestamps for different status changes
        if (sleeves_status === 'in_transit' || sleeves_status === 'out_for_delivery') {
            updateData.in_transit_at = new Date().toISOString();
        }

        if (sleeves_status === 'delivered') {
            updateData.delivered_at = new Date().toISOString();
        }

        if (sleeves_status === 'cancelled' || sleeves_status === 'rejected') {
            updateData.cancelled_at = new Date().toISOString();
        }

        // If changing from cancelled to any deliverable status, reset delivery fields
        // This allows the token to be regenerated by the database trigger
        if (currentOrder.sleeves_status === 'cancelled' &&
            ['confirmed', 'prepared', 'delivered_to_courier', 'in_transit'].includes(sleeves_status)) {
            updateData.delivery_status = 'pending';
            updateData.delivery_failure_reason = null;
            updateData.cancelled_at = null;
            // Don't set delivery_link_token here - let the trigger handle it
        }

        const { data, error } = await supabaseAdmin
            .from('orders')
            .update(updateData)
            .eq('id', id)
            .eq('store_id', req.storeId)
            .select()
            .single();

        if (error || !data) {
            return res.status(404).json({
                error: 'Order not found'
            });
        }

        // If token was regenerated (reactivation from cancelled), generate new QR code
        if (data.delivery_link_token && !currentOrder.delivery_link_token) {
            try {
                const qrCodeDataUrl = await generateDeliveryQRCode(data.delivery_link_token);

                // Update order with new QR code
                const { data: updatedData } = await supabaseAdmin
                    .from('orders')
                    .update({ qr_code_url: qrCodeDataUrl })
                    .eq('id', id)
                    .select()
                    .single();

                if (updatedData) {
                    data.qr_code_url = updatedData.qr_code_url;
                }

                console.log(`✅ [ORDERS] Regenerated delivery token and QR for reactivated order ${id}`);
            } catch (qrError) {
                console.error(`❌ [ORDERS] Failed to generate QR code for reactivated order ${id}:`, qrError);
                // Continue anyway - QR can be regenerated later
            }
        }

        res.json({
            message: 'Order status updated successfully',
            data
        });
    } catch (error: any) {
        console.error(`[PATCH /api/orders/${req.params.id}/status] Error:`, error);
        res.status(500).json({
            error: 'Failed to update order status',
            message: error.message
        });
    }
});

// ================================================================
// GET /api/orders/:id/history - Get order status history
// ================================================================
ordersRouter.get('/:id/history', async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;

        const { data, error } = await supabaseAdmin
            .from('order_status_history')
            .select('*')
            .eq('order_id', id)
            .order('created_at', { ascending: false });

        if (error) {
            throw error;
        }

        res.json({
            data: data || []
        });
    } catch (error: any) {
        console.error(`[GET /api/orders/${req.params.id}/history] Error:`, error);
        res.status(500).json({
            error: 'Failed to fetch order history',
            message: error.message
        });
    }
});

// ================================================================
// DELETE /api/orders/:id - Delete order (soft delete in production)
// ================================================================
ordersRouter.delete('/:id', async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;

        // First, get the order to check if it has shopify_order_id
        const { data: order, error: fetchError } = await supabaseAdmin
            .from('orders')
            .select('id, shopify_order_id')
            .eq('id', id)
            .eq('store_id', req.storeId)
            .maybeSingle();

        if (fetchError || !order) {
            return res.status(404).json({
                error: 'Order not found'
            });
        }

        // If order has shopify_order_id, clean up idempotency records to allow re-sync
        if (order.shopify_order_id) {
            console.log(`🧹 Cleaning idempotency records for Shopify order ${order.shopify_order_id}`);

            // Delete from shopify_webhook_idempotency
            await supabaseAdmin
                .from('shopify_webhook_idempotency')
                .delete()
                .eq('shopify_event_id', order.shopify_order_id);

            // Delete from shopify_webhook_events
            await supabaseAdmin
                .from('shopify_webhook_events')
                .delete()
                .eq('shopify_event_id', order.shopify_order_id)
                .eq('store_id', req.storeId);

            console.log(`✅ Idempotency records cleaned for order ${order.shopify_order_id}`);
        }

        // Now delete the order
        const { data, error } = await supabaseAdmin
            .from('orders')
            .delete()
            .eq('id', id)
            .eq('store_id', req.storeId)
            .select('id')
            .single();

        if (error || !data) {
            return res.status(500).json({
                error: 'Failed to delete order'
            });
        }

        res.json({
            message: order.shopify_order_id
                ? 'Order deleted successfully. It can now be re-synced from Shopify if needed.'
                : 'Order deleted successfully',
            id: data.id
        });
    } catch (error: any) {
        console.error(`[DELETE /api/orders/${req.params.id}] Error:`, error);
        res.status(500).json({
            error: 'Failed to delete order',
            message: error.message
        });
    }
});

// ================================================================
// COD (CONTRA ENTREGA) SPECIFIC ENDPOINTS
// ================================================================

// ================================================================
// PUT /api/orders/:id/payment-status - Update payment status
// ================================================================
ordersRouter.put('/:id/payment-status', async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { payment_status } = req.body;

        if (!['pending', 'collected', 'failed'].includes(payment_status)) {
            return res.status(400).json({
                error: 'Invalid payment_status. Must be: pending, collected, or failed'
            });
        }

        console.log(`💰 [ORDERS] Updating payment status for order ${id} to ${payment_status}`);

        const { data, error } = await supabaseAdmin
            .from('orders')
            .update({
                payment_status,
                updated_at: new Date().toISOString()
            })
            .eq('id', id)
            .eq('store_id', req.storeId)
            .select()
            .single();

        if (error || !data) {
            return res.status(404).json({
                error: 'Order not found'
            });
        }

        res.json({
            message: 'Payment status updated',
            data
        });
    } catch (error: any) {
        console.error(`[PUT /api/orders/${req.params.id}/payment-status] Error:`, error);
        res.status(500).json({
            error: 'Failed to update payment status',
            message: error.message
        });
    }
});

// ================================================================
// POST /api/orders/:id/mark-preparing - Mark as preparing
// ================================================================
ordersRouter.post('/:id/mark-preparing', async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;

        console.log(`📦 [ORDERS] Marking order ${id} as preparing`);

        const { data, error } = await supabaseAdmin
            .from('orders')
            .update({
                status: 'preparing',
                updated_at: new Date().toISOString()
            })
            .eq('id', id)
            .eq('store_id', req.storeId)
            .select()
            .single();

        if (error || !data) {
            return res.status(404).json({
                error: 'Order not found'
            });
        }

        res.json({
            message: 'Order marked as preparing',
            data
        });
    } catch (error: any) {
        console.error(`[POST /api/orders/${req.params.id}/mark-preparing] Error:`, error);
        res.status(500).json({
            error: 'Failed to update order status',
            message: error.message
        });
    }
});

// ================================================================
// POST /api/orders/:id/mark-out-for-delivery - Mark as out for delivery
// ================================================================
ordersRouter.post('/:id/mark-out-for-delivery', async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { carrier_id, delivery_notes } = req.body;

        console.log(`🚚 [ORDERS] Marking order ${id} as out for delivery`);

        const updates: any = {
            status: 'out_for_delivery',
            updated_at: new Date().toISOString()
        };

        if (carrier_id) updates.carrier_id = carrier_id;
        if (delivery_notes) updates.delivery_notes = delivery_notes;

        const { data, error } = await supabaseAdmin
            .from('orders')
            .update(updates)
            .eq('id', id)
            .eq('store_id', req.storeId)
            .select()
            .single();

        if (error || !data) {
            return res.status(404).json({
                error: 'Order not found'
            });
        }

        res.json({
            message: 'Order marked as out for delivery',
            data
        });
    } catch (error: any) {
        console.error(`[POST /api/orders/${req.params.id}/mark-out-for-delivery] Error:`, error);
        res.status(500).json({
            error: 'Failed to update order status',
            message: error.message
        });
    }
});

// ================================================================
// POST /api/orders/:id/mark-delivered-paid - Mark as delivered and paid
// ================================================================
ordersRouter.post('/:id/mark-delivered-paid', async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { notes } = req.body;

        console.log(`✅ [ORDERS] Marking order ${id} as delivered and paid`);

        const updates: any = {
            status: 'delivered',
            payment_status: 'collected',
            updated_at: new Date().toISOString()
        };

        if (notes) updates.delivery_notes = notes;

        const { data, error } = await supabaseAdmin
            .from('orders')
            .update(updates)
            .eq('id', id)
            .eq('store_id', req.storeId)
            .select()
            .single();

        if (error || !data) {
            return res.status(404).json({
                error: 'Order not found'
            });
        }

        res.json({
            message: 'Order marked as delivered and paid',
            data
        });
    } catch (error: any) {
        console.error(`[POST /api/orders/${req.params.id}/mark-delivered-paid] Error:`, error);
        res.status(500).json({
            error: 'Failed to update order status',
            message: error.message
        });
    }
});

// ================================================================
// GET /api/orders/stats/high-risk - Get high risk orders
// ================================================================
ordersRouter.get('/stats/high-risk', async (req: AuthRequest, res: Response) => {
    try {
        const { threshold = '70' } = req.query;

        console.log(`⚠️ [ORDERS] Fetching high-risk orders (threshold: ${threshold})`);

        const { data, error } = await supabaseAdmin
            .from('orders')
            .select(`
                *,
                customers!orders_customer_id_fkey (
                    first_name,
                    last_name,
                    phone,
                    email
                )
            `)
            .eq('store_id', req.storeId)
            .gte('risk_score', parseInt(threshold as string))
            .order('risk_score', { ascending: false })
            .limit(50);

        if (error) {
            throw error;
        }

        res.json({
            data: data || [],
            count: data?.length || 0
        });
    } catch (error: any) {
        console.error('[GET /api/orders/stats/high-risk] Error:', error);
        res.status(500).json({
            error: 'Failed to fetch high-risk orders',
            message: error.message
        });
    }
});

// ================================================================
// GET /api/orders/stats/pending-delivery - Get orders ready for delivery
// ================================================================
ordersRouter.get('/stats/pending-delivery', async (req: AuthRequest, res: Response) => {
    try {
        console.log('🚚 [ORDERS] Fetching orders pending delivery');

        const { data, error } = await supabaseAdmin
            .from('orders')
            .select(`
                *,
                customers!orders_customer_id_fkey (
                    first_name,
                    last_name,
                    phone,
                    email
                ),
                carriers!orders_carrier_id_fkey (
                    name
                )
            `)
            .eq('store_id', req.storeId)
            .in('status', ['confirmed', 'preparing', 'out_for_delivery'])
            .order('created_at', { ascending: false });

        if (error) {
            throw error;
        }

        // Filter orders with location
        const ordersWithLocation = data?.filter(o => o.latitude && o.longitude) || [];
        const ordersWithoutLocation = data?.filter(o => !o.latitude || !o.longitude) || [];

        res.json({
            with_location: ordersWithLocation,
            without_location: ordersWithoutLocation,
            total: data?.length || 0,
            with_location_count: ordersWithLocation.length,
            without_location_count: ordersWithoutLocation.length
        });
    } catch (error: any) {
        console.error('[GET /api/orders/stats/pending-delivery] Error:', error);
        res.status(500).json({
            error: 'Failed to fetch pending delivery orders',
            message: error.message
        });
    }
});

// ================================================================
// NEW ORDER CONFIRMATION AND COURIER FLOW ENDPOINTS
// ================================================================

// ================================================================
// POST /api/orders/:id/confirm - Confirm order (Confirmador action)
// ================================================================
ordersRouter.post('/:id/confirm', async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const {
            upsell_added = false,
            courier_id,
            address,
            latitude,
            longitude
        } = req.body;

        console.log(`✅ [ORDERS] Confirming order ${id} with courier ${courier_id}`);

        // Validate courier_id is provided
        if (!courier_id) {
            return res.status(400).json({
                error: 'Validation failed',
                message: 'courier_id is required'
            });
        }

        // Verify courier exists and belongs to the store
        const { data: courier, error: carrierError } = await supabaseAdmin
            .from('carriers')
            .select('id, name')
            .eq('id', courier_id)
            .eq('store_id', req.storeId)
            .eq('is_active', true)
            .single();

        if (carrierError || !courier) {
            return res.status(404).json({
                error: 'Courier not found or inactive'
            });
        }

        // Update order
        const updateData: any = {
            sleeves_status: 'confirmed',
            confirmed_at: new Date().toISOString(),
            confirmed_by: req.userId || 'confirmador',
            confirmation_method: 'dashboard',
            courier_id,
            upsell_added,
            updated_at: new Date().toISOString()
        };

        // Update address/location if provided
        if (address) updateData.customer_address = address;
        if (latitude !== undefined) updateData.latitude = latitude;
        if (longitude !== undefined) updateData.longitude = longitude;

        const { data, error } = await supabaseAdmin
            .from('orders')
            .update(updateData)
            .eq('id', id)
            .eq('store_id', req.storeId)
            .select()
            .single();

        if (error || !data) {
            console.error('[ORDERS] Update error:', error);
            return res.status(404).json({
                error: 'Order not found'
            });
        }

        // Generate QR code for delivery link
        let qrCodeDataUrl = data.qr_code_url;
        if (data.delivery_link_token && !qrCodeDataUrl) {
            try {
                qrCodeDataUrl = await generateDeliveryQRCode(data.delivery_link_token);

                // Save QR code URL to database
                await supabaseAdmin
                    .from('orders')
                    .update({ qr_code_url: qrCodeDataUrl })
                    .eq('id', id);
            } catch (qrError) {
                console.error('[ORDERS] Failed to generate QR code:', qrError);
                // Continue without QR code, don't fail the confirmation
            }
        }

        // Log status change to history
        await supabaseAdmin
            .from('order_status_history')
            .insert({
                order_id: id,
                store_id: req.storeId,
                previous_status: 'pending_confirmation',
                new_status: 'confirmed',
                changed_by: req.userId || 'confirmador',
                change_source: 'dashboard',
                notes: upsell_added ? 'Order confirmed with upsell added' : 'Order confirmed'
            });

        res.json({
            message: 'Order confirmed successfully',
            data: {
                ...data,
                delivery_link: `${process.env.FRONTEND_URL || 'http://localhost:8080'}/delivery/${data.delivery_link_token}`,
                qr_code_url: qrCodeDataUrl
            }
        });
    } catch (error: any) {
        console.error(`[POST /api/orders/${req.params.id}/confirm] Error:`, error);
        res.status(500).json({
            error: 'Failed to confirm order',
            message: error.message
        });
    }
});

// ================================================================
// POST /api/orders/:id/mark-printed - Mark order label as printed
// ================================================================
ordersRouter.post('/:id/mark-printed', verifyToken, extractStoreId, async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const storeId = req.storeId;
        const userId = req.user?.email || req.user?.name || 'unknown';

        console.log(`🖨️ [ORDERS] Marking order ${id} as printed by ${userId}`);

        // Verify order exists and belongs to store
        const { data: existingOrder, error: fetchError } = await supabaseAdmin
            .from('orders')
            .select('id, printed, printed_at, sleeves_status')
            .eq('id', id)
            .eq('store_id', storeId)
            .single();

        if (fetchError || !existingOrder) {
            return res.status(404).json({
                error: 'Order not found',
                message: 'El pedido no existe o no pertenece a esta tienda'
            });
        }

        // Update order as printed (only if not already printed)
        const updateData: any = {
            printed: true,
            updated_at: new Date().toISOString()
        };

        // Set printed_at and printed_by only on first print
        if (!existingOrder.printed) {
            updateData.printed_at = new Date().toISOString();
            updateData.printed_by = userId;
        }

        // CRITICAL: Change order status to ready_to_ship when label is printed
        // This triggers the stock decrement via the inventory management trigger
        // Only change if order is in 'in_preparation' (packing complete)
        if (existingOrder.sleeves_status === 'in_preparation') {
            updateData.sleeves_status = 'ready_to_ship';
            console.log(`📦 [ORDERS] Changing order ${id} to ready_to_ship (label printed, stock will be decremented)`);
        }

        const { data: updatedOrder, error: updateError } = await supabaseAdmin
            .from('orders')
            .update(updateData)
            .eq('id', id)
            .eq('store_id', storeId)
            .select()
            .single();

        if (updateError) {
            throw updateError;
        }

        console.log(`✅ [ORDERS] Order ${id} marked as printed`);

        res.json({
            success: true,
            message: 'Pedido marcado como impreso',
            data: updatedOrder
        });
    } catch (error: any) {
        console.error('❌ [ORDERS] Error marking order as printed:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: error.message
        });
    }
});

// ================================================================
// POST /api/orders/mark-printed-bulk - Mark multiple orders as printed
// ================================================================
ordersRouter.post('/mark-printed-bulk', verifyToken, extractStoreId, async (req: AuthRequest, res: Response) => {
    try {
        const { order_ids } = req.body;
        const storeId = req.storeId;
        const userId = req.user?.email || req.user?.name || 'unknown';

        if (!Array.isArray(order_ids) || order_ids.length === 0) {
            return res.status(400).json({
                error: 'Validation failed',
                message: 'order_ids debe ser un array no vacío'
            });
        }

        console.log(`🖨️ [ORDERS] Bulk marking ${order_ids.length} orders as printed by ${userId}`);

        // Get all orders to check their current status
        const { data: existingOrders, error: fetchError } = await supabaseAdmin
            .from('orders')
            .select('id, printed, sleeves_status')
            .in('id', order_ids)
            .eq('store_id', storeId);

        if (fetchError) {
            throw fetchError;
        }

        // Process each order individually to handle status changes correctly
        const updatedOrders = [];
        for (const order of existingOrders || []) {
            const updateData: any = {
                printed: true,
                updated_at: new Date().toISOString()
            };

            // Set printed_at and printed_by only on first print
            if (!order.printed) {
                updateData.printed_at = new Date().toISOString();
                updateData.printed_by = userId;
            }

            // CRITICAL: Change to ready_to_ship if order is in in_preparation
            if (order.sleeves_status === 'in_preparation') {
                updateData.sleeves_status = 'ready_to_ship';
                console.log(`📦 [ORDERS] Changing order ${order.id} to ready_to_ship (label printed, stock will be decremented)`);
            }

            const { data: updated, error: updateError } = await supabaseAdmin
                .from('orders')
                .update(updateData)
                .eq('id', order.id)
                .eq('store_id', storeId)
                .select()
                .single();

            if (updateError) {
                console.error(`❌ [ORDERS] Error updating order ${order.id}:`, updateError);
            } else if (updated) {
                updatedOrders.push(updated);
            }
        }

        console.log(`✅ [ORDERS] ${updatedOrders.length} orders marked as printed`);

        res.json({
            success: true,
            message: `${updatedOrders?.length || 0} pedidos marcados como impresos`,
            data: updatedOrders
        });
    } catch (error: any) {
        console.error('❌ [ORDERS] Error in bulk mark printed:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: error.message
        });
    }
});

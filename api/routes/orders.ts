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
import { extractUserRole, requireModule, requirePermission, PermissionRequest } from '../middleware/permissions';
import { checkOrderLimit, PlanLimitRequest } from '../middleware/planLimits';
import { Module, Permission } from '../permissions';
import { generateDeliveryQRCode } from '../utils/qr-generator';
import { ShopifyGraphQLClientService } from '../services/shopify-graphql-client.service';
import { isValidUUID, validateUUIDParam } from '../utils/sanitize';

/**
 * Safely parse a number, returning 0 for invalid values.
 * Unlike parseFloat(x) || 0, this correctly handles:
 * - NaN values (parseFloat('invalid'))
 * - Infinity values
 * - Null/undefined
 * - Empty strings
 */
const safeNumber = (value: any, defaultValue: number = 0): number => {
    if (value === null || value === undefined || value === '') {
        return defaultValue;
    }
    const num = typeof value === 'number' ? value : parseFloat(value);
    if (Number.isNaN(num) || !Number.isFinite(num)) {
        return defaultValue;
    }
    return num;
};

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
            error: 'Error al obtener pedido',
            message: error.message
        });
    }
});

// POST /api/orders/token/:token/delivery-confirm - Courier confirms delivery (public)
// SECURITY: Uses delivery_link_token from URL - courier scans QR code
//
// PAYMENT TYPE LOGIC:
// - COD (efectivo): Courier collects money -> amount_collected = what they collected
// - PREPAID (tarjeta, qr, transferencia): Payment already received -> amount_collected = 0
//
// amount_collected is ONLY relevant for COD orders where courier physically collects cash
ordersRouter.post('/token/:token/delivery-confirm', async (req: Request, res: Response) => {
    try {
        const { token } = req.params;
        const { proof_photo_url, payment_method, notes, amount_collected, has_amount_discrepancy } = req.body;

        console.log(`✅ [ORDERS] Courier confirming delivery via token`);

        // SECURITY: Look up order by token - only valid tokens can access
        const { data: existingOrder, error: fetchError } = await supabaseAdmin
            .from('orders')
            .select('id, store_id, sleeves_status, courier_id, has_active_incident, cod_amount, total_price, payment_method')
            .eq('delivery_link_token', token)
            .single();

        if (fetchError || !existingOrder) {
            console.error(`❌ [ORDERS] Order not found for token`);
            return res.status(404).json({
                error: 'Order not found',
                message: 'Token de entrega inválido o expirado'
            });
        }

        const id = existingOrder.id;
        console.log(`✅ [ORDERS] Token validated for order ${id}`, {
            payment_method,
            original_payment_method: existingOrder.payment_method,
            has_notes: !!notes,
            has_photo: !!proof_photo_url,
            has_amount_discrepancy: !!has_amount_discrepancy,
            amount_collected: amount_collected || null
        });

        // Check if order has an active incident
        if (existingOrder.has_active_incident) {
            console.warn(`⚠️ [ORDERS] Order ${id} has an active incident - delivery must be confirmed through incident retry`);
            return res.status(400).json({
                error: 'Active incident',
                message: 'Este pedido tiene una incidencia activa. Debes completar uno de los intentos programados en lugar de confirmar directamente.'
            });
        }

        // Determine if this is a COD payment based on what courier selected
        const paymentMethodLower = (payment_method || '').toLowerCase().trim();
        const codPaymentMethods = ['efectivo', 'cash', 'contra entrega', 'cod'];
        const isCodPayment = codPaymentMethods.includes(paymentMethodLower);

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

        // Handle amount_collected based on payment type
        if (isCodPayment) {
            // COD payment: courier collected cash
            if (has_amount_discrepancy && amount_collected !== undefined) {
                // Courier explicitly reported a different amount
                updateData.amount_collected = amount_collected;
                updateData.has_amount_discrepancy = true;
                console.log(`⚠️ [ORDERS] COD discrepancy for order ${id}: expected ${existingOrder.cod_amount || existingOrder.total_price}, collected ${amount_collected}`);
            } else {
                // No discrepancy reported - assume full amount collected
                const expectedAmount = existingOrder.cod_amount || existingOrder.total_price || 0;
                updateData.amount_collected = expectedAmount;
                updateData.has_amount_discrepancy = false;
                console.log(`💰 [ORDERS] COD payment for order ${id}: collected ${expectedAmount}`);
            }
        } else {
            // PREPAID payment (tarjeta, qr, transferencia): no cash collected
            // The payment already went directly to the store
            updateData.amount_collected = 0;
            updateData.has_amount_discrepancy = false;
            console.log(`💳 [ORDERS] Prepaid delivery for order ${id}: payment method = ${payment_method}, no cash collected`);
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
                error: 'Error al actualizar pedido'
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

        // Build notes for status history
        let historyNotes = `Delivery confirmed by courier`;
        if (payment_method) historyNotes += ` - Payment: ${payment_method}`;
        if (isCodPayment && updateData.has_amount_discrepancy) {
            historyNotes += ` - MONTO DIFERENTE COBRADO: ₲${amount_collected?.toLocaleString()} (esperado: ₲${(existingOrder.cod_amount || existingOrder.total_price || 0).toLocaleString()})`;
        } else if (!isCodPayment) {
            historyNotes += ` - Pago prepago (no se cobró efectivo)`;
        }
        if (notes) historyNotes += ` - Notes: ${notes}`;

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
                notes: historyNotes
            });

        console.log(`✅ [ORDERS] Order ${id} marked as delivered - Payment: ${payment_method}, COD: ${isCodPayment}, Amount collected: ${updateData.amount_collected}`);

        res.json({
            message: 'Delivery confirmed successfully',
            data,
            payment_info: {
                is_cod: isCodPayment,
                amount_collected: updateData.amount_collected,
                has_discrepancy: updateData.has_amount_discrepancy
            }
        });
    } catch (error: any) {
        console.error(`[POST /api/orders/${req.params.id}/delivery-confirm] Error:`, error);
        res.status(500).json({
            error: 'Error al confirmar entrega',
            message: error.message
        });
    }
});

// POST /api/orders/token/:token/delivery-fail - Courier reports failed delivery (public)
// SECURITY: Uses delivery_link_token from URL - courier scans QR code
ordersRouter.post('/token/:token/delivery-fail', async (req: Request, res: Response) => {
    try {
        const { token } = req.params;
        const { delivery_failure_reason, failure_notes } = req.body;

        if (!delivery_failure_reason) {
            return res.status(400).json({
                error: 'Validation failed',
                message: 'delivery_failure_reason is required'
            });
        }

        console.log(`❌ [ORDERS] Courier reporting failed delivery via token`);

        // SECURITY: Look up order by token - only valid tokens can access
        const { data: existingOrder, error: fetchError } = await supabaseAdmin
            .from('orders')
            .select('id, store_id, sleeves_status, courier_id, has_active_incident')
            .eq('delivery_link_token', token)
            .single();

        if (fetchError || !existingOrder) {
            console.error(`❌ [ORDERS] Order not found for token`);
            return res.status(404).json({
                error: 'Order not found',
                message: 'Token de entrega inválido o expirado'
            });
        }

        const id = existingOrder.id;
        console.log(`❌ [ORDERS] Token validated for order ${id}`, {
            reason: delivery_failure_reason,
            has_notes: !!failure_notes
        });

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
                error: 'Error al actualizar pedido'
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
            error: 'Error al reportar fallo de entrega',
            message: error.message
        });
    }
});

// POST /api/orders/:id/rate-delivery - Customer rates delivery (public)
// This endpoint is accessible without auth for customer feedback
ordersRouter.post('/:id/rate-delivery', validateUUIDParam('id'), async (req: Request, res: Response) => {
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
                error: 'Error al guardar calificación'
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
            error: 'Error al guardar calificación',
            message: error.message
        });
    }
});

// POST /api/orders/:id/cancel - Cancel order after failed delivery (public)
// This endpoint is accessible without auth for courier/customer to cancel after retry decision
ordersRouter.post('/:id/cancel', validateUUIDParam('id'), async (req: Request, res: Response) => {
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
                error: 'Error al cancelar pedido'
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
            error: 'Error al cancelar pedido',
            message: error.message
        });
    }
});

// ================================================================
// AUTHENTICATED ENDPOINTS (Require auth token)
// ================================================================

ordersRouter.use(verifyToken, extractStoreId, extractUserRole);

// Apply module-level access check for all authenticated routes
ordersRouter.use(requireModule(Module.ORDERS));

// Using req.storeId from middleware

// Helper function to map database status to frontend status
function mapStatus(dbStatus: string): 'pending' | 'confirmed' | 'in_preparation' | 'ready_to_ship' | 'shipped' | 'in_transit' | 'delivered' | 'returned' | 'cancelled' | 'incident' {
    const statusMap: Record<string, 'pending' | 'confirmed' | 'in_preparation' | 'ready_to_ship' | 'shipped' | 'in_transit' | 'delivered' | 'returned' | 'cancelled' | 'incident'> = {
        'pending': 'pending',
        'confirmed': 'confirmed',
        'in_preparation': 'in_preparation',
        'ready_to_ship': 'ready_to_ship',
        'shipped': 'in_transit',
        'in_transit': 'in_transit',
        'delivered': 'delivered',
        'returned': 'returned',
        'cancelled': 'cancelled',
        'rejected': 'cancelled',
        'incident': 'incident'
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
            endDate,
            show_test = 'true',        // Filter for test orders
            show_deleted = 'true'      // Show soft-deleted orders (with opacity)
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
                    shopify_variant_id,
                    image_url,
                    products:product_id (
                        id,
                        name,
                        image_url
                    )
                ),
                carriers!orders_courier_id_fkey (
                    id,
                    name
                )
            `, { count: 'exact' })
            .eq('store_id', req.storeId)
            .order('created_at', { ascending: false })
            .range(parseInt(offset as string), parseInt(offset as string) + parseInt(limit as string) - 1);

        // Filter test orders (show by default unless show_test=false)
        if (show_test === 'false') {
            query = query.eq('is_test', false);
        }

        // Filter soft-deleted orders (show by default with reduced opacity)
        // Set show_deleted=false to hide them completely
        if (show_deleted === 'false') {
            query = query.is('deleted_at', null);
        }

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
                    unit_price: safeNumber(item.price),
                    total_price: (item.quantity || 1) * safeNumber(item.price)
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
                shopify_order_id: order.shopify_order_id,
                shopify_order_number: order.shopify_order_number,
                shopify_order_name: order.shopify_order_name,
                payment_gateway: order.payment_gateway,
                customer: `${order.customer_first_name || ''} ${order.customer_last_name || ''}`.trim() || 'Cliente',
                address: order.customer_address || '',
                product: productDisplay,
                quantity: totalQuantity || 1,
                total: order.total_price || 0,
                status: mapStatus(order.sleeves_status),
                payment_status: order.payment_status,
                carrier: order.carriers?.name || 'Sin transportadora',
                carrier_id: order.courier_id,
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
                line_items: lineItems,  // Include all line items
                order_line_items: lineItems,  // Also include as order_line_items for compatibility
                printed: order.printed,
                printed_at: order.printed_at,
                printed_by: order.printed_by,
                deleted_at: order.deleted_at,  // For soft delete opacity in UI
                deleted_by: order.deleted_by,
                deletion_type: order.deletion_type,
                // Amount discrepancy fields
                cod_amount: order.cod_amount,
                amount_collected: order.amount_collected,
                has_amount_discrepancy: order.has_amount_discrepancy
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
            error: 'Error al obtener pedidos',
            message: error.message
        });
    }
});

// ================================================================
// GET /api/orders/:id - Get single order
// ================================================================
ordersRouter.get('/:id', validateUUIDParam('id'), async (req: AuthRequest, res: Response) => {
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
                    properties,
                    image_url,
                    products:product_id (
                        id,
                        name,
                        image_url
                    )
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
                unit_price: safeNumber(item.price),
                total_price: (item.quantity || 1) * safeNumber(item.price),
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
            error: 'Error al obtener pedido',
            message: error.message
        });
    }
});

// ================================================================
// POST /api/orders - Create new order
// ================================================================
ordersRouter.post('/', requirePermission(Module.ORDERS, Permission.CREATE), checkOrderLimit, async (req: PermissionRequest & PlanLimitRequest, res: Response) => {
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

        // ================================================================
        // Find or create customer using atomic function (prevents race conditions)
        // ================================================================
        let customerId: string | null = null;

        try {
            // Use atomic RPC function to prevent race conditions
            // when two orders with same phone/email are created simultaneously
            if (customer_phone || customer_email) {
                const { data: customerResult, error: customerError } = await supabaseAdmin
                    .rpc('find_or_create_customer_atomic', {
                        p_store_id: req.storeId,
                        p_phone: customer_phone || null,
                        p_email: customer_email || null,
                        p_first_name: customer_first_name || null,
                        p_last_name: customer_last_name || null,
                        p_address: customer_address || null,
                        p_city: null,
                        p_country: 'Paraguay'
                    });

                if (customerError) {
                    console.error('⚠️ [ORDERS] Failed to find/create customer via RPC:', customerError);
                    // Fallback to legacy method if RPC not available
                    const { data: existingByPhone } = await supabaseAdmin
                        .from('customers')
                        .select('id')
                        .eq('store_id', req.storeId)
                        .or(`phone.eq.${customer_phone},email.eq.${customer_email}`)
                        .maybeSingle();

                    if (existingByPhone) {
                        customerId = existingByPhone.id;
                    } else {
                        const { data: newCustomer } = await supabaseAdmin
                            .from('customers')
                            .insert({
                                store_id: req.storeId,
                                first_name: customer_first_name || null,
                                last_name: customer_last_name || null,
                                email: customer_email || null,
                                phone: customer_phone || null,
                                total_orders: 0,
                                total_spent: 0
                            })
                            .select('id')
                            .single();
                        if (newCustomer) customerId = newCustomer.id;
                    }
                } else {
                    customerId = customerResult;
                    console.log(`✅ [ORDERS] Customer (atomic): ${customerId}`);
                }

                // Update customer info if we have additional data
                if (customerId) {
                    const { data: existingCustomer } = await supabaseAdmin
                        .from('customers')
                        .select('first_name, last_name, email, phone, address')
                        .eq('id', customerId)
                        .single();

                    if (existingCustomer) {
                        const updateData: any = {};
                        if (customer_first_name && customer_first_name !== existingCustomer.first_name) {
                            updateData.first_name = customer_first_name;
                        }
                        if (customer_last_name && customer_last_name !== existingCustomer.last_name) {
                            updateData.last_name = customer_last_name;
                        }
                        if (customer_email && customer_email !== existingCustomer.email) {
                            updateData.email = customer_email;
                        }
                        if (customer_phone && customer_phone !== existingCustomer.phone) {
                            updateData.phone = customer_phone;
                        }
                        if (customer_address && customer_address !== existingCustomer.address) {
                            updateData.address = customer_address;
                        }

                        if (Object.keys(updateData).length > 0) {
                            updateData.updated_at = new Date().toISOString();
                            await supabaseAdmin
                                .from('customers')
                                .update(updateData)
                                .eq('id', customerId);
                            console.log(`🔄 [ORDERS] Updated customer info for: ${customerId}`);
                        }
                    }
                }
            }
        } catch (customerErr) {
            console.error('⚠️ [ORDERS] Error in find/create customer:', customerErr);
            // Non-blocking: continue with order creation
        }

        const { data, error } = await supabaseAdmin
            .from('orders')
            .insert([{
                store_id: req.storeId,
                customer_id: customerId,
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

        // Create normalized line items in order_line_items table (for manual orders)
        if (line_items && Array.isArray(line_items) && line_items.length > 0) {
            try {
                const normalizedLineItems = [];

                for (const item of line_items) {
                    // Try to find the product to get image_url
                    const productId = item.product_id || null;
                    let imageUrl = null;

                    if (productId) {
                        const { data: product } = await supabaseAdmin
                            .from('products')
                            .select('id, image_url')
                            .eq('id', productId)
                            .eq('store_id', req.storeId)
                            .maybeSingle();

                        if (product) {
                            imageUrl = product.image_url;
                        }
                    }

                    normalizedLineItems.push({
                        order_id: data.id,
                        product_id: productId,
                        product_name: item.name || item.title || 'Producto',
                        variant_title: item.variant_title || null,
                        sku: item.sku || null,
                        quantity: item.quantity || 1,
                        unit_price: parseFloat(item.price) || 0,
                        total_price: (item.quantity || 1) * (parseFloat(item.price) || 0),
                        image_url: imageUrl
                    });
                }

                if (normalizedLineItems.length > 0) {
                    const { error: lineItemsError } = await supabaseAdmin
                        .from('order_line_items')
                        .insert(normalizedLineItems);

                    if (lineItemsError) {
                        console.warn('⚠️ [ORDERS] Failed to create normalized line items:', lineItemsError);
                        // Non-blocking: order is created, line items are optional for display
                    } else {
                        console.log(`✅ [ORDERS] Created ${normalizedLineItems.length} normalized line items`);
                    }
                }
            } catch (lineItemsErr) {
                console.warn('⚠️ [ORDERS] Error creating normalized line items:', lineItemsErr);
                // Non-blocking
            }
        }

        res.status(201).json({
            message: 'Order created successfully',
            data
        });
    } catch (error: any) {
        console.error('[POST /api/orders] Error:', error);
        res.status(500).json({
            error: 'Error al crear pedido',
            message: error.message
        });
    }
});

// ================================================================
// PUT /api/orders/:id - Update order
// ================================================================
// Supports optimistic locking via 'version' field to prevent race conditions
ordersRouter.put('/:id', validateUUIDParam('id'), requirePermission(Module.ORDERS, Permission.EDIT), async (req: PermissionRequest, res: Response) => {
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
            upsell_added,
            version // Optimistic locking: client sends current version
        } = req.body;

        // Build update object with only provided fields
        const updateData: any = {
            updated_at: new Date().toISOString(),
            last_modified_by: req.user?.id || null
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

        // Build query with optimistic locking if version provided
        let query = supabaseAdmin
            .from('orders')
            .update(updateData)
            .eq('id', id)
            .eq('store_id', req.storeId);

        // If version is provided, use optimistic locking
        if (version !== undefined && version !== null) {
            query = query.eq('version', version);
        }

        const { data, error, count } = await query
            .select(`
                *,
                carriers!orders_courier_id_fkey (
                    id,
                    name
                )
            `)
            .single();

        // Check for optimistic locking conflict
        if (error?.code === 'PGRST116' || (!data && version !== undefined)) {
            // Row not found with that version - likely concurrent update
            const { data: currentOrder } = await supabaseAdmin
                .from('orders')
                .select('version, last_modified_at, last_modified_by')
                .eq('id', id)
                .eq('store_id', req.storeId)
                .single();

            if (currentOrder && currentOrder.version !== version) {
                return res.status(409).json({
                    error: 'Conflict',
                    message: 'Este pedido fue modificado por otro usuario. Por favor, recarga la página e intenta de nuevo.',
                    code: 'VERSION_CONFLICT',
                    currentVersion: currentOrder.version,
                    yourVersion: version,
                    lastModifiedAt: currentOrder.last_modified_at
                });
            }

            return res.status(404).json({
                error: 'Order not found'
            });
        }

        if (error || !data) {
            return res.status(404).json({
                error: 'Order not found'
            });
        }

        // Transform response to match frontend format
        const lineItems = data.line_items || [];
        const firstItem = Array.isArray(lineItems) && lineItems.length > 0 ? lineItems[0] : null;
        // Calculate total quantity from all line items
        const totalQuantity = Array.isArray(lineItems)
            ? lineItems.reduce((sum: number, item: any) => sum + (parseInt(item.quantity) || 0), 0)
            : 1;

        const transformedData = {
            id: data.id,
            customer: `${data.customer_first_name || ''} ${data.customer_last_name || ''}`.trim() || 'Cliente',
            address: data.customer_address || '',
            product: firstItem?.product_name || firstItem?.title || 'Producto',
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
            version: data.version // Include version for optimistic locking
        };

        res.json(transformedData);
    } catch (error: any) {
        console.error(`[PUT /api/orders/${req.params.id}] Error:`, error);
        res.status(500).json({
            error: 'Error al actualizar pedido',
            message: error.message
        });
    }
});

// ================================================================
// STATUS TRANSITION RULES - Define allowed transitions with helpful messages
// ================================================================
const STATUS_LABELS: Record<string, string> = {
    pending: 'Pendiente',
    confirmed: 'Confirmado',
    in_preparation: 'En Preparación',
    ready_to_ship: 'Listo para Enviar',
    shipped: 'Despachado',
    in_transit: 'En Tránsito',
    delivered: 'Entregado',
    returned: 'Devuelto',
    cancelled: 'Cancelado',
    rejected: 'Rechazado',
    incident: 'Incidencia'
};

// Define which transitions are allowed from each status
// Format: { fromStatus: { toStatus: { allowed: boolean, message?: string } } }
// NOTE: Rules are permissive to allow manual control, especially for Free plan users without warehouse
const STATUS_TRANSITIONS: Record<string, Record<string, { allowed: boolean; message?: string; requiresStockRestore?: boolean }>> = {
    pending: {
        confirmed: { allowed: true },
        in_preparation: { allowed: true }, // Allow skip for manual workflows (no warehouse)
        ready_to_ship: { allowed: true },  // Allow skip for manual workflows
        shipped: { allowed: true },        // Allow skip for manual workflows
        in_transit: { allowed: true },     // Allow skip for manual workflows
        delivered: { allowed: true },      // Allow marking directly as delivered
        cancelled: { allowed: true },
        rejected: { allowed: true },
        returned: { allowed: true },
        incident: { allowed: true },
    },
    confirmed: {
        pending: { allowed: true },        // Revert to pending
        in_preparation: { allowed: true },
        ready_to_ship: { allowed: true },  // Allow skip for manual workflows
        shipped: { allowed: true },        // Allow skip for manual workflows
        in_transit: { allowed: true },     // Allow skip for manual workflows
        delivered: { allowed: true },      // Allow marking directly as delivered
        cancelled: { allowed: true },
        rejected: { allowed: true },
        returned: { allowed: true },
        incident: { allowed: true },
    },
    in_preparation: {
        pending: { allowed: true },        // Allow full revert
        confirmed: { allowed: true },      // Revert one step
        ready_to_ship: { allowed: true },
        shipped: { allowed: true },        // Allow skip
        in_transit: { allowed: true },     // Allow skip
        delivered: { allowed: true },      // Allow skip
        cancelled: { allowed: true },
        returned: { allowed: true },
        incident: { allowed: true },
    },
    ready_to_ship: {
        pending: { allowed: true, requiresStockRestore: true },       // Allow revert (restores stock)
        confirmed: { allowed: true, requiresStockRestore: true },     // Allow revert (restores stock)
        in_preparation: { allowed: true, requiresStockRestore: true }, // Revert restores stock
        shipped: { allowed: true },
        in_transit: { allowed: true },
        delivered: { allowed: true },      // Allow skip to delivered
        cancelled: { allowed: true, requiresStockRestore: true },     // Cancel restores stock
        returned: { allowed: true, requiresStockRestore: true },
        incident: { allowed: true },
    },
    shipped: {
        pending: { allowed: true, requiresStockRestore: true },       // Allow full revert
        confirmed: { allowed: true, requiresStockRestore: true },     // Allow revert
        in_preparation: { allowed: true, requiresStockRestore: true }, // Allow revert
        ready_to_ship: { allowed: true },  // Can go back to ready
        in_transit: { allowed: true },
        delivered: { allowed: true },
        cancelled: { allowed: true, requiresStockRestore: true },     // Can cancel
        returned: { allowed: true },
        incident: { allowed: true },
    },
    in_transit: {
        pending: { allowed: true, requiresStockRestore: true },       // Allow full revert
        confirmed: { allowed: true, requiresStockRestore: true },     // Allow revert
        in_preparation: { allowed: true, requiresStockRestore: true }, // Allow revert
        ready_to_ship: { allowed: true },  // Can go back
        shipped: { allowed: true },        // Can go back
        delivered: { allowed: true },
        cancelled: { allowed: true, requiresStockRestore: true },     // Can cancel from in_transit
        returned: { allowed: true },
        incident: { allowed: true },
    },
    delivered: {
        // Delivered is final for most actions, but allow some flexibility
        returned: { allowed: true },
        incident: { allowed: true },
        // Disallow going back to earlier states (delivered is final)
        pending: { allowed: false, message: 'Un pedido entregado no puede volver a pendiente. Usa "Devuelto" si el cliente lo devuelve.' },
        confirmed: { allowed: false, message: 'Un pedido entregado no puede volver a confirmado. Usa "Devuelto" si es necesario.' },
        in_preparation: { allowed: false, message: 'Un pedido entregado no puede volver a preparación.' },
        ready_to_ship: { allowed: false, message: 'Un pedido entregado no puede volver a listo para enviar.' },
        shipped: { allowed: false, message: 'Un pedido entregado no puede volver a despachado.' },
        in_transit: { allowed: false, message: 'Un pedido entregado no puede volver a en tránsito.' },
        cancelled: { allowed: false, message: 'Un pedido ya entregado no puede cancelarse. Usa "Devuelto" si el cliente lo devuelve.' },
    },
    cancelled: {
        pending: { allowed: true },        // Reactivate
        confirmed: { allowed: true },      // Reactivate directly to confirmed
        in_preparation: { allowed: true }, // Allow reactivating further along
        ready_to_ship: { allowed: true },  // Allow reactivating further along
        shipped: { allowed: true },        // Allow reactivating further along
        in_transit: { allowed: true },     // Allow reactivating further along
        delivered: { allowed: true },      // Allow marking as delivered (if error)
        returned: { allowed: true },
        incident: { allowed: true },
    },
    rejected: {
        // Same as cancelled - allow reactivation
        pending: { allowed: true },
        confirmed: { allowed: true },
        in_preparation: { allowed: true },
        ready_to_ship: { allowed: true },
        shipped: { allowed: true },
        in_transit: { allowed: true },
        delivered: { allowed: true },
        cancelled: { allowed: true },
        returned: { allowed: true },
        incident: { allowed: true },
    },
    returned: {
        // Returned is usually final, but allow correcting errors
        pending: { allowed: true },        // Allow if marked returned by mistake
        confirmed: { allowed: true },
        in_preparation: { allowed: true },
        ready_to_ship: { allowed: true },
        shipped: { allowed: true },
        in_transit: { allowed: true },
        delivered: { allowed: true },      // Allow if returned by mistake
        cancelled: { allowed: true },
        incident: { allowed: true },
    },
    incident: {
        // From incident, can go to any state (incident needs resolution)
        pending: { allowed: true },
        confirmed: { allowed: true },
        in_preparation: { allowed: true },
        ready_to_ship: { allowed: true },
        shipped: { allowed: true },
        in_transit: { allowed: true },
        delivered: { allowed: true },
        cancelled: { allowed: true, requiresStockRestore: true },
        returned: { allowed: true },
    }
};

/**
 * Provides a helpful suggestion for what to do instead of an invalid transition
 */
function getSuggestionForTransition(fromStatus: string, toStatus: string): string {
    // Suggestions for common invalid transitions
    const suggestions: Record<string, Record<string, string>> = {
        in_transit: {
            pending: 'Si el cliente canceló, usa "Cancelado". El stock se restaurará automáticamente.',
            confirmed: 'Si el cliente canceló, usa "Cancelado". El stock se restaurará automáticamente.',
        },
        shipped: {
            pending: 'Si el cliente canceló, usa "Cancelado". El stock se restaurará automáticamente.',
            confirmed: 'Si el cliente canceló, usa "Cancelado". El stock se restaurará automáticamente.',
        },
        delivered: {
            pending: 'Si el cliente devuelve el producto, usa "Devuelto".',
            cancelled: 'Los pedidos entregados no se pueden cancelar. Usa "Devuelto" si el cliente devuelve el producto.',
        },
        ready_to_ship: {
            pending: 'Si necesitas editar el pedido, primero cámbialo a "En Preparación", luego a "Confirmado".',
        },
    };

    return suggestions[fromStatus]?.[toStatus] || '';
}

/**
 * Validates if a status transition is allowed and returns helpful message if not
 */
function validateStatusTransition(fromStatus: string, toStatus: string): { allowed: boolean; message: string; requiresStockRestore?: boolean } {
    // Same status - no change needed
    if (fromStatus === toStatus) {
        return { allowed: true, message: 'El pedido ya está en este estado.' };
    }

    // Get transition rules for current status
    const fromRules = STATUS_TRANSITIONS[fromStatus];
    if (!fromRules) {
        // Unknown from status - allow any transition
        return { allowed: true, message: '' };
    }

    // Check if specific transition is defined
    const transition = fromRules[toStatus];
    if (transition) {
        return {
            allowed: transition.allowed,
            message: transition.message || '',
            requiresStockRestore: transition.requiresStockRestore
        };
    }

    // If no specific rule, check if it's a valid status
    const validStatuses = Object.keys(STATUS_LABELS);
    if (!validStatuses.includes(toStatus)) {
        return { allowed: false, message: `Estado "${toStatus}" no es válido.` };
    }

    // Default: allow if not explicitly denied
    return { allowed: true, message: '' };
}

// ================================================================
// PATCH /api/orders/:id/status - Update order status
// ================================================================
ordersRouter.patch('/:id/status', requirePermission(Module.ORDERS, Permission.EDIT), async (req: PermissionRequest, res: Response) => {
    try {
        const { id } = req.params;
        const {
            sleeves_status,
            confirmed_by,
            confirmation_method,
            rejection_reason,
            force = false // Allow forcing certain transitions (for admin override)
        } = req.body;

        // DEBUG: Log request details
        console.log(`📋 [PATCH /orders/${id}/status] Request:`, {
            orderId: id,
            storeId: req.storeId,
            userId: req.userId,
            userRole: req.userRole,
            targetStatus: sleeves_status
        });

        const validStatuses = ['pending', 'confirmed', 'in_preparation', 'ready_to_ship', 'in_transit', 'delivered', 'cancelled', 'rejected', 'returned', 'shipped', 'incident'];
        if (!validStatuses.includes(sleeves_status)) {
            return res.status(400).json({
                error: 'Invalid status',
                code: 'INVALID_STATUS',
                message: `Estado inválido. Los estados válidos son: ${validStatuses.map(s => STATUS_LABELS[s] || s).join(', ')}`
            });
        }

        // Get current order status to check if reactivating from cancelled
        const { data: currentOrder, error: fetchError } = await supabaseAdmin
            .from('orders')
            .select('sleeves_status, delivery_link_token, line_items')
            .eq('id', id)
            .eq('store_id', req.storeId)
            .single();

        // DEBUG: Log query result
        console.log(`📋 [PATCH /orders/${id}/status] Query result:`, {
            found: !!currentOrder,
            error: fetchError?.message || null,
            errorCode: fetchError?.code || null
        });

        if (fetchError || !currentOrder) {
            return res.status(404).json({
                error: 'Order not found',
                code: 'ORDER_NOT_FOUND',
                message: 'El pedido no existe o no pertenece a esta tienda.'
            });
        }

        const fromStatus = currentOrder.sleeves_status;
        const toStatus = sleeves_status;

        // Validate transition unless force is enabled (admin override)
        // SECURITY: force flag only allowed for owner/admin roles
        const canForce = force && (req.userRole === 'owner' || req.userRole === 'admin');

        if (force && !canForce) {
            console.warn(`⚠️ [ORDERS] Force flag rejected for user ${req.userId} with role ${req.userRole}`);
            return res.status(403).json({
                error: 'Forbidden',
                code: 'FORCE_NOT_ALLOWED',
                message: 'Solo los propietarios y administradores pueden forzar cambios de estado.'
            });
        }

        if (!canForce) {
            const validation = validateStatusTransition(fromStatus, toStatus);

            if (!validation.allowed) {
                const fromLabel = STATUS_LABELS[fromStatus] || fromStatus;
                const toLabel = STATUS_LABELS[toStatus] || toStatus;

                console.log(`⚠️ [ORDERS] Invalid transition from ${fromStatus} to ${toStatus}: ${validation.message}`);

                return res.status(400).json({
                    error: 'Invalid status transition',
                    code: 'INVALID_STATUS_TRANSITION',
                    message: validation.message || `No puedes cambiar de "${fromLabel}" a "${toLabel}".`,
                    details: {
                        from: fromStatus,
                        fromLabel,
                        to: toStatus,
                        toLabel,
                        suggestion: getSuggestionForTransition(fromStatus, toStatus)
                    }
                });
            }
        }

        // Log force usage for audit trail
        if (canForce) {
            console.log(`⚠️ [ORDERS] Force transition by ${req.userRole} (user ${req.userId}): ${fromStatus} → ${toStatus}`);
        }

        // ================================================================
        // CRITICAL: Check stock availability before moving to ready_to_ship
        // This prevents the trigger from failing with insufficient stock
        // ================================================================
        if (toStatus === 'ready_to_ship' && fromStatus !== 'ready_to_ship') {
            const lineItems = currentOrder.line_items || [];

            if (Array.isArray(lineItems) && lineItems.length > 0) {
                const stockIssues: Array<{
                    product_name: string;
                    required: number;
                    available: number;
                    shortage: number;
                }> = [];

                // Check stock for each product
                for (const item of lineItems) {
                    const productId = item.product_id;
                    const requiredQty = parseInt(item.quantity) || 0;

                    if (!productId || requiredQty <= 0) continue;

                    const { data: product } = await supabaseAdmin
                        .from('products')
                        .select('name, sku, stock')
                        .eq('id', productId)
                        .eq('store_id', req.storeId)
                        .single();

                    if (product && (product.stock || 0) < requiredQty) {
                        stockIssues.push({
                            product_name: product.name || item.name || 'Producto',
                            required: requiredQty,
                            available: product.stock || 0,
                            shortage: requiredQty - (product.stock || 0)
                        });
                    }
                }

                if (stockIssues.length > 0) {
                    const issueList = stockIssues
                        .map(i => `• ${i.product_name}: necesita ${i.required}, disponible ${i.available} (faltan ${i.shortage})`)
                        .join('\n');

                    console.warn(`⚠️ [ORDERS] Stock insuficiente para orden ${id}:\n${issueList}`);

                    return res.status(400).json({
                        error: 'Insufficient stock',
                        code: 'INSUFFICIENT_STOCK',
                        message: `No hay suficiente stock para completar este pedido:\n\n${issueList}\n\nRecibe mercadería para reponer el stock o reduce la cantidad del pedido.`,
                        details: stockIssues
                    });
                }
            }
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
            if (rejection_reason) {
                updateData.cancel_reason = rejection_reason;
            }
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
            .select('*, carriers(name), order_line_items(id, quantity, product_id, product_name, sku, variant_title, unit_price, image_url)')
            .single();

        // DEBUG: Log update result
        console.log(`📋 [PATCH /orders/${id}/status] Update result:`, {
            success: !!data,
            error: error?.message || null,
            errorCode: error?.code || null,
            errorDetails: error?.details || null
        });

        if (error || !data) {
            console.error(`❌ [PATCH /orders/${id}/status] Update failed:`, error);
            return res.status(404).json({
                error: 'Order not found',
                details: error?.message
            });
        }

        // Sync cancellation to Shopify if order is from Shopify
        if ((sleeves_status === 'cancelled' || sleeves_status === 'rejected' || sleeves_status === 'returned') &&
            data.shopify_order_id) {
            try {
                console.log(`🔄 [SHOPIFY-SYNC] Cancelling Shopify order ${data.shopify_order_id} (status: ${sleeves_status})`);

                // Get Shopify integration for this store
                const { data: integration } = await supabaseAdmin
                    .from('shopify_integrations')
                    .select('*')
                    .eq('store_id', req.storeId)
                    .eq('status', 'active')
                    .single();

                if (integration) {
                    const shopifyClient = new ShopifyGraphQLClientService(integration);

                    // Cancel order in Shopify
                    await shopifyClient.cancelOrder(
                        data.shopify_order_id,
                        rejection_reason || 'cancelled',
                        false, // Don't notify customer (we handle that)
                        false  // Don't refund automatically
                    );

                    console.log(`✅ [SHOPIFY-SYNC] Successfully cancelled Shopify order ${data.shopify_order_id}`);
                } else {
                    console.warn(`⚠️  [SHOPIFY-SYNC] No active Shopify integration found for store ${req.storeId}`);
                }
            } catch (shopifyError: any) {
                console.error(`❌ [SHOPIFY-SYNC] Failed to cancel Shopify order:`, shopifyError);
                // Don't fail the entire request - log the error and continue
                // The order is already cancelled in Ordefy
            }
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
            error: 'Error al actualizar estado del pedido',
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
            error: 'Error al obtener historial del pedido',
            message: error.message
        });
    }
});

// ================================================================
// DELETE /api/orders/:id - Delete order (soft delete for non-owners, hard delete for owner)
// ================================================================
ordersRouter.delete('/:id', validateUUIDParam('id'), requirePermission(Module.ORDERS, Permission.DELETE), async (req: PermissionRequest, res: Response) => {
    try {
        const { id } = req.params;
        const userRole = req.userRole;
        const userId = req.userId;

        console.log(`🗑️ [ORDERS] Delete request for order ${id} by ${userRole}`);

        // Get order details
        const { data: order, error: fetchError } = await supabaseAdmin
            .from('orders')
            .select('id, shopify_order_id, sleeves_status, deleted_at')
            .eq('id', id)
            .eq('store_id', req.storeId)
            .single();

        if (fetchError || !order) {
            return res.status(404).json({
                error: 'Order not found'
            });
        }

        // ============================================================
        // OWNER: Hard Delete (permanent removal with cascading cleanup)
        // ============================================================
        if (userRole === 'owner') {
            console.log(`🔥 [ORDERS] Owner hard delete - removing order ${id} permanently`);

            // Hard delete (trigger will handle cascading cleanup + stock restoration)
            const { data, error } = await supabaseAdmin
                .from('orders')
                .delete()
                .eq('id', id)
                .eq('store_id', req.storeId)
                .select('id')
                .single();

            if (error) {
                console.error(`❌ Hard delete failed:`, error.message);
                return res.status(400).json({
                    error: 'Cannot delete order',
                    message: error.message
                });
            }

            const wasStockAffected = order.sleeves_status && ['ready_to_ship', 'shipped', 'delivered'].includes(order.sleeves_status);

            console.log(`✅ Order ${id} permanently deleted${wasStockAffected ? ' (stock restored, all data cleaned)' : ' (all data cleaned)'}`);

            return res.json({
                success: true,
                message: 'Order permanently deleted. All related data has been cleaned up.',
                id: data.id,
                deletion_type: 'hard',
                stock_restored: wasStockAffected
            });
        }

        // ============================================================
        // NON-OWNER: Soft Delete (mark as deleted, reduced opacity in UI)
        // ============================================================
        else {
            console.log(`👤 [ORDERS] Non-owner soft delete - hiding order ${id} (can be restored by owner)`);

            // Check if already soft-deleted
            if (order.deleted_at) {
                return res.status(400).json({
                    error: 'Order already deleted',
                    message: 'This order is already hidden. Only the owner can permanently delete it.'
                });
            }

            // Soft delete (mark as deleted)
            const { data, error } = await supabaseAdmin
                .from('orders')
                .update({
                    deleted_at: new Date().toISOString(),
                    deleted_by: userId,
                    deletion_type: 'soft',
                    updated_at: new Date().toISOString()
                })
                .eq('id', id)
                .eq('store_id', req.storeId)
                .select('id')
                .single();

            if (error || !data) {
                console.error(`❌ Soft delete failed:`, error);
                return res.status(500).json({
                    error: 'Error al eliminar pedido',
                    message: error?.message
                });
            }

            console.log(`✅ Order ${id} soft-deleted by ${userRole}`);

            return res.json({
                success: true,
                message: 'Order hidden successfully. It will appear with reduced opacity until the owner permanently deletes it.',
                id: data.id,
                deletion_type: 'soft'
            });
        }
    } catch (error: any) {
        console.error(`[DELETE /api/orders/${req.params.id}] Error:`, error);
        res.status(500).json({
            error: 'Error al eliminar pedido',
            message: error.message
        });
    }
});

// ================================================================
// Note: Dual deletion system:
// - Non-owners: Soft delete (deleted_at timestamp, reduced opacity in UI)
// - Owner: Hard delete (permanent removal, cascading cleanup, stock restoration)
// ================================================================

// ================================================================
// PATCH /api/orders/:id/test - Mark/unmark order as test
// ================================================================
ordersRouter.patch('/:id/test', requirePermission(Module.ORDERS, Permission.EDIT), async (req: PermissionRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { is_test } = req.body;
        const userId = req.userId;

        if (typeof is_test !== 'boolean') {
            return res.status(400).json({
                error: 'Invalid request',
                message: 'is_test must be a boolean value'
            });
        }

        console.log(`🧪 [ORDERS] ${is_test ? 'Marking' : 'Unmarking'} order ${id} as test`);

        // Call database function to mark/unmark as test
        const { data, error } = await supabaseAdmin
            .rpc('mark_order_as_test', {
                p_order_id: id,
                p_marked_by: userId,
                p_is_test: is_test
            });

        if (error) {
            console.error(`❌ Mark test failed:`, error);
            return res.status(500).json({
                error: 'Error al actualizar estado de prueba del pedido',
                message: error.message
            });
        }

        const result = data?.[0];
        if (!result?.success) {
            return res.status(400).json({
                error: result?.message || 'Error al actualizar estado de prueba'
            });
        }

        console.log(`✅ Order ${id} test status updated`);
        res.json({
            message: result.message,
            id: result.order_id,
            is_test
        });
    } catch (error: any) {
        console.error(`[PATCH /api/orders/${req.params.id}/test] Error:`, error);
        res.status(500).json({
            error: 'Error al actualizar estado de prueba',
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
ordersRouter.put('/:id/payment-status', requirePermission(Module.ORDERS, Permission.EDIT), async (req: AuthRequest, res: Response) => {
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
            error: 'Error al actualizar estado de pago',
            message: error.message
        });
    }
});

// ================================================================
// POST /api/orders/:id/mark-preparing - Mark as preparing
// ================================================================
ordersRouter.post('/:id/mark-preparing', requirePermission(Module.ORDERS, Permission.EDIT), async (req: AuthRequest, res: Response) => {
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
            error: 'Error al actualizar estado del pedido',
            message: error.message
        });
    }
});

// ================================================================
// POST /api/orders/:id/mark-out-for-delivery - Mark as out for delivery
// ================================================================
ordersRouter.post('/:id/mark-out-for-delivery', requirePermission(Module.ORDERS, Permission.EDIT), async (req: AuthRequest, res: Response) => {
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
            error: 'Error al actualizar estado del pedido',
            message: error.message
        });
    }
});

// ================================================================
// POST /api/orders/:id/mark-delivered-paid - Mark as delivered and paid
// ================================================================
ordersRouter.post('/:id/mark-delivered-paid', requirePermission(Module.ORDERS, Permission.EDIT), async (req: AuthRequest, res: Response) => {
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
            error: 'Error al actualizar estado del pedido',
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
            error: 'Error al obtener pedidos de alto riesgo',
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
            error: 'Error al obtener pedidos pendientes de entrega',
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
// Uses atomic RPC (confirm_order_atomic) to prevent inconsistent states
// All critical operations happen in a single database transaction
ordersRouter.post('/:id/confirm', requirePermission(Module.ORDERS, Permission.EDIT), async (req: PermissionRequest, res: Response) => {
    try {
        const { id } = req.params;
        const {
            upsell_added = false,
            upsell_product_id,
            upsell_quantity = 1,
            upsell_product_name,
            courier_id,
            address,
            latitude,
            longitude,
            google_maps_link,
            delivery_zone,
            shipping_cost,
            discount_amount
        } = req.body;

        console.log(`✅ [ORDERS] Confirming order ${id} with courier ${courier_id} (atomic)`);

        // Validate courier_id is provided
        if (!courier_id) {
            return res.status(400).json({
                error: 'Validation failed',
                message: 'courier_id is required'
            });
        }

        // ================================================================
        // ATOMIC CONFIRMATION via RPC
        // All critical operations in a single transaction with row locking
        // ================================================================
        const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc('confirm_order_atomic', {
            p_order_id: id,
            p_store_id: req.storeId,
            p_confirmed_by: req.userId || 'confirmador',
            p_courier_id: courier_id,
            p_address: address || null,
            p_latitude: latitude !== undefined ? Number(latitude) : null,
            p_longitude: longitude !== undefined ? Number(longitude) : null,
            p_google_maps_link: google_maps_link || null,
            p_delivery_zone: delivery_zone || null,
            p_shipping_cost: shipping_cost !== undefined ? Number(shipping_cost) : null,
            p_upsell_product_id: upsell_added && upsell_product_id ? upsell_product_id : null,
            p_upsell_quantity: upsell_added ? (upsell_quantity || 1) : 1,
            p_discount_amount: discount_amount !== undefined ? Number(discount_amount) : null
        });

        if (rpcError) {
            console.error('[ORDERS] Atomic confirmation failed:', rpcError);

            // Parse PostgreSQL error codes for user-friendly messages
            const errorMessage = rpcError.message || '';

            if (errorMessage.includes('ORDER_NOT_FOUND')) {
                return res.status(404).json({
                    error: 'Order not found',
                    message: 'El pedido no existe o no pertenece a esta tienda',
                    code: 'ORDER_NOT_FOUND'
                });
            }

            if (errorMessage.includes('INVALID_STATUS')) {
                const statusMatch = errorMessage.match(/already (\w+)/);
                const currentStatus = statusMatch ? statusMatch[1] : 'procesado';
                return res.status(400).json({
                    error: 'Invalid order status',
                    message: `El pedido ya está ${currentStatus}. Solo se pueden confirmar pedidos pendientes.`,
                    code: 'INVALID_STATUS'
                });
            }

            if (errorMessage.includes('CARRIER_NOT_FOUND')) {
                return res.status(404).json({
                    error: 'Carrier not found',
                    message: 'El transportista no existe o está inactivo',
                    code: 'CARRIER_NOT_FOUND'
                });
            }

            if (errorMessage.includes('PRODUCT_NOT_FOUND')) {
                return res.status(404).json({
                    error: 'Upsell product not found',
                    message: 'El producto de upsell no existe en esta tienda',
                    code: 'PRODUCT_NOT_FOUND'
                });
            }

            // Generic error
            return res.status(500).json({
                error: 'Confirmation failed',
                message: 'Error al confirmar el pedido. Por favor, intente nuevamente.',
                details: errorMessage
            });
        }

        // Parse the result (RPC returns JSON)
        const result = rpcResult as {
            success: boolean;
            order: any;
            upsell_applied: boolean;
            upsell_total: number;
            discount_applied: boolean;
            discount_amount: number;
            new_total_price: number;
            new_cod_amount: number;
            carrier_name: string;
        };

        if (!result?.success || !result?.order) {
            return res.status(500).json({
                error: 'Confirmation failed',
                message: 'La confirmación no retornó datos válidos'
            });
        }

        const confirmedOrder = result.order;

        // Log successful atomic operations
        if (result.upsell_applied) {
            console.log(`📦 [ORDERS] Upsell applied atomically: +${result.upsell_total} to order ${id}`);
        }
        if (result.discount_applied) {
            console.log(`💰 [ORDERS] Discount applied atomically: -${result.discount_amount} to order ${id}`);
        }
        console.log(`✅ [ORDERS] Order ${id} confirmed atomically. Total: ${result.new_total_price}, COD: ${result.new_cod_amount}`);

        // ================================================================
        // NON-CRITICAL OPERATIONS (outside transaction)
        // These can fail without rolling back the confirmation
        // ================================================================

        // Generate QR code for delivery link
        let qrCodeDataUrl = confirmedOrder.qr_code_url;
        if (confirmedOrder.delivery_link_token && !qrCodeDataUrl) {
            try {
                qrCodeDataUrl = await generateDeliveryQRCode(confirmedOrder.delivery_link_token);

                // Save QR code URL to database (non-blocking)
                await supabaseAdmin
                    .from('orders')
                    .update({ qr_code_url: qrCodeDataUrl })
                    .eq('id', id);

                console.log(`🔗 [ORDERS] QR code generated for order ${id}`);
            } catch (qrError) {
                console.error('[ORDERS] Failed to generate QR code (non-blocking):', qrError);
                // Continue without QR code, don't fail the confirmation
            }
        }

        // Log status change to history (audit, non-blocking)
        try {
            await supabaseAdmin
                .from('order_status_history')
                .insert({
                    order_id: id,
                    store_id: req.storeId,
                    previous_status: 'pending',
                    new_status: 'confirmed',
                    changed_by: req.userId || 'confirmador',
                    change_source: 'dashboard',
                    notes: (() => {
                        const parts = ['Order confirmed (atomic)'];
                        if (result.upsell_applied) {
                            parts.push(`with upsell: ${upsell_product_name || 'product'} x${upsell_quantity} (+${result.upsell_total})`);
                        }
                        if (result.discount_applied) {
                            parts.push(`with discount: -Gs. ${result.discount_amount.toLocaleString()}`);
                        }
                        return parts.join(' ');
                    })()
                });
        } catch (historyError) {
            console.error('[ORDERS] Failed to log status history (non-blocking):', historyError);
            // Continue, this is just audit logging
        }

        res.json({
            message: 'Order confirmed successfully',
            data: {
                ...confirmedOrder,
                delivery_link: `${process.env.FRONTEND_URL || 'http://localhost:8080'}/delivery/${confirmedOrder.delivery_link_token}`,
                qr_code_url: qrCodeDataUrl,
                carrier_name: result.carrier_name
            },
            meta: {
                upsell_applied: result.upsell_applied,
                upsell_total: result.upsell_total,
                discount_applied: result.discount_applied,
                discount_amount: result.discount_amount,
                final_total: result.new_total_price,
                final_cod_amount: result.new_cod_amount
            }
        });
    } catch (error: any) {
        console.error(`[POST /api/orders/${req.params.id}/confirm] Error:`, error);
        res.status(500).json({
            error: 'Error al confirmar pedido',
            message: error.message
        });
    }
});

// ================================================================
// POST /api/orders/:id/mark-printed - Mark order label as printed
// ================================================================
ordersRouter.post('/:id/mark-printed', requirePermission(Module.ORDERS, Permission.EDIT), async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const storeId = req.storeId;
        const userId = req.user?.email || req.user?.name || 'unknown';

        console.log(`🖨️ [ORDERS] Marking order ${id} as printed by ${userId}`);

        // Verify order exists and belongs to store - include line_items for stock check
        const { data: existingOrder, error: fetchError } = await supabaseAdmin
            .from('orders')
            .select('id, printed, printed_at, sleeves_status, line_items')
            .eq('id', id)
            .eq('store_id', storeId)
            .single();

        if (fetchError || !existingOrder) {
            return res.status(404).json({
                error: 'Order not found',
                message: 'El pedido no existe o no pertenece a esta tienda'
            });
        }

        // ================================================================
        // CRITICAL: Check stock availability before transitioning to ready_to_ship
        // ================================================================
        if (existingOrder.sleeves_status === 'in_preparation') {
            const lineItems = existingOrder.line_items || [];

            if (Array.isArray(lineItems) && lineItems.length > 0) {
                const stockIssues: Array<{
                    product_name: string;
                    required: number;
                    available: number;
                    shortage: number;
                }> = [];

                for (const item of lineItems) {
                    const productId = item.product_id;
                    const requiredQty = parseInt(item.quantity) || 0;

                    if (!productId || requiredQty <= 0) continue;

                    const { data: product } = await supabaseAdmin
                        .from('products')
                        .select('name, sku, stock')
                        .eq('id', productId)
                        .eq('store_id', storeId)
                        .single();

                    if (product && (product.stock || 0) < requiredQty) {
                        stockIssues.push({
                            product_name: product.name || item.name || 'Producto',
                            required: requiredQty,
                            available: product.stock || 0,
                            shortage: requiredQty - (product.stock || 0)
                        });
                    }
                }

                if (stockIssues.length > 0) {
                    const issueList = stockIssues
                        .map(i => `• ${i.product_name}: necesita ${i.required}, disponible ${i.available}`)
                        .join('\n');

                    console.warn(`⚠️ [ORDERS] Stock insuficiente para orden ${id} al imprimir etiqueta`);

                    return res.status(400).json({
                        error: 'Insufficient stock',
                        code: 'INSUFFICIENT_STOCK',
                        message: `No hay suficiente stock para completar este pedido:\n\n${issueList}\n\nRecibe mercadería para reponer el stock antes de imprimir la etiqueta.`,
                        details: stockIssues
                    });
                }
            }
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
            error: 'Error interno del servidor',
            message: error.message
        });
    }
});

// ================================================================
// POST /api/orders/mark-printed-bulk - Mark multiple orders as printed
// ================================================================
ordersRouter.post('/mark-printed-bulk', requirePermission(Module.ORDERS, Permission.EDIT), async (req: AuthRequest, res: Response) => {
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

        // Get all orders with line_items for stock checking
        const { data: existingOrders, error: fetchError } = await supabaseAdmin
            .from('orders')
            .select('id, printed, sleeves_status, line_items, order_number')
            .in('id', order_ids)
            .eq('store_id', storeId);

        if (fetchError) {
            throw fetchError;
        }

        // First pass: Check stock for all orders that need status change
        const ordersWithStockIssues: Array<{ order_id: string; order_number: string; issues: any[] }> = [];

        for (const order of existingOrders || []) {
            if (order.sleeves_status !== 'in_preparation') continue;

            const lineItems = order.line_items || [];
            if (!Array.isArray(lineItems) || lineItems.length === 0) continue;

            const stockIssues: any[] = [];

            for (const item of lineItems) {
                const productId = item.product_id;
                const requiredQty = parseInt(item.quantity) || 0;

                if (!productId || requiredQty <= 0) continue;

                const { data: product } = await supabaseAdmin
                    .from('products')
                    .select('name, sku, stock')
                    .eq('id', productId)
                    .eq('store_id', storeId)
                    .single();

                if (product && (product.stock || 0) < requiredQty) {
                    stockIssues.push({
                        product_name: product.name || item.name || 'Producto',
                        required: requiredQty,
                        available: product.stock || 0
                    });
                }
            }

            if (stockIssues.length > 0) {
                ordersWithStockIssues.push({
                    order_id: order.id,
                    order_number: order.order_number || order.id.slice(0, 8),
                    issues: stockIssues
                });
            }
        }

        // If any orders have stock issues, return error with details
        if (ordersWithStockIssues.length > 0) {
            const ordersList = ordersWithStockIssues
                .map(o => `Pedido ${o.order_number}: ${o.issues.map(i => `${i.product_name} (necesita ${i.required}, disponible ${i.available})`).join(', ')}`)
                .join('\n');

            console.warn(`⚠️ [ORDERS] Stock insuficiente en ${ordersWithStockIssues.length} pedidos`);

            return res.status(400).json({
                error: 'Insufficient stock',
                code: 'INSUFFICIENT_STOCK',
                message: `No hay suficiente stock para completar estos pedidos:\n\n${ordersList}\n\nRecibe mercadería para reponer el stock.`,
                details: ordersWithStockIssues
            });
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
            error: 'Error interno del servidor',
            message: error.message
        });
    }
});

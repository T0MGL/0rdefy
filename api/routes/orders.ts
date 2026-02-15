// ================================================================
// NEONFLOW API - ORDERS ROUTES
// ================================================================
// CRUD operations for orders with WhatsApp confirmation tracking
// MVP: Uses hardcoded store_id, no authentication
// Uses Supabase JS client for database operations
// ================================================================

import { logger } from '../utils/logger';
import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../db/connection';
import { verifyToken, extractStoreId, AuthRequest } from '../middleware/auth';
import { extractUserRole, requireModule, requirePermission, PermissionRequest } from '../middleware/permissions';
import { checkOrderLimit, PlanLimitRequest } from '../middleware/planLimits';
import { Module, Permission } from '../permissions';
import { generateDeliveryQRCode } from '../utils/qr-generator';
import { ShopifyGraphQLClientService } from '../services/shopify-graphql-client.service';
import { isValidUUID, validateUUIDParam } from '../utils/sanitize';
import { getTodayInTimezone } from '../utils/dateUtils';

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
                ),
                stores!orders_store_id_fkey (
                    name,
                    currency
                )
            `)
            .eq('delivery_link_token', token)
            .single();

        if (error || !data) {
            return res.status(404).json({
                error: 'Order not found',
                message: 'El código QR no es válido o el pedido no existe'
            });
        }


        // Get store currency (default to PYG if not set)
        const storeCurrency = data.stores?.currency || 'PYG';

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
                    store_id: data.store_id,
                    store_name: data.stores?.name || 'Ordefy',
                    currency: storeCurrency
                }
            });
        }

        // Check if order has incident - treat as pending with incident flag
        // This allows the courier to complete retry attempts
        if (data.sleeves_status === 'incident' || data.has_active_incident) {
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
                    store_id: data.store_id,
                    store_name: data.stores?.name || 'Ordefy',
                    currency: storeCurrency
                }
            });
        }

        // Determine if order is prepaid (either from Shopify or manually marked)
        const financialStatus = (data.financial_status || '').toLowerCase();
        const isPaidOnline = financialStatus === 'paid' || financialStatus === 'authorized';
        const isPrepaid = !!data.prepaid_method;

        // CRITICAL: If order is paid (Shopify or manual prepaid), cod_amount MUST be 0
        // This prevents showing wrong collection amount to courier
        const effectiveCodAmount = (isPaidOnline || isPrepaid) ? 0 : (data.cod_amount || 0);

        // Return delivery information for pending deliveries (including incidents)
        const deliveryInfo = {
            id: data.id,
            customer_name: `${data.customer_first_name || ''} ${data.customer_last_name || ''}`.trim(),
            customer_phone: data.customer_phone,
            customer_address: data.customer_address,
            address_reference: data.address_reference,
            neighborhood: data.neighborhood,
            latitude: data.latitude,
            longitude: data.longitude,
            google_maps_link: data.google_maps_link,
            total_price: data.total_price,
            cod_amount: effectiveCodAmount,
            payment_method: data.payment_method,
            // Payment status fields for courier display
            financial_status: data.financial_status,
            prepaid_method: data.prepaid_method,
            is_prepaid: isPaidOnline || isPrepaid,
            line_items: data.line_items,
            delivery_status: data.delivery_status,
            sleeves_status: data.sleeves_status,
            has_active_incident: data.has_active_incident || false,
            carrier_name: data.carriers?.name,
            store_id: data.store_id,
            store_name: data.stores?.name || 'Ordefy',
            currency: storeCurrency
        };

        res.json({
            already_delivered: false,
            delivery_failed: false,
            data: deliveryInfo
        });
    } catch (error: any) {
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


        // SECURITY: Look up order by token - only valid tokens can access
        const { data: existingOrder, error: fetchError } = await supabaseAdmin
            .from('orders')
            .select('id, store_id, sleeves_status, courier_id, has_active_incident, cod_amount, total_price, payment_method')
            .eq('delivery_link_token', token)
            .single();

        if (fetchError || !existingOrder) {
            return res.status(404).json({
                error: 'Order not found',
                message: 'Token de entrega inválido o expirado'
            });
        }

        const id = existingOrder.id;

        // Check if order has an active incident
        if (existingOrder.has_active_incident) {
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
            } else {
                // No discrepancy reported - assume full amount collected
                const expectedAmount = existingOrder.cod_amount || existingOrder.total_price || 0;
                updateData.amount_collected = expectedAmount;
                updateData.has_amount_discrepancy = false;
            }
        } else {
            // PREPAID payment (tarjeta, qr, transferencia): no cash collected
            // The payment already went directly to the store
            updateData.amount_collected = 0;
            updateData.has_amount_discrepancy = false;
            // IMPORTANT: Set prepaid_method so reconciliation knows this is NOT COD
            // This handles the case where order was created as COD but customer paid via transfer/QR
            updateData.prepaid_method = payment_method; // 'transferencia', 'qr', 'tarjeta', etc.
            updateData.prepaid_at = new Date().toISOString();
        }

        const { data, error } = await supabaseAdmin
            .from('orders')
            .update(updateData)
            .eq('id', id)
            .select()
            .single();

        if (error || !data) {
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
                scheduled_date: getTodayInTimezone(),
                actual_date: getTodayInTimezone(),
                status: 'delivered',
                payment_method: payment_method || null,
                notes: notes || null,
                photo_url: proof_photo_url || null
            });

        // Build notes for status history
        let historyNotes = `Delivery confirmed by courier`;
        if (payment_method) historyNotes += ` - Payment: ${payment_method}`;
        if (isCodPayment && updateData.has_amount_discrepancy) {
            historyNotes += ` - MONTO DIFERENTE COBRADO: ${amount_collected?.toLocaleString()} (esperado: ${(existingOrder.cod_amount || existingOrder.total_price || 0).toLocaleString()})`;
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


        // SECURITY: Look up order by token - only valid tokens can access
        const { data: existingOrder, error: fetchError } = await supabaseAdmin
            .from('orders')
            .select('id, store_id, sleeves_status, courier_id, has_active_incident')
            .eq('delivery_link_token', token)
            .single();

        if (fetchError || !existingOrder) {
            return res.status(404).json({
                error: 'Order not found',
                message: 'Token de entrega inválido o expirado'
            });
        }

        const id = existingOrder.id;

        // Check if order has an active incident
        if (existingOrder.has_active_incident) {
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
                scheduled_date: getTodayInTimezone(),
                actual_date: getTodayInTimezone(),
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


        res.json({
            message: 'Delivery failure reported',
            data
        });
    } catch (error: any) {
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


        // Get the order to verify it's delivered
        const { data: existingOrder, error: fetchError } = await supabaseAdmin
            .from('orders')
            .select('id, store_id, delivery_status, courier_id, delivery_rating')
            .eq('id', id)
            .single();

        if (fetchError || !existingOrder) {
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
            return res.status(500).json({
                error: 'Error al guardar calificación'
            });
        }


        res.json({
            message: 'Gracias por tu calificación',
            data: {
                rating: data.delivery_rating,
                comment: data.delivery_rating_comment,
                rated_at: data.rated_at
            }
        });
    } catch (error: any) {
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


        // First, get the order to verify it exists
        const { data: existingOrder, error: fetchError } = await supabaseAdmin
            .from('orders')
            .select('id, store_id, sleeves_status, delivery_status')
            .eq('id', id)
            .single();

        if (fetchError || !existingOrder) {
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


        res.json({
            message: 'Order cancelled successfully',
            data
        });
    } catch (error: any) {
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
function mapStatus(dbStatus: string): 'pending' | 'contacted' | 'awaiting_carrier' | 'confirmed' | 'in_preparation' | 'ready_to_ship' | 'shipped' | 'in_transit' | 'delivered' | 'returned' | 'cancelled' | 'incident' {
    const statusMap: Record<string, 'pending' | 'contacted' | 'awaiting_carrier' | 'confirmed' | 'in_preparation' | 'ready_to_ship' | 'shipped' | 'in_transit' | 'delivered' | 'returned' | 'cancelled' | 'incident'> = {
        'pending': 'pending',
        'contacted': 'contacted',
        'awaiting_carrier': 'awaiting_carrier',
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
            carrier_id,
            search,
            startDate,
            endDate,
            show_test = 'true',        // Filter for test orders
            show_deleted = 'true',     // Show soft-deleted orders (with opacity)
            scheduled_filter = 'all'   // Filter for scheduled deliveries: 'all' | 'scheduled' | 'ready'
        } = req.query;

        // Build query - OPTIMIZED (Migration 083)
        // ✅ SELECT explicit fields (15 vs 60+ columns = 75% less data)
        // ✅ Removed customers JOIN (not used in list view)
        // ✅ Removed products nested JOIN (image_url already in order_line_items)
        // ✅ count: 'exact' for accurate totals with server-side filters
        let query = supabaseAdmin
            .from('orders')
            .select(`
                id,
                shopify_order_id,
                shopify_order_name,
                shopify_order_number,
                payment_gateway,
                customer_first_name,
                customer_last_name,
                customer_phone,
                customer_address,
                total_price,
                sleeves_status,
                payment_status,
                courier_id,
                created_at,
                confirmed_at,
                delivery_link_token,
                latitude,
                longitude,
                google_maps_link,
                printed,
                printed_at,
                printed_by,
                deleted_at,
                deleted_by,
                deletion_type,
                is_test,
                rejection_reason,
                confirmation_method,
                cod_amount,
                amount_collected,
                has_amount_discrepancy,
                financial_status,
                payment_method,
                prepaid_method,
                total_discounts,
                neighborhood,
                address_reference,
                shipping_city,
                delivery_zone,
                is_pickup,
                delivery_preferences,
                delivery_notes,
                internal_notes,
                n8n_sent,
                n8n_processed_at,
                shopify_shipping_method,
                line_items,
                order_line_items (
                    id,
                    product_id,
                    product_name,
                    variant_title,
                    quantity,
                    unit_price,
                    total_price,
                    image_url
                ),
                carriers!orders_courier_id_fkey (
                    id,
                    name
                )
            `, { count: 'exact' })
            .eq('store_id', req.storeId)
            .order('created_at', { ascending: false })
            .range(safeNumber(offset, 0), safeNumber(offset, 0) + safeNumber(limit, 20) - 1);

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
            console.log('[ORDERS FILTER] Status filter:', status);
            query = query.eq('sleeves_status', status);
        }

        // Carrier filter
        if (carrier_id) {
            const carrierStr = carrier_id as string;
            if (carrierStr === 'pickup') {
                query = query.eq('is_pickup', true);
            } else if (carrierStr === 'none') {
                // Orders without carrier and NOT pickup (is_pickup can be NULL or false)
                // Use .is() for courier_id NULL check combined with .in() for is_pickup values
                query = query.is('courier_id', null).in('is_pickup', [null, false]);
            } else {
                query = query.eq('courier_id', carrierStr);
            }
        }

        // Text search (customer name, phone, shopify order name, order ID, shopify order number)
        if (search) {
            const searchStr = (search as string).trim();
            console.log('[ORDERS SEARCH] Received search query:', searchStr);
            if (searchStr.length > 0) {
                // Check if search string is a UUID (for exact ID search)
                const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
                const isUUID = uuidRegex.test(searchStr);

                if (isUUID) {
                    // Exact UUID search
                    query = query.eq('id', searchStr);
                } else {
                    // Sanitize for PostgREST filter syntax safety - only remove SQL wildcards
                    // Keep common chars like ().-,# for phone/address searches
                    const searchClean = searchStr.replace(/[%_\\]/g, '').trim();
                    if (searchClean.length > 0) {
                        // Search using full phrase in all fields (more accurate than word-by-word OR)
                        // This ensures "Juan Perez" only matches customers with both words in their name
                        // Split into words for additional individual word search
                        const words = searchClean.split(/\s+/).filter(w => w.length > 0);

                        if (words.length > 1) {
                            // Multiple words: search full phrase + individual words with priority to full phrase
                            // Strategy: Use full phrase match for better precision
                            // Full phrase in first name, last name, or phone
                            const fullPhraseCondition = `customer_first_name.ilike.%${searchClean}%,customer_last_name.ilike.%${searchClean}%,customer_phone.ilike.%${searchClean}%`;

                            // Also search in order fields (shopify_order_name, shopify_order_number)
                            const orderFieldsCondition = `shopify_order_name.ilike.%${searchClean}%,shopify_order_number.ilike.%${searchClean}%,id.ilike.%${searchClean}%`;

                            // Combine all conditions
                            query = query.or(`${fullPhraseCondition},${orderFieldsCondition}`);
                        } else {
                            // Single word: search in all fields as before
                            query = query.or(
                                `customer_first_name.ilike.%${searchClean}%,customer_last_name.ilike.%${searchClean}%,customer_phone.ilike.%${searchClean}%,shopify_order_name.ilike.%${searchClean}%,shopify_order_number.ilike.%${searchClean}%,id.ilike.%${searchClean}%`
                            );
                        }
                    }
                }
            }
        }

        if (customer_phone) {
            query = query.eq('customer_phone', customer_phone);
        }

        if (shopify_order_id) {
            query = query.eq('shopify_order_id', shopify_order_id);
        }

        // Date range filtering
        // Supports both full ISO timestamps (timezone-safe) and YYYY-MM-DD date strings (legacy)
        if (startDate) {
            query = query.gte('created_at', startDate as string);
        }

        if (endDate) {
            const endStr = endDate as string;
            if (endStr.includes('T')) {
                // Full ISO timestamp (includes end-of-day time) - use directly
                query = query.lte('created_at', endStr);
            } else {
                // Legacy YYYY-MM-DD format - add one day and use lte to include the full last day
                const endDateTime = new Date(endStr);
                endDateTime.setDate(endDateTime.getDate() + 1);
                query = query.lte('created_at', endDateTime.toISOString());
            }
        }

        // Scheduled delivery filter (Migration 125: server-side filtering)
        // Uses JSONB field with functional index for performance
        if (scheduled_filter === 'scheduled') {
            // Show only orders with future delivery restriction
            // Filter: delivery_preferences.not_before_date > TODAY
            const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
            query = query
                .not('delivery_preferences', 'is', null)
                .gt('delivery_preferences->not_before_date', today);
        } else if (scheduled_filter === 'ready') {
            // Show only orders ready to deliver (no future restriction or no delivery_preferences)
            // Filter: delivery_preferences IS NULL OR not_before_date <= TODAY
            const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
            query = query.or(
                `delivery_preferences.is.null,delivery_preferences->not_before_date.lte.${today}`
            );
        }
        // 'all' = no filter applied

        const { data, error, count } = await query;

        console.log('[ORDERS QUERY] Results:', {
            status: status || 'none',
            search: search || 'none',
            carrier_id: carrier_id || 'none',
            count: count,
            resultsLength: data?.length || 0,
            error: error?.message || 'none'
        });

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
                has_amount_discrepancy: order.has_amount_discrepancy,
                // Payment fields - CRITICAL for shipping labels
                financial_status: order.financial_status,
                payment_method: order.payment_method,
                total_price: order.total_price,
                total_discounts: order.total_discounts,
                // Address details for labels
                neighborhood: order.neighborhood,
                address_reference: order.address_reference,
                customer_address: order.customer_address,
                // NEW: Shopify city extraction
                shipping_city: order.shipping_city,
                delivery_zone: order.delivery_zone,
                // NEW: Internal admin notes (truncated indicator for list)
                internal_notes: order.internal_notes,
                has_internal_notes: !!order.internal_notes,
                // NEW: Shopify shipping method
                shopify_shipping_method: order.shopify_shipping_method,
                // Pickup and delivery
                is_pickup: order.is_pickup || false,
                delivery_notes: order.delivery_notes,
                delivery_preferences: order.delivery_preferences
            };
        }) || [];

        res.json({
            data: transformedData,
            pagination: {
                total: count || 0,
                limit: safeNumber(limit, 20),
                offset: safeNumber(offset, 0),
                hasMore: safeNumber(offset, 0) + (data?.length || 0) < (count || 0)
            }
        });
    } catch (error: any) {
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
            order_line_items: lineItems, // Also include as order_line_items for compatibility
            shopify_order_id: data.shopify_order_id,
            shopify_order_number: data.shopify_order_number,
            shopify_order_name: data.shopify_order_name,
            // Payment fields - CRITICAL for shipping labels
            financial_status: data.financial_status,
            payment_method: data.payment_method,
            payment_gateway: data.payment_gateway,
            cod_amount: data.cod_amount,
            total_price: data.total_price,
            total_discounts: data.total_discounts,
            // Carrier info
            carrier_id: data.courier_id,
            // Address details
            neighborhood: data.neighborhood,
            city: data.city,
            address_reference: data.address_reference,
            customer_address: data.customer_address,
            // NEW: Shopify city extraction
            shipping_city: data.shipping_city,
            shipping_city_normalized: data.shipping_city_normalized,
            // Print tracking
            printed: data.printed,
            printed_at: data.printed_at,
            printed_by: data.printed_by,
            // NEW: Internal admin notes
            internal_notes: data.internal_notes,
            has_internal_notes: !!data.internal_notes,
            // NEW: Shopify shipping method
            shopify_shipping_method: data.shopify_shipping_method,
            shopify_shipping_method_code: data.shopify_shipping_method_code,
            // Delivery notes (from customer/Shopify)
            delivery_notes: data.delivery_notes
        };

        res.json(transformedData);
    } catch (error: any) {
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
            shopify_raw_json,
            // New fields for shipping info from OrderForm
            google_maps_link,
            shipping_city,
            shipping_city_normalized,
            delivery_zone,
            is_pickup,
            // Internal admin notes
            internal_notes,
            // Upsell tracking
            upsell_added
        } = req.body;

        // Validation
        if (!customer_phone && !customer_email) {
            return res.status(400).json({
                error: 'Validation failed',
                message: 'Either customer_phone or customer_email is required'
            });
        }

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
                    // Fallback to legacy method if RPC not available
                    const { data: existingByPhone } = await supabaseAdmin
                        .from('customers')
                        .select('id')
                        .eq('store_id', req.storeId)
                        .or(`phone.eq.${(customer_phone || '').replace(/[,().]/g, '')},email.eq.${(customer_email || '').replace(/[,().]/g, '')}`)
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
                        }
                    }
                }
            }
        } catch (customerErr) {
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
                total_price: safeNumber(total_price, 0),
                subtotal_price: safeNumber(subtotal_price, 0),
                total_tax: total_tax ?? 0.0,
                total_shipping: total_shipping ?? 0.0,
                shipping_cost: shipping_cost ?? 0.0,
                currency,
                financial_status: financial_status || 'pending',
                payment_status: payment_status || 'pending',
                payment_method: payment_method || 'cash',
                courier_id: is_pickup ? null : courier_id,
                sleeves_status: 'pending',
                shopify_raw_json: shopify_raw_json || {},
                // New fields for shipping info
                google_maps_link: google_maps_link || null,
                shipping_city: shipping_city || null,
                shipping_city_normalized: shipping_city_normalized || null,
                delivery_zone: delivery_zone || null,
                is_pickup: is_pickup || false,
                // Internal admin notes (max 5000 chars)
                internal_notes: internal_notes?.trim()?.substring(0, 5000) || null,
                // Upsell tracking - true if line_items contains is_upsell item
                upsell_added: upsell_added || (Array.isArray(line_items) && line_items.some((item: any) => item.is_upsell))
            }])
            .select()
            .single();

        if (error) {
            throw error;
        }


        // Create normalized line items in order_line_items table (for manual orders)
        if (line_items && Array.isArray(line_items) && line_items.length > 0) {
            try {
                const normalizedLineItems = [];

                for (const item of line_items) {
                    // Try to find the product to get image_url
                    const productId = item.product_id || null;
                    const variantId = item.variant_id || null; // Migration 097: Variant support
                    let imageUrl = null;
                    let variantTitle = item.variant_title || null;
                    let variantSku = item.sku || null;
                    let unitsPerPack = item.units_per_pack || 1;
                    let unitPrice = safeNumber(item.price, 0);
                    // Migration 101: variant_type for bundle vs variation tracking
                    let variantType: string | null = item.variant_type || null; // Accept from payload for external webhooks

                    console.log('📦 [ORDER CREATE] Processing line item:', {
                        product_id: productId,
                        variant_id: variantId,
                        product_name: item.product_name,
                        name: item.name,
                        title: item.title
                    });

                    // Migration 097/101: If variant_id provided, fetch variant details including variant_type
                    if (variantId) {
                        const { data: variant, error: variantError } = await supabaseAdmin
                            .from('product_variants')
                            .select('id, product_id, variant_title, sku, price, units_per_pack, image_url, variant_type, uses_shared_stock')
                            .eq('id', variantId)
                            .maybeSingle();

                        if (variant && !variantError) {
                            variantTitle = variant.variant_title;
                            variantSku = variant.sku || variantSku;
                            unitPrice = safeNumber(variant.price, unitPrice);
                            unitsPerPack = variant.units_per_pack || 1;
                            imageUrl = variant.image_url || imageUrl;
                            // Migration 101: variant_type - payload takes priority, then DB, then infer from uses_shared_stock
                            if (!variantType) {
                                variantType = variant.variant_type || (variant.uses_shared_stock ? 'bundle' : 'variation');
                            }
                            console.log('📦 [ORDER CREATE] Variant found:', {
                                variant_id: variantId,
                                variant_title: variantTitle,
                                variant_type: variantType,
                                price: unitPrice,
                                units_per_pack: unitsPerPack
                            });
                        }
                    }

                    // Fetch product image if not from variant
                    if (productId && !imageUrl) {
                        const { data: product, error: productError } = await supabaseAdmin
                            .from('products')
                            .select('id, name, image_url')
                            .eq('id', productId)
                            .eq('store_id', req.storeId)
                            .maybeSingle();

                        console.log('📦 [ORDER CREATE] Product lookup result:', {
                            product_id: productId,
                            found: !!product,
                            product_name: product?.name,
                            image_url: product?.image_url,
                            error: productError?.message
                        });

                        if (product) {
                            imageUrl = product.image_url;
                        }
                    }

                    normalizedLineItems.push({
                        order_id: data.id,
                        product_id: productId,
                        variant_id: variantId, // Migration 097
                        variant_type: variantType, // Migration 101: bundle vs variation for audit trail
                        product_name: item.product_name || item.name || item.title || 'Producto',
                        variant_title: variantTitle,
                        sku: variantSku,
                        quantity: safeNumber(item.quantity, 1),
                        unit_price: unitPrice,
                        total_price: safeNumber(item.quantity, 1) * unitPrice,
                        units_per_pack: unitsPerPack, // Migration 097: Snapshot for audit
                        image_url: imageUrl,
                        is_upsell: item.is_upsell || false // Upsell tracking
                    });
                }

                console.log('📦 [ORDER CREATE] Inserting line items:', normalizedLineItems);

                if (normalizedLineItems.length > 0) {
                    const { error: lineItemsError } = await supabaseAdmin
                        .from('order_line_items')
                        .insert(normalizedLineItems);

                    if (lineItemsError) {
                        console.error('❌ [ORDER CREATE] Line items insert error:', lineItemsError);
                    } else {
                        console.log('✅ [ORDER CREATE] Line items inserted successfully');
                    }
                }
            } catch (lineItemsErr) {
                // Non-blocking
            }
        }

        res.status(201).json({
            message: 'Order created successfully',
            data
        });
    } catch (error: any) {
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
            courier_id,
            payment_method,
            payment_status,
            internal_notes,
            version // Optimistic locking: client sends current version
        } = req.body;

        // ================================================================
        // CRITICAL: Fetch existing order to detect label-critical changes
        // ================================================================
        const { data: existingOrder, error: fetchError } = await supabaseAdmin
            .from('orders')
            .select('customer_phone, customer_address, customer_first_name, customer_last_name, courier_id, payment_method, printed')
            .eq('id', id)
            .eq('store_id', req.storeId)
            .single();

        if (fetchError || !existingOrder) {
            return res.status(404).json({
                error: 'Order not found'
            });
        }

        // Build update object with only provided fields
        const updateData: any = {
            updated_at: new Date().toISOString(),
            last_modified_by: req.user?.id || null
        };

        // Track if any label-critical field is changing
        let labelDataChanged = false;

        if (customer_email !== undefined) updateData.customer_email = customer_email;
        if (customer_phone !== undefined) {
            updateData.customer_phone = customer_phone;
            if (customer_phone !== existingOrder.customer_phone) labelDataChanged = true;
        }
        if (customer_first_name !== undefined) {
            updateData.customer_first_name = customer_first_name;
            if (customer_first_name !== existingOrder.customer_first_name) labelDataChanged = true;
        }
        if (customer_last_name !== undefined) {
            updateData.customer_last_name = customer_last_name;
            if (customer_last_name !== existingOrder.customer_last_name) labelDataChanged = true;
        }
        if (customer_address !== undefined) {
            updateData.customer_address = customer_address;
            if (customer_address !== existingOrder.customer_address) labelDataChanged = true;
        }
        if (billing_address !== undefined) updateData.billing_address = billing_address;
        if (shipping_address !== undefined) updateData.shipping_address = shipping_address;
        if (line_items !== undefined) {
            updateData.line_items = line_items;
            labelDataChanged = true; // Products changed = label needs update
        }
        if (total_price !== undefined) updateData.total_price = safeNumber(total_price, 0);
        if (subtotal_price !== undefined) updateData.subtotal_price = safeNumber(subtotal_price, 0);
        if (total_tax !== undefined) updateData.total_tax = safeNumber(total_tax, 0);
        if (total_shipping !== undefined) updateData.total_shipping = safeNumber(total_shipping, 0);
        if (shipping_cost !== undefined) updateData.shipping_cost = safeNumber(shipping_cost, 0);
        if (currency !== undefined) updateData.currency = currency;
        if (upsell_added !== undefined) updateData.upsell_added = upsell_added;

        // Handle courier_id (carrier)
        if (courier_id !== undefined) {
            updateData.courier_id = courier_id;
            if (courier_id !== existingOrder.courier_id) labelDataChanged = true;
        }

        // Handle payment_method and payment_status (critical for COD vs Prepaid labels)
        if (payment_method !== undefined) {
            updateData.payment_method = payment_method;
            if (payment_method !== existingOrder.payment_method) labelDataChanged = true;
        }
        if (payment_status !== undefined) {
            updateData.payment_status = payment_status;
        }

        // Handle internal notes (admin only)
        if (internal_notes !== undefined) {
            updateData.internal_notes = internal_notes?.trim()?.substring(0, 5000) || null;
        }

        // ================================================================
        // CRITICAL: Invalidate printed label if label-critical data changed
        // This forces re-printing with updated info
        // ================================================================
        if (labelDataChanged && existingOrder.printed) {
            updateData.printed = false;
            updateData.printed_at = null;
            updateData.printed_by = null;
        }

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
            ? lineItems.reduce((sum: number, item: any) => sum + safeNumber(item.quantity, 0), 0)
            : 1;

        const transformedData = {
            id: data.id,
            customer: `${data.customer_first_name || ''} ${data.customer_last_name || ''}`.trim() || 'Cliente',
            address: data.customer_address || '',
            customer_address: data.customer_address || '',
            product: firstItem?.product_name || firstItem?.title || 'Producto',
            quantity: totalQuantity || 1,
            total: data.total_price || 0,
            total_price: data.total_price || 0,
            status: mapStatus(data.sleeves_status),
            payment_status: data.payment_status,
            payment_method: data.payment_method,
            carrier: data.carriers?.name || 'Sin transportadora',
            carrier_id: data.courier_id,
            date: data.created_at,
            phone: data.customer_phone || '',
            confirmedByWhatsApp: data.sleeves_status === 'confirmed' || data.sleeves_status === 'shipped' || data.sleeves_status === 'delivered',
            confirmationTimestamp: data.confirmed_at,
            confirmationMethod: data.confirmation_method as any,
            rejectionReason: data.rejection_reason,
            delivery_link_token: data.delivery_link_token,
            latitude: data.latitude,
            longitude: data.longitude,
            version: data.version, // Include version for optimistic locking
            // Print tracking fields
            printed: data.printed,
            printed_at: data.printed_at,
            printed_by: data.printed_by,
            // Internal admin notes
            internal_notes: data.internal_notes,
            has_internal_notes: !!data.internal_notes,
            // Line items for edit dialog
            order_line_items: lineItems
        };

        res.json(transformedData);
    } catch (error: any) {
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
    contacted: 'Contactado',
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
        contacted: { allowed: true },      // Mark as contacted (WhatsApp sent)
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
    contacted: {
        pending: { allowed: true },        // Revert to pending
        confirmed: { allowed: true },      // Customer confirmed
        in_preparation: { allowed: true }, // Skip to preparation
        ready_to_ship: { allowed: true },  // Skip for manual workflows
        shipped: { allowed: true },        // Skip for manual workflows
        in_transit: { allowed: true },     // Skip for manual workflows
        delivered: { allowed: true },      // Skip for manual workflows
        cancelled: { allowed: true },
        rejected: { allowed: true },
        returned: { allowed: true },
        incident: { allowed: true },
    },
    confirmed: {
        pending: { allowed: true },        // Revert to pending
        contacted: { allowed: true },      // Revert to contacted
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
        contacted: { allowed: true },      // Revert to contacted
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
        contacted: { allowed: true, requiresStockRestore: true },     // Revert to contacted (restores stock)
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
        contacted: { allowed: true, requiresStockRestore: true },     // Revert to contacted
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
        contacted: { allowed: true, requiresStockRestore: true },     // Revert to contacted
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
        contacted: { allowed: false, message: 'Un pedido entregado no puede volver a contactado. Usa "Devuelto" si es necesario.' },
        confirmed: { allowed: false, message: 'Un pedido entregado no puede volver a confirmado. Usa "Devuelto" si es necesario.' },
        in_preparation: { allowed: false, message: 'Un pedido entregado no puede volver a preparación.' },
        ready_to_ship: { allowed: false, message: 'Un pedido entregado no puede volver a listo para enviar.' },
        shipped: { allowed: false, message: 'Un pedido entregado no puede volver a despachado.' },
        in_transit: { allowed: false, message: 'Un pedido entregado no puede volver a en tránsito.' },
        cancelled: { allowed: false, message: 'Un pedido ya entregado no puede cancelarse. Usa "Devuelto" si el cliente lo devuelve.' },
    },
    cancelled: {
        pending: { allowed: true },        // Reactivate
        contacted: { allowed: true },      // Reactivate to contacted
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
        contacted: { allowed: true },      // Reactivate to contacted
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
        contacted: { allowed: true },      // Allow if marked returned by mistake
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
        contacted: { allowed: true },      // Can go to contacted
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

        const validStatuses = ['pending', 'contacted', 'awaiting_carrier', 'confirmed', 'in_preparation', 'ready_to_ship', 'in_transit', 'delivered', 'cancelled', 'rejected', 'returned', 'shipped', 'incident'];
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
            .select(`
                sleeves_status, delivery_link_token, line_items, store_id, deleted_at,
                order_line_items (id, product_id, quantity, product_name)
            `)
            .eq('id', id)
            .eq('store_id', req.storeId)
            .is('deleted_at', null)
            .single();

        if (fetchError || !currentOrder) {
            // Debug: Try to find order without store_id filter to diagnose the issue
            const { data: debugOrder } = await supabaseAdmin
                .from('orders')
                .select('id, store_id, deleted_at, sleeves_status')
                .eq('id', id)
                .single();

            console.error('[PATCH /status] Order not found:', {
                requestedId: id,
                requestedStoreId: req.storeId,
                foundOrder: debugOrder ? {
                    id: debugOrder.id,
                    store_id: debugOrder.store_id,
                    deleted_at: debugOrder.deleted_at,
                    status: debugOrder.sleeves_status,
                    storeIdMatch: debugOrder.store_id === req.storeId
                } : 'NOT_FOUND_AT_ALL',
                fetchError: fetchError?.message
            });

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

        // ================================================================
        // CRITICAL: Check stock availability before moving to ready_to_ship
        // This prevents the trigger from failing with insufficient stock
        // ================================================================
        if (toStatus === 'ready_to_ship' && fromStatus !== 'ready_to_ship') {
            // Use normalized order_line_items first (Shopify orders), fallback to JSONB line_items (manual orders)
            const normalizedItems = (currentOrder as any).order_line_items || [];
            const jsonbItems = currentOrder.line_items || [];
            const lineItems = normalizedItems.length > 0 ? normalizedItems : jsonbItems;

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
                    const requiredQty = safeNumber(item.quantity, 0);

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

        if (sleeves_status === 'contacted') {
            updateData.contacted_at = new Date().toISOString();
            updateData.contacted_by = confirmed_by || 'api';
            updateData.contacted_method = confirmation_method || 'whatsapp';
        }

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

        if (error || !data) {
            return res.status(404).json({
                error: 'Order not found',
                details: error?.message
            });
        }

        // Sync cancellation to Shopify if order is from Shopify
        if ((sleeves_status === 'cancelled' || sleeves_status === 'rejected' || sleeves_status === 'returned') &&
            data.shopify_order_id) {
            try {
                // Get Shopify integration for this store
                const { data: integration } = await supabaseAdmin
                    .from('shopify_integrations')
                    .select('shop_domain, access_token')
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
                }
            } catch (shopifyError: any) {
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

            } catch (qrError) {
                // Continue anyway - QR can be regenerated later
            }
        }

        // Apply status mapping before returning (shipped -> in_transit for frontend consistency)
        const responseData = {
            ...data,
            sleeves_status: mapStatus(data.sleeves_status),
            has_internal_notes: !!data.internal_notes
        };

        res.json({
            message: 'Order status updated successfully',
            data: responseData
        });
    } catch (error: any) {
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
            .select('id, old_status, new_status, changed_by, created_at')
            .eq('order_id', id)
            .order('created_at', { ascending: false })
            .limit(50);

        if (error) {
            throw error;
        }

        res.json({
            data: data || []
        });
    } catch (error: any) {
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

            // Hard delete (trigger will handle cascading cleanup + stock restoration)
            const { data, error } = await supabaseAdmin
                .from('orders')
                .delete()
                .eq('id', id)
                .eq('store_id', req.storeId)
                .select('id')
                .single();

            if (error) {
                return res.status(400).json({
                    error: 'Cannot delete order',
                    message: error.message
                });
            }

            const wasStockAffected = order.sleeves_status && ['ready_to_ship', 'shipped', 'delivered'].includes(order.sleeves_status);

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
                return res.status(500).json({
                    error: 'Error al eliminar pedido',
                    message: error?.message
                });
            }


            return res.json({
                success: true,
                message: 'Order hidden successfully. It will appear with reduced opacity until the owner permanently deletes it.',
                id: data.id,
                deletion_type: 'soft'
            });
        }
    } catch (error: any) {
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


        // Call database function to mark/unmark as test
        const { data, error } = await supabaseAdmin
            .rpc('mark_order_as_test', {
                p_order_id: id,
                p_marked_by: userId,
                p_is_test: is_test
            });

        if (error) {
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

        res.json({
            message: result.message,
            id: result.order_id,
            is_test
        });
    } catch (error: any) {
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
        res.status(500).json({
            error: 'Error al actualizar estado del pedido',
            message: error.message
        });
    }
});

// ================================================================
// PATCH /api/orders/:id/mark-prepaid - Mark COD order as prepaid
// ================================================================
// Use this endpoint when a COD order has been paid via bank transfer
// BEFORE delivery (customer paid upfront). This updates:
// - financial_status = 'paid'
// - cod_amount = 0 (nothing to collect at delivery)
// - prepaid_method = 'transfer' (or specified method)
// - prepaid_at = current timestamp
// - prepaid_by = user who marked it
//
// This is useful for:
// - Orders confirmed before the prepaid system was implemented
// - Orders that need to be marked as prepaid after confirmation
// - Remote areas where payment is required before shipping
ordersRouter.patch('/:id/mark-prepaid', validateUUIDParam('id'), requirePermission(Module.ORDERS, Permission.EDIT), async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const storeId = req.storeId;
        const userId = req.userId;
        const { prepaid_method = 'transfer' } = req.body;

        // Valid prepaid methods
        const validMethods = ['transfer', 'efectivo_local', 'qr', 'otro'];
        if (!validMethods.includes(prepaid_method)) {
            return res.status(400).json({
                error: 'Invalid prepaid method',
                message: `prepaid_method must be one of: ${validMethods.join(', ')}`,
                valid_methods: validMethods
            });
        }

        // First, check current order state
        const { data: order, error: fetchError } = await supabaseAdmin
            .from('orders')
            .select('id, sleeves_status, financial_status, cod_amount, prepaid_method')
            .eq('id', id)
            .eq('store_id', storeId)
            .single();

        if (fetchError || !order) {
            return res.status(404).json({
                error: 'Order not found',
                message: 'El pedido no existe o no pertenece a esta tienda'
            });
        }

        // Check if already prepaid
        if (order.prepaid_method) {
            return res.status(400).json({
                error: 'Already prepaid',
                message: 'Este pedido ya fue marcado como prepago',
                prepaid_method: order.prepaid_method
            });
        }

        // Check if already paid online (Shopify)
        if (order.financial_status === 'paid' || order.financial_status === 'authorized') {
            return res.status(400).json({
                error: 'Already paid',
                message: 'Este pedido ya está pagado (Shopify/Online)',
                financial_status: order.financial_status
            });
        }

        // Update order to mark as prepaid
        const { data: updatedOrder, error: updateError } = await supabaseAdmin
            .from('orders')
            .update({
                financial_status: 'paid',
                cod_amount: 0,
                prepaid_method: prepaid_method,
                prepaid_at: new Date().toISOString(),
                prepaid_by: userId,
                updated_at: new Date().toISOString()
            })
            .eq('id', id)
            .eq('store_id', storeId)
            .select()
            .single();

        if (updateError) {
            throw updateError;
        }

        // Add to order status history
        await supabaseAdmin
            .from('order_status_history')
            .insert({
                order_id: id,
                status: order.sleeves_status, // Keep current status
                notes: `Pedido marcado como prepago (${prepaid_method}). COD: ${order.cod_amount?.toLocaleString() || 0} → 0`,
                changed_by: userId,
                created_at: new Date().toISOString()
            });

        logger.info('ORDERS', `Order ${id} marked as prepaid`, {
            method: prepaid_method,
            previous_cod: order.cod_amount,
            marked_by: userId
        });

        res.json({
            success: true,
            message: 'Pedido marcado como prepago - Transportador no debe cobrar',
            data: {
                id: updatedOrder.id,
                financial_status: 'paid',
                cod_amount: 0,
                prepaid_method: prepaid_method,
                prepaid_at: updatedOrder.prepaid_at,
                previous_cod_amount: order.cod_amount
            }
        });

    } catch (error: any) {
        logger.error('ORDERS', `Error marking order as prepaid: ${error.message}`);
        res.status(500).json({
            error: 'Error marking order as prepaid',
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
            .gte('risk_score', safeNumber(threshold, 70))
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
//
// SEPARATE CONFIRMATION FLOW (stores.separate_confirmation_flow = true):
// When enabled, confirmadores confirm WITHOUT assigning carrier.
// The order goes to 'awaiting_carrier' status, and admin assigns carrier later.
ordersRouter.post('/:id/confirm', requirePermission(Module.ORDERS, Permission.EDIT), async (req: PermissionRequest, res: Response) => {
    try {
        const { id } = req.params;
        const {
            upsell_added = false,
            upsell_product_id,
            upsell_quantity = 1,
            upsell_product_name,
            courier_id,
            is_pickup = false,  // Explicit pickup flag from frontend
            address,
            latitude,
            longitude,
            google_maps_link,
            delivery_zone,
            shipping_cost,
            shipping_city,
            discount_amount,
            mark_as_prepaid = false,  // NEW: Mark COD order as prepaid (transfer before shipping)
            prepaid_method = 'transfer',  // NEW: Method used for prepayment
            delivery_preferences = null,   // NEW: Delivery scheduling preferences (date, time slot, notes)
            force_without_carrier = false  // NEW: Force separate flow even if courier_id provided
        } = req.body;

        // Use explicit is_pickup flag from frontend (not inferred from !courier_id)
        // This is critical for separate confirmation flow where confirmadores don't select carriers
        const isPickupOrder = is_pickup === true;

        // ================================================================
        // CHECK FOR SEPARATE CONFIRMATION FLOW
        // ================================================================
        // If store has separate_confirmation_flow enabled AND user is confirmador
        // AND no carrier is provided (not pickup), use the separate flow
        const { data: storeConfig } = await supabaseAdmin
            .from('stores')
            .select('separate_confirmation_flow')
            .eq('id', req.storeId)
            .single();

        const separateFlowEnabled = storeConfig?.separate_confirmation_flow === true;
        const userRole = (req as any).userRole || 'owner'; // From permission middleware
        const isConfirmador = userRole === 'confirmador';

        // Use separate flow if:
        // 1. Store has it enabled AND
        // 2. User is confirmador (not admin/owner) AND
        // 3. No courier_id provided AND
        // 4. Not a pickup order
        const useSeparateFlow = separateFlowEnabled && isConfirmador && !courier_id && !isPickupOrder;

        if (useSeparateFlow) {
            // ================================================================
            // SEPARATE FLOW: Confirm without carrier (Step 1)
            // ================================================================
            const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc('confirm_order_without_carrier', {
                p_order_id: id,
                p_store_id: req.storeId,
                p_confirmed_by: req.userId || 'confirmador',
                p_address: address || null,
                p_google_maps_link: google_maps_link || null,
                p_discount_amount: discount_amount !== undefined ? Number(discount_amount) : null,
                p_mark_as_prepaid: mark_as_prepaid === true,
                p_prepaid_method: mark_as_prepaid ? (prepaid_method || 'transfer') : null
            });

            if (rpcError) {
                const errorMessage = rpcError.message || '';

                if (errorMessage.includes('ORDER_NOT_FOUND')) {
                    return res.status(404).json({
                        error: 'Order not found',
                        message: 'El pedido no existe o no pertenece a esta tienda',
                        code: 'ORDER_NOT_FOUND'
                    });
                }

                if (errorMessage.includes('INVALID_STATUS')) {
                    return res.status(400).json({
                        error: 'Invalid order status',
                        message: 'Solo se pueden confirmar pedidos pendientes o contactados.',
                        code: 'INVALID_STATUS'
                    });
                }

                if (errorMessage.includes('FEATURE_DISABLED')) {
                    return res.status(400).json({
                        error: 'Feature disabled',
                        message: 'El flujo de confirmación separado no está habilitado para esta tienda.',
                        code: 'FEATURE_DISABLED'
                    });
                }

                return res.status(500).json({
                    error: 'Confirmation failed',
                    message: 'Error al confirmar el pedido.',
                    details: errorMessage
                });
            }

            const result = rpcResult as {
                success: boolean;
                order_id: string;
                new_status: string;
                confirmed_by: string;
                confirmed_at: string;
                was_marked_prepaid: boolean;
                new_total_price: number;
                new_cod_amount: number;
                discount_applied: boolean;
                discount_amount: number;
            };

            // Save delivery preferences if provided (non-blocking)
            if (delivery_preferences && typeof delivery_preferences === 'object') {
                try {
                    await supabaseAdmin
                        .from('orders')
                        .update({ delivery_preferences })
                        .eq('id', id);
                } catch (prefError) {
                    // Continue without preferences
                }
            }

            // Handle upsell in separate flow (non-blocking)
            // Upsell is added to order even before carrier assignment
            if (upsell_added && upsell_product_id) {
                try {
                    // Fetch the upsell product
                    const { data: upsellProduct } = await supabaseAdmin
                        .from('products')
                        .select('id, name, price, sku, image_url')
                        .eq('id', upsell_product_id)
                        .eq('store_id', req.storeId)
                        .single();

                    if (upsellProduct) {
                        // Get current order line_items
                        const { data: currentOrder } = await supabaseAdmin
                            .from('orders')
                            .select('line_items, total_price, subtotal_price')
                            .eq('id', id)
                            .single();

                        const currentLineItems = currentOrder?.line_items || [];
                        const upsellQty = upsell_quantity || 1;
                        const upsellPrice = Number(upsellProduct.price) || 0;

                        // Create upsell line item
                        const upsellLineItem = {
                            id: `upsell-${Date.now()}`,
                            product_id: upsellProduct.id,
                            title: upsellProduct.name,
                            name: upsellProduct.name,
                            quantity: upsellQty,
                            price: upsellPrice.toString(),
                            sku: upsellProduct.sku || '',
                            variant_title: 'Upsell',
                            is_upsell: true
                        };

                        // Update order with upsell
                        const newTotal = Number(currentOrder?.total_price || 0) + (upsellPrice * upsellQty);
                        await supabaseAdmin
                            .from('orders')
                            .update({
                                line_items: [...currentLineItems, upsellLineItem],
                                total_price: newTotal,
                                subtotal_price: newTotal,
                                upsell_added: true,
                                updated_at: new Date().toISOString()
                            })
                            .eq('id', id);

                        // Also add to normalized order_line_items table
                        await supabaseAdmin
                            .from('order_line_items')
                            .insert({
                                order_id: id,
                                product_id: upsellProduct.id,
                                product_name: upsellProduct.name,
                                variant_title: 'Upsell',
                                sku: upsellProduct.sku || null,
                                quantity: upsellQty,
                                price: upsellPrice,
                                image_url: upsellProduct.image_url,
                                is_upsell: true
                            });
                    }
                } catch (upsellError) {
                    // Log but don't fail - upsell is non-critical
                    console.error('Error adding upsell in separate flow:', upsellError);
                }
            }

            // Fetch the updated order for response
            const { data: updatedOrder } = await supabaseAdmin
                .from('orders')
                .select('*')
                .eq('id', id)
                .single();

            return res.json({
                message: 'Pedido confirmado. Pendiente de asignación de transportadora.',
                data: {
                    ...updatedOrder,
                    awaiting_carrier: true,
                    was_marked_prepaid: result.was_marked_prepaid,
                    delivery_preferences: delivery_preferences || null
                },
                meta: {
                    separate_flow: true,
                    new_status: 'awaiting_carrier',
                    discount_applied: result.discount_applied,
                    discount_amount: result.discount_amount,
                    final_total: result.new_total_price,
                    final_cod_amount: result.new_cod_amount,
                    was_marked_prepaid: result.was_marked_prepaid,
                    has_delivery_preferences: !!delivery_preferences,
                    upsell_added: upsell_added && !!upsell_product_id
                }
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
            p_courier_id: courier_id || null,  // NULL for pickup orders
            p_address: address || null,
            p_latitude: latitude !== undefined ? Number(latitude) : null,
            p_longitude: longitude !== undefined ? Number(longitude) : null,
            p_google_maps_link: google_maps_link || null,
            p_delivery_zone: delivery_zone || null,
            p_shipping_cost: shipping_cost !== undefined ? Number(shipping_cost) : null,
            p_upsell_product_id: upsell_added && upsell_product_id ? upsell_product_id : null,
            p_upsell_quantity: upsell_added ? (upsell_quantity || 1) : 1,
            p_discount_amount: discount_amount !== undefined ? Number(discount_amount) : null,
            p_mark_as_prepaid: mark_as_prepaid === true,  // NEW: Mark COD as prepaid
            p_prepaid_method: mark_as_prepaid ? (prepaid_method || 'transfer') : null  // NEW: Prepaid method
        });

        if (rpcError) {

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
                    message: `El pedido ya está ${currentStatus}. Solo se pueden confirmar pedidos pendientes o contactados.`,
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
            carrier_name: string | null;
            is_pickup: boolean;
            was_marked_prepaid: boolean;
            final_financial_status: string;
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
        }
        if (result.discount_applied) {
        }

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
            } catch (qrError) {
                // Continue without QR code, don't fail the confirmation
            }
        }

        // Save delivery preferences if provided (non-blocking)
        if (delivery_preferences && typeof delivery_preferences === 'object') {
            try {
                await supabaseAdmin
                    .from('orders')
                    .update({ delivery_preferences })
                    .eq('id', id);
            } catch (prefError) {
                // Continue without preferences, don't fail the confirmation
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
                            parts.push(`with discount: -${result.discount_amount.toLocaleString()}`);
                        }
                        if (delivery_preferences) {
                            parts.push('with delivery preferences');
                        }
                        return parts.join(' ');
                    })()
                });
        } catch (historyError) {
            // Continue, this is just audit logging
        }

        res.json({
            message: result.was_marked_prepaid
                ? 'Order confirmed as prepaid (pagado por transferencia)'
                : result.is_pickup
                    ? 'Order confirmed as pickup (no shipping)'
                    : 'Order confirmed successfully',
            data: {
                ...confirmedOrder,
                delivery_link: `${process.env.FRONTEND_URL || 'http://localhost:8080'}/delivery/${confirmedOrder.delivery_link_token}`,
                qr_code_url: qrCodeDataUrl,
                carrier_name: result.carrier_name,
                is_pickup: result.is_pickup,
                was_marked_prepaid: result.was_marked_prepaid,
                financial_status: result.final_financial_status,
                delivery_preferences: delivery_preferences || null,
                has_internal_notes: !!confirmedOrder.internal_notes
            },
            meta: {
                upsell_applied: result.upsell_applied,
                upsell_total: result.upsell_total,
                discount_applied: result.discount_applied,
                discount_amount: result.discount_amount,
                final_total: result.new_total_price,
                final_cod_amount: result.new_cod_amount,
                is_pickup: result.is_pickup,
                was_marked_prepaid: result.was_marked_prepaid,
                has_delivery_preferences: !!delivery_preferences
            }
        });
    } catch (error: any) {
        res.status(500).json({
            error: 'Error al confirmar pedido',
            message: error.message
        });
    }
});


// ================================================================
// POST /api/orders/:id/assign-carrier - Assign carrier to awaiting_carrier order
// ================================================================
// Step 2 of separate confirmation flow.
// Only owner/admin can assign carriers to orders in awaiting_carrier status.
ordersRouter.post('/:id/assign-carrier', validateUUIDParam('id'), requirePermission(Module.ORDERS, Permission.EDIT), async (req: PermissionRequest, res: Response) => {
    try {
        const { id } = req.params;
        const {
            courier_id,
            delivery_zone,
            shipping_city,
            shipping_cost
        } = req.body;

        // Validate courier_id is required
        if (!courier_id) {
            return res.status(400).json({
                error: 'Validation failed',
                message: 'courier_id es requerido',
                code: 'MISSING_COURIER_ID'
            });
        }

        // Verify user role - only owner/admin can assign carriers
        const userRole = (req as any).userRole || 'owner';
        if (!['owner', 'admin'].includes(userRole)) {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'Solo el dueño o administrador puede asignar transportadoras en el flujo separado',
                code: 'INSUFFICIENT_PERMISSIONS'
            });
        }

        // Call the RPC to assign carrier
        const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc('assign_carrier_to_order', {
            p_order_id: id,
            p_store_id: req.storeId,
            p_assigned_by: req.userId || 'admin',
            p_courier_id: courier_id,
            p_delivery_zone: delivery_zone || null,
            p_shipping_city: shipping_city || null,
            p_shipping_cost: shipping_cost !== undefined ? Number(shipping_cost) : null
        });

        if (rpcError) {
            const errorMessage = rpcError.message || '';

            if (errorMessage.includes('ORDER_NOT_FOUND')) {
                return res.status(404).json({
                    error: 'Order not found',
                    message: 'El pedido no existe o no pertenece a esta tienda',
                    code: 'ORDER_NOT_FOUND'
                });
            }

            if (errorMessage.includes('INVALID_STATUS')) {
                return res.status(400).json({
                    error: 'Invalid order status',
                    message: 'Solo se pueden asignar transportadoras a pedidos en estado "pendiente de carrier".',
                    code: 'INVALID_STATUS'
                });
            }

            if (errorMessage.includes('CARRIER_NOT_FOUND')) {
                return res.status(404).json({
                    error: 'Carrier not found',
                    message: 'La transportadora no existe o está inactiva',
                    code: 'CARRIER_NOT_FOUND'
                });
            }

            return res.status(500).json({
                error: 'Assignment failed',
                message: 'Error al asignar transportadora.',
                details: errorMessage
            });
        }

        const result = rpcResult as {
            success: boolean;
            order_id: string;
            new_status: string;
            carrier_id: string;
            carrier_name: string;
            carrier_assigned_by: string;
            carrier_assigned_at: string;
            shipping_cost: number;
            delivery_zone: string;
            shipping_city: string;
        };

        // Fetch the updated order for response
        const { data: updatedOrder } = await supabaseAdmin
            .from('orders')
            .select('*')
            .eq('id', id)
            .single();

        // Generate QR code if needed
        let qrCodeDataUrl = updatedOrder?.qr_code_url;
        if (updatedOrder?.delivery_link_token && !qrCodeDataUrl) {
            try {
                qrCodeDataUrl = await generateDeliveryQRCode(updatedOrder.delivery_link_token);
                await supabaseAdmin
                    .from('orders')
                    .update({ qr_code_url: qrCodeDataUrl })
                    .eq('id', id);
            } catch (qrError) {
                // Continue without QR code
            }
        }

        res.json({
            message: 'Transportadora asignada exitosamente',
            data: {
                ...updatedOrder,
                delivery_link: `${process.env.FRONTEND_URL || 'http://localhost:8080'}/delivery/${updatedOrder?.delivery_link_token}`,
                qr_code_url: qrCodeDataUrl,
                carrier_name: result.carrier_name,
                carrier_assigned_at: result.carrier_assigned_at,
                carrier_assigned_by: result.carrier_assigned_by
            },
            meta: {
                previous_status: 'awaiting_carrier',
                new_status: 'confirmed',
                carrier_id: result.carrier_id,
                carrier_name: result.carrier_name,
                shipping_cost: result.shipping_cost
            }
        });
    } catch (error: any) {
        res.status(500).json({
            error: 'Error al asignar transportadora',
            message: error.message
        });
    }
});


// ================================================================
// GET /api/orders/awaiting-carrier/count - Get count of orders awaiting carrier
// ================================================================
// Returns the count of orders in awaiting_carrier status for notifications/badges
ordersRouter.get('/awaiting-carrier/count', requirePermission(Module.ORDERS, Permission.VIEW), async (req: PermissionRequest, res: Response) => {
    try {
        const { data: countData, error } = await supabaseAdmin.rpc('get_awaiting_carrier_count', {
            p_store_id: req.storeId
        });

        if (error) {
            throw error;
        }

        const counts = countData?.[0] || { total_count: 0, critical_count: 0, warning_count: 0 };

        res.json({
            success: true,
            data: {
                total: Number(counts.total_count) || 0,
                critical: Number(counts.critical_count) || 0,
                warning: Number(counts.warning_count) || 0
            }
        });
    } catch (error: any) {
        res.status(500).json({
            error: 'Error al obtener conteo',
            message: error.message
        });
    }
});


// ================================================================
// GET /api/orders/awaiting-carrier - List orders awaiting carrier assignment
// ================================================================
// Returns orders in awaiting_carrier status with urgency indicators
ordersRouter.get('/awaiting-carrier', requirePermission(Module.ORDERS, Permission.VIEW), async (req: PermissionRequest, res: Response) => {
    try {
        const { data: orders, error } = await supabaseAdmin
            .from('v_orders_awaiting_carrier')
            .select('*')
            .eq('store_id', req.storeId)
            .order('confirmed_at', { ascending: true });

        if (error) {
            throw error;
        }

        res.json({
            success: true,
            data: orders || [],
            meta: {
                total: orders?.length || 0,
                critical: orders?.filter(o => o.urgency_level === 'CRITICAL').length || 0,
                warning: orders?.filter(o => o.urgency_level === 'WARNING').length || 0
            }
        });
    } catch (error: any) {
        res.status(500).json({
            error: 'Error al obtener pedidos',
            message: error.message
        });
    }
});


// ================================================================
// PATCH /api/orders/:id/internal-notes - Update internal admin notes
// ================================================================
// Internal notes are for admin observations that should NOT be visible
// to customers or couriers. Use for tracking special situations,
// customer feedback, product issues, etc.
// Max length: 5000 characters (reasonable limit for notes)
ordersRouter.patch('/:id/internal-notes', validateUUIDParam('id'), requirePermission(Module.ORDERS, Permission.EDIT), async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const storeId = req.storeId;
        const { internal_notes } = req.body;

        // Validate storeId exists
        if (!storeId) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Store ID is required'
            });
        }

        // Validate input type (allow null/undefined/empty to clear notes)
        if (internal_notes !== null && internal_notes !== undefined && typeof internal_notes !== 'string') {
            return res.status(400).json({
                error: 'Validation failed',
                message: 'internal_notes debe ser un string o null'
            });
        }

        // Limit text length to prevent abuse (5000 chars is ~1000 words)
        const MAX_NOTES_LENGTH = 5000;
        if (internal_notes && internal_notes.length > MAX_NOTES_LENGTH) {
            return res.status(400).json({
                error: 'Validation failed',
                message: `internal_notes no puede exceder ${MAX_NOTES_LENGTH} caracteres`
            });
        }

        // Sanitize: trim whitespace, convert empty string to null
        const sanitizedNotes = internal_notes?.trim() || null;

        // Update order internal notes
        const { data, error } = await supabaseAdmin
            .from('orders')
            .update({
                internal_notes: sanitizedNotes,
                updated_at: new Date().toISOString()
            })
            .eq('id', id)
            .eq('store_id', storeId)
            .select('id, internal_notes, updated_at')
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                return res.status(404).json({
                    error: 'Order not found',
                    message: 'El pedido no existe o no pertenece a esta tienda'
                });
            }
            throw error;
        }

        res.json({
            message: 'Notas internas actualizadas',
            data
        });
    } catch (error: any) {
        console.error('Error updating internal notes:', error);
        res.status(500).json({
            error: 'Error al actualizar notas internas',
            message: error.message
        });
    }
});

// ================================================================
// PATCH /api/orders/:id/upsell - Add or update upsell product
// ================================================================
// Adds/removes/updates upsell product to an existing order
// Handles both JSONB line_items and normalized order_line_items table
ordersRouter.patch('/:id/upsell', validateUUIDParam('id'), requirePermission(Module.ORDERS, Permission.EDIT), async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const storeId = req.storeId;
        const { upsell_product_id, upsell_quantity = 1, remove = false } = req.body;

        // Validate storeId exists
        if (!storeId) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Store ID is required'
            });
        }

        // Fetch existing order
        const { data: existingOrder, error: fetchError } = await supabaseAdmin
            .from('orders')
            .select(`
                id,
                store_id,
                sleeves_status,
                line_items,
                total_price,
                subtotal_price,
                order_line_items (id, product_id, quantity, unit_price, total_price, is_upsell)
            `)
            .eq('id', id)
            .eq('store_id', storeId)
            .single();

        if (fetchError || !existingOrder) {
            return res.status(404).json({
                error: 'Order not found',
                message: 'El pedido no existe o no pertenece a esta tienda'
            });
        }

        // If removing upsell
        if (remove) {
            // Remove from order_line_items table
            const { error: deleteError } = await supabaseAdmin
                .from('order_line_items')
                .delete()
                .eq('order_id', id)
                .eq('is_upsell', true);

            if (deleteError) {
                throw deleteError;
            }

            // Remove from JSONB line_items
            const updatedLineItems = (existingOrder.line_items as any[] || []).filter((item: any) => !item.is_upsell);

            // Recalculate total
            const newTotal = updatedLineItems.reduce((sum, item) => sum + ((item.price || 0) * (item.quantity || 0)), 0);

            // Update order
            const { data, error: updateError } = await supabaseAdmin
                .from('orders')
                .update({
                    line_items: updatedLineItems,
                    total_price: newTotal,
                    subtotal_price: newTotal,
                    upsell_added: false,
                    updated_at: new Date().toISOString()
                })
                .eq('id', id)
                .eq('store_id', storeId)
                .select('id, total_price, upsell_added, updated_at')
                .single();

            if (updateError) {
                throw updateError;
            }

            return res.json({
                message: 'Upsell removido',
                data
            });
        }

        // If adding/updating upsell, validate product exists
        if (!upsell_product_id) {
            return res.status(400).json({
                error: 'Validation failed',
                message: 'upsell_product_id es requerido'
            });
        }

        // Fetch product
        const { data: product, error: productError } = await supabaseAdmin
            .from('products')
            .select('id, name, price, sku, image')
            .eq('id', upsell_product_id)
            .eq('store_id', storeId)
            .single();

        if (productError || !product) {
            return res.status(404).json({
                error: 'Product not found',
                message: 'El producto de upsell no existe en esta tienda'
            });
        }

        // Check if upsell already exists
        const existingUpsell = existingOrder.order_line_items?.find((item: any) => item.is_upsell === true);

        if (existingUpsell) {
            // Update existing upsell in order_line_items table
            const { error: updateError } = await supabaseAdmin
                .from('order_line_items')
                .update({
                    product_id: product.id,
                    product_name: product.name,
                    quantity: upsell_quantity,
                    unit_price: product.price,
                    total_price: product.price * upsell_quantity,
                    sku: product.sku,
                    image_url: product.image,
                    updated_at: new Date().toISOString()
                })
                .eq('id', existingUpsell.id);

            if (updateError) {
                throw updateError;
            }
        } else {
            // Insert new upsell in order_line_items table
            const { error: insertError } = await supabaseAdmin
                .from('order_line_items')
                .insert({
                    order_id: id,
                    product_id: product.id,
                    product_name: product.name,
                    quantity: upsell_quantity,
                    unit_price: product.price,
                    total_price: product.price * upsell_quantity,
                    sku: product.sku,
                    image_url: product.image,
                    is_upsell: true
                });

            if (insertError) {
                throw insertError;
            }
        }

        // Update JSONB line_items (for backwards compatibility)
        let updatedLineItems = [...(existingOrder.line_items as any[] || []).filter((item: any) => !item.is_upsell)];
        updatedLineItems.push({
            product_id: product.id,
            product_name: product.name,
            quantity: upsell_quantity,
            price: product.price,
            sku: product.sku,
            is_upsell: true
        });

        // Recalculate total
        const newTotal = updatedLineItems.reduce((sum, item) => sum + ((item.price || 0) * (item.quantity || 0)), 0);

        // Update order
        const { data, error: updateError } = await supabaseAdmin
            .from('orders')
            .update({
                line_items: updatedLineItems,
                total_price: newTotal,
                subtotal_price: newTotal,
                upsell_added: true,
                updated_at: new Date().toISOString()
            })
            .eq('id', id)
            .eq('store_id', storeId)
            .select('id, total_price, upsell_added, updated_at')
            .single();

        if (updateError) {
            throw updateError;
        }

        res.json({
            message: existingUpsell ? 'Upsell actualizado' : 'Upsell agregado',
            data,
            upsell_total: product.price * upsell_quantity
        });
    } catch (error: any) {
        console.error('Error updating upsell:', error);
        res.status(500).json({
            error: 'Error al actualizar upsell',
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


        // Verify order exists and belongs to store - include both line_items sources for stock check
        const { data: existingOrder, error: fetchError } = await supabaseAdmin
            .from('orders')
            .select(`
                id, printed, printed_at, sleeves_status, line_items,
                order_line_items (id, product_id, quantity, product_name)
            `)
            .eq('id', id)
            .eq('store_id', storeId)
            .is('deleted_at', null)
            .single();

        if (fetchError || !existingOrder) {
            // Debug: Try to find order without store_id filter
            const { data: debugOrder } = await supabaseAdmin
                .from('orders')
                .select('id, store_id, deleted_at, sleeves_status')
                .eq('id', id)
                .single();

            logger.error('API', `[mark-printed] Order not found:`, {
                requestedId: id,
                requestedStoreId: storeId,
                foundOrder: debugOrder ? {
                    store_id: debugOrder.store_id,
                    deleted_at: debugOrder.deleted_at,
                    storeIdMatch: debugOrder.store_id === storeId
                } : 'NOT_FOUND',
                fetchError: fetchError?.message
            });

            return res.status(404).json({
                error: 'Order not found',
                message: 'El pedido no existe o no pertenece a esta tienda'
            });
        }

        // ================================================================
        // CRITICAL: Check stock availability before transitioning to ready_to_ship
        // ================================================================
        if (existingOrder.sleeves_status === 'in_preparation') {
            // Use normalized order_line_items first (Shopify orders), fallback to JSONB line_items (manual orders)
            const normalizedItems = existingOrder.order_line_items || [];
            const jsonbItems = existingOrder.line_items || [];
            const lineItems = normalizedItems.length > 0 ? normalizedItems : jsonbItems;

            if (Array.isArray(lineItems) && lineItems.length > 0) {
                const stockIssues: Array<{
                    product_name: string;
                    required: number;
                    available: number;
                    shortage: number;
                }> = [];

                for (const item of lineItems) {
                    const productId = item.product_id;
                    const requiredQty = safeNumber(item.quantity, 0);

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


        res.json({
            success: true,
            message: 'Pedido marcado como impreso',
            data: {
                ...updatedOrder,
                has_internal_notes: !!updatedOrder.internal_notes
            }
        });
    } catch (error: any) {
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


        // Get all orders with both line_items sources for stock checking
        const { data: existingOrders, error: fetchError } = await supabaseAdmin
            .from('orders')
            .select(`
                id, printed, sleeves_status, line_items, order_number,
                order_line_items (id, product_id, quantity, product_name)
            `)
            .in('id', order_ids)
            .eq('store_id', storeId);

        if (fetchError) {
            throw fetchError;
        }

        // First pass: Check stock for all orders that need status change
        const ordersWithStockIssues: Array<{ order_id: string; order_number: string; issues: any[] }> = [];

        for (const order of existingOrders || []) {
            if (order.sleeves_status !== 'in_preparation') continue;

            // Use normalized order_line_items first (Shopify orders), fallback to JSONB line_items (manual orders)
            const normalizedItems = (order as any).order_line_items || [];
            const jsonbItems = order.line_items || [];
            const lineItems = normalizedItems.length > 0 ? normalizedItems : jsonbItems;
            if (!Array.isArray(lineItems) || lineItems.length === 0) continue;

            const stockIssues: any[] = [];

            for (const item of lineItems) {
                const productId = item.product_id;
                const requiredQty = safeNumber(item.quantity, 0);

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
            }

            const { data: updated, error: updateError } = await supabaseAdmin
                .from('orders')
                .update(updateData)
                .eq('id', order.id)
                .eq('store_id', storeId)
                .select()
                .single();

            if (updateError) {
            } else if (updated) {
                updatedOrders.push(updated);
            }
        }


        res.json({
            success: true,
            message: `${updatedOrders?.length || 0} pedidos marcados como impresos`,
            data: updatedOrders
        });
    } catch (error: any) {
        res.status(500).json({
            error: 'Error interno del servidor',
            message: error.message
        });
    }
});

// ================================================================
// POST /api/orders/bulk-print-and-dispatch - Atomic bulk print + status update
// Returns detailed success/failure per order (safer than mark-printed-bulk)
// ================================================================
ordersRouter.post('/bulk-print-and-dispatch', requirePermission(Module.ORDERS, Permission.EDIT), async (req: AuthRequest, res: Response) => {
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

        // Get all orders with both line_items sources for stock checking
        const { data: existingOrders, error: fetchError } = await supabaseAdmin
            .from('orders')
            .select(`
                id, printed, sleeves_status, line_items, order_number,
                order_line_items (id, product_id, quantity, product_name)
            `)
            .in('id', order_ids)
            .eq('store_id', storeId);

        if (fetchError) {
            throw fetchError;
        }

        if (!existingOrders || existingOrders.length === 0) {
            return res.status(404).json({
                error: 'Not found',
                message: 'No se encontraron pedidos con los IDs proporcionados'
            });
        }

        // First pass: Check stock for all orders that need status change
        const ordersWithStockIssues: Array<{ order_id: string; order_number: string; issues: any[] }> = [];

        for (const order of existingOrders) {
            if (order.sleeves_status !== 'in_preparation') continue;

            // Use normalized order_line_items first (Shopify orders), fallback to JSONB line_items (manual orders)
            const normalizedItems = (order as any).order_line_items || [];
            const jsonbItems = order.line_items || [];
            const lineItems = normalizedItems.length > 0 ? normalizedItems : jsonbItems;
            if (!Array.isArray(lineItems) || lineItems.length === 0) continue;

            const stockIssues: any[] = [];

            for (const item of lineItems) {
                const productId = item.product_id;
                const requiredQty = safeNumber(item.quantity, 0);

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

            return res.status(400).json({
                error: 'Insufficient stock',
                code: 'INSUFFICIENT_STOCK',
                message: `No hay suficiente stock para completar estos pedidos:\n\n${ordersList}\n\nRecibe mercadería para reponer el stock.`,
                details: ordersWithStockIssues
            });
        }

        // Process each order individually with detailed error tracking
        const results = {
            successes: [] as Array<{ order_id: string; order_number: string }>,
            failures: [] as Array<{ order_id: string; order_number: string; error: string }>
        };

        for (const order of existingOrders) {
            try {
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
                // This triggers stock decrement via database trigger
                if (order.sleeves_status === 'in_preparation') {
                    updateData.sleeves_status = 'ready_to_ship';
                }

                const { data: updated, error: updateError } = await supabaseAdmin
                    .from('orders')
                    .update(updateData)
                    .eq('id', order.id)
                    .eq('store_id', storeId)
                    .select()
                    .single();

                if (updateError) {
                    results.failures.push({
                        order_id: order.id,
                        order_number: order.order_number || order.id.slice(0, 8),
                        error: updateError.message || 'Error desconocido'
                    });
                } else if (updated) {
                    results.successes.push({
                        order_id: updated.id,
                        order_number: updated.order_number || updated.id.slice(0, 8)
                    });
                }
            } catch (e: any) {
                results.failures.push({
                    order_id: order.id,
                    order_number: order.order_number || order.id.slice(0, 8),
                    error: e.message || 'Error desconocido'
                });
            }
        }

        // Return detailed results
        const allSucceeded = results.failures.length === 0;
        const statusCode = allSucceeded ? 200 : (results.successes.length > 0 ? 207 : 500);

        res.status(statusCode).json({
            success: allSucceeded,
            message: allSucceeded
                ? `${results.successes.length} pedidos marcados como impresos`
                : `${results.successes.length}/${existingOrders.length} pedidos procesados correctamente`,
            data: {
                total: existingOrders.length,
                succeeded: results.successes.length,
                failed: results.failures.length,
                successes: results.successes,
                failures: results.failures
            }
        });
    } catch (error: any) {
        logger.error('API', 'Bulk print and dispatch error:', error);
        res.status(500).json({
            error: 'Error interno del servidor',
            message: error.message
        });
    }
});

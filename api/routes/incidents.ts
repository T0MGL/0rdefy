// ================================================================
// ORDEFY API - DELIVERY INCIDENTS ROUTES
// ================================================================
// Endpoints para gestionar incidencias de entrega y reintentos
// Permite hasta 3 intentos adicionales por incidencia
//
// Security: Authenticated endpoints require ORDERS module access
// Roles with access: owner, admin, logistics, confirmador
// Public endpoints: Courier-facing endpoints for delivery completion
// ================================================================

import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../db/connection';
import { verifyToken, extractStoreId, AuthRequest } from '../middleware/auth';
import { extractUserRole, requireModule } from '../middleware/permissions';
import { getTodayInTimezone } from '../utils/dateUtils';
import { Module } from '../permissions';

export const incidentsRouter = Router();

// ================================================================
// PUBLIC ENDPOINTS (No authentication required for couriers)
// ================================================================

// GET /api/incidents/order/:order_id/active - Get active incident for order
// Used by courier delivery page to show retry checklist
incidentsRouter.get('/order/:order_id/active', async (req: Request, res: Response) => {
    try {
        const { order_id } = req.params;

        console.log('🔍 [INCIDENTS] Fetching active incident for order:', order_id);

        // Get active incident with retry attempts
        const { data: incident, error } = await supabaseAdmin
            .from('delivery_incidents')
            .select(`
                *,
                incident_retry_attempts (
                    id,
                    retry_number,
                    scheduled_date,
                    status,
                    courier_notes,
                    failure_reason,
                    attempted_at,
                    created_at
                )
            `)
            .eq('order_id', order_id)
            .eq('status', 'active')
            .order('created_at', { ascending: false, foreignTable: 'incident_retry_attempts' })
            .maybeSingle();

        if (error) {
            console.error('❌ [INCIDENTS] Error fetching incident:', error);
            return res.status(500).json({ error: 'Error al obtener incidente' });
        }

        if (!incident) {
            return res.json({
                has_incident: false,
                message: 'No active incident for this order'
            });
        }

        // Calculate available retry slots
        const availableRetries = incident.max_retry_attempts - incident.current_retry_count;
        const retryAttempts = incident.incident_retry_attempts || [];

        res.json({
            has_incident: true,
            data: {
                incident_id: incident.id,
                order_id: incident.order_id,
                status: incident.status,
                current_retry_count: incident.current_retry_count,
                max_retry_attempts: incident.max_retry_attempts,
                available_retries: availableRetries,
                retry_attempts: retryAttempts,
                created_at: incident.created_at
            }
        });
    } catch (error: any) {
        console.error('💥 [INCIDENTS] Error:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// POST /api/incidents/retry/:retry_id/complete - Complete retry attempt (public for couriers)
incidentsRouter.post('/retry/:retry_id/complete', async (req: Request, res: Response) => {
    try {
        const { retry_id } = req.params;
        const {
            status, // 'delivered' or 'failed'
            courier_notes,
            failure_reason,
            payment_method,
            proof_photo_url
        } = req.body;

        if (!status || !['delivered', 'failed'].includes(status)) {
            return res.status(400).json({
                error: 'Estado inválido',
                message: 'status must be either "delivered" or "failed"'
            });
        }

        console.log(`✅ [INCIDENTS] Completing retry ${retry_id} with status:`, status);

        // Get retry attempt details
        const { data: retryAttempt, error: fetchError } = await supabaseAdmin
            .from('incident_retry_attempts')
            .select('incident_id, retry_number, scheduled_date')
            .eq('id', retry_id)
            .single();

        if (fetchError || !retryAttempt) {
            console.error('❌ [INCIDENTS] Retry not found:', fetchError);
            return res.status(404).json({ error: 'Retry attempt not found' });
        }

        // Get incident details separately
        const { data: incident, error: incidentError } = await supabaseAdmin
            .from('delivery_incidents')
            .select('order_id, store_id')
            .eq('id', retryAttempt.incident_id)
            .single();

        if (incidentError || !incident) {
            console.error('❌ [INCIDENTS] Incident not found:', incidentError);
            return res.status(404).json({ error: 'Incident not found' });
        }

        // Update retry attempt
        const { error: updateError } = await supabaseAdmin
            .from('incident_retry_attempts')
            .update({
                status,
                courier_notes,
                failure_reason: failure_reason || null,
                payment_method: payment_method || null,
                proof_photo_url: proof_photo_url || null,
                attempted_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq('id', retry_id);

        if (updateError) {
            console.error('❌ [INCIDENTS] Error updating retry:', updateError);
            return res.status(500).json({ error: 'Error al actualizar intento de reintento' });
        }

        // Create delivery_attempt record
        const { data: deliveryAttempt } = await supabaseAdmin
            .from('delivery_attempts')
            .insert({
                order_id: incident.order_id,
                store_id: incident.store_id,
                attempt_number: retryAttempt.retry_number,
                scheduled_date: retryAttempt.scheduled_date || getTodayInTimezone(),
                actual_date: getTodayInTimezone(),
                status: status === 'delivered' ? 'delivered' : 'failed',
                notes: courier_notes,
                failed_reason: failure_reason || null,
                failure_notes: courier_notes,
                payment_method: payment_method || null,
                photo_url: proof_photo_url || null
            })
            .select()
            .single();

        // Link delivery attempt to retry
        if (deliveryAttempt) {
            await supabaseAdmin
                .from('incident_retry_attempts')
                .update({ delivery_attempt_id: deliveryAttempt.id })
                .eq('id', retry_id);
        }

        // The trigger will automatically update the incident status

        console.log(`✅ [INCIDENTS] Retry ${retry_id} marked as ${status}`);

        res.json({
            message: status === 'delivered' ? 'Delivery confirmed' : 'Retry attempt failed',
            status,
            data: {
                retry_id,
                incident_id: retryAttempt.incident_id,
                order_id: incident.order_id
            }
        });
    } catch (error: any) {
        console.error('💥 [INCIDENTS] Error:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// ================================================================
// AUTHENTICATED ENDPOINTS (Require auth + store context)
// ================================================================

incidentsRouter.use(verifyToken);
incidentsRouter.use(extractStoreId);
incidentsRouter.use(extractUserRole);

// Incidents are part of ORDERS module (order lifecycle management)
incidentsRouter.use(requireModule(Module.ORDERS));

// GET /api/incidents - List all incidents
// Query params: status, limit, offset
incidentsRouter.get('/', async (req: AuthRequest, res: Response) => {
    try {
        const { status, limit = '50', offset = '0' } = req.query;

        console.log('📋 [INCIDENTS] Fetching incidents:', {
            store_id: req.storeId,
            status,
            limit,
            offset
        });

        let query = supabaseAdmin
            .from('v_active_incidents')
            .select('*', { count: 'exact' })
            .eq('store_id', req.storeId);

        if (status && status !== 'active') {
            // For non-active statuses, query the base table
            query = supabaseAdmin
                .from('delivery_incidents')
                .select(`
                    *,
                    orders!inner(
                        shopify_order_number,
                        customer_first_name,
                        customer_last_name,
                        customer_phone,
                        customer_address,
                        total_price,
                        delivery_failure_reason,
                        courier_notes
                    ),
                    incident_retry_attempts(*)
                `, { count: 'exact' })
                .eq('store_id', req.storeId)
                .eq('status', status)
                .order('created_at', { ascending: false });
        } else {
            query = query.order('incident_created_at', { ascending: false });
        }

        query = query.range(
            parseInt(offset as string, 10),
            parseInt(offset as string, 10) + parseInt(limit as string, 10) - 1
        );

        const { data, error, count } = await query;

        if (error) {
            console.error('❌ [INCIDENTS] Error:', error);
            return res.status(500).json({ error: 'Error al obtener incidentes' });
        }

        res.json({
            data,
            pagination: {
                total: count || 0,
                limit: parseInt(limit as string, 10),
                offset: parseInt(offset as string, 10),
                hasMore: count ? count > parseInt(offset as string, 10) + parseInt(limit as string, 10) : false
            }
        });
    } catch (error: any) {
        console.error('💥 [INCIDENTS] Error:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// GET /api/incidents/:id - Get single incident details
incidentsRouter.get('/:id', async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;

        const { data, error } = await supabaseAdmin
            .from('delivery_incidents')
            .select(`
                *,
                orders!inner(
                    shopify_order_number,
                    customer_first_name,
                    customer_last_name,
                    customer_phone,
                    customer_address,
                    total_price,
                    delivery_failure_reason,
                    courier_notes,
                    sleeves_status
                ),
                carriers:orders!inner(courier_id)(
                    name,
                    phone
                ),
                incident_retry_attempts(
                    *,
                    delivery_attempts(*)
                )
            `)
            .eq('id', id)
            .eq('store_id', req.storeId)
            .single();

        if (error || !data) {
            return res.status(404).json({ error: 'Incident not found' });
        }

        res.json(data);
    } catch (error: any) {
        console.error('💥 [INCIDENTS] Error:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// POST /api/incidents/:id/schedule-retry - Schedule new retry attempt
incidentsRouter.post('/:id/schedule-retry', async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { scheduled_date, notes } = req.body;

        console.log('📅 [INCIDENTS] Scheduling retry for incident:', id);

        // Get incident
        const { data: incident, error: fetchError } = await supabaseAdmin
            .from('delivery_incidents')
            .select('*')
            .eq('id', id)
            .eq('store_id', req.storeId)
            .single();

        if (fetchError || !incident) {
            return res.status(404).json({ error: 'Incident not found' });
        }

        if (incident.status !== 'active') {
            return res.status(400).json({
                error: 'Incident is not active',
                message: 'Cannot schedule retry for resolved or expired incident'
            });
        }

        if (incident.current_retry_count >= incident.max_retry_attempts) {
            return res.status(400).json({
                error: 'Max retries reached',
                message: `Maximum ${incident.max_retry_attempts} retries already attempted`
            });
        }

        // Get next retry number
        const { data: existingRetries } = await supabaseAdmin
            .from('incident_retry_attempts')
            .select('retry_number')
            .eq('incident_id', id)
            .order('retry_number', { ascending: false })
            .limit(1);

        const nextRetryNumber = existingRetries && existingRetries.length > 0
            ? existingRetries[0].retry_number + 1
            : 1;

        if (nextRetryNumber > incident.max_retry_attempts) {
            return res.status(400).json({
                error: 'Max retries reached',
                message: `Cannot schedule more than ${incident.max_retry_attempts} retries`
            });
        }

        // Create retry attempt
        const { data: retry, error: createError } = await supabaseAdmin
            .from('incident_retry_attempts')
            .insert({
                incident_id: id,
                retry_number: nextRetryNumber,
                scheduled_date: scheduled_date || getTodayInTimezone(),
                rescheduled_by: 'admin',
                status: 'scheduled',
                courier_notes: notes || null
            })
            .select()
            .single();

        if (createError) {
            console.error('❌ [INCIDENTS] Error creating retry:', createError);
            return res.status(500).json({ error: 'Error al programar reintento' });
        }

        console.log('✅ [INCIDENTS] Retry scheduled:', retry.id);

        res.status(201).json({
            message: 'Retry attempt scheduled',
            data: retry
        });
    } catch (error: any) {
        console.error('💥 [INCIDENTS] Error:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// POST /api/incidents/:id/resolve - Manually resolve incident
incidentsRouter.post('/:id/resolve', async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { resolution_type, notes, payment_method } = req.body;

        if (!resolution_type || !['cancelled', 'customer_rejected', 'delivered', 'other'].includes(resolution_type)) {
            return res.status(400).json({
                error: 'Tipo de resolución inválido',
                valid_types: ['cancelled', 'customer_rejected', 'delivered', 'other']
            });
        }

        // Validate payment_method if resolution_type is 'delivered'
        if (resolution_type === 'delivered' && !payment_method) {
            return res.status(400).json({
                error: 'Payment method required',
                message: 'payment_method is required when resolution_type is "delivered"'
            });
        }

        console.log('✅ [INCIDENTS] Resolving incident:', id, 'as', resolution_type);

        // Update incident
        const { data: incident, error } = await supabaseAdmin
            .from('delivery_incidents')
            .update({
                status: 'resolved',
                resolution_type,
                resolution_notes: notes || null,
                resolved_at: new Date().toISOString(),
                resolved_by: 'admin',
                updated_at: new Date().toISOString()
            })
            .eq('id', id)
            .eq('store_id', req.storeId)
            .select()
            .single();

        if (error || !incident) {
            return res.status(404).json({ error: 'Incident not found' });
        }

        // Update order status based on resolution
        let orderStatus = 'cancelled';
        let paymentStatus = undefined;

        if (resolution_type === 'customer_rejected') {
            orderStatus = 'not_delivered';
        } else if (resolution_type === 'delivered') {
            orderStatus = 'delivered';
            paymentStatus = 'collected';
        }

        const orderUpdates: any = {
            sleeves_status: orderStatus,
            has_active_incident: false,
            updated_at: new Date().toISOString()
        };

        if (paymentStatus) {
            orderUpdates.payment_status = paymentStatus;
        }

        await supabaseAdmin
            .from('orders')
            .update(orderUpdates)
            .eq('id', incident.order_id);

        console.log('✅ [INCIDENTS] Incident resolved', resolution_type === 'delivered' ? 'and order marked as delivered' : '');

        res.json({
            message: resolution_type === 'delivered' ? 'Incident resolved and order marked as delivered' : 'Incident resolved',
            data: incident
        });
    } catch (error: any) {
        console.error('💥 [INCIDENTS] Error:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// PUT /api/incidents/:id/retry/:retry_id - Update retry attempt (admin only)
incidentsRouter.put('/:id/retry/:retry_id', async (req: AuthRequest, res: Response) => {
    try {
        const { id, retry_id } = req.params;
        const updates = req.body;

        // Remove fields that shouldn't be updated
        delete updates.id;
        delete updates.incident_id;
        delete updates.retry_number;
        delete updates.created_at;

        updates.updated_at = new Date().toISOString();

        const { data, error } = await supabaseAdmin
            .from('incident_retry_attempts')
            .update(updates)
            .eq('id', retry_id)
            .eq('incident_id', id)
            .select()
            .single();

        if (error || !data) {
            return res.status(404).json({ error: 'Retry attempt not found' });
        }

        console.log('✅ [INCIDENTS] Retry updated:', retry_id);

        res.json({
            message: 'Retry attempt updated',
            data
        });
    } catch (error: any) {
        console.error('💥 [INCIDENTS] Error:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// DELETE /api/incidents/:id - Delete incident (admin only, use with caution)
incidentsRouter.delete('/:id', async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;

        const { error } = await supabaseAdmin
            .from('delivery_incidents')
            .delete()
            .eq('id', id)
            .eq('store_id', req.storeId);

        if (error) {
            console.error('❌ [INCIDENTS] Error deleting:', error);
            return res.status(500).json({ error: 'Error al eliminar incidente' });
        }

        // Update order flag
        await supabaseAdmin
            .from('orders')
            .update({ has_active_incident: false })
            .eq('id', id);

        console.log('🗑️ [INCIDENTS] Deleted:', id);

        res.json({ message: 'Incident deleted' });
    } catch (error: any) {
        console.error('💥 [INCIDENTS] Error:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

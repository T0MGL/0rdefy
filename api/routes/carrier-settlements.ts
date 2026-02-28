// ================================================================
// ORDEFY API - CARRIER SETTLEMENTS ROUTES
// ================================================================
// Manages deferred payments to external carriers (weekly/monthly)
// Business Logic: Net Amount = Total COD - Total Shipping Cost
//
// Security: Requires CARRIERS module access
// Roles with access: owner, admin, logistics
// ================================================================

import { Router, Response } from 'express';
import { supabaseAdmin } from '../db/connection';
import { verifyToken, extractStoreId, AuthRequest } from '../middleware/auth';
import { extractUserRole, requireModule } from '../middleware/permissions';
import { Module } from '../permissions';
import { getTodayInTimezone } from '../utils/dateUtils';
import { logger } from '../utils/logger';

export const carrierSettlementsRouter = Router();

// Apply authentication and role middleware
carrierSettlementsRouter.use(verifyToken, extractStoreId, extractUserRole);

// Carrier settlements require CARRIERS module access
carrierSettlementsRouter.use(requireModule(Module.CARRIERS));

// ================================================================
// GET /api/carrier-settlements - List all settlements
// Query params: carrier_id, status, start_date, end_date, limit, offset
// ================================================================
carrierSettlementsRouter.get('/', async (req: AuthRequest, res: Response) => {
    try {
        const {
            carrier_id,
            status,
            start_date,
            end_date,
            limit = '50',
            offset = '0'
        } = req.query;

        logger.debug('CARRIER-SETTLEMENTS', 'Fetching settlements', {
            carrier_id,
            status,
            start_date,
            end_date
        });

        let query = supabaseAdmin
            .from('carrier_settlements')
            .select(`
                *,
                carriers(id, name, carrier_type)
            `, { count: 'exact' })
            .eq('store_id', req.storeId)
            .order('created_at', { ascending: false });

        // Apply filters
        if (carrier_id) {
            query = query.eq('carrier_id', carrier_id);
        }

        if (status) {
            query = query.eq('status', status);
        }

        if (start_date) {
            query = query.gte('settlement_period_start', start_date);
        }

        if (end_date) {
            query = query.lte('settlement_period_end', end_date);
        }

        // Apply pagination
        query = query.range(
            parseInt(offset as string, 10),
            parseInt(offset as string, 10) + parseInt(limit as string, 10) - 1
        );

        const { data, error, count } = await query;

        if (error) {
            logger.error('CARRIER-SETTLEMENTS', 'Error fetching settlements', error);
            return res.status(500).json({ error: 'Error al obtener liquidaciones' });
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
        logger.error('CARRIER-SETTLEMENTS', 'Unexpected error listing settlements', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// ================================================================
// GET /api/carrier-settlements/pending - Get pending settlements summary
// Returns carriers with delivered orders not yet settled
// ================================================================
carrierSettlementsRouter.get('/pending', async (req: AuthRequest, res: Response) => {
    try {
        logger.debug('CARRIER-SETTLEMENTS', 'Fetching pending summary');

        // Use the view we created in the migration
        const { data, error } = await supabaseAdmin
            .from('pending_carrier_settlements_summary')
            .select('*')
            .eq('store_id', req.storeId)
            .order('oldest_delivery_date', { ascending: true });

        if (error) {
            logger.error('CARRIER-SETTLEMENTS', 'Error fetching pending settlements', error);
            return res.status(500).json({ error: 'Error al obtener liquidaciones pendientes' });
        }

        logger.debug('CARRIER-SETTLEMENTS', `Found ${data?.length || 0} carriers with pending deliveries`);

        res.json({
            data: data || [],
            count: data?.length || 0
        });
    } catch (error: any) {
        logger.error('CARRIER-SETTLEMENTS', 'Error fetching pending summary', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// ================================================================
// GET /api/carrier-settlements/:id - Get settlement details with orders
// ================================================================
carrierSettlementsRouter.get('/:id', async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;

        logger.debug('CARRIER-SETTLEMENTS', 'Fetching settlement detail', { id });

        // Get settlement
        const { data: settlement, error: settlementError } = await supabaseAdmin
            .from('carrier_settlements')
            .select(`
                *,
                carriers(id, name, phone, email, carrier_type)
            `)
            .eq('id', id)
            .eq('store_id', req.storeId)
            .single();

        if (settlementError || !settlement) {
            return res.status(404).json({ error: 'Liquidación no encontrada' });
        }

        // Get orders included in this settlement
        const { data: orders, error: ordersError } = await supabaseAdmin
            .from('orders')
            .select(`
                id,
                shopify_order_number,
                customer_first_name,
                customer_last_name,
                total_price,
                shipping_cost,
                delivery_zone,
                delivered_at,
                sleeves_status
            `)
            .eq('carrier_settlement_id', id)
            .order('delivered_at', { ascending: false });

        if (ordersError) {
            logger.warn('CARRIER-SETTLEMENTS', 'Error fetching settlement orders', ordersError);
        }

        res.json({
            ...settlement,
            orders: orders || []
        });
    } catch (error: any) {
        logger.error('CARRIER-SETTLEMENTS', 'Error fetching settlement detail', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// ================================================================
// POST /api/carrier-settlements - Create new settlement (bulk)
// Body: { carrier_id, period_start, period_end }
// Uses create_carrier_settlement() function from migration
// ================================================================
carrierSettlementsRouter.post('/', async (req: AuthRequest, res: Response) => {
    try {
        const {
            carrier_id,
            period_start,
            period_end,
            notes
        } = req.body;

        // Validation
        if (!carrier_id) {
            return res.status(400).json({ error: 'carrier_id is required' });
        }

        if (!period_start || !period_end) {
            return res.status(400).json({ error: 'period_start and period_end are required' });
        }

        logger.debug('CARRIER-SETTLEMENTS', 'Creating settlement', {
            carrier_id,
            period_start,
            period_end
        });

        // Verify carrier exists and is external type
        const { data: carrier, error: carrierError } = await supabaseAdmin
            .from('carriers')
            .select('id, name, carrier_type')
            .eq('id', carrier_id)
            .eq('store_id', req.storeId)
            .single();

        if (carrierError || !carrier) {
            return res.status(404).json({ error: 'Transportadora no encontrada' });
        }

        if (carrier.carrier_type !== 'external') {
            return res.status(400).json({
                error: 'Invalid carrier type',
                message: 'Settlements can only be created for external carriers. Use daily settlements for internal carriers.'
            });
        }

        // Check for existing settlement in same period
        const { data: existing, error: existingError } = await supabaseAdmin
            .from('carrier_settlements')
            .select('id')
            .eq('store_id', req.storeId)
            .eq('carrier_id', carrier_id)
            .eq('settlement_period_start', period_start)
            .eq('settlement_period_end', period_end)
            .single();

        if (existing) {
            return res.status(409).json({
                error: 'Duplicate settlement',
                message: 'A settlement for this carrier and period already exists',
                existing_settlement_id: existing.id
            });
        }

        // Call the database function to create settlement
        const { data: result, error: functionError } = await supabaseAdmin
            .rpc('create_carrier_settlement', {
                p_store_id: req.storeId,
                p_carrier_id: carrier_id,
                p_period_start: period_start,
                p_period_end: period_end,
                p_created_by: req.userId || null
            });

        if (functionError) {
            logger.error('CARRIER-SETTLEMENTS', 'RPC create_carrier_settlement failed', functionError);
            return res.status(500).json({
                error: 'Error al crear liquidación',
                message: functionError.message
            });
        }

        const settlementId = result;

        // Update notes if provided
        if (notes) {
            await supabaseAdmin
                .from('carrier_settlements')
                .update({ notes })
                .eq('id', settlementId);
        }

        // Fetch created settlement
        const { data: settlement, error: fetchError } = await supabaseAdmin
            .from('carrier_settlements')
            .select(`
                *,
                carriers(id, name, carrier_type)
            `)
            .eq('id', settlementId)
            .single();

        if (fetchError) {
            logger.warn('CARRIER-SETTLEMENTS', 'Error fetching created settlement', fetchError);
        }

        logger.info('CARRIER-SETTLEMENTS', 'Settlement created', { settlementId });

        res.status(201).json({
            message: 'Settlement created successfully',
            data: settlement
        });
    } catch (error: any) {
        logger.error('CARRIER-SETTLEMENTS', 'Error creating settlement', error);
        res.status(500).json({ error: 'Error interno del servidor', message: error.message });
    }
});

// ================================================================
// PATCH /api/carrier-settlements/:id - Update settlement
// ================================================================
carrierSettlementsRouter.patch('/:id', async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        logger.debug('CARRIER-SETTLEMENTS', 'Updating settlement', { id });

        // Remove fields that shouldn't be updated
        delete updates.id;
        delete updates.store_id;
        delete updates.carrier_id;
        delete updates.created_at;
        delete updates.net_amount; // This is a generated column
        delete updates.total_orders; // Calculated from orders
        delete updates.total_cod_collected; // Calculated from orders
        delete updates.total_shipping_cost; // Calculated from orders

        updates.updated_at = new Date().toISOString();

        const { data, error } = await supabaseAdmin
            .from('carrier_settlements')
            .update(updates)
            .eq('id', id)
            .eq('store_id', req.storeId)
            .select(`
                *,
                carriers(id, name, carrier_type)
            `)
            .single();

        if (error || !data) {
            return res.status(404).json({ error: 'Liquidación no encontrada' });
        }

        logger.debug('CARRIER-SETTLEMENTS', 'Settlement updated', { id });

        res.json({
            message: 'Settlement updated successfully',
            data
        });
    } catch (error: any) {
        logger.error('CARRIER-SETTLEMENTS', 'Error updating settlement', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// ================================================================
// POST /api/carrier-settlements/:id/mark-paid - Mark settlement as paid
// ================================================================
carrierSettlementsRouter.post('/:id/mark-paid', async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { payment_date, payment_method, payment_reference } = req.body;

        logger.debug('CARRIER-SETTLEMENTS', 'Marking settlement as paid', { id });

        const { data, error } = await supabaseAdmin
            .from('carrier_settlements')
            .update({
                status: 'paid',
                payment_date: payment_date || getTodayInTimezone(),
                payment_method: payment_method || null,
                payment_reference: payment_reference || null,
                updated_at: new Date().toISOString()
            })
            .eq('id', id)
            .eq('store_id', req.storeId)
            .select(`
                *,
                carriers(id, name, carrier_type)
            `)
            .single();

        if (error || !data) {
            return res.status(404).json({ error: 'Liquidación no encontrada' });
        }

        logger.debug('CARRIER-SETTLEMENTS', 'Settlement marked as paid', { id });

        res.json({
            message: 'Settlement marked as paid',
            data
        });
    } catch (error: any) {
        logger.error('CARRIER-SETTLEMENTS', 'Error marking settlement as paid', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// ================================================================
// DELETE /api/carrier-settlements/:id - Cancel/delete settlement
// WARNING: This will unlink all orders from this settlement
// ================================================================
carrierSettlementsRouter.delete('/:id', async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;

        logger.debug('CARRIER-SETTLEMENTS', 'Deleting settlement', { id });

        // First, unlink all orders
        await supabaseAdmin
            .from('orders')
            .update({ carrier_settlement_id: null })
            .eq('carrier_settlement_id', id);

        // Delete settlement
        const { error } = await supabaseAdmin
            .from('carrier_settlements')
            .delete()
            .eq('id', id)
            .eq('store_id', req.storeId);

        if (error) {
            logger.error('CARRIER-SETTLEMENTS', 'Error deleting settlement', error);
            return res.status(500).json({ error: 'Error al eliminar liquidación' });
        }

        logger.debug('CARRIER-SETTLEMENTS', 'Settlement deleted', { id });

        res.json({ message: 'Settlement deleted successfully' });
    } catch (error: any) {
        logger.error('CARRIER-SETTLEMENTS', 'Error deleting settlement', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// ================================================================
// GET /api/carrier-settlements/preview - Preview settlement before creating
// Query params: carrier_id, period_start, period_end
// Returns order list and calculated totals without creating record
// ================================================================
carrierSettlementsRouter.get('/preview/calculate', async (req: AuthRequest, res: Response) => {
    try {
        const { carrier_id, period_start, period_end } = req.query;

        if (!carrier_id || !period_start || !period_end) {
            return res.status(400).json({
                error: 'Missing parameters',
                message: 'carrier_id, period_start, and period_end are required'
            });
        }

        logger.debug('CARRIER-SETTLEMENTS', 'Previewing settlement', {
            carrier_id,
            period_start,
            period_end
        });

        // Get delivered orders in period (not yet settled)
        const { data: orders, error: ordersError } = await supabaseAdmin
            .from('orders')
            .select(`
                id,
                shopify_order_number,
                customer_first_name,
                customer_last_name,
                total_price,
                shipping_cost,
                delivery_zone,
                delivered_at
            `)
            .eq('store_id', req.storeId)
            .eq('courier_id', carrier_id)
            .eq('sleeves_status', 'delivered')
            .gte('delivered_at', period_start)
            .lt('delivered_at', `${period_end}T23:59:59`)
            .is('carrier_settlement_id', null)
            .order('delivered_at', { ascending: false });

        if (ordersError) {
            throw ordersError;
        }

        // Calculate totals
        const total_orders = orders?.length || 0;
        const total_cod = orders?.reduce((sum, o) => sum + Number(o.total_price || 0), 0) || 0;
        const total_shipping = orders?.reduce((sum, o) => sum + Number(o.shipping_cost || 0), 0) || 0;
        const net_amount = total_cod - total_shipping;

        res.json({
            preview: {
                total_orders,
                total_cod_collected: total_cod,
                total_shipping_cost: total_shipping,
                net_amount
            },
            orders: orders || []
        });
    } catch (error: any) {
        logger.error('CARRIER-SETTLEMENTS', 'Error previewing settlement', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

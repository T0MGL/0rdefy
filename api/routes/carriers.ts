// ================================================================
// NEONFLOW API - CARRIERS (SHIPPING) ROUTES
// ================================================================
// Shipping carrier management and tracking
// ================================================================

import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../db/connection';
import { verifyToken, extractStoreId, AuthRequest } from '../middleware/auth';
import { extractUserRole, requireModule, requirePermission, PermissionRequest } from '../middleware/permissions';
import { Module, Permission } from '../permissions';
import {
  calculateCourierDeliveryRate,
  getCourierPerformanceByStore,
  getTopCouriers,
  getUnderperformingCouriers
} from '../utils/courier-stats';
import { validateUUIDParam } from '../utils/sanitize';

export const carriersRouter = Router();

carriersRouter.use(verifyToken, extractStoreId, extractUserRole);

// Apply module-level access check for all routes
carriersRouter.use(requireModule(Module.CARRIERS));

// Using req.storeId from middleware

// ================================================================
// GET /api/carriers - List all carriers
// ================================================================
carriersRouter.get('/', async (req: AuthRequest, res: Response) => {
    try {
        const {
            limit = '50',
            offset = '0',
            status,
            sort_by = 'carrier_name',
            sort_order = 'ASC'
        } = req.query;

        // Build base query
        let query = supabaseAdmin
            .from('shipping_integrations')
            .select('*', { count: 'exact' })
            .eq('store_id', req.storeId);

        // Apply filters
        if (status === 'active') {
            query = query.eq('is_active', true);
        } else if (status === 'inactive') {
            query = query.eq('is_active', false);
        }

        // Apply sorting
        const validSortFields = ['carrier_name', 'created_at'];
        const sortField = validSortFields.includes(sort_by as string) ? sort_by as string : 'carrier_name';
        const sortDirection = sort_order === 'ASC';

        query = query
            .order(sortField, { ascending: sortDirection })
            .range(parseInt(offset as string, 10), parseInt(offset as string, 10) + parseInt(limit as string, 10) - 1);

        const { data, error, count } = await query;

        if (error) {
            throw error;
        }

        res.json({
            data: data || [],
            pagination: {
                total: count || 0,
                limit: parseInt(limit as string, 10),
                offset: parseInt(offset as string, 10),
                hasMore: parseInt(offset as string, 10) + (data?.length || 0) < (count || 0)
            }
        });
    } catch (error: any) {
        console.error('[GET /api/carriers] Error:', error);
        res.status(500).json({
            error: 'Error al obtener transportadoras',
            message: error.message
        });
    }
});

// ================================================================
// GET /api/carriers/:id - Get single carrier
// ================================================================
carriersRouter.get('/:id', validateUUIDParam('id'), async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;

        const { data, error } = await supabaseAdmin
            .from('shipping_integrations')
            .select('*')
            .eq('id', id)
            .eq('store_id', req.storeId)
            .single();

        if (error || !data) {
            return res.status(404).json({
                error: 'Carrier not found'
            });
        }

        res.json(data);
    } catch (error: any) {
        console.error(`[GET /api/carriers/${req.params.id}] Error:`, error);
        res.status(500).json({
            error: 'Error al obtener transportadora',
            message: error.message
        });
    }
});

// ================================================================
// GET /api/carriers/:id/zones - Get carrier zones with rates
// ================================================================
carriersRouter.get('/:id/zones', validateUUIDParam('id'), async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;

        // Verify carrier exists and belongs to store
        const { data: carrier, error: carrierError } = await supabaseAdmin
            .from('carriers')
            .select('id, name')
            .eq('id', id)
            .eq('store_id', req.storeId)
            .single();

        if (carrierError || !carrier) {
            return res.status(404).json({
                error: 'Carrier not found'
            });
        }

        // Get all active zones for this carrier
        const { data: zones, error: zonesError } = await supabaseAdmin
            .from('carrier_zones')
            .select('*')
            .eq('carrier_id', id)
            .eq('is_active', true)
            .order('zone_name', { ascending: true });

        if (zonesError) {
            console.error('[GET /api/carriers/:id/zones] Error:', zonesError);
            return res.status(500).json({
                error: 'Error al obtener zonas de transportadora',
                message: zonesError.message
            });
        }

        res.json({
            success: true,
            data: zones || []
        });
    } catch (error: any) {
        console.error(`[GET /api/carriers/${req.params.id}/zones] Error:`, error);
        res.status(500).json({
            error: 'Error al obtener zonas de transportadora',
            message: error.message
        });
    }
});

// ================================================================
// POST /api/carriers - Create new carrier
// ================================================================
carriersRouter.post('/', async (req: AuthRequest, res: Response) => {
    try {
        const {
            carrier_name,
            coverage_zones,
            contact_phone,
            contact_email,
            api_key,
            is_active = true,
            settings = {}
        } = req.body;

        // Validation
        if (!carrier_name) {
            return res.status(400).json({
                error: 'Validation failed',
                message: 'Carrier name is required'
            });
        }

        const insertData: any = {
            store_id: req.storeId,
            carrier_name,
            is_active,
            settings
        };

        // Add optional fields if provided
        if (coverage_zones) insertData.coverage_zones = coverage_zones;
        if (contact_phone) insertData.contact_phone = contact_phone;
        if (contact_email) insertData.contact_email = contact_email;
        if (api_key) insertData.api_key = api_key;

        const { data, error } = await supabaseAdmin
            .from('shipping_integrations')
            .insert([insertData])
            .select()
            .single();

        if (error) {
            // Handle duplicate carrier name
            if (error.code === '23505') {
                return res.status(409).json({
                    error: 'Duplicate carrier',
                    message: 'A carrier with this name already exists'
                });
            }
            throw error;
        }

        res.status(201).json({
            message: 'Carrier created successfully',
            data
        });
    } catch (error: any) {
        console.error('[POST /api/carriers] Error:', error);
        res.status(500).json({
            error: 'Error al crear transportadora',
            message: error.message
        });
    }
});

// ================================================================
// PUT /api/carriers/:id - Update carrier
// ================================================================
carriersRouter.put('/:id', validateUUIDParam('id'), async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const {
            carrier_name,
            coverage_zones,
            contact_phone,
            contact_email,
            api_key,
            is_active,
            settings
        } = req.body;

        // Build update object
        const updateData: any = {
            updated_at: new Date().toISOString()
        };

        if (carrier_name !== undefined) updateData.carrier_name = carrier_name;
        if (coverage_zones !== undefined) updateData.coverage_zones = coverage_zones;
        if (contact_phone !== undefined) updateData.contact_phone = contact_phone;
        if (contact_email !== undefined) updateData.contact_email = contact_email;
        if (api_key !== undefined) updateData.api_key = api_key;
        if (is_active !== undefined) updateData.is_active = is_active;
        if (settings !== undefined) updateData.settings = settings;

        const { data, error } = await supabaseAdmin
            .from('shipping_integrations')
            .update(updateData)
            .eq('id', id)
            .eq('store_id', req.storeId)
            .select()
            .single();

        if (error || !data) {
            return res.status(404).json({
                error: 'Carrier not found'
            });
        }

        res.json({
            message: 'Carrier updated successfully',
            data
        });
    } catch (error: any) {
        console.error(`[PUT /api/carriers/${req.params.id}] Error:`, error);
        res.status(500).json({
            error: 'Error al actualizar transportadora',
            message: error.message
        });
    }
});

// ================================================================
// DELETE /api/carriers/:id - Delete carrier
// ================================================================
carriersRouter.delete('/:id', validateUUIDParam('id'), async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;

        const { data, error } = await supabaseAdmin
            .from('shipping_integrations')
            .delete()
            .eq('id', id)
            .eq('store_id', req.storeId)
            .select('id')
            .single();

        if (error || !data) {
            return res.status(404).json({
                error: 'Carrier not found'
            });
        }

        res.json({
            message: 'Carrier deleted successfully',
            id: data.id
        });
    } catch (error: any) {
        console.error(`[DELETE /api/carriers/${req.params.id}] Error:`, error);
        res.status(500).json({
            error: 'Error al eliminar transportadora',
            message: error.message
        });
    }
});

// ================================================================
// PATCH /api/carriers/:id/toggle - Toggle carrier active status
// ================================================================
carriersRouter.patch('/:id/toggle', validateUUIDParam('id'), async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;

        // Get current status
        const { data: current, error: fetchError } = await supabaseAdmin
            .from('shipping_integrations')
            .select('is_active')
            .eq('id', id)
            .eq('store_id', req.storeId)
            .single();

        if (fetchError || !current) {
            return res.status(404).json({
                error: 'Carrier not found'
            });
        }

        // Toggle status
        const { data, error } = await supabaseAdmin
            .from('shipping_integrations')
            .update({
                is_active: !current.is_active,
                updated_at: new Date().toISOString()
            })
            .eq('id', id)
            .eq('store_id', req.storeId)
            .select()
            .single();

        if (error) {
            throw error;
        }

        res.json({
            message: 'Carrier status toggled successfully',
            data
        });
    } catch (error: any) {
        console.error(`[PATCH /api/carriers/${req.params.id}/toggle] Error:`, error);
        res.status(500).json({
            error: 'Error al cambiar estado de transportadora',
            message: error.message
        });
    }
});

// ================================================================
// COURIER DELIVERY PERFORMANCE ENDPOINTS
// ================================================================

// ================================================================
// GET /api/carriers/:id/performance - Get courier performance metrics
// ================================================================
carriersRouter.get('/:id/performance', validateUUIDParam('id'), async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;

        console.log(`📊 [CARRIERS] Fetching performance for courier ${id}`);

        const performance = await calculateCourierDeliveryRate(id);

        if (!performance) {
            return res.status(404).json({
                error: 'Courier not found'
            });
        }

        res.json({
            data: performance
        });
    } catch (error: any) {
        console.error(`[GET /api/carriers/${req.params.id}/performance] Error:`, error);
        res.status(500).json({
            error: 'Error al obtener rendimiento del courier',
            message: error.message
        });
    }
});

// ================================================================
// GET /api/carriers/performance/all - Get all courier performance
// ================================================================
carriersRouter.get('/performance/all', async (req: AuthRequest, res: Response) => {
    try {
        console.log(`📊 [CARRIERS] Fetching all courier performance for store ${req.storeId}`);

        const performance = await getCourierPerformanceByStore(req.storeId);

        res.json({
            data: performance,
            count: performance.length
        });
    } catch (error: any) {
        console.error('[GET /api/carriers/performance/all] Error:', error);
        res.status(500).json({
            error: 'Error al obtener rendimiento del courier',
            message: error.message
        });
    }
});

// ================================================================
// GET /api/carriers/performance/top - Get top performing couriers
// ================================================================
carriersRouter.get('/performance/top', async (req: AuthRequest, res: Response) => {
    try {
        const { limit = '5' } = req.query;

        console.log(`🏆 [CARRIERS] Fetching top ${limit} couriers for store ${req.storeId}`);

        const topCouriers = await getTopCouriers(req.storeId, parseInt(limit as string, 10));

        res.json({
            data: topCouriers,
            count: topCouriers.length
        });
    } catch (error: any) {
        console.error('[GET /api/carriers/performance/top] Error:', error);
        res.status(500).json({
            error: 'Error al obtener mejores couriers',
            message: error.message
        });
    }
});

// ================================================================
// GET /api/carriers/performance/underperforming - Get underperforming couriers
// ================================================================
carriersRouter.get('/performance/underperforming', async (req: AuthRequest, res: Response) => {
    try {
        const { threshold = '80' } = req.query;

        console.log(`⚠️ [CARRIERS] Fetching underperforming couriers (threshold: ${threshold}%)`);

        const underperformingCouriers = await getUnderperformingCouriers(
            req.storeId,
            parseInt(threshold as string, 10)
        );

        res.json({
            data: underperformingCouriers,
            count: underperformingCouriers.length
        });
    } catch (error: any) {
        console.error('[GET /api/carriers/performance/underperforming] Error:', error);
        res.status(500).json({
            error: 'Error al obtener couriers con bajo rendimiento',
            message: error.message
        });
    }
});

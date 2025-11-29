// ================================================================
// ORDEFY API - COURIERS ROUTES (Repartidores/Delivery Personnel)
// ================================================================
// CRUD operations for delivery couriers
// ================================================================

import { Router, Response } from 'express';
import { supabaseAdmin } from '../db/connection';
import { verifyToken, extractStoreId, AuthRequest } from '../middleware/auth';
import {
  calculateCourierDeliveryRate,
  getCourierPerformanceByStore,
  getTopCouriers,
  getUnderperformingCouriers
} from '../utils/courier-stats';

export const couriersRouter = Router();

couriersRouter.use(verifyToken, extractStoreId);

// ================================================================
// GET /api/couriers - List all couriers (repartidores)
// ================================================================
couriersRouter.get('/', async (req: AuthRequest, res: Response) => {
    try {
        const {
            limit = '50',
            offset = '0',
            status
        } = req.query;

        console.log(`📦 [COURIERS] Fetching couriers for store ${req.storeId}, status: ${status}`);

        // Build base query
        let query = supabaseAdmin
            .from('carriers')
            .select('*', { count: 'exact' })
            .eq('store_id', req.storeId);

        // Filter by status
        if (status === 'active') {
            query = query.eq('is_active', true);
        } else if (status === 'inactive') {
            query = query.eq('is_active', false);
        }

        // Apply pagination and sorting
        query = query
            .order('name', { ascending: true })
            .range(parseInt(offset as string), parseInt(offset as string) + parseInt(limit as string) - 1);

        const { data, error, count } = await query;

        if (error) {
            console.error('[COURIERS] Query error:', error);
            throw error;
        }

        console.log(`✅ [COURIERS] Found ${data?.length || 0} couriers`);

        res.json({
            data: data || [],
            pagination: {
                total: count || 0,
                limit: parseInt(limit as string),
                offset: parseInt(offset as string),
                hasMore: parseInt(offset as string) + (data?.length || 0) < (count || 0)
            }
        });
    } catch (error: any) {
        console.error('[GET /api/couriers] Error:', error);
        res.status(500).json({
            error: 'Failed to fetch couriers',
            message: error.message
        });
    }
});

// ================================================================
// GET /api/couriers/:id - Get single courier
// ================================================================
couriersRouter.get('/:id', async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;

        const { data, error } = await supabaseAdmin
            .from('carriers')
            .select('*')
            .eq('id', id)
            .eq('store_id', req.storeId)
            .single();

        if (error || !data) {
            return res.status(404).json({
                error: 'Courier not found'
            });
        }

        res.json({
            data
        });
    } catch (error: any) {
        console.error(`[GET /api/couriers/${req.params.id}] Error:`, error);
        res.status(500).json({
            error: 'Failed to fetch courier',
            message: error.message
        });
    }
});

// ================================================================
// POST /api/couriers - Create new courier
// ================================================================
couriersRouter.post('/', async (req: AuthRequest, res: Response) => {
    try {
        const {
            name,
            phone,
            email,
            notes
        } = req.body;

        // Validation
        if (!name) {
            return res.status(400).json({
                error: 'Validation failed',
                message: 'Name is required'
            });
        }

        const { data, error } = await supabaseAdmin
            .from('carriers')
            .insert([{
                store_id: req.storeId,
                name,
                phone: phone || null,
                email: email || null,
                is_active: true,
                notes: notes || null
            }])
            .select()
            .single();

        if (error) {
            throw error;
        }

        res.status(201).json({
            message: 'Courier created successfully',
            data
        });
    } catch (error: any) {
        console.error('[POST /api/couriers] Error:', error);
        res.status(500).json({
            error: 'Failed to create courier',
            message: error.message
        });
    }
});

// ================================================================
// PUT /api/couriers/:id - Update courier
// ================================================================
couriersRouter.put('/:id', async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const {
            name,
            phone,
            email,
            is_active,
            notes
        } = req.body;

        const updateData: any = {
            updated_at: new Date().toISOString()
        };

        if (name !== undefined) updateData.name = name;
        if (phone !== undefined) updateData.phone = phone;
        if (email !== undefined) updateData.email = email;
        if (is_active !== undefined) updateData.is_active = is_active;
        if (notes !== undefined) updateData.notes = notes;

        const { data, error } = await supabaseAdmin
            .from('carriers')
            .update(updateData)
            .eq('id', id)
            .eq('store_id', req.storeId)
            .select()
            .single();

        if (error || !data) {
            return res.status(404).json({
                error: 'Courier not found'
            });
        }

        res.json({
            message: 'Courier updated successfully',
            data
        });
    } catch (error: any) {
        console.error(`[PUT /api/couriers/${req.params.id}] Error:`, error);
        res.status(500).json({
            error: 'Failed to update courier',
            message: error.message
        });
    }
});

// ================================================================
// PATCH /api/couriers/:id/toggle - Toggle courier active status
// ================================================================
couriersRouter.patch('/:id/toggle', async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;

        // First, get current status
        const { data: currentData, error: fetchError } = await supabaseAdmin
            .from('carriers')
            .select('is_active')
            .eq('id', id)
            .eq('store_id', req.storeId)
            .single();

        if (fetchError || !currentData) {
            return res.status(404).json({
                error: 'Courier not found'
            });
        }

        // Toggle the status
        const newStatus = !currentData.is_active;

        const { data, error } = await supabaseAdmin
            .from('carriers')
            .update({
                is_active: newStatus,
                updated_at: new Date().toISOString()
            })
            .eq('id', id)
            .eq('store_id', req.storeId)
            .select()
            .single();

        if (error || !data) {
            return res.status(404).json({
                error: 'Courier not found'
            });
        }

        console.log(`🔄 [COURIERS] Toggled courier ${id} to ${newStatus ? 'active' : 'inactive'}`);

        res.json({
            message: `Courier ${newStatus ? 'activated' : 'deactivated'} successfully`,
            data
        });
    } catch (error: any) {
        console.error(`[PATCH /api/couriers/${req.params.id}/toggle] Error:`, error);
        res.status(500).json({
            error: 'Failed to toggle courier status',
            message: error.message
        });
    }
});

// ================================================================
// DELETE /api/couriers/:id - Delete courier
// ================================================================
couriersRouter.delete('/:id', async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;

        const { data, error } = await supabaseAdmin
            .from('carriers')
            .delete()
            .eq('id', id)
            .eq('store_id', req.storeId)
            .select('id')
            .single();

        if (error || !data) {
            return res.status(404).json({
                error: 'Courier not found'
            });
        }

        res.json({
            message: 'Courier deleted successfully',
            id: data.id
        });
    } catch (error: any) {
        console.error(`[DELETE /api/couriers/${req.params.id}] Error:`, error);
        res.status(500).json({
            error: 'Failed to delete courier',
            message: error.message
        });
    }
});

// ================================================================
// COURIER DELIVERY PERFORMANCE ENDPOINTS
// ================================================================

// ================================================================
// GET /api/couriers/:id/performance - Get courier performance metrics
// ================================================================
couriersRouter.get('/:id/performance', async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;

        console.log(`📊 [COURIERS] Fetching performance for courier ${id}`);

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
        console.error(`[GET /api/couriers/${req.params.id}/performance] Error:`, error);
        res.status(500).json({
            error: 'Failed to fetch courier performance',
            message: error.message
        });
    }
});

// ================================================================
// GET /api/couriers/performance/all - Get all courier performance
// ================================================================
couriersRouter.get('/performance/all', async (req: AuthRequest, res: Response) => {
    try {
        console.log(`📊 [COURIERS] Fetching all courier performance for store ${req.storeId}`);

        const performance = await getCourierPerformanceByStore(req.storeId);

        res.json({
            data: performance,
            count: performance.length
        });
    } catch (error: any) {
        console.error('[GET /api/couriers/performance/all] Error:', error);
        res.status(500).json({
            error: 'Failed to fetch courier performance',
            message: error.message
        });
    }
});

// ================================================================
// GET /api/couriers/performance/top - Get top performing couriers
// ================================================================
couriersRouter.get('/performance/top', async (req: AuthRequest, res: Response) => {
    try {
        const { limit = '5' } = req.query;

        console.log(`🏆 [COURIERS] Fetching top ${limit} couriers for store ${req.storeId}`);

        const topCouriers = await getTopCouriers(req.storeId, parseInt(limit as string));

        res.json({
            data: topCouriers,
            count: topCouriers.length
        });
    } catch (error: any) {
        console.error('[GET /api/couriers/performance/top] Error:', error);
        res.status(500).json({
            error: 'Failed to fetch top couriers',
            message: error.message
        });
    }
});

// ================================================================
// GET /api/couriers/performance/underperforming - Get underperforming couriers
// ================================================================
couriersRouter.get('/performance/underperforming', async (req: AuthRequest, res: Response) => {
    try {
        const { threshold = '80' } = req.query;

        console.log(`⚠️ [COURIERS] Fetching underperforming couriers (threshold: ${threshold}%)`);

        const underperformingCouriers = await getUnderperformingCouriers(
            req.storeId,
            parseInt(threshold as string)
        );

        res.json({
            data: underperformingCouriers,
            count: underperformingCouriers.length
        });
    } catch (error: any) {
        console.error('[GET /api/couriers/performance/underperforming] Error:', error);
        res.status(500).json({
            error: 'Failed to fetch underperforming couriers',
            message: error.message
        });
    }
});

// ================================================================
// CARRIER ZONES MANAGEMENT (Zone-based Pricing)
// ================================================================

// ================================================================
// GET /api/couriers/:id/zones - List zones for a courier
// ================================================================
couriersRouter.get('/:id/zones', async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;

        console.log(`🗺️ [COURIERS] Fetching zones for courier ${id}`);

        // Verify courier exists and belongs to store
        const { data: courier, error: courierError } = await supabaseAdmin
            .from('carriers')
            .select('id, name, carrier_type')
            .eq('id', id)
            .eq('store_id', req.storeId)
            .single();

        if (courierError || !courier) {
            return res.status(404).json({
                error: 'Courier not found'
            });
        }

        // Fetch zones
        const { data: zones, error: zonesError } = await supabaseAdmin
            .from('carrier_zones')
            .select('*')
            .eq('carrier_id', id)
            .eq('store_id', req.storeId)
            .order('zone_name', { ascending: true });

        if (zonesError) {
            throw zonesError;
        }

        res.json({
            courier: courier,
            zones: zones || [],
            count: zones?.length || 0
        });
    } catch (error: any) {
        console.error(`[GET /api/couriers/${req.params.id}/zones] Error:`, error);
        res.status(500).json({
            error: 'Failed to fetch courier zones',
            message: error.message
        });
    }
});

// ================================================================
// POST /api/couriers/:id/zones - Create a zone for a courier
// ================================================================
couriersRouter.post('/:id/zones', async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { zone_name, zone_code, rate, is_active = true } = req.body;

        console.log(`🗺️ [COURIERS] Creating zone for courier ${id}:`, { zone_name, rate });

        // Validation
        if (!zone_name) {
            return res.status(400).json({
                error: 'Validation failed',
                message: 'zone_name is required'
            });
        }

        if (!rate || isNaN(parseFloat(rate)) || parseFloat(rate) <= 0) {
            return res.status(400).json({
                error: 'Validation failed',
                message: 'Valid rate is required (must be > 0)'
            });
        }

        // Verify courier exists
        const { data: courier, error: courierError } = await supabaseAdmin
            .from('carriers')
            .select('id')
            .eq('id', id)
            .eq('store_id', req.storeId)
            .single();

        if (courierError || !courier) {
            return res.status(404).json({
                error: 'Courier not found'
            });
        }

        // Create zone
        const { data, error } = await supabaseAdmin
            .from('carrier_zones')
            .insert([{
                store_id: req.storeId,
                carrier_id: id,
                zone_name: zone_name.trim(),
                zone_code: zone_code?.trim() || null,
                rate: parseFloat(rate),
                is_active
            }])
            .select()
            .single();

        if (error) {
            // Handle duplicate zone name
            if (error.code === '23505') {
                return res.status(409).json({
                    error: 'Duplicate zone',
                    message: 'A zone with this name already exists for this courier'
                });
            }
            throw error;
        }

        console.log(`✅ [COURIERS] Zone created:`, data.id);

        res.status(201).json({
            message: 'Zone created successfully',
            data
        });
    } catch (error: any) {
        console.error(`[POST /api/couriers/${req.params.id}/zones] Error:`, error);
        res.status(500).json({
            error: 'Failed to create zone',
            message: error.message
        });
    }
});

// ================================================================
// PUT /api/couriers/zones/:zoneId - Update a zone
// ================================================================
couriersRouter.put('/zones/:zoneId', async (req: AuthRequest, res: Response) => {
    try {
        const { zoneId } = req.params;
        const { zone_name, zone_code, rate, is_active } = req.body;

        console.log(`🗺️ [COURIERS] Updating zone ${zoneId}`);

        const updateData: any = {
            updated_at: new Date().toISOString()
        };

        if (zone_name !== undefined) updateData.zone_name = zone_name.trim();
        if (zone_code !== undefined) updateData.zone_code = zone_code?.trim() || null;
        if (rate !== undefined) {
            if (isNaN(parseFloat(rate)) || parseFloat(rate) <= 0) {
                return res.status(400).json({
                    error: 'Validation failed',
                    message: 'Valid rate is required (must be > 0)'
                });
            }
            updateData.rate = parseFloat(rate);
        }
        if (is_active !== undefined) updateData.is_active = is_active;

        const { data, error } = await supabaseAdmin
            .from('carrier_zones')
            .update(updateData)
            .eq('id', zoneId)
            .eq('store_id', req.storeId)
            .select()
            .single();

        if (error || !data) {
            return res.status(404).json({
                error: 'Zone not found'
            });
        }

        console.log(`✅ [COURIERS] Zone updated:`, zoneId);

        res.json({
            message: 'Zone updated successfully',
            data
        });
    } catch (error: any) {
        console.error(`[PUT /api/couriers/zones/${req.params.zoneId}] Error:`, error);
        res.status(500).json({
            error: 'Failed to update zone',
            message: error.message
        });
    }
});

// ================================================================
// DELETE /api/couriers/zones/:zoneId - Delete a zone
// ================================================================
couriersRouter.delete('/zones/:zoneId', async (req: AuthRequest, res: Response) => {
    try {
        const { zoneId } = req.params;

        console.log(`🗑️ [COURIERS] Deleting zone ${zoneId}`);

        const { data, error } = await supabaseAdmin
            .from('carrier_zones')
            .delete()
            .eq('id', zoneId)
            .eq('store_id', req.storeId)
            .select('id')
            .single();

        if (error || !data) {
            return res.status(404).json({
                error: 'Zone not found'
            });
        }

        console.log(`✅ [COURIERS] Zone deleted:`, zoneId);

        res.json({
            message: 'Zone deleted successfully',
            id: data.id
        });
    } catch (error: any) {
        console.error(`[DELETE /api/couriers/zones/${req.params.zoneId}] Error:`, error);
        res.status(500).json({
            error: 'Failed to delete zone',
            message: error.message
        });
    }
});

// ================================================================
// GET /api/couriers/:id/zones/calculate - Calculate shipping cost
// ================================================================
couriersRouter.get('/:id/zones/calculate', async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { zone_name } = req.query;

        if (!zone_name) {
            return res.status(400).json({
                error: 'Validation failed',
                message: 'zone_name query parameter is required'
            });
        }

        console.log(`💰 [COURIERS] Calculating shipping cost for courier ${id}, zone: ${zone_name}`);

        // Get zone rate
        const { data: zone, error } = await supabaseAdmin
            .from('carrier_zones')
            .select('*')
            .eq('carrier_id', id)
            .eq('zone_name', zone_name)
            .eq('is_active', true)
            .single();

        if (error || !zone) {
            return res.status(404).json({
                error: 'Zone not found',
                message: `No active zone found with name "${zone_name}" for this courier`
            });
        }

        res.json({
            courier_id: id,
            zone_name: zone.zone_name,
            zone_code: zone.zone_code,
            rate: zone.rate,
            currency: 'PYG'
        });
    } catch (error: any) {
        console.error(`[GET /api/couriers/${req.params.id}/zones/calculate] Error:`, error);
        res.status(500).json({
            error: 'Failed to calculate shipping cost',
            message: error.message
        });
    }
});

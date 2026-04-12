// ================================================================
// ORDEFY API - COURIERS ROUTES (Repartidores/Delivery Personnel)
// ================================================================
// CRUD operations for delivery couriers
//
// Security: Requires CARRIERS module access
// Roles with access: owner, admin, logistics, confirmador (view only)
// ================================================================

import { logger } from '../utils/logger';
import { Router, Response } from 'express';
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
import { validateUUIDParam, parsePagination } from '../utils/sanitize';

export const couriersRouter = Router();

// Apply authentication and role middleware
couriersRouter.use(verifyToken, extractStoreId, extractUserRole);

// All courier routes require CARRIERS module access
couriersRouter.use(requireModule(Module.CARRIERS));

// ================================================================
// GET /api/couriers - List all couriers (repartidores)
// ================================================================
couriersRouter.get('/', async (req: AuthRequest, res: Response) => {
    try {
        const {
            limit: rawLimit = '50',
            offset: rawOffset = '0',
            status
        } = req.query;
        const { limit, offset } = parsePagination(rawLimit, rawOffset);

        logger.info('API', `📦 [COURIERS] Fetching couriers for store ${req.storeId}, status: ${status}`);

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
            .range(offset, offset + limit - 1);

        const { data, error, count } = await query;

        if (error) {
            logger.error('API', '[COURIERS] Query error:', error);
            throw error;
        }

        logger.info('API', `✅ [COURIERS] Found ${data?.length || 0} couriers`);

        res.json({
            data: data || [],
            pagination: {
                total: count || 0,
                limit,
                offset,
                hasMore: offset + (data?.length || 0) < (count || 0)
            }
        });
    } catch (error: any) {
        logger.error('API', '[GET /api/couriers] Error:', error);
        res.status(500).json({
            error: 'Error al obtener couriers',
            message: error.message
        });
    }
});

// ================================================================
// GET /api/couriers/:id - Get single courier
// ================================================================
couriersRouter.get('/:id', validateUUIDParam('id'), async (req: AuthRequest, res: Response) => {
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
        logger.error('API', `[GET /api/couriers/${req.params.id}] Error:`, error);
        res.status(500).json({
            error: 'Error al obtener courier',
            message: error.message
        });
    }
});

// ================================================================
// POST /api/couriers - Create new courier
// ================================================================
couriersRouter.post('/', requirePermission(Module.CARRIERS, Permission.CREATE), async (req: PermissionRequest, res: Response) => {
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
        logger.error('API', '[POST /api/couriers] Error:', error);
        res.status(500).json({
            error: 'Error al crear courier',
            message: error.message
        });
    }
});

// ================================================================
// PUT /api/couriers/:id - Update courier
// ================================================================
couriersRouter.put('/:id', validateUUIDParam('id'), requirePermission(Module.CARRIERS, Permission.EDIT), async (req: PermissionRequest, res: Response) => {
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
        logger.error('API', `[PUT /api/couriers/${req.params.id}] Error:`, error);
        res.status(500).json({
            error: 'Error al actualizar courier',
            message: error.message
        });
    }
});

// ================================================================
// PATCH /api/couriers/:id/toggle - Toggle courier active status
// ================================================================
couriersRouter.patch('/:id/toggle', validateUUIDParam('id'), requirePermission(Module.CARRIERS, Permission.EDIT), async (req: PermissionRequest, res: Response) => {
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

        logger.info('API', `🔄 [COURIERS] Toggled courier ${id} to ${newStatus ? 'active' : 'inactive'}`);

        res.json({
            message: `Courier ${newStatus ? 'activated' : 'deactivated'} successfully`,
            data
        });
    } catch (error: any) {
        logger.error('API', `[PATCH /api/couriers/${req.params.id}/toggle] Error:`, error);
        res.status(500).json({
            error: 'Error al cambiar estado de courier',
            message: error.message
        });
    }
});

// ================================================================
// DELETE /api/couriers/:id - Delete courier
// ================================================================
couriersRouter.delete('/:id', validateUUIDParam('id'), requirePermission(Module.CARRIERS, Permission.DELETE), async (req: PermissionRequest, res: Response) => {
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
        logger.error('API', `[DELETE /api/couriers/${req.params.id}] Error:`, error);
        res.status(500).json({
            error: 'Error al eliminar courier',
            message: error.message
        });
    }
});

// ================================================================
// COURIER REPLICATION ACROSS STORES
// ================================================================
//
// Allows an owner/admin that belongs to multiple stores to duplicate a
// carrier (plus its zones and city coverage) into every store they have
// access to, in one atomic call.
//
// Endpoints:
//   GET  /api/couriers/replication-targets
//     Lists the candidate target stores the current user can replicate
//     into (owner/admin membership, excluding the current store).
//
//   POST /api/couriers/:id/replicate
//     Body: { target_store_ids?: string[] }
//     If target_store_ids is omitted or empty, the RPC replicates into
//     every eligible store the user belongs to (owner/admin), excluding
//     the source store.
// ================================================================

// Roles with carrier replication privileges
const CARRIER_REPLICATION_ROLES = new Set<string>(['owner', 'admin']);

// ================================================================
// GET /api/couriers/replication-targets - List eligible target stores
// ================================================================
couriersRouter.get('/replication-targets', async (req: AuthRequest, res: Response) => {
    try {
        if (!req.userId || !req.storeId) {
            return res.status(401).json({
                error: 'Authentication required'
            });
        }

        // Load every store the current user belongs to as owner/admin
        const { data: memberships, error: membershipsError } = await supabaseAdmin
            .from('user_stores')
            .select('store_id, role')
            .eq('user_id', req.userId)
            .eq('is_active', true);

        if (membershipsError) {
            throw membershipsError;
        }

        const eligible = (memberships || []).filter((m) =>
            CARRIER_REPLICATION_ROLES.has(m.role) && m.store_id !== req.storeId
        );

        if (eligible.length === 0) {
            return res.json({
                data: [],
                count: 0
            });
        }

        // Hydrate with store names for the UI
        const storeIds = eligible.map((m) => m.store_id);
        const { data: stores, error: storesError } = await supabaseAdmin
            .from('stores')
            .select('id, name')
            .in('id', storeIds);

        if (storesError) {
            throw storesError;
        }

        const roleByStore = new Map(eligible.map((m) => [m.store_id, m.role] as const));
        const targets = (stores || []).map((s) => ({
            store_id: s.id,
            store_name: s.name,
            role: roleByStore.get(s.id) || null
        })).sort((a, b) => (a.store_name || '').localeCompare(b.store_name || ''));

        res.json({
            data: targets,
            count: targets.length
        });
    } catch (error: any) {
        logger.error('API', '[GET /api/couriers/replication-targets] Error:', error);
        res.status(500).json({
            error: 'Error al obtener tiendas destino',
            message: error.message
        });
    }
});

// ================================================================
// POST /api/couriers/:id/replicate - Replicate carrier into other stores
// ================================================================
couriersRouter.post(
    '/:id/replicate',
    validateUUIDParam('id'),
    requirePermission(Module.CARRIERS, Permission.CREATE),
    async (req: PermissionRequest, res: Response) => {
        try {
            const { id } = req.params;

            if (!req.userId || !req.storeId) {
                return res.status(401).json({
                    error: 'Authentication required'
                });
            }

            // Only owner/admin of the CURRENT store can initiate replication
            if (!req.userRole || !CARRIER_REPLICATION_ROLES.has(req.userRole)) {
                return res.status(403).json({
                    error: 'Insufficient role',
                    message: 'Replicar repartidores requiere rol owner o admin'
                });
            }

            // Verify source carrier belongs to the current store
            const { data: sourceCarrier, error: sourceError } = await supabaseAdmin
                .from('carriers')
                .select('id, store_id, name')
                .eq('id', id)
                .eq('store_id', req.storeId)
                .single();

            if (sourceError || !sourceCarrier) {
                return res.status(404).json({
                    error: 'Courier not found'
                });
            }

            // Determine target store ids
            const rawTargets = Array.isArray(req.body?.target_store_ids)
                ? (req.body.target_store_ids as unknown[])
                : [];

            const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            const sanitizedTargets = rawTargets
                .filter((v): v is string => typeof v === 'string' && UUID_RE.test(v))
                .filter((v) => v !== req.storeId);

            let targetStoreIds: string[] = sanitizedTargets;

            // If caller did not pass explicit targets, auto-resolve to every
            // owner/admin store the user belongs to except the source store.
            if (targetStoreIds.length === 0) {
                const { data: memberships, error: membershipsError } = await supabaseAdmin
                    .from('user_stores')
                    .select('store_id, role')
                    .eq('user_id', req.userId)
                    .eq('is_active', true);

                if (membershipsError) {
                    throw membershipsError;
                }

                targetStoreIds = (memberships || [])
                    .filter((m) => CARRIER_REPLICATION_ROLES.has(m.role) && m.store_id !== req.storeId)
                    .map((m) => m.store_id);
            }

            if (targetStoreIds.length === 0) {
                return res.json({
                    message: 'No eligible target stores',
                    data: {
                        replicated: [],
                        skipped: [],
                        failed: []
                    }
                });
            }

            // Enforce a safety ceiling to avoid runaway fan-out
            const MAX_TARGETS = 50;
            if (targetStoreIds.length > MAX_TARGETS) {
                return res.status(400).json({
                    error: 'Too many target stores',
                    message: `Maximum ${MAX_TARGETS} target stores per replication request`
                });
            }

            const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc(
                'replicate_carrier_to_stores',
                {
                    p_source_carrier_id: id,
                    p_target_store_ids: targetStoreIds,
                    p_actor_user_id: req.userId
                }
            );

            if (rpcError) {
                logger.error('API', `[POST /api/couriers/${id}/replicate] RPC error:`, rpcError);
                return res.status(500).json({
                    error: 'Error al replicar repartidor',
                    message: rpcError.message
                });
            }

            const result = rpcResult as {
                replicated: Array<Record<string, unknown>>;
                skipped: Array<Record<string, unknown>>;
                failed: Array<Record<string, unknown>>;
            };

            logger.info(
                'API',
                `[POST /api/couriers/${id}/replicate] user=${req.userId} source_store=${req.storeId} ` +
                `targets=${targetStoreIds.length} replicated=${result.replicated.length} ` +
                `skipped=${result.skipped.length} failed=${result.failed.length}`
            );

            res.json({
                message: 'Replication processed',
                data: result
            });
        } catch (error: any) {
            logger.error('API', `[POST /api/couriers/${req.params.id}/replicate] Error:`, error);
            res.status(500).json({
                error: 'Error al replicar repartidor',
                message: error.message
            });
        }
    }
);

// ================================================================
// COURIER DELIVERY PERFORMANCE ENDPOINTS
// ================================================================

// ================================================================
// GET /api/couriers/:id/performance - Get courier performance metrics
// ================================================================
couriersRouter.get('/:id/performance', validateUUIDParam('id'), async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;

        logger.info('API', `📊 [COURIERS] Fetching performance for courier ${id}`);

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
        logger.error('API', `[GET /api/couriers/${req.params.id}/performance] Error:`, error);
        res.status(500).json({
            error: 'Error al obtener rendimiento del courier',
            message: error.message
        });
    }
});

// ================================================================
// GET /api/couriers/performance/all - Get all courier performance
// ================================================================
couriersRouter.get('/performance/all', async (req: AuthRequest, res: Response) => {
    try {
        logger.info('API', `📊 [COURIERS] Fetching all courier performance for store ${req.storeId}`);

        const performance = await getCourierPerformanceByStore(req.storeId!);

        res.json({
            data: performance,
            count: performance.length
        });
    } catch (error: any) {
        logger.error('API', '[GET /api/couriers/performance/all] Error:', error);
        res.status(500).json({
            error: 'Error al obtener rendimiento del courier',
            message: error instanceof Error ? error.message : String(error)
        });
    }
});

// ================================================================
// GET /api/couriers/performance/top - Get top performing couriers
// ================================================================
couriersRouter.get('/performance/top', async (req: AuthRequest, res: Response) => {
    try {
        const { limit = '5' } = req.query;

        logger.info('API', `🏆 [COURIERS] Fetching top ${limit} couriers for store ${req.storeId}`);

        const topCouriers = await getTopCouriers(req.storeId!, parseInt(String(limit), 10));

        res.json({
            data: topCouriers,
            count: topCouriers.length
        });
    } catch (error: any) {
        logger.error('API', '[GET /api/couriers/performance/top] Error:', error);
        res.status(500).json({
            error: 'Error al obtener mejores couriers',
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

        logger.info('API', `⚠️ [COURIERS] Fetching underperforming couriers (threshold: ${threshold}%)`);

        const underperformingCouriers = await getUnderperformingCouriers(
            req.storeId!,
            parseInt(String(threshold), 10)
        );

        res.json({
            data: underperformingCouriers,
            count: underperformingCouriers.length
        });
    } catch (error: any) {
        logger.error('API', '[GET /api/couriers/performance/underperforming] Error:', error);
        res.status(500).json({
            error: 'Error al obtener couriers con bajo rendimiento',
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
couriersRouter.get('/:id/zones', validateUUIDParam('id'), async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;

        logger.info('API', `🗺️ [COURIERS] Fetching zones for courier ${id}`);

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
            .select('id, carrier_id, zone_name, zone_code, rate, is_active, created_at')
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
        logger.error('API', `[GET /api/couriers/${req.params.id}/zones] Error:`, error);
        res.status(500).json({
            error: 'Error al obtener zonas del courier',
            message: error.message
        });
    }
});

// ================================================================
// POST /api/couriers/:id/zones - Create a zone for a courier
// ================================================================
couriersRouter.post('/:id/zones', validateUUIDParam('id'), requirePermission(Module.CARRIERS, Permission.CREATE), async (req: PermissionRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { zone_name, zone_code, rate, is_active = true } = req.body;

        logger.info('API', `🗺️ [COURIERS] Creating zone for courier ${id}:`, { zone_name, rate });

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

        logger.info('API', `✅ [COURIERS] Zone created:`, data.id);

        res.status(201).json({
            message: 'Zone created successfully',
            data
        });
    } catch (error: any) {
        logger.error('API', `[POST /api/couriers/${req.params.id}/zones] Error:`, error);
        res.status(500).json({
            error: 'Error al crear zona',
            message: error.message
        });
    }
});

// ================================================================
// PUT /api/couriers/zones/:zoneId - Update a zone
// ================================================================
couriersRouter.put('/zones/:zoneId', validateUUIDParam('zoneId'), requirePermission(Module.CARRIERS, Permission.EDIT), async (req: PermissionRequest, res: Response) => {
    try {
        const { zoneId } = req.params;
        const { zone_name, zone_code, rate, is_active } = req.body;

        logger.info('API', `🗺️ [COURIERS] Updating zone ${zoneId}`);

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

        logger.info('API', `✅ [COURIERS] Zone updated:`, zoneId);

        res.json({
            message: 'Zone updated successfully',
            data
        });
    } catch (error: any) {
        logger.error('API', `[PUT /api/couriers/zones/${req.params.zoneId}] Error:`, error);
        res.status(500).json({
            error: 'Error al actualizar zona',
            message: error.message
        });
    }
});

// ================================================================
// DELETE /api/couriers/zones/:zoneId - Delete a zone
// ================================================================
couriersRouter.delete('/zones/:zoneId', validateUUIDParam('zoneId'), requirePermission(Module.CARRIERS, Permission.DELETE), async (req: PermissionRequest, res: Response) => {
    try {
        const { zoneId } = req.params;

        logger.info('API', `🗑️ [COURIERS] Deleting zone ${zoneId}`);

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

        logger.info('API', `✅ [COURIERS] Zone deleted:`, zoneId);

        res.json({
            message: 'Zone deleted successfully',
            id: data.id
        });
    } catch (error: any) {
        logger.error('API', `[DELETE /api/couriers/zones/${req.params.zoneId}] Error:`, error);
        res.status(500).json({
            error: 'Error al eliminar zona',
            message: error.message
        });
    }
});

// ================================================================
// GET /api/couriers/:id/reviews - Get customer reviews/ratings for courier
// Returns reviews with computed stats (distribution, 30d count, comment count)
// ================================================================
couriersRouter.get('/:id/reviews', validateUUIDParam('id'), async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { limit: rawLimit = '50', offset: rawOffset = '0' } = req.query;
        const { limit, offset } = parsePagination(rawLimit, rawOffset);

        logger.info('API', `[COURIERS] Fetching reviews for courier ${id}`);

        // Verify courier exists and belongs to this store
        const { data: courier, error: courierError } = await supabaseAdmin
            .from('carriers')
            .select('id, name, average_rating, total_ratings')
            .eq('id', id)
            .eq('store_id', req.storeId)
            .single();

        if (courierError || !courier) {
            return res.status(404).json({
                error: 'Courier not found'
            });
        }

        // Fetch paginated reviews (only real columns). Previous version queried
        // `customer` and `date` which do not exist, causing PostgREST to fail
        // silently and the UI to render an empty review list.
        const { data: reviews, error: reviewsError, count } = await supabaseAdmin
            .from('orders')
            .select(`
                id,
                delivery_rating,
                delivery_rating_comment,
                rated_at,
                shopify_order_number,
                shopify_order_name,
                customer_name,
                customer_first_name,
                customer_last_name,
                delivered_at,
                created_at
            `, { count: 'exact' })
            .eq('courier_id', id)
            .eq('store_id', req.storeId)
            .not('delivery_rating', 'is', null)
            .order('rated_at', { ascending: false, nullsFirst: false })
            .range(offset, offset + limit - 1);

        if (reviewsError) {
            logger.error('API', '[COURIERS] Reviews query error:', reviewsError);
            throw reviewsError;
        }

        // Aggregate: distribution + derived stats in one scan of rating-only rows.
        // Kept on a separate query so pagination on `reviews` is independent of stats.
        const { data: allRatingRows, error: distError } = await supabaseAdmin
            .from('orders')
            .select('delivery_rating, delivery_rating_comment, rated_at, delivered_at')
            .eq('courier_id', id)
            .eq('store_id', req.storeId)
            .not('delivery_rating', 'is', null);

        if (distError) {
            logger.error('API', '[COURIERS] Distribution query error:', distError);
            throw distError;
        }

        const ratingDistribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        let commentCount = 0;
        let last30dCount = 0;
        let ratingTimeSum = 0;
        let ratingTimeSamples = 0;
        const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
        const nowMs = Date.now();

        for (const row of allRatingRows || []) {
            const rating = row.delivery_rating as number;
            if (rating >= 1 && rating <= 5) {
                ratingDistribution[rating as 1 | 2 | 3 | 4 | 5]++;
            }

            if (row.delivery_rating_comment && String(row.delivery_rating_comment).trim().length > 0) {
                commentCount++;
            }

            if (row.rated_at) {
                const ratedMs = new Date(row.rated_at as string).getTime();
                if (!Number.isNaN(ratedMs) && nowMs - ratedMs <= THIRTY_DAYS_MS) {
                    last30dCount++;
                }
                if (row.delivered_at) {
                    const deliveredMs = new Date(row.delivered_at as string).getTime();
                    if (!Number.isNaN(ratedMs) && !Number.isNaN(deliveredMs) && ratedMs >= deliveredMs) {
                        ratingTimeSum += (ratedMs - deliveredMs) / (1000 * 60 * 60);
                        ratingTimeSamples++;
                    }
                }
            }
        }

        const totalRated = (allRatingRows || []).length;
        const commentRate = totalRated > 0 ? Math.round((commentCount / totalRated) * 100) : 0;
        const avgHoursToRate = ratingTimeSamples > 0
            ? Number((ratingTimeSum / ratingTimeSamples).toFixed(2))
            : null;

        // Recompute average from the raw ratings (authoritative). Avoids drift if
        // the trigger ever lags.
        const sumRatings = (allRatingRows || []).reduce(
            (acc, r) => acc + (r.delivery_rating as number || 0),
            0
        );
        const computedAverage = totalRated > 0 ? sumRatings / totalRated : 0;

        // Format reviews for response with safe null handling
        const formattedReviews = (reviews || []).map(r => {
            let orderNumber = '#N/A';
            if (r.shopify_order_name) {
                orderNumber = String(r.shopify_order_name);
            } else if (r.shopify_order_number) {
                orderNumber = `#${r.shopify_order_number}`;
            } else if (r.id) {
                orderNumber = `#${String(r.id).slice(0, 4).toUpperCase()}`;
            }

            const customerName = (r.customer_name && String(r.customer_name).trim())
                || `${r.customer_first_name || ''} ${r.customer_last_name || ''}`.trim()
                || 'Cliente';

            return {
                id: r.id || '',
                order_id: r.id || '',
                rating: r.delivery_rating || 0,
                comment: r.delivery_rating_comment || null,
                rated_at: r.rated_at || null,
                order_number: orderNumber,
                customer_name: customerName,
                delivery_date: r.delivered_at || r.created_at || null
            };
        });

        logger.info('API', `[COURIERS] Found ${formattedReviews.length} reviews (total ${totalRated}) for courier ${id}`);

        res.json({
            courier: {
                id: courier.id,
                name: courier.name,
                average_rating: Number(computedAverage.toFixed(2)),
                total_ratings: totalRated
            },
            reviews: formattedReviews,
            rating_distribution: ratingDistribution,
            stats: {
                total_ratings: totalRated,
                last_30d_count: last30dCount,
                comments_count: commentCount,
                comment_rate_percent: commentRate,
                avg_hours_to_rate: avgHoursToRate
            },
            pagination: {
                total: count || totalRated,
                limit,
                offset,
                hasMore: offset + formattedReviews.length < (count || totalRated)
            }
        });
    } catch (error: any) {
        logger.error('API', `[GET /api/couriers/${req.params.id}/reviews] Error:`, error);
        res.status(500).json({
            error: 'Error al obtener reviews del courier',
            message: error.message
        });
    }
});

// ================================================================
// GET /api/couriers/:id/zones/calculate - Calculate shipping cost
// ================================================================
couriersRouter.get('/:id/zones/calculate', validateUUIDParam('id'), async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { zone_name } = req.query;

        if (!zone_name) {
            return res.status(400).json({
                error: 'Validation failed',
                message: 'zone_name query parameter is required'
            });
        }

        logger.info('API', `💰 [COURIERS] Calculating shipping cost for courier ${id}, zone: ${zone_name}`);

        // Get zone rate - only fields needed for calculation
        const { data: zone, error } = await supabaseAdmin
            .from('carrier_zones')
            .select('id, zone_name, zone_code, rate')
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
        logger.error('API', `[GET /api/couriers/${req.params.id}/zones/calculate] Error:`, error);
        res.status(500).json({
            error: 'Error al calcular costo de envío',
            message: error.message
        });
    }
});

// ================================================================
// NEONFLOW API - CARRIERS (SHIPPING) ROUTES
// ================================================================
// Shipping carrier management and tracking
// ================================================================

import { logger } from '../utils/logger';
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
        logger.error('API', '[GET /api/carriers] Error:', error);
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
        logger.error('API', `[GET /api/carriers/${req.params.id}] Error:`, error);
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
            logger.error('API', '[GET /api/carriers/:id/zones] Error:', zonesError);
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
        logger.error('API', `[GET /api/carriers/${req.params.id}/zones] Error:`, error);
        res.status(500).json({
            error: 'Error al obtener zonas de transportadora',
            message: error.message
        });
    }
});

// ================================================================
// POST /api/carriers - Create new carrier
// ================================================================
carriersRouter.post('/', requirePermission(Module.CARRIERS, Permission.CREATE), async (req: PermissionRequest, res: Response) => {
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
        logger.error('API', '[POST /api/carriers] Error:', error);
        res.status(500).json({
            error: 'Error al crear transportadora',
            message: error.message
        });
    }
});

// ================================================================
// PUT /api/carriers/:id - Update carrier
// ================================================================
carriersRouter.put('/:id', validateUUIDParam('id'), requirePermission(Module.CARRIERS, Permission.EDIT), async (req: PermissionRequest, res: Response) => {
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
        logger.error('API', `[PUT /api/carriers/${req.params.id}] Error:`, error);
        res.status(500).json({
            error: 'Error al actualizar transportadora',
            message: error.message
        });
    }
});

// ================================================================
// DELETE /api/carriers/:id - Delete carrier
// ================================================================
carriersRouter.delete('/:id', validateUUIDParam('id'), requirePermission(Module.CARRIERS, Permission.DELETE), async (req: PermissionRequest, res: Response) => {
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
        logger.error('API', `[DELETE /api/carriers/${req.params.id}] Error:`, error);
        res.status(500).json({
            error: 'Error al eliminar transportadora',
            message: error.message
        });
    }
});

// ================================================================
// PATCH /api/carriers/:id/toggle - Toggle carrier active status
// ================================================================
carriersRouter.patch('/:id/toggle', validateUUIDParam('id'), requirePermission(Module.CARRIERS, Permission.EDIT), async (req: PermissionRequest, res: Response) => {
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
        logger.error('API', `[PATCH /api/carriers/${req.params.id}/toggle] Error:`, error);
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

        logger.info('API', `📊 [CARRIERS] Fetching performance for courier ${id}`);

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
        logger.error('API', `[GET /api/carriers/${req.params.id}/performance] Error:`, error);
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
        logger.info('API', `📊 [CARRIERS] Fetching all courier performance for store ${req.storeId}`);

        const performance = await getCourierPerformanceByStore(req.storeId);

        res.json({
            data: performance,
            count: performance.length
        });
    } catch (error: any) {
        logger.error('API', '[GET /api/carriers/performance/all] Error:', error);
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

        logger.info('API', `🏆 [CARRIERS] Fetching top ${limit} couriers for store ${req.storeId}`);

        const topCouriers = await getTopCouriers(req.storeId, parseInt(limit as string, 10));

        res.json({
            data: topCouriers,
            count: topCouriers.length
        });
    } catch (error: any) {
        logger.error('API', '[GET /api/carriers/performance/top] Error:', error);
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

        logger.info('API', `⚠️ [CARRIERS] Fetching underperforming couriers (threshold: ${threshold}%)`);

        const underperformingCouriers = await getUnderperformingCouriers(
            req.storeId,
            parseInt(threshold as string, 10)
        );

        res.json({
            data: underperformingCouriers,
            count: underperformingCouriers.length
        });
    } catch (error: any) {
        logger.error('API', '[GET /api/carriers/performance/underperforming] Error:', error);
        res.status(500).json({
            error: 'Error al obtener couriers con bajo rendimiento',
            message: error.message
        });
    }
});

// ================================================================
// CARRIER COVERAGE ENDPOINTS (City-based rates)
// ================================================================

// ================================================================
// GET /api/carriers/locations/search - Search Paraguay cities (autocomplete)
// ================================================================
carriersRouter.get('/locations/search', async (req: AuthRequest, res: Response) => {
    try {
        const { q, limit = '10' } = req.query;

        if (!q || (q as string).length < 2) {
            return res.json({ data: [] });
        }

        const { data, error } = await supabaseAdmin.rpc('search_paraguay_cities', {
            p_query: q as string,
            p_limit: parseInt(limit as string, 10)
        });

        if (error) {
            logger.error('API', '[GET /api/carriers/locations/search] RPC error:', error);
            // Fallback to direct query if function doesn't exist
            const { data: fallbackData, error: fallbackError } = await supabaseAdmin
                .from('paraguay_locations')
                .select('city, department, zone_code')
                .ilike('city_normalized', `%${(q as string).toLowerCase()}%`)
                .limit(parseInt(limit as string, 10));

            if (fallbackError) throw fallbackError;

            return res.json({
                data: (fallbackData || []).map(loc => ({
                    ...loc,
                    display_text: `${loc.city} (${loc.department})`
                }))
            });
        }

        res.json({ data: data || [] });
    } catch (error: any) {
        logger.error('API', '[GET /api/carriers/locations/search] Error:', error);
        res.status(500).json({
            error: 'Error al buscar ciudades',
            message: error.message
        });
    }
});

// ================================================================
// GET /api/carriers/coverage/city - Get carriers with coverage for a city
// ================================================================
carriersRouter.get('/coverage/city', async (req: AuthRequest, res: Response) => {
    try {
        const { city, department, zone_code } = req.query;

        if (!city) {
            return res.status(400).json({
                error: 'City parameter is required'
            });
        }

        const normalizeText = (value?: string | null): string =>
            (value || '')
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .toLowerCase()
                .trim();

        const normalizedCity = normalizeText(city as string);
        const normalizedZoneCode = normalizeText((zone_code as string) || '');

        const { data, error } = await supabaseAdmin.rpc('get_carriers_for_city', {
            p_store_id: req.storeId,
            p_city: city as string,
            p_department: department as string || null
        });

        if (error) {
            logger.error('API', '[GET /api/carriers/coverage/city] RPC error:', error);
            // Fallback: Get all carriers and their coverage manually
            const { data: carriers, error: carriersError } = await supabaseAdmin
                .from('carriers')
                .select(`
                    id,
                    name,
                    phone,
                    carrier_coverage!inner (
                        rate,
                        city
                    )
                `)
                .eq('store_id', req.storeId)
                .eq('is_active', true)
                .ilike('carrier_coverage.city', city as string);

            if (carriersError) throw carriersError;

            return res.json({
                data: (carriers || []).map(c => ({
                    carrier_id: c.id,
                    carrier_name: c.name,
                    carrier_phone: c.phone,
                    rate: c.carrier_coverage?.[0]?.rate || null,
                    has_coverage: c.carrier_coverage?.[0]?.rate != null
                }))
            });
        }

        const carriersData = (data || []) as Array<{
            carrier_id: string;
            carrier_name: string;
            carrier_phone: string | null;
            rate: number | null;
            zone_code: string | null;
            has_coverage: boolean;
        }>;

        // Backward-compatible fallback:
        // If city-based coverage is missing, allow legacy carrier_zones match
        // by zone_code (preferred) or exact city name in zone_name.
        const { data: zoneRows, error: zoneRowsError } = await supabaseAdmin
            .from('carrier_zones')
            .select('carrier_id, rate, zone_name, zone_code')
            .eq('store_id', req.storeId)
            .eq('is_active', true);

        if (zoneRowsError) throw zoneRowsError;

        const legacyZoneRates = new Map<string, number>();
        (zoneRows || []).forEach((zone: any) => {
            const zoneName = normalizeText(zone.zone_name);
            const zoneCode = normalizeText(zone.zone_code);
            const matchesByZoneCode = normalizedZoneCode && zoneCode === normalizedZoneCode;
            const matchesByZoneName = zoneName && zoneName === normalizedCity;
            if (!matchesByZoneCode && !matchesByZoneName) return;
            const rate = Number(zone.rate);
            if (!Number.isFinite(rate)) return;

            const current = legacyZoneRates.get(zone.carrier_id);
            if (current == null || rate < current) {
                legacyZoneRates.set(zone.carrier_id, rate);
            }
        });

        const enriched = carriersData.map((carrier) => {
            if (carrier.has_coverage) return carrier;
            const fallbackRate = legacyZoneRates.get(carrier.carrier_id);
            if (fallbackRate == null) return carrier;
            return {
                ...carrier,
                rate: fallbackRate,
                has_coverage: true
            };
        });

        const sorted = enriched.sort((a, b) => {
            if (a.has_coverage && !b.has_coverage) return -1;
            if (!a.has_coverage && b.has_coverage) return 1;
            if (a.rate === null) return 1;
            if (b.rate === null) return -1;
            return a.rate - b.rate;
        });

        res.json({ data: sorted });
    } catch (error: any) {
        logger.error('API', '[GET /api/carriers/coverage/city] Error:', error);
        res.status(500).json({
            error: 'Error al obtener cobertura de carriers',
            message: error.message
        });
    }
});

// ================================================================
// GET /api/carriers/:id/coverage - Get all coverage for a carrier
// ================================================================
carriersRouter.get('/:id/coverage', validateUUIDParam('id'), async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { zone_code } = req.query;

        let query = supabaseAdmin
            .from('carrier_coverage')
            .select(`
                id,
                city,
                department,
                rate,
                is_active,
                created_at,
                updated_at
            `)
            .eq('carrier_id', id)
            .eq('is_active', true)
            .order('city', { ascending: true });

        // Optional: filter by zone via join with paraguay_locations
        if (zone_code) {
            // We need to join with paraguay_locations to filter by zone
            const { data: locations } = await supabaseAdmin
                .from('paraguay_locations')
                .select('city')
                .eq('zone_code', zone_code as string);

            if (locations && locations.length > 0) {
                const cities = locations.map(l => l.city);
                query = query.in('city', cities);
            }
        }

        const { data, error } = await query;

        if (error) throw error;

        // Group by zone for easier display
        const coverageWithZones = await Promise.all((data || []).map(async (cov) => {
            const { data: loc } = await supabaseAdmin
                .from('paraguay_locations')
                .select('zone_code, department')
                .ilike('city', cov.city)
                .single();

            return {
                ...cov,
                zone_code: loc?.zone_code || 'UNKNOWN',
                department: cov.department || loc?.department
            };
        }));

        // Calculate summary
        const summary = {
            total_cities: coverageWithZones.length,
            with_coverage: coverageWithZones.filter(c => c.rate != null).length,
            without_coverage: coverageWithZones.filter(c => c.rate == null).length,
            min_rate: Math.min(...coverageWithZones.filter(c => c.rate != null).map(c => c.rate)),
            max_rate: Math.max(...coverageWithZones.filter(c => c.rate != null).map(c => c.rate)),
            by_zone: coverageWithZones.reduce((acc, c) => {
                const zone = c.zone_code || 'UNKNOWN';
                if (!acc[zone]) {
                    acc[zone] = { count: 0, with_coverage: 0, min_rate: Infinity, max_rate: 0 };
                }
                acc[zone].count++;
                if (c.rate != null) {
                    acc[zone].with_coverage++;
                    acc[zone].min_rate = Math.min(acc[zone].min_rate, c.rate);
                    acc[zone].max_rate = Math.max(acc[zone].max_rate, c.rate);
                }
                return acc;
            }, {} as Record<string, any>)
        };

        res.json({
            data: coverageWithZones,
            summary
        });
    } catch (error: any) {
        logger.error('API', `[GET /api/carriers/${req.params.id}/coverage] Error:`, error);
        res.status(500).json({
            error: 'Error al obtener cobertura del carrier',
            message: error.message
        });
    }
});

// ================================================================
// POST /api/carriers/:id/coverage - Add/Update coverage for a carrier
// ================================================================
carriersRouter.post('/:id/coverage', validateUUIDParam('id'), requirePermission(Module.CARRIERS, Permission.EDIT), async (req: PermissionRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { city, department, rate } = req.body;

        if (!city) {
            return res.status(400).json({
                error: 'City is required'
            });
        }

        // Verify carrier exists and belongs to store
        const { data: carrier, error: carrierError } = await supabaseAdmin
            .from('carriers')
            .select('id')
            .eq('id', id)
            .eq('store_id', req.storeId)
            .single();

        if (carrierError || !carrier) {
            return res.status(404).json({
                error: 'Carrier not found'
            });
        }

        // Check if coverage already exists for this carrier+city+department
        const normalizedDepartment = department || '';
        const { data: existing } = await supabaseAdmin
            .from('carrier_coverage')
            .select('id')
            .eq('carrier_id', id)
            .ilike('city', city)
            .eq('department', normalizedDepartment)
            .single();

        let data, error;

        if (existing) {
            // Update existing coverage
            const result = await supabaseAdmin
                .from('carrier_coverage')
                .update({
                    rate: rate === 'SIN COBERTURA' || rate === null ? null : rate,
                    is_active: true,
                    updated_at: new Date().toISOString()
                })
                .eq('id', existing.id)
                .select()
                .single();
            data = result.data;
            error = result.error;
        } else {
            // Insert new coverage
            const result = await supabaseAdmin
                .from('carrier_coverage')
                .insert({
                    store_id: req.storeId,
                    carrier_id: id,
                    city,
                    department: normalizedDepartment,
                    rate: rate === 'SIN COBERTURA' || rate === null ? null : rate,
                    is_active: true
                })
                .select()
                .single();
            data = result.data;
            error = result.error;
        }

        if (error) throw error;

        res.json({
            message: rate == null ? 'Coverage removed (SIN COBERTURA)' : 'Coverage updated',
            data
        });
    } catch (error: any) {
        logger.error('API', `[POST /api/carriers/${req.params.id}/coverage] Error:`, error);
        res.status(500).json({
            error: 'Error al actualizar cobertura',
            message: error.message
        });
    }
});

// ================================================================
// POST /api/carriers/:id/coverage/bulk - Bulk import coverage
// ================================================================
carriersRouter.post('/:id/coverage/bulk', validateUUIDParam('id'), requirePermission(Module.CARRIERS, Permission.EDIT), async (req: PermissionRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { coverage } = req.body;

        if (!Array.isArray(coverage) || coverage.length === 0) {
            return res.status(400).json({
                error: 'Coverage array is required'
            });
        }

        // Verify carrier exists and belongs to store
        const { data: carrier, error: carrierError } = await supabaseAdmin
            .from('carriers')
            .select('id')
            .eq('id', id)
            .eq('store_id', req.storeId)
            .single();

        if (carrierError || !carrier) {
            return res.status(404).json({
                error: 'Carrier not found'
            });
        }

        // Try RPC first
        const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc('import_carrier_coverage', {
            p_store_id: req.storeId,
            p_carrier_id: id,
            p_coverage: coverage
        });

        if (!rpcError) {
            return res.json({
                message: 'Coverage imported successfully',
                count: rpcResult
            });
        }

        // Fallback: Manual one-by-one insert/update
        logger.warn('API', '[POST /api/carriers/:id/coverage/bulk] RPC failed, using fallback:', rpcError);

        let successCount = 0;
        for (const c of coverage) {
            const normalizedDept = c.department || '';
            const rateValue = c.rate === 'SIN COBERTURA' || c.rate === null ? null : c.rate;

            // Check if exists
            const { data: existing } = await supabaseAdmin
                .from('carrier_coverage')
                .select('id')
                .eq('carrier_id', id)
                .ilike('city', c.city)
                .eq('department', normalizedDept)
                .single();

            if (existing) {
                await supabaseAdmin
                    .from('carrier_coverage')
                    .update({ rate: rateValue, is_active: true, updated_at: new Date().toISOString() })
                    .eq('id', existing.id);
            } else {
                await supabaseAdmin
                    .from('carrier_coverage')
                    .insert({
                        store_id: req.storeId,
                        carrier_id: id,
                        city: c.city,
                        department: normalizedDept,
                        rate: rateValue,
                        is_active: true
                    });
            }
            successCount++;
        }

        res.json({
            message: 'Coverage imported successfully',
            count: successCount
        });
    } catch (error: any) {
        logger.error('API', `[POST /api/carriers/${req.params.id}/coverage/bulk] Error:`, error);
        res.status(500).json({
            error: 'Error al importar cobertura',
            message: error.message
        });
    }
});

// ================================================================
// DELETE /api/carriers/:id/coverage/:city - Remove coverage for a city
// ================================================================
carriersRouter.delete('/:id/coverage/:city', validateUUIDParam('id'), requirePermission(Module.CARRIERS, Permission.DELETE), async (req: PermissionRequest, res: Response) => {
    try {
        const { id, city } = req.params;

        const { data, error } = await supabaseAdmin
            .from('carrier_coverage')
            .update({ is_active: false, updated_at: new Date().toISOString() })
            .eq('carrier_id', id)
            .ilike('city', city)
            .select('id')
            .single();

        if (error) throw error;

        res.json({
            message: 'Coverage removed',
            id: data?.id
        });
    } catch (error: any) {
        logger.error('API', `[DELETE /api/carriers/${req.params.id}/coverage/${req.params.city}] Error:`, error);
        res.status(500).json({
            error: 'Error al eliminar cobertura',
            message: error.message
        });
    }
});

// ================================================================
// GET /api/carriers/coverage/summary - Get coverage summary for all carriers
// ================================================================
carriersRouter.get('/coverage/summary', async (req: AuthRequest, res: Response) => {
    try {
        const { data, error } = await supabaseAdmin
            .from('v_carrier_coverage_summary')
            .select('*')
            .eq('store_id', req.storeId);

        if (error) {
            // View might not exist yet, use fallback
            logger.warn('API', '[GET /api/carriers/coverage/summary] View error, using fallback:', error);

            const { data: carriers, error: carriersError } = await supabaseAdmin
                .from('carriers')
                .select(`
                    id,
                    name,
                    carrier_coverage (
                        rate
                    )
                `)
                .eq('store_id', req.storeId)
                .eq('is_active', true);

            if (carriersError) throw carriersError;

            const summary = (carriers || []).map(c => {
                const coverage = c.carrier_coverage || [];
                const withCoverage = coverage.filter((cov: any) => cov.rate != null);
                return {
                    carrier_id: c.id,
                    carrier_name: c.name,
                    cities_with_coverage: withCoverage.length,
                    cities_without_coverage: coverage.length - withCoverage.length,
                    min_rate: withCoverage.length > 0 ? Math.min(...withCoverage.map((cov: any) => cov.rate)) : null,
                    max_rate: withCoverage.length > 0 ? Math.max(...withCoverage.map((cov: any) => cov.rate)) : null
                };
            });

            return res.json({ data: summary });
        }

        res.json({ data: data || [] });
    } catch (error: any) {
        logger.error('API', '[GET /api/carriers/coverage/summary] Error:', error);
        res.status(500).json({
            error: 'Error al obtener resumen de cobertura',
            message: error.message
        });
    }
});

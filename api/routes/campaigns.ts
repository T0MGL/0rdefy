// ================================================================
// NEONFLOW API - CAMPAIGNS (ADS) ROUTES
// ================================================================
// Marketing campaign tracking for ROI/ROAS analysis
// ================================================================

import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../db/connection';
import { verifyToken, extractStoreId, AuthRequest } from '../middleware/auth';
import { extractUserRole, requireModule, requirePermission, PermissionRequest } from '../middleware/permissions';
import { requireFeature } from '../middleware/planLimits';
import { Module, Permission } from '../permissions';

export const campaignsRouter = Router();

campaignsRouter.use(verifyToken, extractStoreId, extractUserRole);
campaignsRouter.use(requireModule(Module.CAMPAIGNS));
// Campaign tracking requires Growth plan or higher
campaignsRouter.use(requireFeature('campaign_tracking'));


// ================================================================
// GET /api/campaigns - List all campaigns
// ================================================================
campaignsRouter.get('/', async (req: AuthRequest, res: Response) => {
    try {
        const {
            limit = '50',
            offset = '0',
            platform,
            status,
            sort_by = 'created_at',
            sort_order = 'DESC'
        } = req.query;

        // Build base query
        let query = supabaseAdmin
            .from('campaigns')
            .select('*', { count: 'exact' })
            .eq('store_id', req.storeId);

        // Apply filters
        if (platform) {
            query = query.eq('platform', platform);
        }

        if (status) {
            query = query.eq('status', status);
        }

        // Apply sorting
        const validSortFields = ['created_at', 'investment', 'roas', 'conversions', 'campaign_name'];
        const sortField = validSortFields.includes(sort_by as string) ? sort_by as string : 'created_at';
        const sortDirection = sort_order === 'DESC';

        query = query
            .order(sortField, { ascending: !sortDirection })
            .range(parseInt(offset as string), parseInt(offset as string) + parseInt(limit as string) - 1);

        const { data, error, count } = await query;

        if (error) {
            throw error;
        }

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
        console.error('[GET /api/campaigns] Error:', error);
        res.status(500).json({
            error: 'Error al obtener campañas',
            message: error.message
        });
    }
});

// ================================================================
// GET /api/campaigns/:id - Get single campaign
// ================================================================
campaignsRouter.get('/:id', async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;

        const { data, error } = await supabaseAdmin
            .from('campaigns')
            .select('*')
            .eq('id', id)
            .eq('store_id', req.storeId)
            .single();

        if (error || !data) {
            return res.status(404).json({
                error: 'Campaign not found'
            });
        }

        res.json(data);
    } catch (error: any) {
        console.error(`[GET /api/campaigns/${req.params.id}] Error:`, error);
        res.status(500).json({
            error: 'Error al obtener campaña',
            message: error.message
        });
    }
});

// ================================================================
// POST /api/campaigns - Create new campaign
// ================================================================
campaignsRouter.post('/', requirePermission(Module.CAMPAIGNS, Permission.CREATE), async (req: PermissionRequest, res: Response) => {
    try {
        const {
            platform,
            campaign_name,
            investment,
            clicks = 0,
            conversions = 0,
            status = 'active'
        } = req.body;

        // Validation
        if (!platform || !campaign_name) {
            return res.status(400).json({
                error: 'Validation failed',
                message: 'Platform and campaign name are required'
            });
        }

        if (investment !== undefined && investment < 0) {
            return res.status(400).json({
                error: 'Validation failed',
                message: 'Investment cannot be negative'
            });
        }

        // Calculate ROAS if we have conversions and investment
        let roas = 0;
        if (investment > 0 && conversions > 0) {
            // ROAS calculation would need order data - for now just set to 0
            roas = 0;
        }

        const { data, error } = await supabaseAdmin
            .from('campaigns')
            .insert([{
                store_id: req.storeId,
                platform,
                campaign_name,
                investment: investment || 0,
                clicks: clicks || 0,
                conversions: conversions || 0,
                roas,
                status
            }])
            .select()
            .single();

        if (error) {
            throw error;
        }

        res.status(201).json({
            message: 'Campaign created successfully',
            data
        });
    } catch (error: any) {
        console.error('[POST /api/campaigns] Error:', error);
        res.status(500).json({
            error: 'Error al crear campaña',
            message: error.message
        });
    }
});

// ================================================================
// PUT /api/campaigns/:id - Update campaign
// ================================================================
campaignsRouter.put('/:id', requirePermission(Module.CAMPAIGNS, Permission.EDIT), async (req: PermissionRequest, res: Response) => {
    try {
        const { id } = req.params;
        const {
            platform,
            campaign_name,
            investment,
            clicks,
            conversions,
            roas,
            status
        } = req.body;

        // Build update object
        const updateData: any = {
            updated_at: new Date().toISOString()
        };

        if (platform !== undefined) updateData.platform = platform;
        if (campaign_name !== undefined) updateData.campaign_name = campaign_name;
        if (investment !== undefined) {
            if (investment < 0) {
                return res.status(400).json({
                    error: 'Validation failed',
                    message: 'Investment cannot be negative'
                });
            }
            updateData.investment = investment;
        }
        if (clicks !== undefined) updateData.clicks = clicks;
        if (conversions !== undefined) updateData.conversions = conversions;
        if (roas !== undefined) updateData.roas = roas;
        if (status !== undefined) updateData.status = status;

        const { data, error } = await supabaseAdmin
            .from('campaigns')
            .update(updateData)
            .eq('id', id)
            .eq('store_id', req.storeId)
            .select()
            .single();

        if (error || !data) {
            return res.status(404).json({
                error: 'Campaign not found'
            });
        }

        res.json({
            message: 'Campaign updated successfully',
            data
        });
    } catch (error: any) {
        console.error(`[PUT /api/campaigns/${req.params.id}] Error:`, error);
        res.status(500).json({
            error: 'Error al actualizar campaña',
            message: error.message
        });
    }
});

// ================================================================
// DELETE /api/campaigns/:id - Delete campaign
// ================================================================
campaignsRouter.delete('/:id', requirePermission(Module.CAMPAIGNS, Permission.DELETE), async (req: PermissionRequest, res: Response) => {
    try {
        const { id } = req.params;

        const { data, error } = await supabaseAdmin
            .from('campaigns')
            .delete()
            .eq('id', id)
            .eq('store_id', req.storeId)
            .select('id')
            .single();

        if (error || !data) {
            return res.status(404).json({
                error: 'Campaign not found'
            });
        }

        res.json({
            message: 'Campaign deleted successfully',
            id: data.id
        });
    } catch (error: any) {
        console.error(`[DELETE /api/campaigns/${req.params.id}] Error:`, error);
        res.status(500).json({
            error: 'Error al eliminar campaña',
            message: error.message
        });
    }
});

// ================================================================
// PATCH /api/campaigns/:id/status - Update campaign status
// ================================================================
campaignsRouter.patch('/:id/status', requirePermission(Module.CAMPAIGNS, Permission.EDIT), async (req: PermissionRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!status || !['active', 'paused', 'ended'].includes(status)) {
            return res.status(400).json({
                error: 'Validation failed',
                message: 'Status must be "active", "paused", or "ended"'
            });
        }

        const { data, error } = await supabaseAdmin
            .from('campaigns')
            .update({
                status,
                updated_at: new Date().toISOString()
            })
            .eq('id', id)
            .eq('store_id', req.storeId)
            .select()
            .single();

        if (error || !data) {
            return res.status(404).json({
                error: 'Campaign not found'
            });
        }

        res.json({
            message: 'Campaign status updated successfully',
            data
        });
    } catch (error: any) {
        console.error(`[PATCH /api/campaigns/${req.params.id}/status] Error:`, error);
        res.status(500).json({
            error: 'Error al actualizar estado de campaña',
            message: error.message
        });
    }
});

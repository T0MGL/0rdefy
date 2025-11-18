// ================================================================
// NEONFLOW API - ADDITIONAL VALUES ROUTES
// ================================================================
// Track additional expenses and income beyond product sales
// ================================================================

import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../db/connection';
import { verifyToken, extractStoreId, AuthRequest } from '../middleware/auth';

export const additionalValuesRouter = Router();

additionalValuesRouter.use(verifyToken, extractStoreId);


// ================================================================
// GET /api/additional-values - List all additional values
// ================================================================
additionalValuesRouter.get('/', async (req: AuthRequest, res: Response) => {
    try {
        const {
            limit = '50',
            offset = '0',
            category,
            type,
            from_date,
            to_date,
            sort_by = 'date',
            sort_order = 'DESC'
        } = req.query;

        // Build base query
        let query = supabaseAdmin
            .from('additional_values')
            .select('*', { count: 'exact' })
            .eq('store_id', req.storeId);

        // Apply filters
        if (category) {
            query = query.eq('category', category);
        }

        if (type) {
            query = query.eq('type', type);
        }

        if (from_date) {
            query = query.gte('date', from_date);
        }

        if (to_date) {
            query = query.lte('date', to_date);
        }

        // Apply sorting
        const validSortFields = ['date', 'amount', 'category', 'created_at'];
        const sortField = validSortFields.includes(sort_by as string) ? sort_by as string : 'date';
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
        console.error('[GET /api/additional-values] Error:', error);
        res.status(500).json({
            error: 'Failed to fetch additional values',
            message: error.message
        });
    }
});

// ================================================================
// GET /api/additional-values/summary - Get summary by category
// ================================================================
additionalValuesRouter.get('/summary', async (req: AuthRequest, res: Response) => {
    try {
        const { from_date, to_date } = req.query;

        let query = supabaseAdmin
            .from('additional_values')
            .select('category, type, amount')
            .eq('store_id', req.storeId);

        if (from_date) {
            query = query.gte('date', from_date);
        }

        if (to_date) {
            query = query.lte('date', to_date);
        }

        const { data, error } = await query;

        if (error) {
            throw error;
        }

        // Calculate totals by category
        const summary = {
            marketing: 0,
            sales: 0,
            employees: 0,
            operational: 0
        };

        data?.forEach((item: any) => {
            const amount = item.type === 'expense' ? -item.amount : item.amount;
            if (summary.hasOwnProperty(item.category)) {
                summary[item.category as keyof typeof summary] += amount;
            }
        });

        res.json(summary);
    } catch (error: any) {
        console.error('[GET /api/additional-values/summary] Error:', error);
        res.status(500).json({
            error: 'Failed to fetch summary',
            message: error.message
        });
    }
});

// ================================================================
// GET /api/additional-values/:id - Get single additional value
// ================================================================
additionalValuesRouter.get('/:id', async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;

        const { data, error } = await supabaseAdmin
            .from('additional_values')
            .select('*')
            .eq('id', id)
            .eq('store_id', req.storeId)
            .single();

        if (error || !data) {
            return res.status(404).json({
                error: 'Additional value not found'
            });
        }

        res.json(data);
    } catch (error: any) {
        console.error(`[GET /api/additional-values/${req.params.id}] Error:`, error);
        res.status(500).json({
            error: 'Failed to fetch additional value',
            message: error.message
        });
    }
});

// ================================================================
// POST /api/additional-values - Create new additional value
// ================================================================
additionalValuesRouter.post('/', async (req: AuthRequest, res: Response) => {
    try {
        const {
            category,
            description,
            amount,
            type,
            date
        } = req.body;

        // Validation
        if (!category || !description || !amount || !type) {
            return res.status(400).json({
                error: 'Validation failed',
                message: 'Category, description, amount, and type are required'
            });
        }

        if (!['marketing', 'sales', 'employees', 'operational'].includes(category)) {
            return res.status(400).json({
                error: 'Validation failed',
                message: 'Invalid category'
            });
        }

        if (!['expense', 'income'].includes(type)) {
            return res.status(400).json({
                error: 'Validation failed',
                message: 'Type must be either "expense" or "income"'
            });
        }

        if (amount <= 0) {
            return res.status(400).json({
                error: 'Validation failed',
                message: 'Amount must be greater than 0'
            });
        }

        const { data, error } = await supabaseAdmin
            .from('additional_values')
            .insert([{
                store_id: req.storeId,
                category,
                description,
                amount,
                type,
                date: date || new Date().toISOString().split('T')[0]
            }])
            .select()
            .single();

        if (error) {
            throw error;
        }

        res.status(201).json({
            message: 'Additional value created successfully',
            data
        });
    } catch (error: any) {
        console.error('[POST /api/additional-values] Error:', error);
        res.status(500).json({
            error: 'Failed to create additional value',
            message: error.message
        });
    }
});

// ================================================================
// PUT /api/additional-values/:id - Update additional value
// ================================================================
additionalValuesRouter.put('/:id', async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const {
            category,
            description,
            amount,
            type,
            date
        } = req.body;

        // Build update object
        const updateData: any = {
            updated_at: new Date().toISOString()
        };

        if (category !== undefined) {
            if (!['marketing', 'sales', 'employees', 'operational'].includes(category)) {
                return res.status(400).json({
                    error: 'Validation failed',
                    message: 'Invalid category'
                });
            }
            updateData.category = category;
        }

        if (description !== undefined) updateData.description = description;

        if (amount !== undefined) {
            if (amount <= 0) {
                return res.status(400).json({
                    error: 'Validation failed',
                    message: 'Amount must be greater than 0'
                });
            }
            updateData.amount = amount;
        }

        if (type !== undefined) {
            if (!['expense', 'income'].includes(type)) {
                return res.status(400).json({
                    error: 'Validation failed',
                    message: 'Type must be either "expense" or "income"'
                });
            }
            updateData.type = type;
        }

        if (date !== undefined) updateData.date = date;

        const { data, error } = await supabaseAdmin
            .from('additional_values')
            .update(updateData)
            .eq('id', id)
            .eq('store_id', req.storeId)
            .select()
            .single();

        if (error || !data) {
            return res.status(404).json({
                error: 'Additional value not found'
            });
        }

        res.json({
            message: 'Additional value updated successfully',
            data
        });
    } catch (error: any) {
        console.error(`[PUT /api/additional-values/${req.params.id}] Error:`, error);
        res.status(500).json({
            error: 'Failed to update additional value',
            message: error.message
        });
    }
});

// ================================================================
// DELETE /api/additional-values/:id - Delete additional value
// ================================================================
additionalValuesRouter.delete('/:id', async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;

        const { data, error } = await supabaseAdmin
            .from('additional_values')
            .delete()
            .eq('id', id)
            .eq('store_id', req.storeId)
            .select('id')
            .single();

        if (error || !data) {
            return res.status(404).json({
                error: 'Additional value not found'
            });
        }

        res.json({
            message: 'Additional value deleted successfully',
            id: data.id
        });
    } catch (error: any) {
        console.error(`[DELETE /api/additional-values/${req.params.id}] Error:`, error);
        res.status(500).json({
            error: 'Failed to delete additional value',
            message: error.message
        });
    }
});

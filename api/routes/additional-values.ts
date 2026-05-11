// ================================================================
// NEONFLOW API - ADDITIONAL VALUES ROUTES
// ================================================================
// Track additional expenses and income beyond product sales
// ================================================================

import { logger } from '../utils/logger';
import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../db/connection';
import { verifyToken, extractStoreId, AuthRequest } from '../middleware/auth';
import { extractUserRole, requireModule, requirePermission, PermissionRequest } from '../middleware/permissions';
import { Module, Permission } from '../permissions';
import { RecurringValuesService } from '../services/recurring-values.service';
import { getTodayInTimezone } from '../utils/dateUtils';
import {
    proratedAmountInWindow,
    type ProratableExpense,
} from '../utils/metrics-canonical';

// Validate that period_start and period_end form a valid optional pair.
// Returns an error message when invalid, null when valid (including the
// both-null case). Mirrors the DB CHECK constraints from migration 184 so
// the API rejects with a clean 400 instead of letting Postgres surface a
// constraint violation.
function validatePeriodPair(
    periodStart: unknown,
    periodEnd: unknown,
): string | null {
    const hasStart = periodStart !== undefined && periodStart !== null && periodStart !== '';
    const hasEnd = periodEnd !== undefined && periodEnd !== null && periodEnd !== '';
    if (hasStart !== hasEnd) {
        return 'period_start and period_end must be provided together or both omitted';
    }
    if (hasStart && hasEnd) {
        const s = String(periodStart).slice(0, 10);
        const e = String(periodEnd).slice(0, 10);
        // Cheap YYYY-MM-DD string comparison works because both are zero-padded
        // ISO calendar dates.
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !/^\d{4}-\d{2}-\d{2}$/.test(e)) {
            return 'period_start and period_end must be valid YYYY-MM-DD dates';
        }
        if (e < s) {
            return 'period_end must be on or after period_start';
        }
    }
    return null;
}

export const additionalValuesRouter = Router();

additionalValuesRouter.use(verifyToken, extractStoreId, extractUserRole);
// Additional values are related to analytics/campaigns for ROI tracking
additionalValuesRouter.use(requireModule(Module.ANALYTICS));


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

        // Process recurring values first to ensure data is up to date
        // Note: This operation is non-blocking to user experience if handled carefully, 
        // but for now we await it to guarantee consistency on load.
        await RecurringValuesService.processRecurringValues(req.storeId || '');

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
        logger.error('API', '[GET /api/additional-values] Error:', error);
        res.status(500).json({
            error: 'Error al obtener valores adicionales',
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

        // Default window: this year. The summary needs a window because
        // proration math is window-relative. Without explicit bounds we used
        // to "sum everything"; that path now still works (it just uses a very
        // wide window so any prorated row contributes its full amount).
        const windowStart = from_date
            ? String(from_date).slice(0, 10)
            : '1970-01-01';
        const windowEnd = to_date
            ? String(to_date).slice(0, 10)
            : '2999-12-31';

        // Include rows whose `date` falls in the window OR whose period
        // overlaps the window. The OR filter mirrors the analytics path.
        const query = supabaseAdmin
            .from('additional_values')
            .select('category, type, amount, date, period_start, period_end')
            .eq('store_id', req.storeId)
            .or(
                `and(date.gte.${windowStart},date.lte.${windowEnd}),and(period_start.lte.${windowEnd},period_end.gte.${windowStart})`,
            )
            .limit(5000);

        const { data, error } = await query;

        if (error) {
            throw error;
        }

        const summary = {
            marketing: 0,
            sales: 0,
            employees: 0,
            operational: 0,
        };

        for (const item of data ?? []) {
            // Prorate amounts that carry a period. Legacy single-date rows
            // get their full amount when `date` is in the window.
            const portion = proratedAmountInWindow(
                item as ProratableExpense,
                windowStart,
                windowEnd,
            );
            if (portion <= 0) continue;
            const signed = item.type === 'expense' ? -portion : portion;
            if (Object.prototype.hasOwnProperty.call(summary, item.category)) {
                summary[item.category as keyof typeof summary] += signed;
            }
        }

        res.json(summary);
    } catch (error: any) {
        logger.error('API', '[GET /api/additional-values/summary] Error:', error);
        res.status(500).json({
            error: 'Error al obtener resumen',
            message: error.message,
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
                error: 'Valor adicional no encontrado'
            });
        }

        res.json(data);
    } catch (error: any) {
        logger.error('API', `[GET /api/additional-values/${req.params.id}] Error:`, error);
        res.status(500).json({
            error: 'Error al obtener valor adicional',
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
            date,
            period_start,
            period_end,
        } = req.body;

        // Validation
        if (!category || !description || !amount || !type) {
            return res.status(400).json({
                error: 'Validación fallida',
                message: 'Category, description, amount, and type are required',
            });
        }

        if (!['marketing', 'sales', 'employees', 'operational'].includes(category)) {
            return res.status(400).json({
                error: 'Validación fallida',
                message: 'Invalid category',
            });
        }

        if (!['expense', 'income'].includes(type)) {
            return res.status(400).json({
                error: 'Validación fallida',
                message: 'Type must be either "expense" or "income"',
            });
        }

        if (amount <= 0) {
            return res.status(400).json({
                error: 'Validación fallida',
                message: 'Amount must be greater than 0',
            });
        }

        const periodError = validatePeriodPair(period_start, period_end);
        if (periodError) {
            return res.status(400).json({
                error: 'Validación fallida',
                message: periodError,
            });
        }

        // Period proration is scoped to marketing expenses only. The dashboard
        // analytics path (sumMarketingInWindow, dailyMarketingAllocation) reads
        // period columns only for category='marketing' AND type='expense'. Any
        // other row would store the period silently and never have it honored,
        // which leads to confusing reporting. Reject explicitly instead.
        if (period_start && period_end && (type !== 'expense' || category !== 'marketing')) {
            return res.status(400).json({
                error: 'Validación fallida',
                message: 'Period only allowed for marketing expense entries',
            });
        }

        const insertRow: Record<string, unknown> = {
            store_id: req.storeId,
            category,
            description,
            amount,
            type,
            date: date || getTodayInTimezone(),
        };
        if (period_start && period_end) {
            insertRow.period_start = String(period_start).slice(0, 10);
            insertRow.period_end = String(period_end).slice(0, 10);
        }

        const { data, error } = await supabaseAdmin
            .from('additional_values')
            .insert([insertRow])
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
        logger.error('API', '[POST /api/additional-values] Error:', error);
        res.status(500).json({
            error: 'Error al crear valor adicional',
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
            date,
            period_start,
            period_end,
        } = req.body;

        // Build update object
        const updateData: Record<string, unknown> = {
            updated_at: new Date().toISOString(),
        };

        if (category !== undefined) {
            if (!['marketing', 'sales', 'employees', 'operational'].includes(category)) {
                return res.status(400).json({
                    error: 'Validación fallida',
                    message: 'Invalid category',
                });
            }
            updateData.category = category;
        }

        if (description !== undefined) updateData.description = description;

        if (amount !== undefined) {
            if (amount <= 0) {
                return res.status(400).json({
                    error: 'Validación fallida',
                    message: 'Amount must be greater than 0',
                });
            }
            updateData.amount = amount;
        }

        if (type !== undefined) {
            if (!['expense', 'income'].includes(type)) {
                return res.status(400).json({
                    error: 'Validación fallida',
                    message: 'Type must be either "expense" or "income"',
                });
            }
            updateData.type = type;
        }

        if (date !== undefined) updateData.date = date;

        // Period columns: validated together. Explicit null on either side
        // clears the period (returns the row to legacy single-date behavior).
        // Passing only one of the two is rejected; the DB CHECK would catch
        // it anyway but a 400 with a readable message is friendlier.
        if (period_start !== undefined || period_end !== undefined) {
            const periodError = validatePeriodPair(period_start, period_end);
            if (periodError) {
                return res.status(400).json({
                    error: 'Validación fallida',
                    message: periodError,
                });
            }
            if (period_start === null || period_start === '') {
                updateData.period_start = null;
                updateData.period_end = null;
            } else if (period_start !== undefined) {
                // Period proration only applies to marketing expenses. Resolve
                // the row's final type/category against the existing record
                // when the request does not include them in this PATCH-style
                // payload, then reject any non-marketing combo before persisting.
                let finalType = type;
                let finalCategory = category;
                if (finalType === undefined || finalCategory === undefined) {
                    const { data: existingRow, error: existingErr } = await supabaseAdmin
                        .from('additional_values')
                        .select('type, category')
                        .eq('id', id)
                        .eq('store_id', req.storeId)
                        .single();
                    if (existingErr || !existingRow) {
                        return res.status(404).json({
                            error: 'Valor adicional no encontrado',
                        });
                    }
                    if (finalType === undefined) finalType = existingRow.type;
                    if (finalCategory === undefined) finalCategory = existingRow.category;
                }
                if (finalType !== 'expense' || finalCategory !== 'marketing') {
                    return res.status(400).json({
                        error: 'Validación fallida',
                        message: 'Period only allowed for marketing expense entries',
                    });
                }
                updateData.period_start = String(period_start).slice(0, 10);
                updateData.period_end = String(period_end).slice(0, 10);
            }
        }

        const { data, error } = await supabaseAdmin
            .from('additional_values')
            .update(updateData)
            .eq('id', id)
            .eq('store_id', req.storeId)
            .select()
            .single();

        if (error || !data) {
            return res.status(404).json({
                error: 'Valor adicional no encontrado'
            });
        }

        res.json({
            message: 'Additional value updated successfully',
            data
        });
    } catch (error: any) {
        logger.error('API', `[PUT /api/additional-values/${req.params.id}] Error:`, error);
        res.status(500).json({
            error: 'Error al actualizar valor adicional',
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
                error: 'Valor adicional no encontrado'
            });
        }

        res.json({
            message: 'Additional value deleted successfully',
            id: data.id
        });
    } catch (error: any) {
        logger.error('API', `[DELETE /api/additional-values/${req.params.id}] Error:`, error);
        res.status(500).json({
            error: 'Error al eliminar valor adicional',
            message: error.message
        });
    }
});

import { Router, Response } from 'express';
import { supabaseAdmin } from '../db/connection';
import { verifyToken, extractStoreId, AuthRequest } from '../middleware/auth';
import { RecurringValuesService } from '../services/recurring-values.service';

export const recurringValuesRouter = Router();

recurringValuesRouter.use(verifyToken, extractStoreId);

// ================================================================
// GET /api/recurring-values - List and Process
// ================================================================
recurringValuesRouter.get('/', async (req: AuthRequest, res: Response) => {
    try {
        // Trigger processing to ensure up-to-date values
        await RecurringValuesService.processRecurringValues(req.storeId || '');

        const { data, error } = await supabaseAdmin
            .from('recurring_additional_values')
            .select('*')
            .eq('store_id', req.storeId)
            .order('created_at', { ascending: false });

        if (error) throw error;

        res.json(data || []);
    } catch (error: any) {
        console.error('[GET /api/recurring-values] Error:', error);
        res.status(500).json({ error: 'Failed to fetch recurring values', message: error.message });
    }
});

// ================================================================
// POST /api/recurring-values - Create
// ================================================================
recurringValuesRouter.post('/', async (req: AuthRequest, res: Response) => {
    try {
        const { category, description, amount, type, frequency, start_date } = req.body;

        if (!category || !description || !amount || !type || !frequency || !start_date) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const { data, error } = await supabaseAdmin
            .from('recurring_additional_values')
            .insert([{
                store_id: req.storeId,
                category,
                description,
                amount,
                type,
                frequency,
                start_date
            }])
            .select()
            .single();

        if (error) throw error;

        // Process immediately to generate first value if due
        await RecurringValuesService.processRecurringValues(req.storeId || '');

        res.status(201).json(data);
    } catch (error: any) {
        console.error('[POST /api/recurring-values] Error:', error);
        res.status(500).json({ error: 'Failed to create recurring value', message: error.message });
    }
});

// ================================================================
// POST /api/recurring-values/ordefy-subscription - Quick Add
// ================================================================
recurringValuesRouter.post('/ordefy-subscription', async (req: AuthRequest, res: Response) => {
    try {
        const { amount, start_date } = req.body;

        if (!amount || !start_date) {
            return res.status(400).json({ error: 'Amount and start date are required' });
        }

        // Check if already exists
        const { data: existing } = await supabaseAdmin
            .from('recurring_additional_values')
            .select('id')
            .eq('store_id', req.storeId)
            .eq('is_ordefy_subscription', true)
            .maybeSingle();

        if (existing) {
            return res.status(400).json({ error: 'Ordefy subscription already exists' });
        }

        const { data, error } = await supabaseAdmin
            .from('recurring_additional_values')
            .insert([{
                store_id: req.storeId,
                category: 'operational',
                description: 'Suscripción Ordefy',
                amount,
                type: 'expense',
                frequency: 'monthly',
                start_date,
                is_ordefy_subscription: true
            }])
            .select()
            .single();

        if (error) throw error;

        // Process immediately
        await RecurringValuesService.processRecurringValues(req.storeId || '');

        res.status(201).json(data);
    } catch (error: any) {
        console.error('[POST /api/recurring-values/ordefy-subscription] Error:', error);
        res.status(500).json({ error: 'Failed to create subscription', message: error.message });
    }
});

// ================================================================
// PUT /api/recurring-values/:id - Update
// ================================================================
recurringValuesRouter.put('/:id', async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        delete updates.id;
        delete updates.store_id;
        delete updates.last_processed_date; // Prevent manual modification of processing state

        const { data, error } = await supabaseAdmin
            .from('recurring_additional_values')
            .update({ ...updates, updated_at: new Date().toISOString() })
            .eq('id', id)
            .eq('store_id', req.storeId)
            .select()
            .single();

        if (error) throw error;

        // Reprocess just in case dates changed to include missed periods
        await RecurringValuesService.processRecurringValues(req.storeId || '');

        res.json(data);
    } catch (error: any) {
        console.error(`[PUT /api/recurring-values/${req.params.id}] Error:`, error);
        res.status(500).json({ error: 'Failed to update recurring value', message: error.message });
    }
});

// ================================================================
// DELETE /api/recurring-values/:id - Delete
// ================================================================
recurringValuesRouter.delete('/:id', async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;

        const { error } = await supabaseAdmin
            .from('recurring_additional_values')
            .delete()
            .eq('id', id)
            .eq('store_id', req.storeId);

        if (error) throw error;

        res.json({ message: 'Recurring value deleted successfully' });
    } catch (error: any) {
        console.error(`[DELETE /api/recurring-values/${req.params.id}] Error:`, error);
        res.status(500).json({ error: 'Failed to delete recurring value', message: error.message });
    }
});

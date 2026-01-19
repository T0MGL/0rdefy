import { logger } from '../utils/logger';
import { supabaseAdmin } from '../db/connection';

interface RecurringValue {
    id: string;
    store_id: string;
    category: string;
    description: string;
    amount: number;
    type: string;
    frequency: 'monthly' | 'annually';
    start_date: string;
    end_date: string | null;
    last_processed_date: string | null;
    is_active: boolean;
}

export class RecurringValuesService {

    /**
     * Process recurring values for a specific store.
     * Generates additional_values records for due periods.
     */
    static async processRecurringValues(storeId: string) {
        try {
            // 1. Fetch active recurring values
            const { data: recurringValues, error } = await supabaseAdmin
                .from('recurring_additional_values')
                .select('*')
                .eq('store_id', storeId)
                .eq('is_active', true);

            if (error) throw error;
            if (!recurringValues || recurringValues.length === 0) return;

            const today = new Date();
            const operations = [];

            for (const rv of recurringValues) {
                const nextDate = this.getNextDueDate(rv);

                // If there's a valid next date and it's in the past or today
                if (nextDate && nextDate <= today) {
                    // Generate values until we catch up to today
                    let currentDateToProcess = nextDate;
                    let lastProcessedDate = rv.last_processed_date;

                    while (currentDateToProcess <= today) {
                        // Check end date
                        if (rv.end_date && new Date(rv.end_date) < currentDateToProcess) {
                            break;
                        }

                        // Create the additional value record
                        const insertPromise = supabaseAdmin
                            .from('additional_values')
                            .insert({
                                store_id: storeId,
                                category: rv.category,
                                description: `${rv.description} (${this.formatPeriod(currentDateToProcess, rv.frequency)})`,
                                amount: rv.amount,
                                type: rv.type,
                                date: currentDateToProcess.toISOString().split('T')[0]
                            });

                        operations.push(insertPromise);

                        lastProcessedDate = currentDateToProcess.toISOString().split('T')[0];

                        // Move to next period
                        currentDateToProcess = this.addPeriod(currentDateToProcess, rv.frequency);
                    }

                    // Update the last_processed_date on the recurring value template
                    if (lastProcessedDate !== rv.last_processed_date) {
                        const updatePromise = supabaseAdmin
                            .from('recurring_additional_values')
                            .update({ last_processed_date: lastProcessedDate })
                            .eq('id', rv.id);

                        operations.push(updatePromise);
                    }
                }
            }

            if (operations.length > 0) {
                await Promise.all(operations);
            }

        } catch (error) {
            logger.error('BACKEND', '[RecurringValuesService] Error processing values:', error);
            // Don't throw to prevent blocking the main request
        }
    }

    private static getNextDueDate(rv: RecurringValue): Date | null {
        if (!rv.last_processed_date) {
            // If never processed, start date is the first due date
            return new Date(rv.start_date);
        }

        // Otherwise, add one frequency period to the last processed date
        const lastDate = new Date(rv.last_processed_date);
        return this.addPeriod(lastDate, rv.frequency);
    }

    private static addPeriod(date: Date, frequency: 'monthly' | 'annually'): Date {
        const newDate = new Date(date);
        if (frequency === 'monthly') {
            newDate.setMonth(newDate.getMonth() + 1);
        } else if (frequency === 'annually') {
            newDate.setFullYear(newDate.getFullYear() + 1);
        }
        return newDate;
    }

    private static formatPeriod(date: Date, frequency: 'monthly' | 'annually'): string {
        if (frequency === 'monthly') {
            return date.toLocaleString('es-ES', { month: 'long', year: 'numeric' });
        }
        return date.getFullYear().toString();
    }
}

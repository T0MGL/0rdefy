import { AdditionalValue } from '@/types';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// Helper to get auth headers
const getAuthHeaders = (): HeadersInit => {
    const token = localStorage.getItem('auth_token');
    const storeId = localStorage.getItem('current_store_id');

    return {
        'Content-Type': 'application/json',
        ...(token && { 'Authorization': `Bearer ${token}` }),
        ...(storeId && { 'X-Store-ID': storeId }),
    };
};

export interface RecurringAdditionalValue extends Omit<AdditionalValue, 'id' | 'date'> {
    id?: string;
    frequency: 'monthly' | 'annually';
    start_date: string;
    end_date?: string;
    last_processed_date?: string;
    is_ordefy_subscription?: boolean;
    is_active?: boolean;
}

export const recurringAdditionalValuesService = {
    async getAll(): Promise<RecurringAdditionalValue[]> {
        try {
            const response = await fetch(`${API_URL}/api/recurring-values`, {
                headers: getAuthHeaders(),
            });
            if (!response.ok) throw new Error('Failed to fetch recurring values');
            return await response.json();
        } catch (error) {
            console.error('Error fetching recurring values:', error);
            return [];
        }
    },

    async create(data: Partial<RecurringAdditionalValue>): Promise<RecurringAdditionalValue> {
        const response = await fetch(`${API_URL}/api/recurring-values`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify(data),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Failed to create recurring value');
        }

        return await response.json();
    },

    async createOrdefySubscription(amount: number, startDate: string): Promise<RecurringAdditionalValue> {
        const response = await fetch(`${API_URL}/api/recurring-values/ordefy-subscription`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ amount, start_date: startDate }),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Failed to create subscription');
        }

        return await response.json();
    },

    async update(id: string, data: Partial<RecurringAdditionalValue>): Promise<RecurringAdditionalValue> {
        const response = await fetch(`${API_URL}/api/recurring-values/${id}`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify(data),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Failed to update recurring value');
        }

        return await response.json();
    },

    async delete(id: string): Promise<boolean> {
        const response = await fetch(`${API_URL}/api/recurring-values/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders(),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Failed to delete recurring value');
        }

        return true;
    },
};

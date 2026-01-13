import { UnifiedOrder, UnifiedSession, UnifiedDispatchOrder } from '@/types/unified';
import { DashboardOverview, ChartData } from '@/types';

let cleanBaseURL = import.meta.env.VITE_API_URL || 'https://api.ordefy.io';
cleanBaseURL = cleanBaseURL.trim();
cleanBaseURL = cleanBaseURL.replace(/(\/api\/?)+$/i, '');
cleanBaseURL = cleanBaseURL.replace(/\/+$/, '');
const API_BASE_URL = `${cleanBaseURL}/api`;

const getHeaders = () => {
    const token = localStorage.getItem('auth_token');
    const headers: HeadersInit = {
        'Content-Type': 'application/json',
    };
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
};

export interface UnifiedAnalyticsResponse {
    data: DashboardOverview | null;
    stores: { id: string; name: string }[];
    storeCount: number;
}

export const unifiedService = {
    getWarehouseReady: async (): Promise<UnifiedOrder[]> => {
        try {
            const response = await fetch(`${API_BASE_URL}/unified/warehouse/ready`, {
                headers: getHeaders(),
            });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                console.error('Unified Warehouse API Error:', errorData);
                throw new Error(errorData.details || 'Failed to fetch unified warehouse data');
            }
            const result = await response.json();
            return result.data || [];
        } catch (error) {
            console.error('Unified Warehouse Error:', error);
            return [];
        }
    },

    getWarehouseSessions: async (): Promise<UnifiedSession[]> => {
        try {
            const response = await fetch(`${API_BASE_URL}/unified/warehouse/sessions`, {
                headers: getHeaders(),
            });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                console.error('Unified Sessions API Error:', errorData);
                throw new Error(errorData.details || 'Failed to fetch unified sessions');
            }
            const result = await response.json();
            return result.data || [];
        } catch (error) {
            console.error('Unified Sessions Error:', error);
            return [];
        }
    },

    getOrders: async (params?: {
        limit?: number;
        offset?: number;
        status?: string;
        startDate?: string;
        endDate?: string;
    }) => {
        try {
            const queryParams = new URLSearchParams();
            if (params?.limit) queryParams.append('limit', params.limit.toString());
            if (params?.offset) queryParams.append('offset', params.offset.toString());
            if (params?.status) queryParams.append('status', params.status);
            if (params?.startDate) queryParams.append('startDate', params.startDate);
            if (params?.endDate) queryParams.append('endDate', params.endDate);

            const response = await fetch(`${API_BASE_URL}/unified/orders?${queryParams}`, {
                headers: getHeaders(),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                console.error('Unified Orders API Error:', errorData);
                throw new Error(errorData.details || 'Failed to fetch unified orders');
            }
            const result = await response.json();
            return {
                data: result.data || [],
                pagination: result.pagination || { total: 0, limit: 50, offset: 0, hasMore: false }
            };
        } catch (error) {
            console.error('Unified Orders Error:', error);
            return { data: [], pagination: { total: 0, limit: 50, offset: 0, hasMore: false } };
        }
    },

    getDispatchReady: async (): Promise<UnifiedDispatchOrder[]> => {
        try {
            const response = await fetch(`${API_BASE_URL}/unified/shipping/ready`, {
                headers: getHeaders(),
            });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                console.error('Unified Dispatch API Error:', errorData);
                throw new Error(errorData.details || 'Failed to fetch unified dispatch data');
            }
            const result = await response.json();
            return result.data || [];
        } catch (error) {
            console.error('Unified Dispatch Error:', error);
            return [];
        }
    },

    // Analytics endpoints for Global View Dashboard
    getAnalyticsOverview: async (params?: {
        startDate?: string;
        endDate?: string;
    }): Promise<UnifiedAnalyticsResponse> => {
        try {
            const queryParams = new URLSearchParams();
            if (params?.startDate) queryParams.append('startDate', params.startDate);
            if (params?.endDate) queryParams.append('endDate', params.endDate);

            const response = await fetch(`${API_BASE_URL}/unified/analytics/overview?${queryParams}`, {
                headers: getHeaders(),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                console.error('Unified Analytics API Error:', errorData);
                throw new Error(errorData.details || 'Failed to fetch unified analytics');
            }

            const result = await response.json();
            return {
                data: result.data || null,
                stores: result.stores || [],
                storeCount: result.storeCount || 0,
            };
        } catch (error) {
            console.error('Unified Analytics Error:', error);
            return { data: null, stores: [], storeCount: 0 };
        }
    },

    getAnalyticsChart: async (days: number, params?: {
        startDate?: string;
        endDate?: string;
    }): Promise<ChartData[]> => {
        try {
            const queryParams = new URLSearchParams();
            queryParams.append('days', days.toString());
            if (params?.startDate) queryParams.append('startDate', params.startDate);
            if (params?.endDate) queryParams.append('endDate', params.endDate);

            const response = await fetch(`${API_BASE_URL}/unified/analytics/chart?${queryParams}`, {
                headers: getHeaders(),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                console.error('Unified Chart API Error:', errorData);
                throw new Error(errorData.details || 'Failed to fetch unified chart data');
            }

            const result = await response.json();
            return result.data || [];
        } catch (error) {
            console.error('Unified Chart Error:', error);
            return [];
        }
    },
};

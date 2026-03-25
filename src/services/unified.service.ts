import { UnifiedOrder, UnifiedSession, UnifiedDispatchOrder } from '@/types/unified';
import { DashboardOverview, ChartData } from '@/types';
import { logger } from '@/utils/logger';

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
        const response = await fetch(`${API_BASE_URL}/unified/warehouse/ready`, {
            headers: getHeaders(),
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.details || 'Error al obtener datos de almacen unificado');
        }
        const result = await response.json();
        return result.data || [];
    },

    getWarehouseSessions: async (): Promise<UnifiedSession[]> => {
        const response = await fetch(`${API_BASE_URL}/unified/warehouse/sessions`, {
            headers: getHeaders(),
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.details || 'Error al obtener sesiones unificadas');
        }
        const result = await response.json();
        return result.data || [];
    },

    getOrders: async (params?: {
        limit?: number;
        offset?: number;
        status?: string;
        startDate?: string;
        endDate?: string;
    }) => {
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
            throw new Error(errorData.details || 'Error al obtener pedidos unificados');
        }
        const result = await response.json();
        return {
            data: result.data || [],
            pagination: result.pagination || { total: 0, limit: 50, offset: 0, hasMore: false }
        };
    },

    getDispatchReady: async (): Promise<UnifiedDispatchOrder[]> => {
        const response = await fetch(`${API_BASE_URL}/unified/shipping/ready`, {
            headers: getHeaders(),
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.details || 'Error al obtener datos de despacho unificado');
        }
        const result = await response.json();
        return result.data || [];
    },

    getAnalyticsOverview: async (params?: {
        startDate?: string;
        endDate?: string;
    }, signal?: AbortSignal): Promise<UnifiedAnalyticsResponse> => {
        const queryParams = new URLSearchParams();
        if (params?.startDate) queryParams.append('startDate', params.startDate);
        if (params?.endDate) queryParams.append('endDate', params.endDate);

        const url = `${API_BASE_URL}/unified/analytics/overview?${queryParams}`;

        const response = await fetch(url, {
            headers: getHeaders(),
            signal,
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.details || 'Error al obtener analisis unificado');
        }

        const result = await response.json();

        return {
            data: result.data || null,
            stores: result.stores || [],
            storeCount: result.storeCount || 0,
        };
    },

    getAnalyticsChart: async (days: number, params?: {
        startDate?: string;
        endDate?: string;
    }, signal?: AbortSignal): Promise<ChartData[]> => {
        const queryParams = new URLSearchParams();
        queryParams.append('days', days.toString());
        if (params?.startDate) queryParams.append('startDate', params.startDate);
        if (params?.endDate) queryParams.append('endDate', params.endDate);

        const response = await fetch(`${API_BASE_URL}/unified/analytics/chart?${queryParams}`, {
            headers: getHeaders(),
            signal,
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.details || 'Error al obtener datos de grafico unificado');
        }

        const result = await response.json();
        return result.data || [];
    },
};

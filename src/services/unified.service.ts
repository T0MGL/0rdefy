import { UnifiedOrder, UnifiedSession, UnifiedDispatchOrder } from '@/types/unified';

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

    getOrders: async (params?: { limit?: number; offset?: number; status?: string }) => {
        try {
            const queryParams = new URLSearchParams();
            if (params?.limit) queryParams.append('limit', params.limit.toString());
            if (params?.offset) queryParams.append('offset', params.offset.toString());
            if (params?.status) queryParams.append('status', params.status);

            const response = await fetch(`${API_BASE_URL}/unified/orders?${queryParams}`, {
                headers: getHeaders(),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                console.error('Unified Orders API Error:', errorData);
                throw new Error(errorData.details || 'Failed to fetch unified orders');
            }
            const result = await response.json();
            return result;
        } catch (error) {
            console.error('Unified Orders Error:', error);
            return { data: [], pagination: { total: 0 } };
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
    }
};

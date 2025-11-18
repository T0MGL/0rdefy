import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// No token validation in interceptor - let server handle it
// Token will last full 7 days without client-side interruptions
// Server will return 401 if token is actually invalid/expired
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token');
  const storeId = localStorage.getItem('current_store_id');

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  if (storeId) {
    config.headers['X-Store-ID'] = storeId;
  }

  return config;
});

// Response interceptor for global error handling
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response) {
      const { status } = error.response;

      // Handle 401 Unauthorized - Token expired or invalid
      if (status === 401) {
        console.warn('⚠️ [API] 401 Unauthorized - Clearing session');
        localStorage.removeItem('auth_token');
        localStorage.removeItem('user');
        localStorage.removeItem('current_store_id');
        localStorage.removeItem('onboarding_completed');

        // Redirect to login if not already there
        if (window.location.pathname !== '/login') {
          window.location.href = '/login';
        }
      }

      // Handle 403 Forbidden
      if (status === 403) {
        console.error('❌ [API] 403 Forbidden - Access denied');
        // Could show toast notification here
      }

      // Handle 500 Server Error
      if (status === 500) {
        console.error('❌ [API] 500 Server Error');
        // Could show toast notification here
      }

      // Handle 503 Service Unavailable - Could retry
      if (status === 503 || status === 504) {
        console.warn('⚠️ [API] Service temporarily unavailable');
        // Could implement retry logic here
      }
    } else if (error.request) {
      // Network error - no response received
      console.error('❌ [API] Network error - No response from server');
    } else {
      // Something else happened
      console.error('❌ [API] Request error:', error.message);
    }

    return Promise.reject(error);
  }
);

export interface Order {
  id?: string;
  order_number: string;
  customer_name: string;
  customer_email?: string;
  customer_phone: string;
  customer_address?: string;
  status: 'pending' | 'confirmed' | 'in_transit' | 'delivered' | 'cancelled';
  total_amount: number;
  items: OrderItem[];
  created_at?: string;
}

export interface OrderItem {
  product_id: string;
  quantity: number;
  price: number;
}

export interface Product {
  id?: string;
  name: string;
  description?: string;
  price: number;
  cost?: number;
  stock: number;
  sku?: string;
  category?: string;
  image_url?: string;
  is_active?: boolean;
}

export interface Supplier {
  id?: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  country?: string;
  is_active?: boolean;
}

export interface Carrier {
  id?: string;
  name: string;
  country?: string;
  base_cost?: number;
  cost_per_kg?: number;
  delivery_time_days?: number;
  is_active?: boolean;
}

export const ordersAPI = {
  getAll: async () => {
    const response = await apiClient.get('/orders');
    return response.data.data || response.data;
  },

  getById: async (id: string) => {
    const response = await apiClient.get(`/orders/${id}`);
    return response.data.data || response.data;
  },

  create: async (order: Order) => {
    const response = await apiClient.post('/orders', order);
    return response.data.data || response.data;
  },

  update: async (id: string, order: Partial<Order>) => {
    const response = await apiClient.put(`/orders/${id}`, order);
    return response.data.data || response.data;
  },

  delete: async (id: string) => {
    const response = await apiClient.delete(`/orders/${id}`);
    return response.data;
  },

  confirm: async (id: string) => {
    const response = await apiClient.post(`/orders/${id}/confirm`);
    return response.data.data || response.data;
  },

  reject: async (id: string) => {
    const response = await apiClient.post(`/orders/${id}/reject`);
    return response.data.data || response.data;
  },
};

export const productsAPI = {
  getAll: async () => {
    const response = await apiClient.get('/products');
    return response.data.data || response.data;
  },

  getById: async (id: string) => {
    const response = await apiClient.get(`/products/${id}`);
    return response.data.data || response.data;
  },

  create: async (product: Product) => {
    const response = await apiClient.post('/products', product);
    return response.data.data || response.data;
  },

  update: async (id: string, product: Partial<Product>) => {
    const response = await apiClient.put(`/products/${id}`, product);
    return response.data.data || response.data;
  },

  delete: async (id: string) => {
    const response = await apiClient.delete(`/products/${id}`);
    return response.data;
  },
};

export const suppliersAPI = {
  getAll: async () => {
    const response = await apiClient.get('/suppliers');
    return response.data.data || response.data;
  },

  getById: async (id: string) => {
    const response = await apiClient.get(`/suppliers/${id}`);
    return response.data.data || response.data;
  },

  create: async (supplier: Supplier) => {
    const response = await apiClient.post('/suppliers', supplier);
    return response.data.data || response.data;
  },

  update: async (id: string, supplier: Partial<Supplier>) => {
    const response = await apiClient.put(`/suppliers/${id}`, supplier);
    return response.data.data || response.data;
  },

  delete: async (id: string) => {
    const response = await apiClient.delete(`/suppliers/${id}`);
    return response.data;
  },
};

export const carriersAPI = {
  getAll: async () => {
    const response = await apiClient.get('/carriers');
    return response.data.data || response.data;
  },

  getById: async (id: string) => {
    const response = await apiClient.get(`/carriers/${id}`);
    return response.data.data || response.data;
  },

  create: async (carrier: Carrier) => {
    const response = await apiClient.post('/carriers', carrier);
    return response.data.data || response.data;
  },

  update: async (id: string, carrier: Partial<Carrier>) => {
    const response = await apiClient.put(`/carriers/${id}`, carrier);
    return response.data.data || response.data;
  },

  delete: async (id: string) => {
    const response = await apiClient.delete(`/carriers/${id}`);
    return response.data;
  },
};

export default apiClient;

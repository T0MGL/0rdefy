import axios from 'axios';
import { config } from '@/config';

const apiClient = axios.create({
  baseURL: `${config.api.baseUrl}/api`,
  timeout: 30000, // 30s request timeout — prevents hanging requests
  headers: {
    'Content-Type': 'application/json',
  },
});

// Helper to safely get Shopify session token without dynamic imports that can fail
let cachedGetSessionToken: ((app: any) => Promise<string>) | null = null;

async function safeGetShopifyToken(shopifyApp: any): Promise<string | null> {
  try {
    // Only attempt to load Shopify utilities if we haven't tried before
    if (!cachedGetSessionToken) {
      // Check if the module is available before importing
      const utilities = await import('@shopify/app-bridge/utilities').catch(() => null);
      if (utilities?.getSessionToken) {
        cachedGetSessionToken = utilities.getSessionToken;
      } else {
        // Module not available, don't try again
        cachedGetSessionToken = () => Promise.resolve('');
        return null;
      }
    }

    const token = await cachedGetSessionToken(shopifyApp);
    return token || null;
  } catch {
    // Silently fail - we're not in a Shopify context
    return null;
  }
}

// Check if we're truly in Shopify embedded mode
function isShopifyEmbedded(): boolean {
  try {
    // Must be in an iframe
    if (window.top === window.self) return false;

    // Must have Shopify app bridge initialized
    const shopify = (window as any).shopify;
    if (!shopify) return false;

    // Verify it looks like a real Shopify app bridge instance
    if (typeof shopify.idToken !== 'function' && typeof shopify.toast !== 'function') {
      return false;
    }

    return true;
  } catch {
    // Cross-origin iframe check can throw
    return false;
  }
}

// Request interceptor - Get fresh tokens for each request
// Priority: Shopify App Bridge token > Regular auth token
apiClient.interceptors.request.use(async (config) => {
  const authToken = localStorage.getItem('auth_token');
  const storeId = localStorage.getItem('current_store_id');

  // Check if we're truly in Shopify embedded mode
  if (isShopifyEmbedded()) {
    const shopifyApp = (window as any).shopify;
    const freshToken = await safeGetShopifyToken(shopifyApp);

    if (freshToken) {
      config.headers.Authorization = `Bearer ${freshToken}`;
      config.headers['X-Shopify-Session'] = 'true';
      localStorage.setItem('shopify_session_token', freshToken);
    } else {
      // Fallback to stored Shopify token
      const shopifySessionToken = localStorage.getItem('shopify_session_token');
      if (shopifySessionToken) {
        config.headers.Authorization = `Bearer ${shopifySessionToken}`;
        config.headers['X-Shopify-Session'] = 'true';
      }
    }
  }
  // Use regular auth token for standalone mode
  else if (authToken) {
    config.headers.Authorization = `Bearer ${authToken}`;
  }

  if (storeId) {
    config.headers['X-Store-ID'] = storeId;
  }

  return config;
});

// Response interceptor for global error handling
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response) {
      const { status } = error.response;

      // Handle 401 Unauthorized - Token expired or invalid
      if (status === 401) {
        console.warn('⚠️ [API] 401 Unauthorized - Session invalid');

        if (isShopifyEmbedded()) {
          // IN EMBEDDED MODE: Do NOT redirect, try to refresh token
          // Prevent infinite retry loop
          const originalRequest = error.config;

          // Check if we already retried this request
          if (originalRequest._retryCount >= 1) {
            console.error('❌ [API] Token refresh failed after retry. Please refresh the page.');
            return Promise.reject(error);
          }

          const shopifyApp = (window as any).shopify;
          const freshToken = await safeGetShopifyToken(shopifyApp);

          if (freshToken) {
            localStorage.setItem('shopify_session_token', freshToken);

            // Mark request as retried to prevent infinite loop
            originalRequest._retryCount = (originalRequest._retryCount || 0) + 1;
            originalRequest.headers.Authorization = `Bearer ${freshToken}`;
            originalRequest.headers['X-Shopify-Session'] = 'true';

            return apiClient(originalRequest);
          }
          // If we couldn't get a token, user needs to refresh the page
          console.warn('⚠️ [API] Session expired. Please refresh the Shopify admin page.');
        } else {
          // IN STANDALONE MODE: Dispatch event for AuthContext to handle
          const event = new CustomEvent('auth:session-expired');
          window.dispatchEvent(event);
        }
      }

      // Handle 403 Forbidden
      if (status === 403) {
        const errorCode = error.response?.data?.error;

        // Check if it's a plan limit error
        if (errorCode === 'ORDER_LIMIT_REACHED' || errorCode === 'PRODUCT_LIMIT_REACHED') {
          console.warn('⚠️ [API] Plan limit reached:', errorCode);

          // Dispatch custom event for UI to handle
          const event = new CustomEvent('plan:limit-reached', {
            detail: {
              type: errorCode === 'ORDER_LIMIT_REACHED' ? 'orders' : 'products',
              message: error.response?.data?.message,
              usage: error.response?.data?.usage,
            },
          });
          window.dispatchEvent(event);
        } else if (errorCode === 'FEATURE_NOT_AVAILABLE') {
          console.warn('⚠️ [API] Feature not available:', error.response?.data?.feature);

          // Dispatch custom event for UI to handle
          const event = new CustomEvent('plan:feature-blocked', {
            detail: {
              feature: error.response?.data?.feature,
              message: error.response?.data?.message,
            },
          });
          window.dispatchEvent(event);
        } else {
          console.error('❌ [API] 403 Forbidden - Access denied');
        }
      }

      // Handle 500 Server Error
      if (status === 500) {
        console.error('❌ [API] 500 Server Error');
        // Could show toast notification here
      }

      // Handle 503 Service Unavailable - Retry with backoff
      if (status === 503 || status === 504) {
        const originalRequest = error.config;
        if (!originalRequest._retryCount503 || originalRequest._retryCount503 < 2) {
          originalRequest._retryCount503 = (originalRequest._retryCount503 || 0) + 1;
          const delay = originalRequest._retryCount503 * 1000; // 1s, 2s
          await new Promise(resolve => setTimeout(resolve, delay));
          return apiClient(originalRequest);
        }
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

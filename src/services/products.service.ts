import { Product } from '@/types';

let cleanBaseURL = import.meta.env.VITE_API_URL || 'https://api.ordefy.io';
cleanBaseURL = cleanBaseURL.trim();
cleanBaseURL = cleanBaseURL.replace(/(\/api\/?)+$/i, '');
cleanBaseURL = cleanBaseURL.replace(/\/+$/, '');
const API_BASE_URL = `${cleanBaseURL}/api`;

const getHeaders = () => {
  const token = localStorage.getItem('auth_token');
  const storeId = localStorage.getItem('current_store_id');
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (storeId) {
    headers['X-Store-ID'] = storeId;
  }
  return headers;
};

export const productsService = {
  getAll: async (): Promise<Product[]> => {
    try {
      const response = await fetch(`${API_BASE_URL}/products`, {
        headers: getHeaders(),
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const result = await response.json();
      // API returns {data: [], pagination: {...}}, transform backend format to frontend
      const products = result.data || [];
      return products.map((p: any) => ({
        id: p.id,
        name: p.name,
        sku: p.sku || '',
        description: p.description || '',
        category: p.category || '',
        image: p.image_url || p.image || '',
        stock: p.stock,
        price: p.price,
        cost: p.cost,
        packaging_cost: p.packaging_cost || 0,
        additional_costs: p.additional_costs || 0,
        profitability: p.profitability || ((p.price - p.cost) / p.price * 100).toFixed(1),
        sales: p.sales || 0,
        shopify_product_id: p.shopify_product_id || null,
        shopify_variant_id: p.shopify_variant_id || null,
      }));
    } catch (error) {
      console.error('Error loading products:', error);
      return [];
    }
  },

  getById: async (id: string): Promise<Product | undefined> => {
    try {
      const response = await fetch(`${API_BASE_URL}/products/${id}`, {
        headers: getHeaders(),
      });
      if (!response.ok) {
        if (response.status === 404) return undefined;
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      // Transform backend format to frontend
      return {
        id: data.id,
        name: data.name,
        sku: data.sku || '',
        description: data.description || '',
        category: data.category || '',
        image: data.image_url || data.image || '',
        stock: data.stock,
        price: data.price,
        cost: data.cost,
        packaging_cost: data.packaging_cost || 0,
        additional_costs: data.additional_costs || 0,
        profitability: data.profitability || ((data.price - data.cost) / data.price * 100).toFixed(1),
        sales: data.sales || 0,
        shopify_product_id: data.shopify_product_id || null,
        shopify_variant_id: data.shopify_variant_id || null,
      };
    } catch (error) {
      console.error('Error loading product:', error);
      return undefined;
    }
  },

  create: async (product: Omit<Product, 'id'>): Promise<Product> => {
    try {
      // Transform frontend format to backend format
      const backendProduct = {
        name: product.name,
        sku: product.sku,
        description: product.description,
        category: product.category,
        image_url: product.image,
        stock: product.stock,
        price: product.price,
        cost: product.cost,
        packaging_cost: product.packaging_cost,
        additional_costs: product.additional_costs,
        is_service: product.is_service,
      };

      const response = await fetch(`${API_BASE_URL}/products`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(backendProduct),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
      }

      const result = await response.json();

      // Transform backend response to frontend format
      return {
        id: result.data.id,
        name: result.data.name,
        sku: result.data.sku || '',
        description: result.data.description || '',
        category: result.data.category || '',
        image: result.data.image_url || product.image,
        stock: result.data.stock,
        price: result.data.price,
        cost: result.data.cost,
        packaging_cost: result.data.packaging_cost || 0,
        additional_costs: result.data.additional_costs || 0,
        profitability: product.profitability || 0,
        sales: product.sales || 0,
        shopify_product_id: result.data.shopify_product_id || null,
        shopify_variant_id: result.data.shopify_variant_id || null,
      };
    } catch (error) {
      console.error('Error creating product:', error);
      throw error;
    }
  },

  update: async (id: string, data: Partial<Product>): Promise<Product | undefined> => {
    try {
      // Transform frontend format to backend format
      const backendData: any = {};
      if (data.name !== undefined) backendData.name = data.name;
      if (data.sku !== undefined) backendData.sku = data.sku;
      if (data.description !== undefined) backendData.description = data.description;
      if (data.category !== undefined) backendData.category = data.category;
      if (data.image !== undefined) backendData.image_url = data.image;
      if (data.stock !== undefined) backendData.stock = data.stock;
      if (data.price !== undefined) backendData.price = data.price;
      if (data.cost !== undefined) backendData.cost = data.cost;
      if (data.packaging_cost !== undefined) backendData.packaging_cost = data.packaging_cost;
      if (data.additional_costs !== undefined) backendData.additional_costs = data.additional_costs;
      if (data.is_service !== undefined) backendData.is_service = data.is_service;

      const response = await fetch(`${API_BASE_URL}/products/${id}`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify(backendData),
      });

      if (!response.ok) {
        if (response.status === 404) return undefined;
        const errorData = await response.json();
        throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
      }

      const result = await response.json();

      // Transform backend response to frontend format
      return {
        id: result.data.id,
        name: result.data.name,
        sku: result.data.sku || '',
        description: result.data.description || '',
        category: result.data.category || '',
        image: result.data.image_url || '',
        stock: result.data.stock,
        price: result.data.price,
        cost: result.data.cost,
        packaging_cost: result.data.packaging_cost || 0,
        additional_costs: result.data.additional_costs || 0,
        profitability: data.profitability || 0,
        sales: data.sales || 0,
        shopify_product_id: result.data.shopify_product_id || null,
        shopify_variant_id: result.data.shopify_variant_id || null,
      };
    } catch (error) {
      console.error('Error updating product:', error);
      return undefined;
    }
  },

  delete: async (id: string): Promise<boolean> => {
    try {
      // Use hard delete to permanently remove product from database
      const response = await fetch(`${API_BASE_URL}/products/${id}?hard_delete=true`, {
        method: 'DELETE',
        headers: getHeaders(),
      });
      if (!response.ok) {
        if (response.status === 404) return false;
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return true;
    } catch (error) {
      console.error('Error deleting product:', error);
      return false;
    }
  },

  getShopifyProducts: async (search?: string): Promise<any[]> => {
    try {
      const params = new URLSearchParams();
      if (search) params.append('search', search);

      const response = await fetch(`${API_BASE_URL}/shopify/products?${params}`, {
        headers: getHeaders(),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      return result.products || [];
    } catch (error) {
      console.error('Error loading Shopify products:', error);
      return [];
    }
  },

  createFromShopify: async (
    shopifyProductId: string,
    shopifyVariantId: string,
    costs?: { cost?: number; packaging_cost?: number; additional_costs?: number }
  ): Promise<Product> => {
    try {
      const response = await fetch(`${API_BASE_URL}/products/from-shopify`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          shopify_product_id: shopifyProductId,
          shopify_variant_id: shopifyVariantId,
          ...(costs || {})
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
      }

      const result = await response.json();

      // Transform backend response to frontend format
      return {
        id: result.data.id,
        name: result.data.name,
        sku: result.data.sku || '',
        description: result.data.description || '',
        category: result.data.category || '',
        image: result.data.image_url || '',
        stock: result.data.stock,
        price: result.data.price,
        cost: result.data.cost,
        packaging_cost: result.data.packaging_cost || 0,
        additional_costs: result.data.additional_costs || 0,
        profitability: 0,
        sales: 0,
        shopify_product_id: result.data.shopify_product_id || null,
        shopify_variant_id: result.data.shopify_variant_id || null,
      };
    } catch (error) {
      console.error('Error creating product from Shopify:', error);
      throw error;
    }
  },

  publishToShopify: async (id: string): Promise<boolean> => {
    try {
      const response = await fetch(`${API_BASE_URL}/products/${id}/publish-to-shopify`, {
        method: 'POST',
        headers: getHeaders(),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || errorData.details || `HTTP error! status: ${response.status}`);
      }

      return true;
    } catch (error) {
      console.error('Error publishing product to Shopify:', error);
      throw error;
    }
  },

  checkShopifyIntegration: async (): Promise<boolean> => {
    try {
      const response = await fetch(`${API_BASE_URL}/shopify/integration`, {
        headers: getHeaders(),
      });
      return response.ok;
    } catch (error) {
      return false;
    }
  },
};

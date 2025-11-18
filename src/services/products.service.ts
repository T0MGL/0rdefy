import { Product } from '@/types';

const API_BASE_URL = `${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api`;

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
        image: p.image_url || p.image || '',
        stock: p.stock,
        price: p.price,
        cost: p.cost,
        profitability: p.profitability || ((p.price - p.cost) / p.price * 100).toFixed(1),
        sales: p.sales || 0,
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
        image: data.image_url || data.image || '',
        stock: data.stock,
        price: data.price,
        cost: data.cost,
        profitability: data.profitability || ((data.price - data.cost) / data.price * 100).toFixed(1),
        sales: data.sales || 0,
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
        image_url: product.image,
        stock: product.stock,
        price: product.price,
        cost: product.cost,
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
        image: result.data.image_url || product.image,
        stock: result.data.stock,
        price: result.data.price,
        cost: result.data.cost,
        profitability: product.profitability || 0,
        sales: product.sales || 0,
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
      if (data.image !== undefined) backendData.image_url = data.image;
      if (data.stock !== undefined) backendData.stock = data.stock;
      if (data.price !== undefined) backendData.price = data.price;
      if (data.cost !== undefined) backendData.cost = data.cost;

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
        image: result.data.image_url || '',
        stock: result.data.stock,
        price: result.data.price,
        cost: result.data.cost,
        profitability: data.profitability || 0,
        sales: data.sales || 0,
      };
    } catch (error) {
      console.error('Error updating product:', error);
      return undefined;
    }
  },

  delete: async (id: string): Promise<boolean> => {
    try {
      const response = await fetch(`${API_BASE_URL}/products/${id}`, {
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
};

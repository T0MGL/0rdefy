// ================================================================
// SHOPIFY API SERVICE
// ================================================================
// Handles all Shopify API calls with rate limiting and error handling
// Rate limit: 2 req/sec (Shopify's bucket limit)
// ================================================================

import axios, { AxiosInstance, AxiosError } from 'axios';

const SHOPIFY_API_VERSION = '2025-10';
const RATE_LIMIT_DELAY = 500; // 500ms = 2 req/sec
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second

interface ShopifyProduct {
  id: number;
  title: string;
  body_html: string;
  vendor: string;
  product_type: string;
  status: string;
  variants: ShopifyVariant[];
  images: ShopifyImage[];
  tags: string;
}

interface ShopifyVariant {
  id: number;
  product_id: number;
  title: string;
  price: string;
  sku: string;
  inventory_quantity: number;
  inventory_item_id: number;
}

interface ShopifyImage {
  id: number;
  src: string;
  position: number;
}

interface ShopifyCustomer {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  total_spent: string;
  orders_count: number;
  default_address?: {
    address1: string;
    address2: string | null;
    city: string;
    province: string;
    zip: string;
    country: string;
  };
}

interface RateLimitInfo {
  current: number;
  max: number;
  percentage: number;
}

export class ShopifyAPIService {
  private client: AxiosInstance;
  private shop: string;
  private accessToken: string;
  private lastRequestTime: number = 0;

  constructor(shop: string, accessToken: string) {
    this.shop = shop;
    this.accessToken = accessToken;

    // Create axios instance with Shopify configuration
    this.client = axios.create({
      baseURL: `https://${shop}/admin/api/${SHOPIFY_API_VERSION}`,
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
      timeout: 30000, // 30 seconds
    });

    console.log(`🏪 [SHOPIFY-API] Initialized for shop: ${shop}`);
  }

  // ================================================================
  // RATE LIMITING
  // ================================================================
  // Ensures we don't exceed Shopify's 2 req/sec limit
  // ================================================================

  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < RATE_LIMIT_DELAY) {
      const waitTime = RATE_LIMIT_DELAY - timeSinceLastRequest;
      console.log(`⏱️  [SHOPIFY-API] Rate limiting: waiting ${waitTime}ms`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    this.lastRequestTime = Date.now();
  }

  // ================================================================
  // ERROR HANDLING & RETRY LOGIC
  // ================================================================

  private async makeRequest<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    endpoint: string,
    data?: any,
    retryCount = 0
  ): Promise<T> {
    await this.enforceRateLimit();

    try {
      const response = await this.client.request<T>({
        method,
        url: endpoint,
        data,
      });

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;

        // Handle rate limit errors (429)
        if (axiosError.response?.status === 429 && retryCount < MAX_RETRIES) {
          const retryAfter = parseInt(axiosError.response.headers['retry-after'] || '2') * 1000;
          console.warn(`⚠️  [SHOPIFY-API] Rate limited. Retrying after ${retryAfter}ms...`);
          await new Promise(resolve => setTimeout(resolve, retryAfter));
          return this.makeRequest<T>(method, endpoint, data, retryCount + 1);
        }

        // Handle server errors (500, 502, 503) with retry
        if (
          axiosError.response?.status &&
          axiosError.response.status >= 500 &&
          retryCount < MAX_RETRIES
        ) {
          console.warn(`⚠️  [SHOPIFY-API] Server error. Retry ${retryCount + 1}/${MAX_RETRIES}...`);
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (retryCount + 1)));
          return this.makeRequest<T>(method, endpoint, data, retryCount + 1);
        }

        // Log error details
        console.error(`❌ [SHOPIFY-API] Error:`, {
          status: axiosError.response?.status,
          data: axiosError.response?.data,
          endpoint,
        });

        throw new Error(
          `Shopify API Error: ${axiosError.response?.data?.errors || axiosError.message}`
        );
      }

      throw error;
    }
  }

  // ================================================================
  // RATE LIMIT STATUS
  // ================================================================

  getRateLimitStatus(): RateLimitInfo | null {
    // This would be populated from response headers
    // For now, return null (can be extended to track from headers)
    return null;
  }

  // ================================================================
  // PRODUCTS API
  // ================================================================

  /**
   * Get products from Shopify
   * @param limit Max products per page (max 250)
   */
  async getProducts(limit = 250): Promise<ShopifyProduct[]> {
    console.log(`📦 [SHOPIFY-API] Fetching products (limit: ${limit})...`);

    const response = await this.makeRequest<{ products: ShopifyProduct[] }>(
      'GET',
      `/products.json?limit=${limit}&status=any`
    );

    console.log(`✅ [SHOPIFY-API] Fetched ${response.products.length} products`);
    return response.products;
  }

  /**
   * Get products with pagination using sinceId
   * @param sinceId Get products after this ID
   * @param limit Max products per page
   */
  async getProductsPaginated(sinceId?: number, limit = 250): Promise<ShopifyProduct[]> {
    const url = sinceId
      ? `/products.json?limit=${limit}&since_id=${sinceId}&status=any`
      : `/products.json?limit=${limit}&status=any`;

    console.log(`📦 [SHOPIFY-API] Fetching products paginated (since_id: ${sinceId || 'start'})...`);

    const response = await this.makeRequest<{ products: ShopifyProduct[] }>('GET', url);

    return response.products;
  }

  /**
   * Get ALL products with automatic pagination
   */
  async getAllProducts(): Promise<ShopifyProduct[]> {
    console.log(`📦 [SHOPIFY-API] Fetching ALL products with pagination...`);

    let allProducts: ShopifyProduct[] = [];
    let lastId: number | undefined;
    let hasMore = true;
    let page = 1;

    while (hasMore) {
      const products = await this.getProductsPaginated(lastId, 250);

      if (products.length === 0) {
        hasMore = false;
      } else {
        allProducts = [...allProducts, ...products];
        lastId = products[products.length - 1].id;
        console.log(`📄 [SHOPIFY-API] Page ${page}: ${products.length} products (total: ${allProducts.length})`);
        page++;
      }
    }

    console.log(`✅ [SHOPIFY-API] Fetched ${allProducts.length} total products`);
    return allProducts;
  }

  /**
   * Create a new product in Shopify
   */
  async createProduct(productData: Partial<ShopifyProduct>): Promise<ShopifyProduct> {
    console.log(`✨ [SHOPIFY-API] Creating product: ${productData.title}...`);

    const response = await this.makeRequest<{ product: ShopifyProduct }>(
      'POST',
      '/products.json',
      { product: productData }
    );

    console.log(`✅ [SHOPIFY-API] Created product ID: ${response.product.id}`);
    return response.product;
  }

  /**
   * Update an existing product in Shopify
   */
  async updateProduct(productId: number, productData: Partial<ShopifyProduct>): Promise<ShopifyProduct> {
    console.log(`🔄 [SHOPIFY-API] Updating product ID: ${productId}...`);

    const response = await this.makeRequest<{ product: ShopifyProduct }>(
      'PUT',
      `/products/${productId}.json`,
      { product: productData }
    );

    console.log(`✅ [SHOPIFY-API] Updated product ID: ${productId}`);
    return response.product;
  }

  /**
   * Update inventory quantity for a variant
   */
  async updateInventory(inventoryItemId: number, quantity: number, locationId?: number): Promise<void> {
    console.log(`📊 [SHOPIFY-API] Updating inventory item ${inventoryItemId} to ${quantity}...`);

    // If no location provided, get the first location
    if (!locationId) {
      const locations = await this.getLocations();
      if (locations.length === 0) {
        throw new Error('No locations found in Shopify store');
      }
      locationId = locations[0].id;
    }

    await this.makeRequest('POST', '/inventory_levels/set.json', {
      location_id: locationId,
      inventory_item_id: inventoryItemId,
      available: quantity,
    });

    console.log(`✅ [SHOPIFY-API] Updated inventory to ${quantity}`);
  }

  /**
   * Get store locations for inventory updates
   */
  private async getLocations(): Promise<{ id: number; name: string }[]> {
    const response = await this.makeRequest<{ locations: { id: number; name: string }[] }>(
      'GET',
      '/locations.json'
    );

    return response.locations;
  }

  // ================================================================
  // CUSTOMERS API
  // ================================================================

  /**
   * Get customers from Shopify
   * @param limit Max customers per page (max 250)
   */
  async getCustomers(limit = 250): Promise<ShopifyCustomer[]> {
    console.log(`👥 [SHOPIFY-API] Fetching customers (limit: ${limit})...`);

    const response = await this.makeRequest<{ customers: ShopifyCustomer[] }>(
      'GET',
      `/customers.json?limit=${limit}`
    );

    console.log(`✅ [SHOPIFY-API] Fetched ${response.customers.length} customers`);
    return response.customers;
  }

  /**
   * Get customers with pagination using sinceId
   */
  async getCustomersPaginated(sinceId?: number, limit = 250): Promise<ShopifyCustomer[]> {
    const url = sinceId
      ? `/customers.json?limit=${limit}&since_id=${sinceId}`
      : `/customers.json?limit=${limit}`;

    console.log(`👥 [SHOPIFY-API] Fetching customers paginated (since_id: ${sinceId || 'start'})...`);

    const response = await this.makeRequest<{ customers: ShopifyCustomer[] }>('GET', url);

    return response.customers;
  }

  /**
   * Get ALL customers with automatic pagination
   */
  async getAllCustomers(): Promise<ShopifyCustomer[]> {
    console.log(`👥 [SHOPIFY-API] Fetching ALL customers with pagination...`);

    let allCustomers: ShopifyCustomer[] = [];
    let lastId: number | undefined;
    let hasMore = true;
    let page = 1;

    while (hasMore) {
      const customers = await this.getCustomersPaginated(lastId, 250);

      if (customers.length === 0) {
        hasMore = false;
      } else {
        allCustomers = [...allCustomers, ...customers];
        lastId = customers[customers.length - 1].id;
        console.log(`📄 [SHOPIFY-API] Page ${page}: ${customers.length} customers (total: ${allCustomers.length})`);
        page++;
      }
    }

    console.log(`✅ [SHOPIFY-API] Fetched ${allCustomers.length} total customers`);
    return allCustomers;
  }

  // ================================================================
  // SHOP INFO
  // ================================================================

  /**
   * Get shop information
   */
  async getShopInfo(): Promise<{ name: string; email: string; domain: string }> {
    console.log(`🏪 [SHOPIFY-API] Fetching shop info...`);

    const response = await this.makeRequest<{ shop: any }>('GET', '/shop.json');

    return {
      name: response.shop.name,
      email: response.shop.email,
      domain: response.shop.myshopify_domain,
    };
  }
}

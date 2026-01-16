// Shopify API Client Service
// Handles all communication with Shopify Admin API (2025-10)
// - Products: GraphQL ONLY (REST deprecated since 2024-04)
// - Orders/Customers: REST API (still supported in 2025-10)
// Implements rate limiting, error handling, and pagination

import axios, { AxiosInstance, AxiosError } from 'axios';
import crypto from 'crypto';
import {
  ShopifyProduct,
  ShopifyCustomer,
  ShopifyOrder,
  RateLimitConfig,
  ShopifyIntegration
} from '../types/shopify';
import { ShopifyGraphQLClientService } from './shopify-graphql-client.service';

// Token bucket rate limiter
class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private config: RateLimitConfig;

  constructor(config: RateLimitConfig) {
    this.config = config;
    this.tokens = config.bucket_size;
    this.lastRefill = Date.now();
  }

  async consume(tokens: number = 1): Promise<void> {
    this.refill();

    while (this.tokens < tokens) {
      const waitTime = (tokens - this.tokens) / this.config.refill_rate * 1000;
      await new Promise(resolve => setTimeout(resolve, waitTime));
      this.refill();
    }

    this.tokens -= tokens;
  }

  private refill(): void {
    const now = Date.now();
    const timePassed = (now - this.lastRefill) / 1000;
    const tokensToAdd = timePassed * this.config.refill_rate;

    this.tokens = Math.min(this.config.bucket_size, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  getAvailableTokens(): number {
    this.refill();
    return Math.floor(this.tokens);
  }
}

export class ShopifyClientService {
  private client: AxiosInstance;
  private rateLimiter: TokenBucket;
  private integration: ShopifyIntegration;
  private graphqlClient: ShopifyGraphQLClientService;

  constructor(integration: ShopifyIntegration) {
    this.integration = integration;

    // Initialize GraphQL client for product operations (REQUIRED - REST is deprecated)
    try {
      this.graphqlClient = new ShopifyGraphQLClientService(integration);
      console.log('[Shopify] ✅ GraphQL API initialized (2025-10)');
    } catch (error: any) {
      console.error('[Shopify] ❌ CRITICAL: GraphQL initialization failed:', error.message);
      throw new Error(`GraphQL client initialization failed: ${error.message}`);
    }

    // Initialize rate limiter - Shopify allows 2 requests per second for REST Admin API
    this.rateLimiter = new TokenBucket({
      max_requests_per_second: 2,
      bucket_size: 40,
      refill_rate: 2
    });

    // Create axios client with Shopify configuration
    const apiVersion = process.env.SHOPIFY_API_VERSION || '2025-10';
    this.client = axios.create({
      baseURL: `https://${integration.shop_domain}/admin/api/${apiVersion}`,
      headers: {
        'X-Shopify-Access-Token': integration.access_token,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      response => response,
      error => this.handleError(error)
    );
  }

  // Verify HMAC signature for webhook authenticity
  static verifyWebhookHmac(body: string, hmacHeader: string, secret: string): boolean {
    const hash = crypto
      .createHmac('sha256', secret)
      .update(body, 'utf8')
      .digest('base64');

    return crypto.timingSafeEqual(
      Buffer.from(hash),
      Buffer.from(hmacHeader)
    );
  }

  // Test connection to Shopify
  async testConnection(): Promise<{ success: boolean; shop_data?: any; error?: string; error_type?: string }> {
    try {
      await this.rateLimiter.consume();
      const response = await this.client.get('/shop.json');

      if (!response.data || !response.data.shop) {
        return {
          success: false,
          error: 'Invalid response from Shopify API',
          error_type: 'invalid_response'
        };
      }

      return {
        success: true,
        shop_data: response.data.shop
      };
    } catch (error: any) {
      // Parse error type for better debugging
      let errorType = 'unknown_error';
      let errorMessage = 'Error al conectar con Shopify';

      if (error.response) {
        const status = error.response.status;
        if (status === 401 || status === 403) {
          errorType = 'authentication_error';
          errorMessage = 'Invalid Shopify credentials. Please check your API key and access token.';
        } else if (status === 404) {
          errorType = 'shop_not_found';
          errorMessage = 'Shop not found. Please check your shop domain.';
        } else if (status === 429) {
          errorType = 'rate_limit_exceeded';
          errorMessage = 'Rate limit exceeded. Please try again later.';
        } else if (status >= 500) {
          errorType = 'shopify_server_error';
          errorMessage = 'Shopify server error. Please try again later.';
        } else {
          errorMessage = error.response.data?.errors || error.message;
        }
      } else if (error.request) {
        errorType = 'network_error';
        errorMessage = 'Unable to reach Shopify. Please check your internet connection.';
      }

      console.error('❌ [SHOPIFY-CLIENT] Connection test failed:', {
        error_type: errorType,
        error_message: errorMessage,
        shop_domain: this.integration.shop_domain
      });

      return {
        success: false,
        error: errorMessage,
        error_type: errorType
      };
    }
  }

  // ================================================================
  // PRODUCTS API - GraphQL ONLY (REST deprecated since 2024-04)
  // ================================================================

  async getProducts(params: {
    limit?: number;
    page_info?: string;
    since_id?: number;
    fields?: string;
  } = {}): Promise<{ products: ShopifyProduct[]; pagination: any }> {
    // Use GraphQL API exclusively (REST is deprecated for products in 2025-10)
    console.log('✅ Using GraphQL API 2025-10 for products');

    const result = await this.graphqlClient.getProducts({
      first: params.limit || 50,
      after: params.page_info
    });

    // Convert GraphQL response to match REST format for backward compatibility
    const products = result.products.map((p: any) => this.convertGraphQLProductToREST(p));

    return {
      products,
      pagination: {
        has_next: result.pageInfo.hasNextPage,
        next_cursor: result.pageInfo.endCursor,
        has_prev: false
      }
    };
  }

  async getAllProducts(): Promise<ShopifyProduct[]> {
    console.log('📦 [SHOPIFY-CLIENT] Fetching ALL products with pagination...');

    let allProducts: ShopifyProduct[] = [];
    let cursor: string | undefined;
    let hasMore = true;
    let page = 1;

    while (hasMore) {
      const result = await this.getProducts({
        limit: 250,
        page_info: cursor
      });

      if (result.products.length === 0) {
        hasMore = false;
      } else {
        allProducts = [...allProducts, ...result.products];
        cursor = result.pagination.next_cursor;
        hasMore = result.pagination.has_next;
        console.log(`📄 [SHOPIFY-CLIENT] Page ${page}: ${result.products.length} products (total: ${allProducts.length})`);
        page++;
      }
    }

    console.log(`✅ [SHOPIFY-CLIENT] Fetched ${allProducts.length} total products`);
    return allProducts;
  }

  async getProduct(productId: string): Promise<ShopifyProduct> {
    // GraphQL ONLY - REST deprecated in 2025-10
    console.log('✅ Using GraphQL API 2025-10 for product');
    const product = await this.graphqlClient.getProduct(productId);
    return this.convertGraphQLProductToREST(product);
  }

  async createProduct(productData: {
    title: string;
    body_html?: string;
    vendor?: string;
    product_type?: string;
    tags?: string;
    status?: 'active' | 'draft' | 'archived';
    variants?: Array<{
      price: string;
      sku?: string;
      inventory_quantity?: number;
      barcode?: string;
    }>;
    images?: Array<{ src: string; alt?: string }>;
  }): Promise<ShopifyProduct> {
    // GraphQL ONLY - REST deprecated in 2025-10
    console.log('✅ Using GraphQL API 2025-10 for product creation');

    // Convert REST format to GraphQL format
    const graphqlInput: any = {
      title: productData.title,
      descriptionHtml: productData.body_html,
      vendor: productData.vendor,
      productType: productData.product_type,
      tags: productData.tags ? productData.tags.split(',').map(t => t.trim()) : [],
      status: productData.status?.toUpperCase() as any || 'DRAFT'
    };

    if (productData.variants && productData.variants.length > 0) {
      graphqlInput.variants = productData.variants.map(v => ({
        price: v.price,
        sku: v.sku,
        barcode: v.barcode
      }));
    }

    const product = await this.graphqlClient.createProduct(graphqlInput);
    return this.convertGraphQLProductToREST(product);
  }

  async updateProduct(productId: string, productData: Partial<ShopifyProduct>): Promise<ShopifyProduct> {
    // GraphQL ONLY - REST deprecated in 2025-10
    console.log('✅ Using GraphQL API 2025-10 for product update');

    // Convert REST format to GraphQL format
    const graphqlInput: any = {};

    if (productData.title) graphqlInput.title = productData.title;
    if (productData.body_html) graphqlInput.descriptionHtml = productData.body_html;
    if (productData.vendor) graphqlInput.vendor = productData.vendor;
    if (productData.product_type) graphqlInput.productType = productData.product_type;
    if (productData.tags) {
      graphqlInput.tags = typeof productData.tags === 'string'
        ? productData.tags.split(',').map(t => t.trim())
        : productData.tags;
    }
    if (productData.status) {
      graphqlInput.status = productData.status.toUpperCase();
    }

    const product = await this.graphqlClient.updateProduct(productId, graphqlInput);
    return this.convertGraphQLProductToREST(product);
  }

  async deleteProduct(productId: string): Promise<void> {
    // GraphQL ONLY - REST deprecated in 2025-10
    console.log('✅ Using GraphQL API 2025-10 for product deletion');
    await this.graphqlClient.deleteProduct(productId);
  }

  async updateInventory(inventoryItemId: string, quantity: number, locationId?: string): Promise<void> {
    // GraphQL ONLY - REST deprecated in 2025-10
    console.log('✅ Using GraphQL API 2025-10 for inventory update');

    // Get location if not provided
    let location = locationId;
    if (!location) {
      const locations = await this.graphqlClient.getLocations();
      const activeLocation = locations.find(l => l.isActive);
      if (!activeLocation) {
        throw new Error('No active location found');
      }
      location = activeLocation.id;
    }

    await this.graphqlClient.updateInventory(inventoryItemId, location, quantity);
  }

  // Helper: Convert GraphQL product format to REST format for backward compatibility
  private convertGraphQLProductToREST(graphqlProduct: any): ShopifyProduct {
    if (!ShopifyGraphQLClientService) {
      throw new Error('GraphQL service not available');
    }
    const numericId = ShopifyGraphQLClientService.extractNumericId(graphqlProduct.id);

    return {
      id: parseInt(numericId),
      title: graphqlProduct.title,
      body_html: graphqlProduct.descriptionHtml || '',
      vendor: graphqlProduct.vendor || '',
      product_type: graphqlProduct.productType || '',
      tags: Array.isArray(graphqlProduct.tags) ? graphqlProduct.tags.join(', ') : graphqlProduct.tags || '',
      status: graphqlProduct.status?.toLowerCase() as any || 'draft',
      created_at: graphqlProduct.createdAt,
      updated_at: graphqlProduct.updatedAt,
      variants: graphqlProduct.variants?.edges?.map((edge: any) => ({
        id: parseInt(ShopifyGraphQLClientService.extractNumericId(edge.node.id)),
        sku: edge.node.sku || '',
        price: edge.node.price,
        inventory_quantity: edge.node.inventoryQuantity,
        barcode: edge.node.barcode || '',
        inventory_item_id: edge.node.inventoryItem ?
          parseInt(ShopifyGraphQLClientService.extractNumericId(edge.node.inventoryItem.id)) :
          null
      })) || [],
      images: graphqlProduct.images?.edges?.map((edge: any) => ({
        id: parseInt(ShopifyGraphQLClientService.extractNumericId(edge.node.id)),
        src: edge.node.url,
        alt: edge.node.altText || ''
      })) || []
    } as ShopifyProduct;
  }

  // ================================================================
  // CUSTOMERS API - REST (still supported in 2025-10)
  // ================================================================

  async getCustomers(params: {
    limit?: number;
    page_info?: string;
    since_id?: number;
    fields?: string;
  } = {}): Promise<{ customers: ShopifyCustomer[]; pagination: any }> {
    await this.rateLimiter.consume();

    const queryParams: any = {
      limit: params.limit || 50,
      fields: params.fields
    };

    if (params.page_info) {
      queryParams.page_info = params.page_info;
    } else if (params.since_id) {
      queryParams.since_id = params.since_id;
    }

    const response = await this.client.get('/customers.json', { params: queryParams });
    const linkHeader = response.headers.link || '';
    const pagination = this.parseLinkHeader(linkHeader);

    return {
      customers: response.data.customers || [],
      pagination
    };
  }

  async getCustomer(customerId: string): Promise<ShopifyCustomer> {
    await this.rateLimiter.consume();
    const response = await this.client.get(`/customers/${customerId}.json`);
    return response.data.customer;
  }

  async createCustomer(customerData: Partial<ShopifyCustomer>): Promise<ShopifyCustomer> {
    await this.rateLimiter.consume();
    const response = await this.client.post('/customers.json', {
      customer: customerData
    });
    return response.data.customer;
  }

  async updateCustomer(customerId: string, customerData: Partial<ShopifyCustomer>): Promise<ShopifyCustomer> {
    await this.rateLimiter.consume();
    const response = await this.client.put(`/customers/${customerId}.json`, {
      customer: customerData
    });
    return response.data.customer;
  }

  // ================================================================
  // ORDERS API - REST (still supported in 2025-10)
  // ================================================================

  async getOrders(params: {
    limit?: number;
    page_info?: string;
    since_id?: number;
    status?: string;
    financial_status?: string;
    fulfillment_status?: string;
    created_at_min?: string;
    created_at_max?: string;
    fields?: string;
  } = {}): Promise<{ orders: ShopifyOrder[]; pagination: any }> {
    await this.rateLimiter.consume();

    const queryParams: any = {
      limit: params.limit || 50,
      status: params.status || 'any',
      fields: params.fields
    };

    if (params.page_info) {
      queryParams.page_info = params.page_info;
    } else {
      if (params.since_id) queryParams.since_id = params.since_id;
      if (params.financial_status) queryParams.financial_status = params.financial_status;
      if (params.fulfillment_status) queryParams.fulfillment_status = params.fulfillment_status;
      if (params.created_at_min) queryParams.created_at_min = params.created_at_min;
      if (params.created_at_max) queryParams.created_at_max = params.created_at_max;
    }

    const response = await this.client.get('/orders.json', { params: queryParams });
    const linkHeader = response.headers.link || '';
    const pagination = this.parseLinkHeader(linkHeader);

    return {
      orders: response.data.orders || [],
      pagination
    };
  }

  async getOrder(orderId: string): Promise<ShopifyOrder> {
    await this.rateLimiter.consume();
    const response = await this.client.get(`/orders/${orderId}.json`);
    return response.data.order;
  }

  async getOrderCount(params: {
    status?: string;
    financial_status?: string;
    fulfillment_status?: string;
    created_at_min?: string;
    created_at_max?: string;
  } = {}): Promise<number> {
    await this.rateLimiter.consume();
    const response = await this.client.get('/orders/count.json', { params });
    return response.data.count;
  }

  // Webhook management

  async createWebhook(topic: string, address: string): Promise<any> {
    await this.rateLimiter.consume();
    const response = await this.client.post('/webhooks.json', {
      webhook: {
        topic,
        address,
        format: 'json'
      }
    });
    return response.data.webhook;
  }

  async listWebhooks(): Promise<any[]> {
    await this.rateLimiter.consume();
    const response = await this.client.get('/webhooks.json');
    return response.data.webhooks || [];
  }

  async deleteWebhook(webhookId: string): Promise<void> {
    await this.rateLimiter.consume();
    await this.client.delete(`/webhooks/${webhookId}.json`);
  }

  // Utility methods

  private parseLinkHeader(linkHeader: string): any {
    const pagination: any = {
      has_next: false,
      has_prev: false
    };

    if (!linkHeader) return pagination;

    const links = linkHeader.split(',');
    links.forEach(link => {
      const match = link.match(/<([^>]+)>;\s*rel="([^"]+)"/);
      if (match) {
        const url = match[1];
        const rel = match[2];

        const pageInfoMatch = url.match(/page_info=([^&]+)/);
        if (pageInfoMatch) {
          const pageInfo = pageInfoMatch[1];
          if (rel === 'next') {
            pagination.has_next = true;
            pagination.next_cursor = pageInfo;
          } else if (rel === 'previous') {
            pagination.has_prev = true;
            pagination.prev_cursor = pageInfo;
          }
        }
      }
    });

    return pagination;
  }

  private async handleError(error: AxiosError): Promise<never> {
    if (error.response) {
      const status = error.response.status;
      const data: any = error.response.data;

      // Rate limit exceeded
      if (status === 429) {
        const retryAfter = error.response.headers['retry-after'];
        const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : 2000;
        await new Promise(resolve => setTimeout(resolve, waitTime));
        throw new Error(`Rate limit exceeded. Retry after ${waitTime}ms`);
      }

      // Authentication error
      if (status === 401 || status === 403) {
        throw new Error('Shopify authentication failed. Please check your credentials.');
      }

      // Not found
      if (status === 404) {
        throw new Error('Resource not found in Shopify');
      }

      // Validation error
      if (status === 422) {
        const errors = data.errors || {};
        const errorMessages = Object.entries(errors)
          .map(([field, messages]: [string, any]) => `${field}: ${messages.join(', ')}`)
          .join('; ');
        throw new Error(`Validation error: ${errorMessages}`);
      }

      throw new Error(data.error || data.errors || `Shopify API error: ${status}`);
    }

    if (error.request) {
      throw new Error('No response from Shopify API. Please check your connection.');
    }

    throw error;
  }

  // Get rate limiter stats for monitoring
  getRateLimiterStats(): { available_tokens: number; bucket_size: number } {
    return {
      available_tokens: this.rateLimiter.getAvailableTokens(),
      bucket_size: this.rateLimiter['config'].bucket_size
    };
  }
}

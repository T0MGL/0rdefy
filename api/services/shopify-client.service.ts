// Shopify API Client Service
// Handles all communication with Shopify REST Admin API
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

  constructor(integration: ShopifyIntegration) {
    this.integration = integration;

    // Initialize rate limiter - Shopify allows 2 requests per second for REST Admin API
    this.rateLimiter = new TokenBucket({
      max_requests_per_second: 2,
      bucket_size: 40,
      refill_rate: 2
    });

    // Create axios client with Shopify configuration
    this.client = axios.create({
      baseURL: `https://${integration.shop_domain}/admin/api/2024-01`,
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
  async testConnection(): Promise<{ success: boolean; shop_data?: any; error?: string }> {
    try {
      await this.rateLimiter.consume();
      const response = await this.client.get('/shop.json');
      return {
        success: true,
        shop_data: response.data.shop
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to connect to Shopify'
      };
    }
  }

  // Products API methods

  async getProducts(params: {
    limit?: number;
    page_info?: string;
    since_id?: number;
    fields?: string;
  } = {}): Promise<{ products: ShopifyProduct[]; pagination: any }> {
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

    const response = await this.client.get('/products.json', { params: queryParams });

    // Extract pagination info from Link header
    const linkHeader = response.headers.link || '';
    const pagination = this.parseLinkHeader(linkHeader);

    return {
      products: response.data.products || [],
      pagination
    };
  }

  async getProduct(productId: string): Promise<ShopifyProduct> {
    await this.rateLimiter.consume();
    const response = await this.client.get(`/products/${productId}.json`);
    return response.data.product;
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
    await this.rateLimiter.consume();
    const response = await this.client.post('/products.json', {
      product: productData
    });
    return response.data.product;
  }

  async updateProduct(productId: string, productData: Partial<ShopifyProduct>): Promise<ShopifyProduct> {
    await this.rateLimiter.consume();
    const response = await this.client.put(`/products/${productId}.json`, {
      product: productData
    });
    return response.data.product;
  }

  async deleteProduct(productId: string): Promise<void> {
    await this.rateLimiter.consume();
    await this.client.delete(`/products/${productId}.json`);
  }

  async updateInventory(inventoryItemId: string, quantity: number, locationId?: string): Promise<void> {
    await this.rateLimiter.consume();

    // First get locations if not provided
    let location = locationId;
    if (!location) {
      const locationsResponse = await this.client.get('/locations.json');
      location = locationsResponse.data.locations[0]?.id;
    }

    await this.client.post('/inventory_levels/set.json', {
      location_id: location,
      inventory_item_id: inventoryItemId,
      available: quantity
    });
  }

  // Customers API methods

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

  // Orders API methods

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

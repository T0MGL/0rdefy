/**
 * Production API Client for E2E Testing
 *
 * Features:
 * - Automatic authentication
 * - Resource tracking for cleanup
 * - Rate limiting respect
 * - Error handling with retries
 * - Request/response logging
 */

import { CONFIG } from '../e2e/config';

interface TrackedResource {
  type: string;
  id: string;
  createdAt: Date;
  endpoint: string;
}

interface ApiResponse<T = any> {
  data: T;
  status: number;
  ok: boolean;
  headers: Headers;
}

interface LoginResponse {
  token: string;
  user: {
    id: string;
    email: string;
    name: string;
    stores: Array<{
      id: string;
      name: string;
      role: string;
    }>;
  };
}

export class ProductionApiClient {
  private token: string | null = null;
  private storeId: string | null = null;
  private userId: string | null = null;
  private baseUrl: string;
  private createdResources: TrackedResource[] = [];
  private lastRequestTime: number = 0;
  private isLoggedIn: boolean = false;

  constructor(baseUrl: string = CONFIG.apiUrl) {
    this.baseUrl = baseUrl;
  }

  /**
   * Authenticate with the production API
   */
  async login(): Promise<LoginResponse> {
    if (this.isLoggedIn && this.token) {
      return {
        token: this.token,
        user: {
          id: this.userId!,
          email: CONFIG.credentials.email,
          name: '',
          stores: [{ id: this.storeId!, name: '', role: 'owner' }]
        }
      };
    }

    const response = await fetch(`${this.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: CONFIG.credentials.email,
        password: CONFIG.credentials.password
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Login failed: ${response.status} - ${error}`);
    }

    const data: LoginResponse = await response.json();

    if (!data.token) {
      throw new Error('Login response missing token');
    }

    if (!data.user?.stores?.length) {
      throw new Error('Login response missing store information');
    }

    this.token = data.token;
    this.userId = data.user.id;
    this.storeId = data.user.stores[0].id;
    this.isLoggedIn = true;

    console.log(`✓ Logged in as ${data.user.email} (Store: ${this.storeId})`);

    return data;
  }

  /**
   * Ensure we're logged in before making requests
   */
  private async ensureAuthenticated(): Promise<void> {
    if (!this.isLoggedIn) {
      await this.login();
    }
  }

  /**
   * Rate limiting - wait between requests
   */
  private async respectRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    const minDelay = CONFIG.rateLimiting.delayBetweenRequests;

    if (timeSinceLastRequest < minDelay) {
      await this.delay(minDelay - timeSinceLastRequest);
    }

    this.lastRequestTime = Date.now();
  }

  /**
   * Helper to delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Make an authenticated request to the API
   */
  async request<T = any>(
    method: string,
    path: string,
    body?: any,
    options: { skipAuth?: boolean; retries?: number } = {}
  ): Promise<T> {
    if (!options.skipAuth) {
      await this.ensureAuthenticated();
    }

    await this.respectRateLimit();

    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    if (this.token && !options.skipAuth) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    if (this.storeId && !options.skipAuth) {
      headers['X-Store-ID'] = this.storeId;
    }

    const retries = options.retries ?? CONFIG.retries.max;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await fetch(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined
        });

        const responseData = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(
            `API Error ${response.status}: ${JSON.stringify(responseData)}`
          );
        }

        return responseData as T;
      } catch (error) {
        lastError = error as Error;

        if (attempt < retries) {
          console.log(`  ⟳ Retry ${attempt + 1}/${retries} for ${method} ${path}`);
          await this.delay(CONFIG.retries.delay * (attempt + 1));
        }
      }
    }

    throw lastError;
  }

  /**
   * Make a raw request (returns full response with status)
   */
  async requestRaw(
    method: string,
    path: string,
    body?: any,
    options: { skipAuth?: boolean } = {}
  ): Promise<ApiResponse> {
    if (!options.skipAuth) {
      await this.ensureAuthenticated();
    }

    await this.respectRateLimit();

    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    if (this.token && !options.skipAuth) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    if (this.storeId && !options.skipAuth) {
      headers['X-Store-ID'] = this.storeId;
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });

    const data = await response.json().catch(() => ({}));

    return {
      data,
      status: response.status,
      ok: response.ok,
      headers: response.headers
    };
  }

  /**
   * Track a created resource for later cleanup
   */
  trackResource(type: string, id: string, endpoint?: string): void {
    if (!id) {
      console.warn(`⚠ Cannot track resource without ID (type: ${type})`);
      return;
    }

    this.createdResources.push({
      type,
      id,
      createdAt: new Date(),
      endpoint: endpoint || `/${type}/${id}`
    });

    console.log(`  📝 Tracking ${type}: ${id}`);
  }

  /**
   * Get all tracked resources
   */
  getTrackedResources(): TrackedResource[] {
    return [...this.createdResources];
  }

  /**
   * Clean up a specific resource
   */
  async cleanupResource(type: string, id: string): Promise<boolean> {
    try {
      // Special handling for different resource types
      let endpoint = `/${type}/${id}`;

      // Handle hard delete for orders
      if (type === 'orders') {
        endpoint = `/orders/${id}?hard_delete=true`;
      }

      await this.request('DELETE', endpoint);
      console.log(`  🗑️  Deleted ${type}: ${id}`);
      return true;
    } catch (error) {
      console.warn(`  ⚠ Failed to delete ${type} ${id}:`, (error as Error).message);
      return false;
    }
  }

  /**
   * Clean up all tracked resources (in reverse order)
   * Order: orders → picking sessions → products → customers → carriers
   */
  async cleanupAll(): Promise<{ success: number; failed: number }> {
    console.log('\n🧹 Cleaning up test resources...');

    const results = { success: 0, failed: 0 };

    // Group resources by type for ordered deletion
    const resourcesByType: Record<string, TrackedResource[]> = {};
    for (const resource of this.createdResources) {
      if (!resourcesByType[resource.type]) {
        resourcesByType[resource.type] = [];
      }
      resourcesByType[resource.type].push(resource);
    }

    // Delete in specific order (dependencies first)
    const deleteOrder = [
      'dispatch-sessions',
      'return-sessions',
      'picking-sessions',
      'orders',
      'products',
      'customers',
      'carriers',
      'suppliers'
    ];

    for (const type of deleteOrder) {
      const resources = resourcesByType[type] || [];
      for (const resource of resources.reverse()) {
        const success = await this.cleanupResource(type, resource.id);
        if (success) {
          results.success++;
        } else {
          results.failed++;
        }
      }
    }

    // Clean up any remaining types not in the order
    for (const [type, resources] of Object.entries(resourcesByType)) {
      if (!deleteOrder.includes(type)) {
        for (const resource of resources.reverse()) {
          const success = await this.cleanupResource(type, resource.id);
          if (success) {
            results.success++;
          } else {
            results.failed++;
          }
        }
      }
    }

    this.createdResources = [];

    console.log(`✓ Cleanup complete: ${results.success} deleted, ${results.failed} failed\n`);

    return results;
  }

  /**
   * Get current authentication state
   */
  getAuthState(): { token: string | null; storeId: string | null; userId: string | null } {
    return {
      token: this.token,
      storeId: this.storeId,
      userId: this.userId
    };
  }

  /**
   * Reset client state (for test isolation)
   */
  reset(): void {
    this.token = null;
    this.storeId = null;
    this.userId = null;
    this.isLoggedIn = false;
    this.createdResources = [];
    this.lastRequestTime = 0;
  }
}

// Singleton instance for shared state across tests
let sharedClient: ProductionApiClient | null = null;

export function getSharedClient(): ProductionApiClient {
  if (!sharedClient) {
    sharedClient = new ProductionApiClient();
  }
  return sharedClient;
}

export function resetSharedClient(): void {
  if (sharedClient) {
    sharedClient.reset();
  }
  sharedClient = null;
}

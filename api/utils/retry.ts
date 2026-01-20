/**
 * Retry Utility for External API Calls
 *
 * CRITICAL: Production-ready retry logic with exponential backoff.
 * Use this for all external API calls (Shopify, Stripe, WhatsApp, etc.)
 *
 * Features:
 * - Exponential backoff with jitter
 * - Configurable retry conditions
 * - Timeout handling
 * - Circuit breaker pattern (optional)
 * - Logging integration
 */

import { logger } from './logger';

const log = logger.child('RETRY');

export interface RetryOptions {
    /** Maximum number of retry attempts (default: 3) */
    maxRetries?: number;
    /** Initial delay in ms (default: 1000) */
    initialDelay?: number;
    /** Maximum delay in ms (default: 30000) */
    maxDelay?: number;
    /** Backoff multiplier (default: 2) */
    backoffMultiplier?: number;
    /** Add random jitter to prevent thundering herd (default: true) */
    jitter?: boolean;
    /** Timeout for each attempt in ms (default: 30000) */
    timeout?: number;
    /** Function to determine if error is retryable (default: checks status codes) */
    isRetryable?: (error: any) => boolean;
    /** Context for logging */
    context?: string;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
    maxRetries: 3,
    initialDelay: 1000,
    maxDelay: 30000,
    backoffMultiplier: 2,
    jitter: true,
    timeout: 30000,
    isRetryable: defaultIsRetryable,
    context: 'API',
};

/**
 * Default retry condition - retries on network errors and specific status codes
 */
function defaultIsRetryable(error: any): boolean {
    // Network errors
    if (error.code === 'ECONNRESET' ||
        error.code === 'ETIMEDOUT' ||
        error.code === 'ECONNREFUSED' ||
        error.code === 'ENOTFOUND' ||
        error.code === 'EAI_AGAIN') {
        return true;
    }

    // HTTP status codes that are retryable
    const status = error.status || error.statusCode || error.response?.status;
    if (status) {
        // 429 Too Many Requests
        // 500 Internal Server Error
        // 502 Bad Gateway
        // 503 Service Unavailable
        // 504 Gateway Timeout
        return [429, 500, 502, 503, 504].includes(status);
    }

    // Timeout errors
    if (error.name === 'TimeoutError' || error.message?.includes('timeout')) {
        return true;
    }

    return false;
}

/**
 * Calculate delay with exponential backoff and optional jitter
 */
function calculateDelay(attempt: number, options: Required<RetryOptions>): number {
    let delay = options.initialDelay * Math.pow(options.backoffMultiplier, attempt);
    delay = Math.min(delay, options.maxDelay);

    if (options.jitter) {
        // Add random jitter between 0-25% of delay
        const jitter = delay * 0.25 * Math.random();
        delay = delay + jitter;
    }

    return Math.round(delay);
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Wrap a promise with a timeout
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, context: string): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`${context} operation timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        promise
            .then(result => {
                clearTimeout(timer);
                resolve(result);
            })
            .catch(error => {
                clearTimeout(timer);
                reject(error);
            });
    });
}

/**
 * Execute a function with automatic retry logic
 *
 * @example
 * ```typescript
 * const result = await withRetry(
 *   () => shopifyClient.get('/products'),
 *   { maxRetries: 3, context: 'SHOPIFY' }
 * );
 * ```
 */
export async function withRetry<T>(
    fn: () => Promise<T>,
    options?: RetryOptions
): Promise<T> {
    const opts: Required<RetryOptions> = { ...DEFAULT_OPTIONS, ...options };
    let lastError: any;

    for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
        try {
            // Apply timeout to each attempt
            const result = await withTimeout(fn(), opts.timeout, opts.context);

            // Log successful retry
            if (attempt > 0) {
                log.info(`${opts.context} succeeded after ${attempt} retries`);
            }

            return result;
        } catch (error: any) {
            lastError = error;

            // Check if we should retry
            if (attempt < opts.maxRetries && opts.isRetryable(error)) {
                const delay = calculateDelay(attempt, opts);

                log.warn(`${opts.context} attempt ${attempt + 1} failed, retrying in ${delay}ms`, {
                    error: error.message,
                    code: error.code,
                    status: error.status || error.statusCode,
                    attempt: attempt + 1,
                    maxRetries: opts.maxRetries,
                });

                await sleep(delay);
            } else {
                // Not retryable or max retries reached
                if (attempt >= opts.maxRetries) {
                    log.error(`${opts.context} failed after ${opts.maxRetries} retries`, {
                        error: error.message,
                        code: error.code,
                        status: error.status || error.statusCode,
                    });
                } else {
                    log.error(`${opts.context} failed (not retryable)`, {
                        error: error.message,
                        code: error.code,
                    });
                }
                throw error;
            }
        }
    }

    // This should never be reached, but TypeScript needs it
    throw lastError;
}

/**
 * Create a retryable version of an async function
 *
 * @example
 * ```typescript
 * const fetchWithRetry = retryable(
 *   async (url: string) => fetch(url),
 *   { maxRetries: 3 }
 * );
 * const result = await fetchWithRetry('https://api.example.com/data');
 * ```
 */
export function retryable<TArgs extends any[], TResult>(
    fn: (...args: TArgs) => Promise<TResult>,
    options?: RetryOptions
): (...args: TArgs) => Promise<TResult> {
    return (...args: TArgs) => withRetry(() => fn(...args), options);
}

// ================================================================
// SPECIALIZED RETRY CONFIGURATIONS
// ================================================================

/**
 * Shopify-specific retry options
 * - Higher timeout for GraphQL operations
 * - Respects Shopify rate limits (429)
 */
export const SHOPIFY_RETRY_OPTIONS: RetryOptions = {
    maxRetries: 5,
    initialDelay: 2000, // Shopify recommends waiting at least 1s
    maxDelay: 60000,
    backoffMultiplier: 2,
    timeout: 45000, // GraphQL operations can be slow
    context: 'SHOPIFY',
    isRetryable: (error: any) => {
        // Always retry rate limits
        const status = error.status || error.statusCode || error.response?.status;
        if (status === 429) return true;

        // Use default logic for other errors
        return defaultIsRetryable(error);
    },
};

/**
 * Stripe-specific retry options
 * - Stripe has its own idempotency, so fewer retries needed
 * - Quick timeout for payment operations
 */
export const STRIPE_RETRY_OPTIONS: RetryOptions = {
    maxRetries: 2,
    initialDelay: 1000,
    maxDelay: 10000,
    timeout: 30000,
    context: 'STRIPE',
    isRetryable: (error: any) => {
        // Don't retry client errors (4xx except 429)
        const status = error.status || error.statusCode || error.raw?.statusCode;
        if (status >= 400 && status < 500 && status !== 429) {
            return false;
        }
        return defaultIsRetryable(error);
    },
};

/**
 * WhatsApp/Meta API retry options
 * - Respects Meta rate limits
 * - Short timeout for messaging
 */
export const WHATSAPP_RETRY_OPTIONS: RetryOptions = {
    maxRetries: 3,
    initialDelay: 1000,
    maxDelay: 15000,
    timeout: 15000, // Messages should be fast
    context: 'WHATSAPP',
};

/**
 * Database operation retry options
 * - Very short delays for transient DB errors
 * - Fewer retries
 */
export const DATABASE_RETRY_OPTIONS: RetryOptions = {
    maxRetries: 2,
    initialDelay: 100,
    maxDelay: 1000,
    timeout: 10000,
    context: 'DATABASE',
    isRetryable: (error: any) => {
        // Retry connection issues
        if (error.code === 'ECONNRESET' ||
            error.code === '57P01' || // admin_shutdown
            error.code === '57P02' || // crash_shutdown
            error.code === '57P03' || // cannot_connect_now
            error.code === '40001' || // serialization_failure
            error.code === '40P01') { // deadlock_detected
            return true;
        }
        return false;
    },
};

// ================================================================
// CIRCUIT BREAKER PATTERN
// ================================================================

interface CircuitBreakerState {
    failures: number;
    lastFailure: number | null;
    lastAccess: number;
    state: 'closed' | 'open' | 'half-open';
}

/**
 * Bounded LRU-style cache for circuit breakers
 * Prevents unbounded memory growth with automatic TTL-based eviction
 */
class BoundedCircuitBreakerCache {
    private cache: Map<string, CircuitBreakerState> = new Map();
    private readonly maxSize: number;
    private readonly ttlMs: number;
    private cleanupInterval: ReturnType<typeof setInterval> | null = null;

    constructor(maxSize: number = 500, ttlMs: number = 30 * 60 * 1000) {
        this.maxSize = maxSize;
        this.ttlMs = ttlMs;
        // Run cleanup every 5 minutes
        this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
        // Don't let cleanup interval prevent process exit
        if (this.cleanupInterval.unref) {
            this.cleanupInterval.unref();
        }
    }

    get(name: string): CircuitBreakerState | undefined {
        const state = this.cache.get(name);
        if (state) {
            state.lastAccess = Date.now();
        }
        return state;
    }

    has(name: string): boolean {
        return this.cache.has(name);
    }

    set(name: string, state: CircuitBreakerState): void {
        // If at capacity, evict oldest entry
        if (this.cache.size >= this.maxSize && !this.cache.has(name)) {
            this.evictOldest();
        }
        state.lastAccess = Date.now();
        this.cache.set(name, state);
    }

    delete(name: string): boolean {
        return this.cache.delete(name);
    }

    /**
     * Remove entries that haven't been accessed within TTL
     */
    private cleanup(): void {
        const now = Date.now();
        let evicted = 0;
        for (const [name, state] of this.cache.entries()) {
            if (now - state.lastAccess > this.ttlMs) {
                this.cache.delete(name);
                evicted++;
            }
        }
        if (evicted > 0) {
            log.debug(`Circuit breaker cache cleanup: evicted ${evicted} stale entries`);
        }
    }

    /**
     * Evict the least recently accessed entry
     */
    private evictOldest(): void {
        let oldestKey: string | null = null;
        let oldestAccess = Infinity;

        for (const [name, state] of this.cache.entries()) {
            if (state.lastAccess < oldestAccess) {
                oldestAccess = state.lastAccess;
                oldestKey = name;
            }
        }

        if (oldestKey) {
            this.cache.delete(oldestKey);
            log.debug(`Circuit breaker cache: evicted LRU entry '${oldestKey}'`);
        }
    }

    /**
     * Get current cache size (for monitoring)
     */
    size(): number {
        return this.cache.size;
    }

    /**
     * Stop cleanup interval (for graceful shutdown)
     */
    destroy(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }
}

// Bounded cache: max 500 entries, 30-minute TTL
const circuitBreakers = new BoundedCircuitBreakerCache(500, 30 * 60 * 1000);

export interface CircuitBreakerOptions {
    /** Number of failures before opening circuit (default: 5) */
    failureThreshold?: number;
    /** Time in ms before attempting to close circuit (default: 30000) */
    resetTimeout?: number;
    /** Name for this circuit breaker */
    name: string;
}

/**
 * Execute a function with circuit breaker protection
 *
 * @example
 * ```typescript
 * const result = await withCircuitBreaker(
 *   () => externalApiCall(),
 *   { name: 'shopify-products', failureThreshold: 5 }
 * );
 * ```
 */
export async function withCircuitBreaker<T>(
    fn: () => Promise<T>,
    options: CircuitBreakerOptions
): Promise<T> {
    const { name, failureThreshold = 5, resetTimeout = 30000 } = options;

    // Get or create circuit breaker state
    if (!circuitBreakers.has(name)) {
        circuitBreakers.set(name, {
            failures: 0,
            lastFailure: null,
            lastAccess: Date.now(),
            state: 'closed',
        });
    }

    const breaker = circuitBreakers.get(name)!;
    const now = Date.now();

    // Check if circuit is open
    if (breaker.state === 'open') {
        // Check if we should try half-open
        if (breaker.lastFailure && now - breaker.lastFailure >= resetTimeout) {
            breaker.state = 'half-open';
            log.info(`Circuit breaker ${name} entering half-open state`);
        } else {
            log.warn(`Circuit breaker ${name} is open, rejecting request`);
            throw new Error(`Circuit breaker ${name} is open`);
        }
    }

    try {
        const result = await fn();

        // Success - reset circuit
        if (breaker.state === 'half-open') {
            log.info(`Circuit breaker ${name} closing after successful call`);
        }
        breaker.failures = 0;
        breaker.state = 'closed';

        return result;
    } catch (error) {
        breaker.failures++;
        breaker.lastFailure = now;

        // Check if we should open the circuit
        if (breaker.failures >= failureThreshold) {
            breaker.state = 'open';
            log.error(`Circuit breaker ${name} opened after ${breaker.failures} failures`);
        }

        throw error;
    }
}

/**
 * Get circuit breaker status (for monitoring)
 */
export function getCircuitBreakerStatus(name: string): CircuitBreakerState | undefined {
    return circuitBreakers.get(name);
}

/**
 * Reset a circuit breaker (for testing/admin)
 */
export function resetCircuitBreaker(name: string): void {
    circuitBreakers.delete(name);
    log.info(`Circuit breaker ${name} reset`);
}

/**
 * Get circuit breaker cache statistics (for monitoring)
 */
export function getCircuitBreakerCacheStats(): { size: number; maxSize: number } {
    return {
        size: circuitBreakers.size(),
        maxSize: 500,
    };
}

/**
 * Stop circuit breaker cleanup interval (for graceful shutdown)
 */
export function destroyCircuitBreakerCache(): void {
    circuitBreakers.destroy();
    log.info('Circuit breaker cache destroyed');
}

export default withRetry;

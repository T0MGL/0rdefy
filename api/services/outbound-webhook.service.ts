/**
 * Outbound Webhook Service
 *
 * Sends webhook notifications to user-configured URLs when order events occur.
 * Features:
 *   - HMAC-SHA256 payload signing
 *   - Fire-and-forget with async delivery logging
 *   - Retry with exponential backoff (max 3 attempts)
 *   - Event filtering per config
 *   - SSRF protection (blocks private/internal IPs)
 *   - Header injection prevention
 *
 * Usage:
 *   import { OutboundWebhookService } from './outbound-webhook.service';
 *   OutboundWebhookService.fireOrderEvent(storeId, 'order.delivered', orderData);
 */

import crypto from 'crypto';
import { supabaseAdmin } from '../db/connection';
import { logger } from '../utils/logger';

// ================================================================
// Types
// ================================================================

export interface OutboundWebhookConfig {
    id: string;
    store_id: string;
    name: string;
    url: string;
    signing_secret: string;
    events: string[];
    is_active: boolean;
    custom_headers: Record<string, string>;
    created_by: string | null;
    created_at: string;
    updated_at: string;
    last_triggered_at: string | null;
    total_deliveries: number;
    total_failures: number;
}

export interface OutboundWebhookPayload {
    event: string;
    timestamp: string;
    store_id: string;
    data: Record<string, any>;
}

export interface WebhookDeliveryResult {
    config_id: string;
    status: 'success' | 'failed';
    response_status?: number;
    response_body?: string;
    error_message?: string;
    duration_ms: number;
    attempts: number;
}

// ================================================================
// Supported Events
// ================================================================

export const OUTBOUND_WEBHOOK_EVENTS = [
    'order.status_changed',
    'order.confirmed',
    'order.in_preparation',
    'order.ready_to_ship',
    'order.shipped',
    'order.delivered',
    'order.cancelled',
    'order.returned',
] as const;

export type OutboundWebhookEvent = typeof OUTBOUND_WEBHOOK_EVENTS[number];

// Map order statuses to webhook events
const STATUS_TO_EVENT: Record<string, OutboundWebhookEvent> = {
    confirmed: 'order.confirmed',
    in_preparation: 'order.in_preparation',
    ready_to_ship: 'order.ready_to_ship',
    shipped: 'order.shipped',
    in_transit: 'order.shipped',
    delivered: 'order.delivered',
    cancelled: 'order.cancelled',
    rejected: 'order.cancelled',
    returned: 'order.returned',
};

// ================================================================
// SSRF Protection
// ================================================================

// Headers that users must NOT override via custom_headers
const BLOCKED_HEADERS = new Set([
    'host',
    'content-type',
    'content-length',
    'user-agent',
    'authorization',
    'cookie',
    'x-webhook-signature',
    'x-webhook-event',
    'x-webhook-delivery-id',
]);

/**
 * Validate that a webhook URL is safe (not targeting internal/private networks).
 * Prevents SSRF attacks against cloud metadata endpoints, localhost, etc.
 */
function validateWebhookUrl(url: string): { valid: boolean; error?: string } {
    try {
        const parsed = new URL(url);

        // Must be http or https
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return { valid: false, error: 'Solo se permiten URLs http:// o https://' };
        }

        const hostname = parsed.hostname.toLowerCase();

        // Block localhost variants
        if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' ||
            hostname === '0.0.0.0' || hostname === '[::1]') {
            return { valid: false, error: 'No se permiten URLs a localhost' };
        }

        // Block private IP ranges (RFC 1918)
        const ipMatch = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
        if (ipMatch) {
            const [, a, b] = ipMatch.map(Number);
            // 10.x.x.x
            if (a === 10) return { valid: false, error: 'No se permiten IPs privadas' };
            // 172.16-31.x.x
            if (a === 172 && b >= 16 && b <= 31) return { valid: false, error: 'No se permiten IPs privadas' };
            // 192.168.x.x
            if (a === 192 && b === 168) return { valid: false, error: 'No se permiten IPs privadas' };
            // 169.254.x.x (link-local / cloud metadata)
            if (a === 169 && b === 254) return { valid: false, error: 'No se permiten IPs de metadata' };
            // 0.x.x.x
            if (a === 0) return { valid: false, error: 'No se permiten IPs reservadas' };
        }

        // Block common metadata hostnames
        if (hostname === 'metadata.google.internal' || hostname === 'metadata.google.com') {
            return { valid: false, error: 'No se permiten URLs de metadata de cloud' };
        }

        return { valid: true };
    } catch {
        return { valid: false, error: 'URL inválida' };
    }
}

/**
 * Sanitize custom headers: remove blocked headers, validate types, limit count.
 */
function sanitizeCustomHeaders(headers: Record<string, any>): Record<string, string> {
    const sanitized: Record<string, string> = {};
    const entries = Object.entries(headers);

    // Max 10 custom headers
    const limited = entries.slice(0, 10);

    for (const [key, value] of limited) {
        // Skip blocked headers
        if (BLOCKED_HEADERS.has(key.toLowerCase())) continue;
        // Only string values
        if (typeof value !== 'string') continue;
        // Key must be valid HTTP header name
        if (!/^[A-Za-z0-9-]+$/.test(key)) continue;
        // Value max 500 chars
        sanitized[key] = String(value).substring(0, 500);
    }

    return sanitized;
}

// ================================================================
// Service
// ================================================================

export class OutboundWebhookService {

    /**
     * Generate a signing secret for a new webhook config.
     * Format: whsec_ + 32 random hex bytes = 70 chars total
     */
    static generateSigningSecret(): string {
        return 'whsec_' + crypto.randomBytes(32).toString('hex');
    }

    /**
     * Sign a payload using HMAC-SHA256.
     * Returns the signature as hex string.
     */
    static signPayload(payload: string, secret: string): string {
        return crypto
            .createHmac('sha256', secret)
            .update(payload)
            .digest('hex');
    }

    /**
     * Validate and sanitize a webhook URL.
     */
    static validateUrl(url: string): { valid: boolean; error?: string } {
        return validateWebhookUrl(url);
    }

    /**
     * Sanitize custom headers (remove blocked, validate types, limit count).
     */
    static sanitizeHeaders(headers: Record<string, any>): Record<string, string> {
        return sanitizeCustomHeaders(headers);
    }

    // ================================================================
    // CRUD Operations
    // ================================================================

    static async getConfigs(storeId: string): Promise<OutboundWebhookConfig[]> {
        const { data, error } = await supabaseAdmin
            .from('outbound_webhook_configs')
            .select('*')
            .eq('store_id', storeId)
            .order('created_at', { ascending: true });

        if (error) {
            logger.error('OUTBOUND_WEBHOOK', 'Error fetching configs:', error.message);
            throw new Error('Error al obtener configuraciones de webhook');
        }

        return data || [];
    }

    static async getConfigById(storeId: string, configId: string): Promise<OutboundWebhookConfig | null> {
        const { data, error } = await supabaseAdmin
            .from('outbound_webhook_configs')
            .select('*')
            .eq('id', configId)
            .eq('store_id', storeId)
            .single();

        if (error) return null;
        return data;
    }

    static async createConfig(
        storeId: string,
        userId: string,
        params: { name: string; url: string; events: string[]; custom_headers?: Record<string, string> }
    ): Promise<{ config: OutboundWebhookConfig; signing_secret: string }> {
        // SSRF protection
        const urlCheck = validateWebhookUrl(params.url);
        if (!urlCheck.valid) {
            throw new Error(urlCheck.error || 'URL inválida');
        }

        const signingSecret = this.generateSigningSecret();
        const safeHeaders = sanitizeCustomHeaders(params.custom_headers || {});

        const { data, error } = await supabaseAdmin
            .from('outbound_webhook_configs')
            .insert({
                store_id: storeId,
                name: params.name.substring(0, 100),
                url: params.url,
                signing_secret: signingSecret,
                events: params.events,
                custom_headers: safeHeaders,
                created_by: userId,
            })
            .select()
            .single();

        if (error) {
            if (error.message.includes('Maximum of 5')) {
                throw new Error('Máximo 5 configuraciones de webhook por tienda');
            }
            logger.error('OUTBOUND_WEBHOOK', 'Error creating config:', error.message);
            throw new Error('Error al crear configuración de webhook');
        }

        return { config: data, signing_secret: signingSecret };
    }

    static async updateConfig(
        storeId: string,
        configId: string,
        params: { name?: string; url?: string; events?: string[]; is_active?: boolean; custom_headers?: Record<string, string> }
    ): Promise<OutboundWebhookConfig> {
        // SSRF protection on URL update
        if (params.url !== undefined) {
            const urlCheck = validateWebhookUrl(params.url);
            if (!urlCheck.valid) {
                throw new Error(urlCheck.error || 'URL inválida');
            }
        }

        const updateData: any = {};
        if (params.name !== undefined) updateData.name = params.name.substring(0, 100);
        if (params.url !== undefined) updateData.url = params.url;
        if (params.events !== undefined) updateData.events = params.events;
        if (params.is_active !== undefined) updateData.is_active = params.is_active;
        if (params.custom_headers !== undefined) updateData.custom_headers = sanitizeCustomHeaders(params.custom_headers);

        const { data, error } = await supabaseAdmin
            .from('outbound_webhook_configs')
            .update(updateData)
            .eq('id', configId)
            .eq('store_id', storeId)
            .select()
            .single();

        if (error) {
            logger.error('OUTBOUND_WEBHOOK', 'Error updating config:', error.message);
            throw new Error('Error al actualizar configuración de webhook');
        }

        if (!data) {
            throw new Error('Configuración no encontrada');
        }

        return data;
    }

    static async deleteConfig(storeId: string, configId: string): Promise<void> {
        // Verify config exists first
        const existing = await this.getConfigById(storeId, configId);
        if (!existing) {
            throw new Error('Configuración no encontrada');
        }

        const { error } = await supabaseAdmin
            .from('outbound_webhook_configs')
            .delete()
            .eq('id', configId)
            .eq('store_id', storeId);

        if (error) {
            logger.error('OUTBOUND_WEBHOOK', 'Error deleting config:', error.message);
            throw new Error('Error al eliminar configuración de webhook');
        }
    }

    static async regenerateSecret(storeId: string, configId: string): Promise<string> {
        // Verify config exists first
        const existing = await this.getConfigById(storeId, configId);
        if (!existing) {
            throw new Error('Configuración no encontrada');
        }

        const newSecret = this.generateSigningSecret();

        const { error } = await supabaseAdmin
            .from('outbound_webhook_configs')
            .update({ signing_secret: newSecret })
            .eq('id', configId)
            .eq('store_id', storeId);

        if (error) {
            logger.error('OUTBOUND_WEBHOOK', 'Error regenerating secret:', error.message);
            throw new Error('Error al regenerar secreto');
        }

        return newSecret;
    }

    // ================================================================
    // Delivery Log
    // ================================================================

    static async getDeliveries(
        storeId: string,
        configId?: string,
        limit = 50,
        offset = 0
    ): Promise<{ deliveries: any[]; total: number }> {
        let query = supabaseAdmin
            .from('outbound_webhook_deliveries')
            .select('*', { count: 'exact' })
            .eq('store_id', storeId)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (configId) {
            query = query.eq('config_id', configId);
        }

        const { data, error, count } = await query;

        if (error) {
            logger.error('OUTBOUND_WEBHOOK', 'Error fetching deliveries:', error.message);
            throw new Error('Error al obtener historial de entregas');
        }

        return { deliveries: data || [], total: count || 0 };
    }

    // ================================================================
    // Fire Webhook (Core Logic)
    // ================================================================

    /**
     * Fire outbound webhooks for an order status change.
     * This is fire-and-forget — errors are logged but never thrown.
     *
     * @param storeId - The store ID
     * @param newStatus - The new order status (e.g., 'delivered')
     * @param orderData - Order data to include in the payload
     */
    static async fireOrderStatusEvent(
        storeId: string,
        newStatus: string,
        previousStatus: string,
        orderData: Record<string, any>
    ): Promise<void> {
        try {
            // Determine which specific event this maps to
            const specificEvent = STATUS_TO_EVENT[newStatus];

            // Get all active configs for this store
            const { data: configs, error } = await supabaseAdmin
                .from('outbound_webhook_configs')
                .select('id, url, signing_secret, events, custom_headers')
                .eq('store_id', storeId)
                .eq('is_active', true);

            if (error || !configs || configs.length === 0) return;

            // Build the payload
            const payload: OutboundWebhookPayload = {
                event: specificEvent || 'order.status_changed',
                timestamp: new Date().toISOString(),
                store_id: storeId,
                data: {
                    ...orderData,
                    previous_status: previousStatus,
                    new_status: newStatus,
                },
            };

            // Fire webhooks for each matching config
            for (const config of configs) {
                const subscribedEvents: string[] = config.events || [];

                // Check if this config subscribes to this event
                const matchesSpecific = specificEvent && subscribedEvents.includes(specificEvent);
                const matchesGeneral = subscribedEvents.includes('order.status_changed');

                if (!matchesSpecific && !matchesGeneral) continue;

                // Fire-and-forget: don't await
                this.deliverWebhook(config, payload, storeId).catch((err) => {
                    logger.error('OUTBOUND_WEBHOOK', `Delivery failed for config ${config.id}:`, err.message);
                });
            }
        } catch (err: any) {
            // Never throw — this is fire-and-forget
            logger.error('OUTBOUND_WEBHOOK', 'Error in fireOrderStatusEvent:', err.message);
        }
    }

    /**
     * Send a test webhook to verify the URL is reachable.
     * Uses only 1 attempt (no retries) for faster feedback.
     */
    static async sendTestWebhook(storeId: string, configId: string): Promise<WebhookDeliveryResult> {
        const config = await this.getConfigById(storeId, configId);
        if (!config) throw new Error('Configuración no encontrada');

        const payload: OutboundWebhookPayload = {
            event: 'test',
            timestamp: new Date().toISOString(),
            store_id: storeId,
            data: {
                message: 'This is a test webhook from Ordefy',
                config_name: config.name,
            },
        };

        return this.deliverWebhook(config, payload, storeId, true);
    }

    // ================================================================
    // Internal: HTTP Delivery with Retry
    // ================================================================

    private static async deliverWebhook(
        config: Pick<OutboundWebhookConfig, 'id' | 'url' | 'signing_secret' | 'custom_headers'>,
        payload: OutboundWebhookPayload,
        storeId: string,
        isTest = false
    ): Promise<WebhookDeliveryResult> {
        const payloadStr = JSON.stringify(payload);
        const signature = this.signPayload(payloadStr, config.signing_secret);
        const maxAttempts = isTest ? 1 : 3; // No retries for test webhooks
        let lastError: string | null = null;
        let responseStatus: number | undefined;
        let responseBody: string | undefined;
        let attempts = 0;
        const startTime = Date.now();

        // Sanitize custom headers (strip blocked headers)
        const safeCustomHeaders = sanitizeCustomHeaders(config.custom_headers || {});

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            attempts = attempt;
            try {
                // Custom headers spread first so system headers always win
                const headers: Record<string, string> = {
                    ...safeCustomHeaders,
                    'Content-Type': 'application/json',
                    'User-Agent': 'Ordefy-Webhook/1.0',
                    'X-Webhook-Signature': `sha256=${signature}`,
                    'X-Webhook-Event': payload.event,
                    'X-Webhook-Delivery-Id': crypto.randomUUID(),
                };

                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

                const response = await fetch(config.url, {
                    method: 'POST',
                    headers,
                    body: payloadStr,
                    signal: controller.signal,
                    redirect: 'manual', // Prevent SSRF via redirect to internal IPs
                });

                responseStatus = response.status;

                // Read response body with size limit (max 4KB)
                // Keep timeout alive during body read to prevent slow-trickle DoS
                let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
                try {
                    reader = response.body?.getReader();
                    if (reader) {
                        const chunks: Uint8Array[] = [];
                        let totalSize = 0;
                        const maxResponseSize = 4096;

                        while (totalSize < maxResponseSize) {
                            const { done, value } = await reader.read();
                            if (done) break;
                            chunks.push(value);
                            totalSize += value.length;
                        }
                        const decoder = new TextDecoder();
                        responseBody = chunks.map(c => decoder.decode(c, { stream: true })).join('');
                        if (totalSize >= maxResponseSize) {
                            responseBody = responseBody.substring(0, maxResponseSize) + '...(truncated)';
                        }
                    } else {
                        responseBody = '';
                    }
                } catch {
                    responseBody = '(could not read response)';
                } finally {
                    reader?.cancel().catch(() => {});
                    clearTimeout(timeout); // Clear timeout AFTER body read completes
                }

                if (response.ok) {
                    const durationMs = Date.now() - startTime;
                    const result: WebhookDeliveryResult = {
                        config_id: config.id,
                        status: 'success',
                        response_status: responseStatus,
                        response_body: responseBody,
                        duration_ms: durationMs,
                        attempts,
                    };

                    this.logDelivery(config.id, storeId, payload.event, payload, result).catch(() => {});
                    return result;
                }

                // Non-2xx response — retry on 5xx, fail on 4xx
                lastError = `HTTP ${responseStatus}: ${responseBody?.substring(0, 200)}`;
                if (responseStatus < 500) break; // Don't retry client errors

            } catch (err: any) {
                lastError = err.name === 'AbortError'
                    ? 'Request timeout (10s)'
                    : err.message || 'Unknown error';
            }

            // Exponential backoff before retry: 1s, 2s, 4s
            if (attempt < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt - 1) * 1000));
            }
        }

        // All attempts failed
        const durationMs = Date.now() - startTime;
        const result: WebhookDeliveryResult = {
            config_id: config.id,
            status: 'failed',
            response_status: responseStatus,
            error_message: lastError || 'Unknown error',
            duration_ms: durationMs,
            attempts,
        };

        this.logDelivery(config.id, storeId, payload.event, payload, result).catch(() => {});

        if (!isTest) {
            logger.warn('OUTBOUND_WEBHOOK', `Webhook delivery failed after ${attempts} attempts`, {
                config_id: config.id,
                url: config.url,
                event: payload.event,
                error: lastError,
            });
        }

        return result;
    }

    /**
     * Log a delivery attempt to the database.
     */
    private static async logDelivery(
        configId: string,
        storeId: string,
        event: string,
        payload: OutboundWebhookPayload,
        result: WebhookDeliveryResult
    ): Promise<void> {
        try {
            await supabaseAdmin
                .from('outbound_webhook_deliveries')
                .insert({
                    config_id: configId,
                    store_id: storeId,
                    event,
                    payload,
                    status: result.status,
                    response_status: result.response_status || null,
                    response_body: result.response_body?.substring(0, 4000) || null,
                    error_message: result.error_message || null,
                    attempts: result.attempts,
                    completed_at: new Date().toISOString(),
                    duration_ms: result.duration_ms,
                });
        } catch (err: any) {
            logger.error('OUTBOUND_WEBHOOK', 'Failed to log delivery:', err.message);
        }
    }
}

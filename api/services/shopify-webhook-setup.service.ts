// ================================================================
// SHOPIFY WEBHOOK SETUP SERVICE
// ================================================================
// Registra webhooks automáticamente en Shopify cuando se configura
// la integración desde el dashboard de Ordefy
// ================================================================

import { ShopifyClientService } from './shopify-client.service';
import { ShopifyIntegration } from '../types/shopify';

interface WebhookConfig {
  topic: string;
  address: string;
  description: string;
}

export class ShopifyWebhookSetupService {
  private shopifyClient: ShopifyClientService;
  private integration: ShopifyIntegration;
  private apiUrl: string;

  constructor(integration: ShopifyIntegration) {
    this.integration = integration;
    this.shopifyClient = new ShopifyClientService(integration);

    // Get API_URL from environment (ngrok URL or production URL)
    this.apiUrl = process.env.API_URL || 'http://localhost:3001';

    console.log(`🔌 [WEBHOOK-SETUP] Initialized for shop: ${integration.shop_domain}`);
    console.log(`🔌 [WEBHOOK-SETUP] API URL: ${this.apiUrl}`);
  }

  /**
   * Setup all required webhooks for Shopify integration
   * Returns list of registered webhooks
   */
  async setupWebhooks(): Promise<{
    success: boolean;
    registered: string[];
    errors: string[];
    skipped: string[];
  }> {
    const registered: string[] = [];
    const errors: string[] = [];
    const skipped: string[] = [];

    try {
      console.log('🔌 [WEBHOOK-SETUP] Starting webhook setup...');

      // Define webhooks to register
      const webhooksToRegister: WebhookConfig[] = [
        {
          topic: 'orders/create',
          address: `${this.apiUrl}/api/shopify/webhook/orders-create`,
          description: 'New order created'
        },
        {
          topic: 'orders/updated',
          address: `${this.apiUrl}/api/shopify/webhook/orders-updated`,
          description: 'Order updated'
        },
        {
          topic: 'products/delete',
          address: `${this.apiUrl}/api/shopify/webhook/products-delete`,
          description: 'Product deleted'
        }
      ];

      // Step 1: Get existing webhooks
      console.log('📋 [WEBHOOK-SETUP] Fetching existing webhooks...');
      const existingWebhooks = await this.shopifyClient.listWebhooks();
      console.log(`📋 [WEBHOOK-SETUP] Found ${existingWebhooks.length} existing webhooks`);

      // Step 2: Register each webhook
      for (const webhookConfig of webhooksToRegister) {
        try {
          // Check if webhook already exists
          const existingWebhook = existingWebhooks.find(
            (w: any) => w.topic === webhookConfig.topic && w.address === webhookConfig.address
          );

          if (existingWebhook) {
            console.log(`⏭️  [WEBHOOK-SETUP] Webhook already exists: ${webhookConfig.topic}`);
            skipped.push(webhookConfig.topic);
            continue;
          }

          // Check if there's an old webhook with same topic but different address
          const oldWebhook = existingWebhooks.find(
            (w: any) => w.topic === webhookConfig.topic && w.address !== webhookConfig.address
          );

          if (oldWebhook) {
            console.log(`🗑️  [WEBHOOK-SETUP] Deleting old webhook: ${webhookConfig.topic} (${oldWebhook.address})`);
            await this.shopifyClient.deleteWebhook(oldWebhook.id.toString());
          }

          // Create new webhook
          console.log(`✨ [WEBHOOK-SETUP] Creating webhook: ${webhookConfig.topic}`);
          console.log(`   Address: ${webhookConfig.address}`);

          await this.shopifyClient.createWebhook(
            webhookConfig.topic,
            webhookConfig.address
          );

          registered.push(webhookConfig.topic);
          console.log(`✅ [WEBHOOK-SETUP] Registered: ${webhookConfig.topic}`);

        } catch (error: any) {
          console.error(`❌ [WEBHOOK-SETUP] Error registering ${webhookConfig.topic}:`, error.message);
          errors.push(`${webhookConfig.topic}: ${error.message}`);
        }
      }

      // Step 3: Summary
      console.log('📊 [WEBHOOK-SETUP] Summary:');
      console.log(`   ✅ Registered: ${registered.length}`);
      console.log(`   ⏭️  Skipped: ${skipped.length}`);
      console.log(`   ❌ Errors: ${errors.length}`);

      return {
        success: errors.length === 0,
        registered,
        errors,
        skipped
      };

    } catch (error: any) {
      console.error('❌ [WEBHOOK-SETUP] Fatal error:', error.message);
      return {
        success: false,
        registered,
        errors: [error.message],
        skipped
      };
    }
  }

  /**
   * Verify that all webhooks are properly configured
   * Returns list of missing or misconfigured webhooks
   */
  async verifyWebhooks(): Promise<{
    valid: boolean;
    missing: string[];
    misconfigured: Array<{ topic: string; expected: string; actual: string }>;
  }> {
    const missing: string[] = [];
    const misconfigured: Array<{ topic: string; expected: string; actual: string }> = [];

    try {
      console.log('🔍 [WEBHOOK-SETUP] Verifying webhooks...');

      const existingWebhooks = await this.shopifyClient.listWebhooks();

      const expectedWebhooks = [
        { topic: 'orders/create', address: `${this.apiUrl}/api/shopify/webhook/orders-create` },
        { topic: 'orders/updated', address: `${this.apiUrl}/api/shopify/webhook/orders-updated` },
        { topic: 'products/delete', address: `${this.apiUrl}/api/shopify/webhook/products-delete` }
      ];

      for (const expected of expectedWebhooks) {
        const webhook = existingWebhooks.find((w: any) => w.topic === expected.topic);

        if (!webhook) {
          console.log(`❌ [WEBHOOK-SETUP] Missing: ${expected.topic}`);
          missing.push(expected.topic);
        } else if (webhook.address !== expected.address) {
          console.log(`⚠️  [WEBHOOK-SETUP] Misconfigured: ${expected.topic}`);
          console.log(`   Expected: ${expected.address}`);
          console.log(`   Actual: ${webhook.address}`);
          misconfigured.push({
            topic: expected.topic,
            expected: expected.address,
            actual: webhook.address
          });
        } else {
          console.log(`✅ [WEBHOOK-SETUP] Valid: ${expected.topic}`);
        }
      }

      return {
        valid: missing.length === 0 && misconfigured.length === 0,
        missing,
        misconfigured
      };

    } catch (error: any) {
      console.error('❌ [WEBHOOK-SETUP] Error verifying webhooks:', error.message);
      return {
        valid: false,
        missing: [],
        misconfigured: []
      };
    }
  }

  /**
   * Remove all webhooks for this integration
   * Useful for cleanup or reset
   */
  async removeAllWebhooks(): Promise<{
    success: boolean;
    removed: number;
    errors: string[];
  }> {
    const errors: string[] = [];
    let removed = 0;

    try {
      console.log('🗑️  [WEBHOOK-SETUP] Removing all webhooks...');

      const existingWebhooks = await this.shopifyClient.listWebhooks();
      console.log(`📋 [WEBHOOK-SETUP] Found ${existingWebhooks.length} webhooks to remove`);

      for (const webhook of existingWebhooks) {
        try {
          console.log(`🗑️  [WEBHOOK-SETUP] Deleting: ${webhook.topic} (ID: ${webhook.id})`);
          await this.shopifyClient.deleteWebhook(webhook.id.toString());
          removed++;
          console.log(`✅ [WEBHOOK-SETUP] Deleted: ${webhook.topic}`);
        } catch (error: any) {
          console.error(`❌ [WEBHOOK-SETUP] Error deleting ${webhook.topic}:`, error.message);
          errors.push(`${webhook.topic}: ${error.message}`);
        }
      }

      console.log(`📊 [WEBHOOK-SETUP] Removed ${removed} webhooks`);

      return {
        success: errors.length === 0,
        removed,
        errors
      };

    } catch (error: any) {
      console.error('❌ [WEBHOOK-SETUP] Fatal error:', error.message);
      return {
        success: false,
        removed,
        errors: [error.message]
      };
    }
  }
}

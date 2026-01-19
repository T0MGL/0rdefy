import { logger } from '../utils/logger';
import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { supabaseAdmin } from '../db/connection';

export interface ShopifyWebhookRequest extends Request {
  shopDomain?: string;
  integration?: any;
  rawBody?: string;
}

/**
 * Middleware to validate Shopify webhook HMAC signatures
 * Must be used AFTER rawBody middleware that sets req.rawBody
 */
export async function validateShopifyWebhook(
  req: ShopifyWebhookRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const shopDomain = req.get('X-Shopify-Shop-Domain');
    const hmacHeader = req.get('X-Shopify-Hmac-Sha256');

    if (!shopDomain) {
      logger.error('BACKEND', '❌ Webhook missing X-Shopify-Shop-Domain header');
      return res.status(401).json({ error: 'Missing shop domain header' });
    }

    if (!hmacHeader) {
      logger.error('BACKEND', '❌ Webhook missing X-Shopify-Hmac-Sha256 header');
      return res.status(401).json({ error: 'Missing HMAC header' });
    }

    // Get integration by shop domain to retrieve API secret
    const { data: integration, error } = await supabaseAdmin
      .from('shopify_integrations')
      .select('*')
      .eq('shop_domain', shopDomain)
      .single();

    if (error || !integration) {
      logger.error('BACKEND', '❌ Integration not found for domain:', shopDomain);
      return res.status(404).json({ error: 'Integration not found' });
    }

    // Use rawBody for HMAC validation (set by rawBody middleware in api/index.ts)
    const rawBody = req.rawBody || JSON.stringify(req.body);
    const secret = process.env.SHOPIFY_API_SECRET || integration.api_secret_key;

    if (!secret) {
      logger.error('BACKEND', '❌ SHOPIFY_API_SECRET not configured');
      return res.status(500).json({ error: 'Webhook secret not configured' });
    }

    // Verify HMAC signature
    const isValid = verifyHmacSignature(rawBody, hmacHeader, secret);

    if (!isValid) {
      logger.error('BACKEND', '❌ Invalid HMAC signature for webhook from:', shopDomain);
      return res.status(401).json({ error: 'Invalid HMAC signature' });
    }

    // Attach integration and shop domain to request for downstream use
    req.shopDomain = shopDomain;
    req.integration = integration;

    logger.info('BACKEND', `✅ Valid webhook from: ${shopDomain}`);
    next();

  } catch (error: any) {
    logger.error('BACKEND', '❌ Error validating webhook:', error);
    // Always return 200 to Shopify to prevent retry storms
    return res.status(200).json({ error: 'Internal error', received: true });
  }
}

/**
 * Verify Shopify HMAC signature using timing-safe comparison
 */
function verifyHmacSignature(body: string, hmacHeader: string, secret: string): boolean {
  try {
    const hash = crypto
      .createHmac('sha256', secret)
      .update(body, 'utf8')
      .digest('base64');

    return crypto.timingSafeEqual(
      Buffer.from(hash),
      Buffer.from(hmacHeader)
    );
  } catch (error) {
    logger.error('BACKEND', 'Error verifying HMAC:', error);
    return false;
  }
}

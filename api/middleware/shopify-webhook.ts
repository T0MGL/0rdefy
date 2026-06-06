import { logger } from '../utils/logger';
import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { supabaseAdmin } from '../db/connection';

export interface ShopifyWebhookIntegration {
  id: string;
  store_id: string;
  api_secret_key: string | null;
}

export interface ShopifyWebhookRequest extends Request {
  shopDomain?: string;
  integration?: ShopifyWebhookIntegration | null;
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

    // Get integration by shop domain to retrieve API secret. Lookup is
    // intentionally without status filter: GDPR webhooks (customers/redact,
    // shop/redact) can arrive up to 30 days after uninstall, when the row
    // is already in status='uninstalled' or 'redacted' with credentials
    // nulled. We still want to validate HMAC using SHOPIFY_API_SECRET
    // from env in those cases.
    const { data: integration } = await supabaseAdmin
      .from('shopify_integrations')
      .select('id, store_id, api_secret_key')
      .eq('shop_domain', shopDomain)
      .maybeSingle<ShopifyWebhookIntegration>();

    // Use rawBody for HMAC validation (set by rawBody middleware in api/index.ts)
    const rawBody = req.rawBody || JSON.stringify(req.body);
    const secret = process.env.SHOPIFY_API_SECRET || integration?.api_secret_key;

    if (!secret) {
      logger.error('BACKEND', 'SHOPIFY_API_SECRET not configured');
      return res.status(500).json({ error: 'Webhook secret not configured' });
    }

    // Verify HMAC signature
    const isValid = verifyHmacSignature(rawBody, hmacHeader, secret);

    if (!isValid) {
      logger.error('BACKEND', 'Invalid HMAC signature for webhook from:', shopDomain);
      return res.status(401).json({ error: 'Invalid HMAC signature' });
    }

    // Attach integration (may be null for post-redact GDPR webhooks) and
    // shop domain to request for downstream use. Handlers must tolerate
    // a null integration since redacted shops have no row left.
    req.shopDomain = shopDomain;
    req.integration = integration ?? null;

    logger.info('BACKEND', `Valid webhook from: ${shopDomain}`);
    next();

  } catch (error: unknown) {
    logger.error('BACKEND', '❌ Error validating webhook:', error);
    // Always return 200 to Shopify to prevent retry storms
    return res.status(200).json({ error: 'Internal error', received: true });
  }
}

/**
 * Verify Shopify HMAC signature using timing-safe comparison.
 *
 * Returns false (not throws) for any failure mode so the caller's
 * 401 response is uniform. Length mismatch is checked up-front
 * because crypto.timingSafeEqual throws on differing-length buffers,
 * which would leak timing information through the exception path.
 */
function verifyHmacSignature(body: string, hmacHeader: string, secret: string): boolean {
  try {
    const hash = crypto
      .createHmac('sha256', secret)
      .update(body, 'utf8')
      .digest('base64');

    const hashBuf = Buffer.from(hash);
    const headerBuf = Buffer.from(hmacHeader);

    if (hashBuf.length !== headerBuf.length) {
      return false;
    }

    return crypto.timingSafeEqual(hashBuf, headerBuf);
  } catch (error) {
    logger.error('BACKEND', 'Error verifying HMAC:', error);
    return false;
  }
}

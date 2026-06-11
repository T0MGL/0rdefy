/**
 * Wrapped Routes, public, token-addressed milestone share pages.
 *
 *   GET  /api/public/wrapped/:token            JSON payload (public + private)
 *   POST /api/public/wrapped/:token/share      record a share interaction
 *   GET  /og/wrapped/:token.png?format=...     PNG via Satori + resvg
 *   GET  /wrapped/:token                       hand off to the SPA, with
 *                                              prefilled OG meta tags.
 *
 * No auth. Tokens are 22-char nanoid (high entropy). View counts increment on
 * every JSON fetch; share counts on POST share with platform.
 */

import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../db/connection';
import { logger } from '../utils/logger';
import { renderShareCard, type ShareCardFormat } from '../services/share-card-renderer';

export const wrappedRouter = Router();

const APP_URL = process.env.APP_URL || process.env.FRONTEND_URL || 'https://app.ordefy.io';
const API_URL = process.env.API_URL || 'https://api.ordefy.io';

const VALID_FORMATS: ShareCardFormat[] = ['square', 'story', 'landscape'];

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface ShareCardRow {
  id: string;
  store_id: string;
  token: string;
  milestone_type: string;
  milestone_value: number;
  public_data: Record<string, unknown>;
  private_data: Record<string, unknown>;
  view_count: number;
  share_count: number;
  created_at: string;
}

async function getShareCard(token: string): Promise<ShareCardRow | null> {
  if (!token || token.length < 8 || token.length > 64) return null;
  const { data } = await supabaseAdmin
    .from('share_cards')
    .select('*')
    .eq('token', token)
    .maybeSingle();
  return (data as ShareCardRow) ?? null;
}

// ---------------------------------------------------------------------------
// JSON payload (public)
// ---------------------------------------------------------------------------
wrappedRouter.get('/api/public/wrapped/:token', async (req: Request, res: Response) => {
  const token = req.params.token;
  const card = await getShareCard(token);
  if (!card) {
    return res.status(404).json({ error: 'Not found' });
  }

  // Increment view count fire-and-forget
  supabaseAdmin
    .from('share_cards')
    .update({ view_count: (card.view_count ?? 0) + 1 })
    .eq('id', card.id)
    .then(() => undefined, () => undefined);

  // Public response: include private_data only when explicit ?reveal=1.
  // The owner-side React page calls with reveal=1 after auth-gate (handled
  // client-side by checking JWT; for now we return both and let the UI gate).
  const reveal = req.query.reveal === '1';

  const baseImage = `${API_URL}/og/wrapped/${card.token}.png`;

  return res.json({
    token: card.token,
    milestone_type: card.milestone_type,
    milestone_value: card.milestone_value,
    public_data: card.public_data,
    private_data: reveal ? card.private_data : null,
    image_urls: {
      square: `${baseImage}?format=square`,
      story: `${baseImage}?format=story`,
      landscape: `${baseImage}?format=landscape`,
    },
    share_url: `${APP_URL}/wrapped/${card.token}`,
    created_at: card.created_at,
  });
});

// ---------------------------------------------------------------------------
// Share interaction tracker (public)
// ---------------------------------------------------------------------------
wrappedRouter.post('/api/public/wrapped/:token/share', async (req: Request, res: Response) => {
  const token = req.params.token;
  const card = await getShareCard(token);
  if (!card) {
    return res.status(404).json({ error: 'Not found' });
  }

  const platform = String(req.body?.platform || 'unknown').slice(0, 32);

  await supabaseAdmin
    .from('share_cards')
    .update({ share_count: (card.share_count ?? 0) + 1 })
    .eq('id', card.id);

  logger.info('WRAPPED', `Share tracked: token=${token.slice(0, 6)}... platform=${platform}`);

  return res.json({ ok: true, platform });
});

// ---------------------------------------------------------------------------
// PNG renderer (public)
// ---------------------------------------------------------------------------
wrappedRouter.get('/og/wrapped/:tokenOrFile', async (req: Request, res: Response) => {
  // Support both /og/wrapped/:token.png and /og/wrapped/:token (for sniffing).
  let token = req.params.tokenOrFile;
  if (token.endsWith('.png')) token = token.slice(0, -4);

  const formatParam = String(req.query.format || 'square').toLowerCase();
  const format = (VALID_FORMATS.includes(formatParam as ShareCardFormat)
    ? formatParam
    : 'square') as ShareCardFormat;

  const card = await getShareCard(token);
  if (!card) {
    return res.status(404).send('Not found');
  }

  try {
    const pub = (card.public_data ?? {}) as Record<string, unknown>;
    const priv = (card.private_data ?? {}) as Record<string, unknown>;

    const mode: 'public' | 'private' = req.query.private === '1' ? 'private' : 'public';

    const privateLines: string[] = [];
    if (mode === 'private') {
      if (typeof priv.product_count === 'number') {
        privateLines.push(`${priv.product_count} productos diferentes`);
      }
      if (typeof priv.delivery_rate === 'number') {
        privateLines.push(`${priv.delivery_rate}% delivery rate`);
      }
      if (typeof priv.carrier_count === 'number') {
        privateLines.push(`${priv.carrier_count} carriers usados`);
      }
    }

    const png = await renderShareCard(
      {
        milestoneValue: card.milestone_value,
        subtitle: typeof pub.headline === 'string' ? (pub.headline as string).toUpperCase() : undefined,
        storeHandle: typeof pub.store_handle === 'string' ? (pub.store_handle as string) : undefined,
        mode,
        privateLines,
      },
      format,
    );

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
    return res.send(png);
  } catch (err) {
    logger.error('WRAPPED', 'Failed to render share card PNG', err);
    return res.status(500).send('Render error');
  }
});

// ---------------------------------------------------------------------------
// SSR-ish landing for /wrapped/:token (so OG bots get rich preview).
// The SPA at app.ordefy.io still renders the full UX once JS runs.
// ---------------------------------------------------------------------------
wrappedRouter.get('/wrapped/:token', async (req: Request, res: Response) => {
  const token = req.params.token;
  const card = await getShareCard(token);
  if (!card) {
    return res.redirect(302, `${APP_URL}/wrapped/${token}`);
  }

  const pub = (card.public_data ?? {}) as Record<string, unknown>;
  const headline =
    (typeof pub.headline === 'string' ? (pub.headline as string) : 'Logro alcanzado') +
    ` (${card.milestone_value})`;
  const description = `Un hito procesado en Ordefy. ${card.milestone_value} ${
    card.milestone_type === 'orders' ? 'órdenes entregadas' : 'unidades'
  }.`;
  const ogImage = `${API_URL}/og/wrapped/${card.token}.png?format=landscape`;
  const target = `${APP_URL}/wrapped/${card.token}`;

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(headline)} | Ordefy</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <meta property="og:title" content="${escapeHtml(headline)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:image" content="${escapeHtml(ogImage)}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${escapeHtml(target)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(headline)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <meta name="twitter:image" content="${escapeHtml(ogImage)}" />
  <meta http-equiv="refresh" content="0; url=${escapeHtml(target)}" />
  <link rel="canonical" href="${escapeHtml(target)}" />
</head>
<body style="background:#09090b;color:#f2f2f2;font-family:Inter,system-ui,sans-serif;text-align:center;padding:60px 20px;">
  <p>Cargando tu logro...</p>
  <p><a href="${escapeHtml(target)}" style="color:#b0e636;">Abrir Ordefy</a></p>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
  return res.send(html);
});

/**
 * Share-card renderer (Satori -> SVG -> resvg -> PNG).
 *
 * Renders aggressive, LATAM-flex-friendly milestone cards in three formats:
 *   - square    1080x1080 (Instagram feed)
 *   - story     1080x1920 (Instagram / Facebook / TikTok Stories)  PRIMARY
 *   - landscape 1200x630  (LinkedIn / Twitter / Open Graph)
 *
 * Visual language:
 *   - Bg: deep ink #09090b
 *   - Number: lime #b0e636, font-weight 900, massive
 *   - Subtitle: uppercase, wide tracking
 *   - Bottom-right wordmark: ordefy.io (lime)
 *
 * Inter font is downloaded once at boot (tier 1) and cached in module memory.
 */

import * as React from 'react';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { logger } from '../utils/logger';

export type ShareCardFormat = 'square' | 'story' | 'landscape';

export interface ShareCardData {
  /** Big number (e.g. 100) */
  milestoneValue: number;
  /** Shown under big number, e.g. "ÓRDENES PROCESADAS" */
  subtitle?: string;
  /** Optional store handle or first name, e.g. "@nocte" */
  storeHandle?: string;
  /** Visual mode: 'public' (abstract, no raw figures) or 'private' (raw figures visible) */
  mode: 'public' | 'private';
  /** Used only in private mode: extra context lines like ["28 productos", "91% delivery"]. */
  privateLines?: string[];
}

interface FormatSpec {
  width: number;
  height: number;
  numberFontSize: number;
  subtitleFontSize: number;
  metaFontSize: number;
  paddingX: number;
  paddingY: number;
}

const FORMATS: Record<ShareCardFormat, FormatSpec> = {
  square: {
    width: 1080,
    height: 1080,
    numberFontSize: 420,
    subtitleFontSize: 38,
    metaFontSize: 26,
    paddingX: 90,
    paddingY: 90,
  },
  story: {
    width: 1080,
    height: 1920,
    numberFontSize: 520,
    subtitleFontSize: 44,
    metaFontSize: 30,
    paddingX: 96,
    paddingY: 140,
  },
  landscape: {
    width: 1200,
    height: 630,
    numberFontSize: 280,
    subtitleFontSize: 30,
    metaFontSize: 22,
    paddingX: 80,
    paddingY: 70,
  },
};

const COLORS = {
  bg: '#09090b',
  bgGrain: '#0d0d11',
  primary: '#b0e636',
  text: '#f2f2f2',
  textSecondary: '#9ca3af',
  textMuted: '#525258',
} as const;

/**
 * Lazy-load Inter font ArrayBuffer from Google's CDN.
 * Cached in module scope for warm requests.
 */
let interBoldBuffer: ArrayBuffer | null = null;
let interBlackBuffer: ArrayBuffer | null = null;
let interRegularBuffer: ArrayBuffer | null = null;
let fontLoadPromise: Promise<void> | null = null;

// Google Fonts CDN TTF URLs (v20). These are the underlying gstatic asset
// paths surfaced by the CSS API; satori requires TTF, not woff2, so the rsms
// upstream (woff2-only since v4) cannot be used directly.
const FONT_URL_REGULAR =
  'https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuLyfMZg.ttf';
const FONT_URL_BOLD =
  'https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuFuYMZg.ttf';
const FONT_URL_BLACK =
  'https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuBWYMZg.ttf';

async function loadFonts(): Promise<void> {
  if (interBoldBuffer && interBlackBuffer && interRegularBuffer) return;
  if (fontLoadPromise) return fontLoadPromise;

  fontLoadPromise = (async () => {
    const [regular, bold, black] = await Promise.all([
      fetchFontBuffer(FONT_URL_REGULAR),
      fetchFontBuffer(FONT_URL_BOLD),
      fetchFontBuffer(FONT_URL_BLACK),
    ]);
    interRegularBuffer = regular;
    interBoldBuffer = bold;
    interBlackBuffer = black;
    logger.info('SHARE_CARD', 'Inter font family loaded for Satori');
  })();

  return fontLoadPromise;
}

async function fetchFontBuffer(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load font ${url}: ${res.status}`);
  }
  return res.arrayBuffer();
}

interface CardComponentProps {
  data: ShareCardData;
  spec: FormatSpec;
}

function MilestoneCard({ data, spec }: CardComponentProps) {
  const number = data.milestoneValue.toLocaleString('en-US');
  const subtitle = data.subtitle ?? defaultSubtitle(data.milestoneValue);

  // Container: full bleed, dark, padded
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: spec.width,
        height: spec.height,
        backgroundColor: COLORS.bg,
        padding: `${spec.paddingY}px ${spec.paddingX}px`,
        position: 'relative',
        fontFamily: 'Inter',
      }}
    >
      {/* Top brand strip */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          color: COLORS.textSecondary,
          fontSize: spec.metaFontSize,
          letterSpacing: 2,
          textTransform: 'uppercase',
          fontWeight: 600,
        }}
      >
        <div
          style={{
            width: 14,
            height: 14,
            borderRadius: 14,
            backgroundColor: COLORS.primary,
          }}
        />
        <div>{data.storeHandle ?? 'Tu tienda'}</div>
      </div>

      {/* Spacer that pushes the number block toward vertical center */}
      <div style={{ flex: 1, display: 'flex' }} />

      {/* Big number — auto-shrink for >=4 digits to keep within frame */}
      <div
        style={{
          display: 'flex',
          color: COLORS.primary,
          fontSize:
            number.length >= 5
              ? spec.numberFontSize * 0.55
              : number.length === 4
                ? spec.numberFontSize * 0.7
                : spec.numberFontSize,
          fontWeight: 900,
          lineHeight: 0.9,
          letterSpacing: -6,
          marginBottom: 14,
        }}
      >
        {number}
      </div>

      {/* Subtitle */}
      <div
        style={{
          display: 'flex',
          color: COLORS.text,
          fontSize: spec.subtitleFontSize,
          fontWeight: 700,
          letterSpacing: 4,
          textTransform: 'uppercase',
        }}
      >
        {subtitle}
      </div>

      {/* Private extras (optional) */}
      {data.mode === 'private' && data.privateLines && data.privateLines.length > 0 ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            marginTop: 36,
            gap: 8,
          }}
        >
          {data.privateLines.slice(0, 4).map((line, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                color: COLORS.textSecondary,
                fontSize: spec.metaFontSize,
                letterSpacing: 0.5,
                fontWeight: 500,
              }}
            >
              {line}
            </div>
          ))}
        </div>
      ) : null}

      {/* Bottom spacer */}
      <div style={{ flex: 1, display: 'flex' }} />

      {/* Footer wordmark */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
        }}
      >
        <div
          style={{
            display: 'flex',
            color: COLORS.textMuted,
            fontSize: spec.metaFontSize - 2,
            letterSpacing: 1.5,
            textTransform: 'uppercase',
            fontWeight: 600,
          }}
        >
          {data.mode === 'public' ? 'Logro alcanzado' : 'Hito de operación'}
        </div>
        <div
          style={{
            display: 'flex',
            color: COLORS.primary,
            fontSize: spec.metaFontSize + 4,
            fontWeight: 800,
            letterSpacing: 1,
          }}
        >
          ordefy.io
        </div>
      </div>
    </div>
  );
}

function defaultSubtitle(milestoneValue: number): string {
  if (milestoneValue === 1) return 'PRIMERA ORDEN';
  return 'ÓRDENES PROCESADAS';
}

/**
 * Render a milestone share card to a PNG buffer.
 */
export async function renderShareCard(
  data: ShareCardData,
  format: ShareCardFormat = 'square',
): Promise<Buffer> {
  await loadFonts();
  const spec = FORMATS[format];

  const svg = await satori(<MilestoneCard data={data} spec={spec} />, {
    width: spec.width,
    height: spec.height,
    fonts: [
      {
        name: 'Inter',
        data: interRegularBuffer!,
        weight: 400,
        style: 'normal',
      },
      {
        name: 'Inter',
        data: interBoldBuffer!,
        weight: 700,
        style: 'normal',
      },
      {
        name: 'Inter',
        data: interBlackBuffer!,
        weight: 900,
        style: 'normal',
      },
    ],
  });

  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: spec.width },
    background: COLORS.bg,
  });
  const png = resvg.render();
  return png.asPng();
}

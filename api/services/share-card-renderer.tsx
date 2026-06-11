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

      {/* Big number, auto-shrink for >=4 digits to keep within frame */}
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

/* ================================================================
 * MILESTONE EMAIL HERO (hero embedded INSIDE the email)
 * ================================================================
 * Different aspect ratio than social share cards. Wide and short, fits
 * inside the 560px email container at full width without cropping.
 */

interface EmailHeroProps {
  milestoneValue: number;
  subtitle: string;
}

/**
 * GENERIC milestone hero. No personalized data here on purpose: the same
 * "100 ÓRDENES" PNG is reused across every store that hits that milestone.
 * Cached once per (milestoneValue, subtitle) pair.
 */
function EmailHero({ milestoneValue, subtitle }: EmailHeroProps) {
  const number = milestoneValue.toLocaleString('en-US');
  const numberSize =
    number.length >= 5 ? 220 : number.length === 4 ? 280 : 360;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: 1120,
        height: 520,
        backgroundColor: COLORS.bg,
        padding: '64px 72px',
        position: 'relative',
        fontFamily: 'Inter',
      }}
    >
      {/* Top brand strip */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          color: COLORS.textSecondary,
          fontSize: 22,
          letterSpacing: 3,
          textTransform: 'uppercase',
          fontWeight: 700,
        }}
      >
        <div
          style={{
            width: 12,
            height: 12,
            borderRadius: 12,
            backgroundColor: COLORS.primary,
            display: 'flex',
          }}
        />
        <div>HITO ALCANZADO</div>
      </div>

      <div style={{ flex: 1, display: 'flex' }} />

      {/* Big number */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 28,
          color: COLORS.primary,
          fontWeight: 900,
          lineHeight: 0.9,
          letterSpacing: -6,
        }}
      >
        <div style={{ display: 'flex', fontSize: numberSize }}>{number}</div>
        <div
          style={{
            display: 'flex',
            color: COLORS.text,
            fontSize: 52,
            fontWeight: 800,
            letterSpacing: -1,
          }}
        >
          {subtitle}
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex' }} />

      {/* Footer wordmark only, no personalization */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'flex-end',
        }}
      >
        <div
          style={{
            display: 'flex',
            color: COLORS.primary,
            fontSize: 26,
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

export async function renderEmailHero(args: {
  milestoneValue: number;
  subtitle?: string;
}): Promise<Buffer> {
  await loadFonts();
  const subtitle = args.subtitle ?? 'ÓRDENES';

  // Render at 1120px for retina sharpness, then downscale to 560px on output.
  // 560px native = exactly the email container width, keeps file size small
  // (~15 KB) so the MIME message stays well under Gmail's 102 KB clip line.
  const svg = await satori(
    <EmailHero milestoneValue={args.milestoneValue} subtitle={subtitle} />,
    {
      width: 1120,
      height: 520,
      fonts: [
        { name: 'Inter', data: interRegularBuffer!, weight: 400, style: 'normal' },
        { name: 'Inter', data: interBoldBuffer!, weight: 700, style: 'normal' },
        { name: 'Inter', data: interBlackBuffer!, weight: 900, style: 'normal' },
      ],
    },
  );

  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: 560 },
    background: COLORS.bg,
  });
  return resvg.render().asPng();
}

/* ================================================================
 * MILESTONE LINE CHART (orders over time)
 * ================================================================
 * Embedded inline in the email body. Shows acumulated orders progression.
 * Pure SVG paths via Satori (no recharts dep needed).
 */

interface ChartProps {
  points: Array<{ label: string; value: number }>;
  width: number;
  height: number;
  highlightLastPoint?: boolean;
}

function LineChart({ points, width, height, highlightLastPoint = true }: ChartProps) {
  const padTop = 80;
  const padBottom = 90;
  const padLeft = 60;
  const padRight = 60;
  const innerW = width - padLeft - padRight;
  const innerH = height - padTop - padBottom;

  const maxVal = Math.max(...points.map((p) => p.value), 1);
  const stepX = points.length > 1 ? innerW / (points.length - 1) : innerW;

  const coords = points.map((p, i) => ({
    x: padLeft + i * stepX,
    y: padTop + innerH - (p.value / maxVal) * innerH,
    label: p.label,
    value: p.value,
  }));

  const last = coords[coords.length - 1];

  // Build SVG children flat (no fragments, no defs, no gradients).
  // Satori SVG support is limited but reliable for primitive elements.
  const svgChildren: React.ReactNode[] = [];

  // Gridlines
  [0.25, 0.5, 0.75].forEach((frac, i) => {
    const y = padTop + innerH * frac;
    svgChildren.push(
      <line
        key={`grid-${i}`}
        x1={padLeft}
        x2={width - padRight}
        y1={y}
        y2={y}
        stroke="#1f1f26"
        strokeWidth={1}
      />,
    );
  });

  // Line segments (one <line> per pair of consecutive points)
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i];
    const b = coords[i + 1];
    svgChildren.push(
      <line
        key={`seg-${i}`}
        x1={a.x}
        y1={a.y}
        x2={b.x}
        y2={b.y}
        stroke="#b0e636"
        strokeWidth={5}
        strokeLinecap="round"
      />,
    );
  }

  // Regular dots
  coords.forEach((c, i) => {
    if (i === coords.length - 1 && highlightLastPoint) return;
    svgChildren.push(
      <circle
        key={`dot-${i}`}
        cx={c.x}
        cy={c.y}
        r={6}
        fill={COLORS.bg}
        stroke="#b0e636"
        strokeWidth={3}
      />,
    );
  });

  // Last-point highlight (bigger filled lime dot)
  if (highlightLastPoint && last) {
    svgChildren.push(
      <circle
        key="last-glow"
        cx={last.x}
        cy={last.y}
        r={18}
        fill="#b0e636"
        fillOpacity={0.18}
      />,
    );
    svgChildren.push(
      <circle
        key="last-dot"
        cx={last.x}
        cy={last.y}
        r={9}
        fill="#b0e636"
      />,
    );
  }

  // Text overlays (final tag + x-axis labels) rendered as absolutely
  // positioned divs because Satori does NOT support <text> inside <svg>.
  const labelW = 140;
  const overlays: React.ReactNode[] = [];

  if (last) {
    overlays.push(
      <div
        key="final-tag"
        style={{
          position: 'absolute',
          top: last.y - 60,
          left: last.x - labelW / 2,
          width: labelW,
          textAlign: 'center',
          color: COLORS.primary,
          fontSize: 32,
          fontWeight: 800,
          letterSpacing: -0.5,
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        {last.value.toLocaleString('en-US')}
      </div>,
    );
  }

  coords.forEach((c, i) => {
    overlays.push(
      <div
        key={`lbl-${i}`}
        style={{
          position: 'absolute',
          top: height - 60,
          left: c.x - labelW / 2,
          width: labelW,
          textAlign: 'center',
          color: COLORS.textMuted,
          fontSize: 22,
          fontWeight: 500,
          letterSpacing: 0.3,
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        {c.label}
      </div>,
    );
  });

  return (
    <div
      style={{
        display: 'flex',
        width,
        height,
        backgroundColor: COLORS.bg,
        position: 'relative',
        fontFamily: 'Inter',
      }}
    >
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        xmlns="http://www.w3.org/2000/svg"
      >
        {svgChildren}
      </svg>
      {overlays}
    </div>
  );
}

export async function renderOrdersChart(
  points: Array<{ label: string; value: number }>,
): Promise<Buffer> {
  await loadFonts();

  const width = 1120;
  const height = 480;

  const svg = await satori(
    <LineChart points={points} width={width} height={height} />,
    {
      width,
      height,
      fonts: [
        { name: 'Inter', data: interRegularBuffer!, weight: 400, style: 'normal' },
        { name: 'Inter', data: interBoldBuffer!, weight: 500, style: 'normal' },
        { name: 'Inter', data: interBoldBuffer!, weight: 700, style: 'normal' },
      ],
    },
  );

  // Downscale to 560px on output for email-friendly size (~5-8 KB).
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: 560 },
    background: COLORS.bg,
  });
  return resvg.render().asPng();
}

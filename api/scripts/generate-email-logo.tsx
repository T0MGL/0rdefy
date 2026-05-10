/**
 * One-shot logo generator for transactional emails.
 *
 * Emits two PNG variants of the `<isotipo> ordefy` wordmark via Satori +
 * Resvg (same pipeline the share-card renderer uses):
 *
 *   public/email/logo.png       transparent background, lime wordmark.
 *                                Kept for legacy callers / picture <source>.
 *   public/email/logo-dark.png   #09090b background baked in, lime wordmark.
 *                                Used by every transactional template. The
 *                                solid bg means Gmail iOS / Outlook desktop
 *                                cannot introduce a halo or a light field
 *                                around the mark when they apply forced
 *                                dark-mode color inversion.
 *
 * Both are emitted at 840x240 (3x density for the 280x80 retina display
 * target -- previous 560x160 was 2x and looked soft on iOS Mail).
 *
 * Why a generated PNG instead of inline SVG:
 *   Gmail, Outlook desktop and Yahoo aggressively strip <svg>. The only
 *   bulletproof cross-client logo is a small PNG referenced via <img src>.
 *
 * Run:  npx tsx api/scripts/generate-email-logo.tsx
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as React from 'react';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Inter font (TTF) sourced from Google's gstatic CDN (matches share-card-renderer).
const FONT_URL_BLACK =
  'https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuBWYMZg.ttf';

const LIME = '#b0e636';
const DARK_BG = '#09090b';

// Output spec: 3x density. Renders at 840x240, exports compact, scales clean
// from 0 to 280px wide on Gmail clients (the display target). 2x was visibly
// soft on iOS Mail retina; 3x lands sharp without measurably increasing the
// payload thanks to the small color palette.
const OUT_WIDTH = 840;
const OUT_HEIGHT = 240;

async function fetchFont(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load font: ${url} -> ${res.status}`);
  return res.arrayBuffer();
}

/**
 * Stacked-tiles isotipo. The shape matches the existing app favicon (three
 * horizontal lozenges stacked vertically) but vectorized inline so we avoid
 * the raster halo that the legacy 1920x544 PNG carried.
 *
 * The inline geometry is rendered through Satori's flexbox engine via SVG
 * `dangerouslySetInnerHTML` is unsupported, so we use absolutely-positioned
 * rotated squares to recreate the stacked diamonds. Visual parity is checked
 * against the live app icon at /favicon.png.
 */
function Isotipo({ size }: { size: number }) {
  // Each tile is a rounded rect rotated 45deg, stacked with vertical offset.
  // Stroke width matches the current app icon's 8% of size.
  const tileW = size * 0.6;
  const tileH = size * 0.18;
  const stroke = size * 0.08;
  const gap = size * 0.04;

  const baseTile: React.CSSProperties = {
    position: 'absolute',
    left: '50%',
    width: tileW,
    height: tileH,
    transform: 'translateX(-50%) skewX(-22deg)',
    border: `${stroke}px solid ${LIME}`,
    borderRadius: stroke / 2,
    display: 'flex',
  };

  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        display: 'flex',
      }}
    >
      <div style={{ ...baseTile, top: size * 0.18 }} />
      <div
        style={{
          ...baseTile,
          top: size * 0.18 + tileH + gap,
          backgroundColor: LIME,
          border: `${stroke}px solid ${LIME}`,
        }}
      />
      <div style={{ ...baseTile, top: size * 0.18 + (tileH + gap) * 2 }} />
    </div>
  );
}

interface WordmarkProps {
  font: ArrayBuffer;
  background: string;
}

function Wordmark({ background }: WordmarkProps) {
  // 3x scale: icon, type and gap all multiplied from the 2x baseline so the
  // visual proportions are preserved.
  const iconSize = 165;

  return (
    <div
      style={{
        width: OUT_WIDTH,
        height: OUT_HEIGHT,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-start',
        gap: 36,
        padding: '0 48px',
        backgroundColor: background,
        fontFamily: 'Inter',
      }}
    >
      <Isotipo size={iconSize} />
      <div
        style={{
          color: LIME,
          fontSize: 144,
          fontWeight: 900,
          letterSpacing: -4,
          lineHeight: 1,
          paddingBottom: 12,
        }}
      >
        ordefy
      </div>
    </div>
  );
}

async function renderVariant(
  font: ArrayBuffer,
  bg: string,
  resvgBg: string,
): Promise<Uint8Array> {
  const svg = await satori(<Wordmark font={font} background={bg} />, {
    width: OUT_WIDTH,
    height: OUT_HEIGHT,
    fonts: [
      {
        name: 'Inter',
        data: font,
        weight: 900,
        style: 'normal',
      },
    ],
  });

  return new Resvg(svg, {
    fitTo: { mode: 'width', value: OUT_WIDTH },
    background: resvgBg,
  })
    .render()
    .asPng();
}

async function main() {
  console.log('Loading Inter Black from gstatic...');
  const font = await fetchFont(FONT_URL_BLACK);

  const outDir = path.resolve(__dirname, '../../public/email');
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`Rendering ${OUT_WIDTH}x${OUT_HEIGHT} transparent wordmark...`);
  const transparentPng = await renderVariant(
    font,
    'rgba(0,0,0,0)',
    'rgba(0,0,0,0)',
  );
  const transparentPath = path.join(outDir, 'logo.png');
  fs.writeFileSync(transparentPath, transparentPng);
  console.log(`  -> ${transparentPath} (${transparentPng.length} bytes)`);

  console.log(`Rendering ${OUT_WIDTH}x${OUT_HEIGHT} dark-baked wordmark...`);
  const darkPng = await renderVariant(font, DARK_BG, DARK_BG);
  const darkPath = path.join(outDir, 'logo-dark.png');
  fs.writeFileSync(darkPath, darkPng);
  console.log(`  -> ${darkPath} (${darkPng.length} bytes)`);

  // Mirrors for offline previews.
  fs.writeFileSync('/tmp/ordefy-email-logo.png', transparentPng);
  fs.writeFileSync('/tmp/ordefy-email-logo-dark.png', darkPng);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

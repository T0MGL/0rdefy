/**
 * One-shot logo generator for transactional emails.
 *
 * Renders a clean wordmark (`<isotipo> ordefy`) on transparent background using
 * Satori (the same Inter font tier the share-card renderer uses) and emits a
 * single PNG into `public/email/logo.png`. The asset is then served from
 * https://app.ordefy.io/email/logo.png and embedded by every transactional
 * template.
 *
 * Why a generated PNG instead of inline SVG:
 *   Gmail, Outlook desktop and Yahoo aggressively strip <svg>. The only
 *   bulletproof cross-client logo is a small, transparent PNG referenced via
 *   <img src>. This script regenerates it deterministically so we never end up
 *   with the previous halo/aberration artifacts that the legacy 1920x544
 *   raster carried.
 *
 * Run:  npx tsx api/scripts/generate-email-logo.ts
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

// Output spec: 2x density. Renders at 560x160, exports compact, scales clean
// from 0 to 280px wide on Gmail clients.
const OUT_WIDTH = 560;
const OUT_HEIGHT = 160;

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

function Wordmark({ font }: { font: ArrayBuffer }) {
  const iconSize = 110;

  return (
    <div
      style={{
        width: OUT_WIDTH,
        height: OUT_HEIGHT,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-start',
        gap: 24,
        padding: '0 32px',
        // Transparent background — the email layout supplies the dark canvas.
        backgroundColor: 'rgba(0,0,0,0)',
        fontFamily: 'Inter',
      }}
    >
      <Isotipo size={iconSize} />
      <div
        style={{
          color: LIME,
          fontSize: 96,
          fontWeight: 900,
          letterSpacing: -3,
          lineHeight: 1,
          // Force the 'y' descender to render fully inside the canvas.
          paddingBottom: 8,
        }}
      >
        ordefy
      </div>
    </div>
  );
}

async function main() {
  console.log('Loading Inter Black from gstatic...');
  const font = await fetchFont(FONT_URL_BLACK);

  console.log(`Rendering ${OUT_WIDTH}x${OUT_HEIGHT} wordmark via Satori...`);
  const svg = await satori(<Wordmark font={font} />, {
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

  const png = new Resvg(svg, {
    fitTo: { mode: 'width', value: OUT_WIDTH },
    background: 'rgba(0,0,0,0)',
  })
    .render()
    .asPng();

  const outDir = path.resolve(__dirname, '../../public/email');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'logo.png');
  fs.writeFileSync(outPath, png);

  // Also drop a 1x mirror for tests / preview.
  fs.writeFileSync('/tmp/ordefy-email-logo.png', png);

  console.log(`Wrote ${png.length} bytes -> ${outPath}`);
  console.log(`Mirror: /tmp/ordefy-email-logo.png`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

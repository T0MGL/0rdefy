/**
 * Build the email-ready Ordefy wordmark from the production favicon asset.
 *
 * Source: public/favicon.png (1920x544). The asset packs the stacked-tile
 * isotipo on the left and the "ordefy" wordmark on the right, with the
 * wordmark rendered in the brand's custom display face (not Inter, not a
 * system stack). The asset also carries a glassy gradient that fades the
 * lower half of each glyph toward near-white. The gradient is fine on the
 * dark app surface but disappears against the light email canvas, leaving
 * letters that look half-erased.
 *
 * What this script does:
 *   1. Extract the wordmark region (text only, no isotipo).
 *   2. Repaint every non-transparent pixel to the solid brand lime
 *      (#b0e636), keeping the original alpha channel so the custom
 *      letterform survives.
 *   3. Trim residual transparent margins.
 *   4. Resize to a 2x retina target (560x ~ for an 80px tall display).
 *   5. Emit two files. Both are visually identical because solid lime
 *      reads correctly on light (#fafafa) and dark (#09090b) email surfaces:
 *
 *        public/email/logo.png         transparent bg, solid lime wordmark.
 *        public/email/logo-on-dark.png same artwork, kept as a stable URL
 *                                      for any caller that wants a "dark
 *                                      surface" variant. Identical bytes
 *                                      to logo.png today; if a future
 *                                      design ever needs a different mark
 *                                      on dark surfaces, this file is the
 *                                      hook.
 *
 * Run:  npx tsx api/scripts/crop-ordefy-wordmark.tsx
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SRC = path.resolve(__dirname, '../../public/favicon.png');
const OUT_DIR = path.resolve(__dirname, '../../public/email');

const LIME = { r: 0xb0, g: 0xe6, b: 0x36 };
const ALPHA_THRESHOLD = 32;

const TARGET_WIDTH = 560;

async function main() {
  if (!fs.existsSync(SRC)) {
    throw new Error(`Source favicon not found at ${SRC}`);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const src = sharp(SRC);
  const { data, info } = await src
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const W = info.width;
  const H = info.height;
  const C = info.channels;
  if (C !== 4) {
    throw new Error(`Expected RGBA source; got ${C} channels`);
  }

  const textBox = findTextBoundingBox(data, W, H, C);
  if (!textBox) {
    throw new Error('Could not locate wordmark text region in favicon');
  }

  const { x0, y0, x1, y1 } = textBox;
  const cropW = x1 - x0 + 1;
  const cropH = y1 - y0 + 1;

  const recolored = recolorToLime(data, W, H, C, x0, y0, cropW, cropH);

  const targetH = Math.round((cropH / cropW) * TARGET_WIDTH);

  const out = await sharp(recolored, {
    raw: { width: cropW, height: cropH, channels: 4 },
  })
    .resize({ width: TARGET_WIDTH, height: targetH, fit: 'fill' })
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();

  const outPath = path.join(OUT_DIR, 'logo.png');
  const onDarkPath = path.join(OUT_DIR, 'logo-on-dark.png');

  fs.writeFileSync(outPath, out);
  fs.writeFileSync(onDarkPath, out);

  fs.writeFileSync('/tmp/ordefy-email-logo.png', out);

  const oldDarkPath = path.join(OUT_DIR, 'logo-dark.png');
  if (fs.existsSync(oldDarkPath)) {
    fs.unlinkSync(oldDarkPath);
    console.log(`  pruned ${oldDarkPath} (legacy generated asset)`);
  }

  console.log(
    `wordmark cropped from ${SRC}\n` +
      `  src bbox    x=${x0}-${x1} y=${y0}-${y1} (${cropW}x${cropH})\n` +
      `  resized to  ${TARGET_WIDTH}x${targetH}\n` +
      `  -> ${outPath} (${out.length} bytes)\n` +
      `  -> ${onDarkPath} (${out.length} bytes)`,
  );
}

interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function findTextBoundingBox(
  data: Buffer,
  W: number,
  H: number,
  C: number,
): BBox | null {
  const colHasContent = new Uint8Array(W);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      const i = (y * W + x) * C;
      if (data[i + 3] > ALPHA_THRESHOLD) {
        colHasContent[x] = 1;
        break;
      }
    }
  }

  type Run = { start: number; end: number };
  const runs: Run[] = [];
  let runStart = -1;
  for (let x = 0; x < W; x++) {
    if (colHasContent[x] && runStart < 0) runStart = x;
    else if (!colHasContent[x] && runStart >= 0) {
      runs.push({ start: runStart, end: x - 1 });
      runStart = -1;
    }
  }
  if (runStart >= 0) runs.push({ start: runStart, end: W - 1 });

  if (runs.length < 2) return null;

  const iconRun = runs[0];
  const iconEnd = iconRun.end;

  const MIN_GAP_AFTER_ICON = 50;
  let textStart = -1;
  for (let i = 1; i < runs.length; i++) {
    if (runs[i].start - iconEnd >= MIN_GAP_AFTER_ICON) {
      textStart = runs[i].start;
      break;
    }
  }
  if (textStart < 0) {
    if (runs.length >= 2) textStart = runs[1].start;
    else return null;
  }

  const textEnd = runs[runs.length - 1].end;

  let minY = H;
  let maxY = -1;
  for (let y = 0; y < H; y++) {
    for (let x = textStart; x <= textEnd; x++) {
      const i = (y * W + x) * C;
      if (data[i + 3] > ALPHA_THRESHOLD) {
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        break;
      }
    }
  }
  if (maxY < 0) return null;

  const padX = 16;
  const padY = 24;
  return {
    x0: Math.max(0, textStart - padX),
    y0: Math.max(0, minY - padY),
    x1: Math.min(W - 1, textEnd + padX),
    y1: Math.min(H - 1, maxY + padY),
  };
}

function recolorToLime(
  src: Buffer,
  W: number,
  _H: number,
  C: number,
  x0: number,
  y0: number,
  cropW: number,
  cropH: number,
): Buffer {
  const out = Buffer.alloc(cropW * cropH * 4);
  for (let y = 0; y < cropH; y++) {
    for (let x = 0; x < cropW; x++) {
      const srcIdx = ((y0 + y) * W + (x0 + x)) * C;
      const dstIdx = (y * cropW + x) * 4;
      const a = src[srcIdx + 3];
      if (a < ALPHA_THRESHOLD) {
        out[dstIdx] = 0;
        out[dstIdx + 1] = 0;
        out[dstIdx + 2] = 0;
        out[dstIdx + 3] = 0;
        continue;
      }
      out[dstIdx] = LIME.r;
      out[dstIdx + 1] = LIME.g;
      out[dstIdx + 2] = LIME.b;
      out[dstIdx + 3] = a;
    }
  }
  return out;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

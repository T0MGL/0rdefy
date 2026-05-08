/**
 * Client-side image compression for proof-of-delivery photos.
 *
 * Targets ~500KB JPEGs by:
 *   1. Reading the file into an HTMLImageElement.
 *   2. Resizing into a canvas with the longest edge clamped to `maxEdgePx`.
 *   3. Re-encoding to JPEG, dropping quality until size <= targetBytes (or
 *      we hit the floor quality).
 *
 * Stays in the browser — no upload until the caller hands the result off
 * to portalService.uploadProof(). Honors the original file name so the
 * server logs are still useful.
 */

export interface CompressOptions {
  /** Largest dimension in CSS pixels. Defaults to 1600. */
  maxEdgePx?: number;
  /** Target compressed size in bytes. Defaults to 500 KB. */
  targetBytes?: number;
  /** Initial JPEG quality (0..1). Defaults to 0.85. */
  initialQuality?: number;
  /** Floor quality. Defaults to 0.55 to keep faces/labels legible. */
  minQuality?: number;
  /** Output mime type. Defaults to image/jpeg. */
  mimeType?: 'image/jpeg' | 'image/webp';
}

const DEFAULTS: Required<CompressOptions> = {
  maxEdgePx: 1600,
  targetBytes: 500 * 1024,
  initialQuality: 0.85,
  minQuality: 0.55,
  mimeType: 'image/jpeg',
};

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo leer la imagen'));
    };
    img.src = url;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mime: string,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Falló la compresión'));
          return;
        }
        resolve(blob);
      },
      mime,
      quality,
    );
  });
}

export async function compressImage(
  file: File,
  options: CompressOptions = {},
): Promise<File> {
  // Skip if it's already small enough and a JPEG
  const opts = { ...DEFAULTS, ...options };

  if (
    file.size <= opts.targetBytes &&
    /^image\/jpe?g$/i.test(file.type)
  ) {
    return file;
  }

  const img = await loadImage(file);

  const longestEdge = Math.max(img.naturalWidth, img.naturalHeight);
  const scale =
    longestEdge > opts.maxEdgePx ? opts.maxEdgePx / longestEdge : 1;
  const targetWidth = Math.round(img.naturalWidth * scale);
  const targetHeight = Math.round(img.naturalHeight * scale);

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Tu navegador no soporta compresión de imágenes');
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

  let quality = opts.initialQuality;
  let blob = await canvasToBlob(canvas, opts.mimeType, quality);

  // Step quality down in 0.1 increments until we fit.
  while (blob.size > opts.targetBytes && quality > opts.minQuality) {
    quality = Math.max(opts.minQuality, quality - 0.1);
    blob = await canvasToBlob(canvas, opts.mimeType, quality);
  }

  const ext = opts.mimeType === 'image/webp' ? 'webp' : 'jpg';
  const baseName = file.name.replace(/\.[^.]+$/, '') || 'proof';
  return new File([blob], `${baseName}.${ext}`, {
    type: opts.mimeType,
    lastModified: Date.now(),
  });
}

/** Convenience: compress and read as object URL for previews. */
export async function compressForPreview(
  file: File,
  options?: CompressOptions,
): Promise<{ file: File; previewUrl: string }> {
  const compressed = await compressImage(file, options);
  const previewUrl = URL.createObjectURL(compressed);
  return { file: compressed, previewUrl };
}

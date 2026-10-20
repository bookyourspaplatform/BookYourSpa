/**
 * Client-only helpers for branch photos. Uploads are stored as resized JPEG
 * data URLs in `branches.images` (first image = cover) so no file backend is
 * required — the platform can move to object storage later without a schema
 * change (values are plain strings).
 */

export const MAX_BRANCH_IMAGES = 10;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read that image.'));
    img.src = src;
  });
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
}

/**
 * Read a picked file, downscale it to `maxDim` on its long edge and re-encode
 * as JPEG at `quality` — typically 100–300 KB, safe to keep in the row.
 */
export async function fileToDataUrl(file: File, maxDim = 1400, quality = 0.78): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Only image files are allowed.');
  if (file.size > 20 * 1024 * 1024) throw new Error('Image must be under 20 MB.');
  const original = await readAsDataUrl(file);
  const img = await loadImage(original);
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return original; // no canvas (very old browser) — keep the original
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);
}

/** True for values we can render as an <img src>. */
export function isRenderableImage(src: string): boolean {
  return /^https?:\/\//i.test(src) || /^data:image\//i.test(src);
}

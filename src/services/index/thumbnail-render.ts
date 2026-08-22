/**
 * Making a thumbnail.
 *
 * Canvas only — no model, no network, nothing to download. It used to live alongside the image
 * embedder, which decoded the picture anyway, so generating a thumbnail there was free. With the
 * embedder gone this is the whole job: decode once in a worker, draw small, encode to WebP.
 *
 * Worth keeping rather than letting the grid draw originals. A folder of 4000-pixel photographs
 * rendered at 160 pixels is the classic way to make a file manager stutter, and the fix is the
 * same whether or not anything clever is happening elsewhere.
 */
export async function makeThumbnail(
  data: ArrayBuffer,
  mime: string,
  maxEdge = 320,
): Promise<{ blob: Blob; width: number; height: number } | null> {
  if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap !== 'function')
    return null;

  const bitmap = await createImageBitmap(new Blob([data], { type: mime }));
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) {
    bitmap.close();
    return null;
  }
  context.drawImage(bitmap, 0, 0, width, height);
  // The stored dimensions are the original's: Photos reports what the file is, not what the
  // thumbnail was squeezed to.
  const original = { width: bitmap.width, height: bitmap.height };
  bitmap.close();

  // WebP at 0.8 is a good trade for thumbnails: roughly a tenth the size of PNG, no visible loss
  // at this scale.
  const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.8 });
  return { blob, width: original.width, height: original.height };
}

// Client-side photo downscale/compression before upload
// (change: fix-photo-camera-capture). Family playtest: raw camera photos burned
// mobile data and were slow to upload. We resize to a sane max edge and re-encode
// as JPEG in the browser so the uploaded file is a fraction of the original.
//
// `computeScaledDimensions` is the pure, DOM-free core (unit-tested); it preserves
// aspect ratio, never upscales, and is total (junk input → finite, non-negative).

export const PHOTO_MAX_EDGE = 1280;
export const PHOTO_JPEG_QUALITY = 0.7;

export function computeScaledDimensions(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  if (
    !Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(maxEdge) ||
    width <= 0 || height <= 0 || maxEdge <= 0
  ) {
    const w = Number.isFinite(width) && width > 0 ? Math.round(width) : 0;
    const h = Number.isFinite(height) && height > 0 ? Math.round(height) : 0;
    return { width: w, height: h };
  }
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width: Math.round(width), height: Math.round(height) };
  const scale = maxEdge / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

// Resize + re-encode a captured image to JPEG. Best-effort: on any decode/encode
// failure it returns the original file so capture still works.
export async function compressImageFile(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = computeScaledDimensions(bitmap.width, bitmap.height, PHOTO_MAX_EDGE);
    if (width <= 0 || height <= 0) { bitmap.close?.(); return file; }
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) { bitmap.close?.(); return file; }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    const blob: Blob | null = await new Promise((res) =>
      canvas.toBlob((b) => res(b), 'image/jpeg', PHOTO_JPEG_QUALITY));
    return blob ?? file;
  } catch {
    return file;
  }
}

// Client-side photo downscale/compression before upload
// (change: fix-photo-camera-capture; hardened in docs/wave-a/upload-resiliency.md).
// Family playtest: raw camera photos burned mobile data and were slow to upload.
// We resize to a sane max edge and re-encode as JPEG in the browser so the
// uploaded file is a fraction of the original.
//
// Task 11 hardening — the original version fell back to the ORIGINAL full-size
// file on ANY failure, silently. On a 12 MP phone photo that is a ~5 MB upload the
// player experiences as a freeze, and nothing recorded that it happened. Now:
//   * every fallback carries a `reason` and logs one `[rp:photo]` warning;
//   * a multi-pass budget keeps tightening quality/edge until the encode is under
//     PHOTO_TARGET_BYTES, instead of accepting whatever one pass produced;
//   * chooseUploadBlob refuses an encode that isn't meaningfully smaller, so we
//     never spend the player's data uploading a BIGGER re-encode.
//
// `computeScaledDimensions`, `chooseUploadBlob` and `nextEncodeStep` are the pure,
// DOM-free core (unit-tested in scripts/test-image-resize.ts).

export const PHOTO_MAX_EDGE = 1280;
export const PHOTO_JPEG_QUALITY = 0.7;
/** Budget for the uploaded JPEG. Above this we re-encode harder. */
export const PHOTO_TARGET_BYTES = 900_000;
/** An encode must save at least this fraction to be worth uploading instead of the original. */
export const PHOTO_MIN_SAVING = 0.05;

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

export interface EncodeStep { maxEdge: number; quality: number }

// The tightening plan. Each step is strictly smaller (quality and/or edge) than
// the previous one; the last step returns null so the caller always terminates.
const ENCODE_PLAN: EncodeStep[] = [
  { maxEdge: PHOTO_MAX_EDGE, quality: PHOTO_JPEG_QUALITY },
  { maxEdge: PHOTO_MAX_EDGE, quality: 0.55 },
  { maxEdge: 1024, quality: 0.5 },
  { maxEdge: 800, quality: 0.45 },
];

export function nextEncodeStep(step: EncodeStep): EncodeStep | null {
  const i = ENCODE_PLAN.findIndex((s) => s.maxEdge === step.maxEdge && s.quality === step.quality);
  const next = i >= 0 ? ENCODE_PLAN[i + 1] : ENCODE_PLAN[1];
  return next ?? null;
}

export function firstEncodeStep(): EncodeStep {
  return { ...ENCODE_PLAN[0] };
}

// Which blob should actually be uploaded. Junk input, a bigger encode, or a
// negligible saving ⇒ keep the original (and the caller reports why).
export function chooseUploadBlob(originalBytes: number, encodedBytes: number): 'encoded' | 'original' {
  if (
    !Number.isFinite(originalBytes) || !Number.isFinite(encodedBytes) ||
    originalBytes <= 0 || encodedBytes <= 0
  ) return 'original';
  const saving = (originalBytes - encodedBytes) / originalBytes;
  return saving >= PHOTO_MIN_SAVING ? 'encoded' : 'original';
}

export type CompressionFallback =
  | 'ok'
  | 'no-bitmap'         // createImageBitmap threw (unsupported / corrupt capture)
  | 'bad-dimensions'
  | 'no-canvas-context'
  | 'encode-failed'     // canvas.toBlob returned null
  | 'not-smaller'       // the re-encode wasn't worth uploading
  | 'over-budget';      // encoded, still above PHOTO_TARGET_BYTES after every pass

export interface CompressionReport {
  blob: Blob;
  /** false ⇒ we are about to upload the ORIGINAL full-size capture. */
  compressed: boolean;
  reason: CompressionFallback;
  originalBytes: number;
  outputBytes: number;
  passes: number;
}

function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((res) => canvas.toBlob((b) => res(b), 'image/jpeg', quality));
}

/**
 * Resize + re-encode a captured image to JPEG, reporting exactly what happened.
 * Still best-effort — it never throws and always yields something uploadable —
 * but a fallback to the full-size original is now visible instead of silent.
 */
export async function compressImageWithReport(file: File | Blob): Promise<CompressionReport> {
  const originalBytes = file.size;
  const fallback = (reason: CompressionFallback, passes = 0): CompressionReport => {
    if (reason !== 'ok') {
      // Observable: one line per capture, so a slow upload can be traced to a
      // full-size fallback instead of being blamed on the network.
      console.warn(`[rp:photo] compression fallback: ${reason} (${originalBytes} bytes)`);
    }
    return { blob: file, compressed: false, reason, originalBytes, outputBytes: originalBytes, passes };
  };

  const finish = (out: Blob, passes = 1): CompressionReport => {
    if (chooseUploadBlob(originalBytes, out.size) === 'original') return fallback('not-smaller', passes);
    const reason: CompressionFallback = out.size > PHOTO_TARGET_BYTES ? 'over-budget' : 'ok';
    if (reason === 'over-budget') {
      console.warn(`[rp:photo] compressed but still over budget: ${out.size} bytes after ${passes} pass(es)`);
    }
    return { blob: out, compressed: true, reason, originalBytes, outputBytes: out.size, passes };
  };

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return fallback('no-bitmap');
  }

  try {
    let step: EncodeStep | null = firstEncodeStep();
    let best: Blob | null = null;
    let passes = 0;
    while (step) {
      const { width, height } = computeScaledDimensions(bitmap.width, bitmap.height, step.maxEdge);
      if (width <= 0 || height <= 0) return fallback('bad-dimensions', passes);
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return fallback('no-canvas-context', passes);
      ctx.drawImage(bitmap, 0, 0, width, height);
      const out = await encode(canvas, step.quality);
      passes++;
      if (!out) return best ? finish(best) : fallback('encode-failed', passes);
      if (!best || out.size < best.size) best = out;
      if (out.size <= PHOTO_TARGET_BYTES) break;
      step = nextEncodeStep(step);
    }
    if (!best) return fallback('encode-failed', passes);
    return finish(best, passes);
  } catch {
    return fallback('encode-failed');
  } finally {
    bitmap.close?.();
  }
}

/** Back-compat thin wrapper — prefer compressImageWithReport for observability. */
export async function compressImageFile(file: File | Blob): Promise<Blob> {
  return (await compressImageWithReport(file)).blob;
}

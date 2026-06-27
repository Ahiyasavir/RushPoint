// Reusable brand stamp for every shared image (change: share-branding). Composites
// the RushPoint logo mark + app URL + a scannable QR onto a canvas, positioned by
// the pure computeWatermarkLayout so the stamp sits on the bottom edge, never over
// the subject. Degrades gracefully: a missing logo falls back to a text wordmark,
// a failed QR is simply omitted — a share never fails because of branding.
import QRCode from 'qrcode';
import { computeWatermarkLayout } from '@rushpoint/shared';

/** Load an image, resolving null on any failure (never throws). */
export function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** Generate a QR image for `target`, resolving null on failure. */
export async function makeQrImage(target: string): Promise<HTMLImageElement | null> {
  try {
    const dataUrl = await QRCode.toDataURL(target, { margin: 1, width: 256, errorCorrectionLevel: 'M' });
    return await loadImage(dataUrl);
  } catch {
    return null;
  }
}

export interface StampOptions {
  width: number;
  height: number;
  urlText: string;       // human-readable URL (e.g. play.rushpoint.app)
  qrTarget?: string;     // URL the QR encodes; omit to skip the QR
  logoSrc?: string;      // logo to load; falls back to the text wordmark on failure
  color?: string;        // brand text colour (default white)
}

/** Draw the brand stamp onto `ctx`. Async because it may load the logo + QR. */
export async function stampBrand(ctx: CanvasRenderingContext2D, opts: StampOptions): Promise<void> {
  const L = computeWatermarkLayout({ width: opts.width, height: opts.height });
  const color = opts.color ?? '#ffffff';

  // ── Logo mark, or a text wordmark fallback ──
  const logo = opts.logoSrc ? await loadImage(opts.logoSrc) : null;
  if (logo) {
    ctx.drawImage(logo, L.logo.x, L.logo.y, L.logo.size, L.logo.size);
  } else {
    ctx.save();
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.round(L.logo.size * 0.46)}px Outfit, Inter, sans-serif`;
    ctx.fillText('RUSHPOINT', L.logo.x, L.logo.y + L.logo.size / 2);
    ctx.restore();
  }

  // ── URL line between logo and QR ──
  ctx.save();
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = `500 ${Math.round(L.logo.size * 0.32)}px Inter, sans-serif`;
  ctx.fillText(opts.urlText, L.url.x, L.url.y, L.url.maxWidth);
  ctx.restore();

  // ── Scannable QR on a white chip (for contrast) ──
  if (opts.qrTarget) {
    const qr = await makeQrImage(opts.qrTarget);
    if (qr) {
      const pad = Math.round(L.qr.size * 0.07);
      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(L.qr.x - pad, L.qr.y - pad, L.qr.size + pad * 2, L.qr.size + pad * 2);
      ctx.drawImage(qr, L.qr.x, L.qr.y, L.qr.size, L.qr.size);
      ctx.restore();
    }
  }
}

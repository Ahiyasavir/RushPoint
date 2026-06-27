// Share-branding pure helpers (change: share-branding). Every image the app shares
// carries a brand stamp (logo + app URL + a scannable QR). The QR destination and
// the box placement are pure + DOM-free so they're unit-tested; the canvas drawing
// that consumes them lives in play-web (apps/play-web/src/lib/brandWatermark.ts).

/** Resolve where a shared image's QR should point: a join code → the joinable URL,
 *  else a game id → the promo URL, else the generic app URL. */
export function resolveShareQrTarget(opts: {
  accessCode?: string | null;
  gameId?: string | null;
  playBaseUrl: string;
}): string {
  const base = opts.playBaseUrl.replace(/\/+$/, '');
  if (opts.accessCode) return `${base}/?code=${encodeURIComponent(opts.accessCode)}`;
  if (opts.gameId) return `${base}/?game=${encodeURIComponent(opts.gameId)}`;
  return base;
}

export interface Box { x: number; y: number; size: number }
export interface WatermarkLayout {
  margin: number;
  logo: Box;
  qr: Box;
  url: { x: number; y: number; maxWidth: number };
}

/**
 * Deterministic placement of the brand stamp along the BOTTOM edge of the image:
 * the logo at the bottom-start, the QR at the bottom-end, the URL line between
 * them. All boxes sit inside the margin and clear of the centre subject band, and
 * the logo and QR never overlap. Sizes default to a fraction of the canvas width.
 */
export function computeWatermarkLayout(opts: {
  width: number;
  height: number;
  margin?: number;
  logoSize?: number;
  qrSize?: number;
}): WatermarkLayout {
  const { width, height } = opts;
  const margin = opts.margin ?? Math.round(Math.min(width, height) * 0.04);
  const logoSize = opts.logoSize ?? Math.round(width * 0.09);
  const qrSize = opts.qrSize ?? Math.round(width * 0.13);

  const logo: Box = { x: margin, y: height - margin - logoSize, size: logoSize };
  const qr: Box = { x: width - margin - qrSize, y: height - margin - qrSize, size: qrSize };

  const urlStartX = logo.x + logo.size + Math.round(width * 0.02);
  const url = {
    x: urlStartX,
    y: height - margin - Math.round(logoSize / 2),
    maxWidth: Math.max(0, qr.x - urlStartX - Math.round(width * 0.02)),
  };

  return { margin, logo, qr, url };
}

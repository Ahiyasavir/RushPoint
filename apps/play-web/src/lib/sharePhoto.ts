// Share an individual task photo, brand-stamped (change: share-branding). Loads the
// photo to a canvas, composites the brand stamp (logo + URL + QR), and routes it
// through the native-share / download / clipboard ladder. If a cross-origin photo
// taints the canvas (toBlob fails), it falls back to sharing the original URL with
// a branded caption — a share never throws.
import { resolveShareQrTarget } from '@rushpoint/shared';
import { loadImage, stampBrand } from './brandWatermark';
import { routeShare, nativeShare, copyText, canNativeShare, type ShareOutcome, type ShareNav } from './shareLadder';

export interface PhotoShareBrand {
  playBaseUrl: string;
  accessCode?: string | null;
  gameId?: string | null;
  caption: string;   // branded caption for the URL fallback
  urlText: string;   // human-readable URL drawn on the stamp
  logoSrc?: string;
}


async function shareUrlFallback(photoUrl: string, caption: string): Promise<ShareOutcome> {
  const nav = navigator as ShareNav;
  const text = `${caption}\n${photoUrl}`;
  if (canNativeShare(nav)) {
    const r = await nativeShare(nav, { title: 'RushPoint', text });
    if (r !== 'failed') return r;
  }
  return copyText(text, nav);
}

export async function sharePhoto(photoUrl: string, brand: PhotoShareBrand): Promise<ShareOutcome> {
  const qrTarget = resolveShareQrTarget({ accessCode: brand.accessCode, gameId: brand.gameId, playBaseUrl: brand.playBaseUrl });
  try {
    const img = await loadImage(photoUrl);
    if (img && img.naturalWidth > 0) {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        await stampBrand(ctx, {
          width: canvas.width, height: canvas.height,
          urlText: brand.urlText, qrTarget, logoSrc: brand.logoSrc ?? '/icon.svg',
        });
        // toBlob throws SecurityError on a tainted (cross-origin) canvas → caught.
        const blob = await new Promise<Blob | null>((resolve) => {
          try { canvas.toBlob((b) => resolve(b), 'image/png', 0.92); } catch { resolve(null); }
        });
        if (blob) {
          const result = await routeShare({ blob, filename: 'rushpoint-photo.png', text: brand.caption });
          // A dismissal is the user's answer, not a broken channel: never fall
          // through to re-sharing the raw URL behind their back.
          if (result !== 'failed') return result;
        }
      }
    }
  } catch { /* fall through to URL fallback */ }
  return shareUrlFallback(photoUrl, brand.caption);
}

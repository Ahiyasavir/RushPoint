// Share an individual task photo, brand-stamped (change: share-branding). Loads the
// photo to a canvas, composites the brand stamp (logo + URL + QR), and routes it
// through the native-share / download / clipboard ladder. If a cross-origin photo
// taints the canvas (toBlob fails), it falls back to sharing the original URL with
// a branded caption — a share never throws.
import { resolveShareQrTarget } from '@rushpoint/shared';
import { loadImage, stampBrand } from './brandWatermark';

export interface PhotoShareBrand {
  playBaseUrl: string;
  accessCode?: string | null;
  gameId?: string | null;
  caption: string;   // branded caption for the URL fallback
  urlText: string;   // human-readable URL drawn on the stamp
  logoSrc?: string;
}

type ShareResult = 'shared' | 'downloaded' | 'copied' | 'failed';

type ShareNav = Navigator & {
  share?: (d: { title?: string; text?: string; url?: string; files?: File[] }) => Promise<void>;
  canShare?: (d: { files?: File[] }) => boolean;
};

async function routeBlob(blob: Blob, caption: string): Promise<ShareResult> {
  const nav = navigator as ShareNav;
  const file = new File([blob], 'rushpoint-photo.png', { type: 'image/png' });
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try { await nav.share({ files: [file], text: caption }); return 'shared'; } catch { return 'failed'; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'rushpoint-photo.png'; a.click();
  URL.revokeObjectURL(url);
  return 'downloaded';
}

async function shareUrlFallback(photoUrl: string, caption: string): Promise<ShareResult> {
  const nav = navigator as ShareNav;
  const text = `${caption}\n${photoUrl}`;
  if (nav.share) { try { await nav.share({ title: 'RushPoint', text }); return 'shared'; } catch { return 'failed'; } }
  try { await navigator.clipboard.writeText(text); return 'copied'; } catch { return 'failed'; }
}

export async function sharePhoto(photoUrl: string, brand: PhotoShareBrand): Promise<ShareResult> {
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
          const result = await routeBlob(blob, brand.caption);
          if (result !== 'failed') return result;
        }
      }
    }
  } catch { /* fall through to URL fallback */ }
  return shareUrlFallback(photoUrl, brand.caption);
}

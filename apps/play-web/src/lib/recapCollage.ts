// Branded recap collage (change: run-recap). Tiles the run's photos into a
// deterministic grid (computeMontageGrid) and stamps the shared brand (logo +
// URL + QR back to the public recap), then routes through the native-share /
// download / clipboard ladder. Consumes share-branding's stampBrand.
import { computeMontageGrid, type RunRecapPhoto } from '@rushpoint/shared';
import { stampBrand, loadImage } from './brandWatermark';

const W = 1080;
const H = 1080;

function coverDraw(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  // object-fit: cover within the cell.
  const ir = img.width / img.height;
  const cr = w / h;
  let sw = img.width, sh = img.height, sx = 0, sy = 0;
  if (ir > cr) { sw = img.height * cr; sx = (img.width - sw) / 2; }
  else { sh = img.width / cr; sy = (img.height - sh) / 2; }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

export async function buildRecapCollage(
  photos: RunRecapPhoto[],
  opts: { title: string; ctaUrl: string },
): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#0F172A';
  ctx.fillRect(0, 0, W, H);

  // Header band; the montage fills the area below it (above the brand stamp).
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 56px Outfit, Inter, sans-serif';
  ctx.fillText('🏁 ' + opts.title, W / 2, 80);

  const top = 120;
  const montageH = H * 0.74 - top + 120;
  const grid = computeMontageGrid(photos.length, W, montageH);
  for (let i = 0; i < grid.cells.length; i++) {
    const cell = grid.cells[i];
    const img = await loadImage(photos[i].photoUrl);
    const x = cell.x, y = top + cell.y, w = cell.w, h = cell.h;
    if (img) {
      coverDraw(ctx, img, x + 4, y + 4, w - 8, h - 8);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(x + 4, y + 4, w - 8, h - 8);
    }
  }

  await stampBrand(ctx, {
    width: W, height: H,
    urlText: opts.ctaUrl.replace(/^https?:\/\//, ''),
    qrTarget: opts.ctaUrl,
    logoSrc: '/icon.svg',
  });

  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png', 0.92));
}

type ShareNav = Navigator & {
  share?: (d: { title?: string; text?: string; url?: string; files?: File[] }) => Promise<void>;
  canShare?: (d: { files?: File[] }) => boolean;
};

export async function shareRecap(
  photos: RunRecapPhoto[],
  opts: { title: string; ctaUrl: string; text: string },
): Promise<'shared' | 'downloaded' | 'copied' | 'failed'> {
  try {
    const nav = navigator as ShareNav;
    const blob = await buildRecapCollage(photos, opts);
    if (blob) {
      const file = new File([blob], 'rushpoint-recap.png', { type: 'image/png' });
      if (nav.share && nav.canShare?.({ files: [file] })) {
        try { await nav.share({ files: [file], text: opts.text, url: opts.ctaUrl }); return 'shared'; } catch { return 'failed'; }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'rushpoint-recap.png'; a.click();
      URL.revokeObjectURL(url);
      return 'downloaded';
    }
    if (nav.share) { try { await nav.share({ title: 'RushPoint', text: opts.text, url: opts.ctaUrl }); return 'shared'; } catch { return 'failed'; } }
    await navigator.clipboard.writeText(`${opts.text} ${opts.ctaUrl}`); return 'copied';
  } catch { return 'failed'; }
}

// Branded recap collage (change: run-recap). Tiles the run's photos into a
// deterministic grid (computeMontageGrid) and stamps the shared brand (logo +
// URL + QR back to the public recap), then routes through the native-share /
// download / clipboard ladder. Consumes share-branding's stampBrand.
import { computeMontageGrid, type RunRecapPhoto } from '@rushpoint/shared';
import { stampBrand, loadImage } from './brandWatermark';
import { routeShare, type ShareOutcome } from './shareLadder';

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

export async function shareRecap(
  photos: RunRecapPhoto[],
  opts: { title: string; ctaUrl: string; text: string },
): Promise<ShareOutcome> {
  try {
    const blob = await buildRecapCollage(photos, opts);
    return await routeShare({ blob, filename: 'rushpoint-recap.png', text: opts.text, url: opts.ctaUrl });
  } catch { return 'failed'; }
}

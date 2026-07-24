// Branded podium share image (change: podium-share-moment). Draws the top-3 on a
// 1-2-3 podium (geometry from the pure computePodiumLayout) and stamps the shared
// brand (logo + URL + QR) along the bottom, then routes through the native-share /
// download / clipboard ladder. Consumes share-branding's stampBrand.
import { computePodiumLayout, type PodiumEntry } from '@rushpoint/shared';
import { stampBrand } from './brandWatermark';

const W = 1080;
const H = 1080;
const MEDALS: Record<1 | 2 | 3, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

function fit(ctx: CanvasRenderingContext2D, text: string, max: number, start: number): number {
  let size = start;
  do {
    ctx.font = `700 ${size}px Inter, system-ui, sans-serif`;
    if (ctx.measureText(text).width <= max) break;
    size -= 3;
  } while (size > 18);
  return size;
}

export async function buildPodiumCard(podium: PodiumEntry[], opts: { gameName: string; ctaUrl: string; title?: string }): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#FB923C');
  bg.addColorStop(0.55, '#F97316');
  bg.addColorStop(1, '#9A3412');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 64px Outfit, Inter, sans-serif';
  ctx.fillText(opts.title ?? '🏆 Podium', W / 2, 110);
  const gnSize = fit(ctx, opts.gameName, W - 160, 44);
  ctx.font = `600 ${gnSize}px Inter, sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillText(opts.gameName, W / 2, 175);

  // Podium blocks sit in the lower band, above the brand stamp.
  const blocks = computePodiumLayout({ width: W, height: H * 0.72, count: podium.length });
  for (const b of blocks) {
    const entry = podium.find((p) => p.place === b.place);
    if (!entry) continue;
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = '#ffffff';
    ctx.font = '90px serif';
    ctx.fillText(MEDALS[b.place], b.x + b.w / 2, b.y - 96);
    const nameSize = fit(ctx, entry.teamName, b.w - 16, 34);
    ctx.font = `700 ${nameSize}px Inter, sans-serif`;
    ctx.fillText(entry.teamName, b.x + b.w / 2, b.y - 30);
    ctx.font = '800 56px Outfit, Inter, sans-serif';
    ctx.fillText(String(entry.score), b.x + b.w / 2, b.y + 70);
  }

  await stampBrand(ctx, {
    width: W,
    height: H,
    urlText: opts.ctaUrl.replace(/^https?:\/\//, ''),
    qrTarget: opts.ctaUrl,
    logoSrc: '/icon.svg',
  });

  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png', 0.92));
}

type ShareNav = Navigator & {
  share?: (d: { title?: string; text?: string; files?: File[] }) => Promise<void>;
  canShare?: (d: { files?: File[] }) => boolean;
};

export async function sharePodium(podium: PodiumEntry[], opts: { gameName: string; ctaUrl: string; text: string; title?: string }): Promise<'shared' | 'downloaded' | 'copied' | 'failed'> {
  try {
    const nav = navigator as ShareNav;
    const blob = await buildPodiumCard(podium, opts);
    if (blob) {
      const file = new File([blob], 'rushpoint-podium.png', { type: 'image/png' });
      if (nav.share && nav.canShare?.({ files: [file] })) {
        try { await nav.share({ files: [file], text: opts.text }); return 'shared'; } catch { return 'failed'; }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'rushpoint-podium.png'; a.click();
      URL.revokeObjectURL(url);
      return 'downloaded';
    }
    if (nav.share) { try { await nav.share({ title: 'RushPoint', text: opts.text }); return 'shared'; } catch { return 'failed'; } }
    await navigator.clipboard.writeText(opts.text); return 'copied';
  } catch { return 'failed'; }
}

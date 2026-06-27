// Generates a branded, share-ready "story" image (1080×1920) of a team's result
// — the viral artifact participants post to Instagram/WhatsApp stories. Drawn on
// a canvas at share time, so there are no static assets and no server round-trip.
import { stampBrand } from './brandWatermark';

export interface StoryCardData {
  gameName: string;
  teamName: string;
  score: number;
  rank?: number;
  totalTime?: string;
  stagesDone?: string;
  ctaUrl: string; // shown as the "create your own" call-to-action
  headline?: string; // big banner word(s); defaults to FINISHED!
  scoreLabel?: string; // label under the big number; defaults to POINTS
}

const W = 1080;
const H = 1920;

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fitText(ctx: CanvasRenderingContext2D, text: string, max: number, start: number) {
  let size = start;
  do {
    ctx.font = `700 ${size}px Inter, system-ui, sans-serif`;
    if (ctx.measureText(text).width <= max) break;
    size -= 4;
  } while (size > 24);
  return size;
}

export async function buildStoryCard(data: StoryCardData): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Warm "Trail" gradient background.
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#FB923C');
  bg.addColorStop(0.55, '#F97316');
  bg.addColorStop(1, '#9A3412');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = 'center';

  // Trophy
  ctx.font = '240px serif';
  ctx.fillText('🏆', W / 2, 470);

  // Banner headline (FINISHED! / WE'RE #1! / ON THE TRAIL …)
  ctx.fillStyle = '#ffffff';
  const headline = data.headline ?? 'FINISHED!';
  const hlSize = fitText(ctx, headline, W - 120, 110);
  ctx.font = `800 ${hlSize}px Outfit, Inter, sans-serif`;
  ctx.fillText(headline, W / 2, 610);

  // Game name (fit to width)
  const gnSize = fitText(ctx, data.gameName, W - 160, 52);
  ctx.font = `600 ${gnSize}px Inter, sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fillText(data.gameName, W / 2, 700);

  // Team name
  const tnSize = fitText(ctx, data.teamName, W - 220, 44);
  ctx.font = `500 ${tnSize}px Inter, sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillText(data.teamName, W / 2, 770);

  // Big score
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 320px Outfit, Inter, sans-serif';
  ctx.fillText(String(data.score), W / 2, 1170);
  ctx.font = '600 46px Inter, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.fillText(data.scoreLabel ?? 'POINTS', W / 2, 1240);

  // Stat chips (rank · time · stages) — only those present
  const chips: [string, string][] = [];
  if (data.rank) chips.push(['RANK', `#${data.rank}`]);
  if (data.totalTime) chips.push(['TIME', data.totalTime]);
  if (data.stagesDone) chips.push(['STAGES', data.stagesDone]);
  if (chips.length) {
    const cw = 290, ch = 180, gap = 28;
    const totalW = chips.length * cw + (chips.length - 1) * gap;
    let x = (W - totalW) / 2;
    const y = 1360;
    for (const [label, value] of chips) {
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      roundRect(ctx, x, y, cw, ch, 28);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = '800 72px Outfit, Inter, sans-serif';
      ctx.fillText(value, x + cw / 2, y + 100);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.font = '600 30px Inter, sans-serif';
      ctx.fillText(label, x + cw / 2, y + 145);
      x += cw + gap;
    }
  }

  // CTA tagline (the value prop); the logo + URL + scannable QR ride along via the
  // shared brand stamp on the bottom edge, so every share is one scan from joining.
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 48px Outfit, Inter, sans-serif';
  ctx.fillText('Build your own race adventure', W / 2, 1690);

  await stampBrand(ctx, {
    width: W,
    height: H,
    urlText: data.ctaUrl.replace(/^https?:\/\//, ''),
    qrTarget: data.ctaUrl,
    logoSrc: '/icon.svg',
  });

  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png', 0.92));
}

// Build the card and share it: mobile → native share sheet (Instagram/WhatsApp/
// stories); desktop or no file-share support → downloads the PNG / copies the
// text. Returns 'shared' | 'downloaded' | 'copied' | 'failed' so callers can
// show the right confirmation. `text` is the caption + viral CTA fallback.
export async function shareStoryCard(data: StoryCardData, text: string): Promise<'shared' | 'downloaded' | 'copied' | 'failed'> {
  try {
    const navAny = navigator as Navigator & {
      share?: (d: { title?: string; text?: string; files?: File[] }) => Promise<void>;
      canShare?: (d: { files?: File[] }) => boolean;
    };
    const blob = await buildStoryCard(data);
    if (blob) {
      const file = new File([blob], 'rushpoint.png', { type: 'image/png' });
      if (navAny.share && navAny.canShare?.({ files: [file] })) {
        try { await navAny.share({ files: [file], text }); return 'shared'; } catch { /* cancelled */ return 'failed'; }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'rushpoint.png'; a.click();
      URL.revokeObjectURL(url);
      return 'downloaded';
    }
    if (navAny.share) { try { await navAny.share({ title: 'RushPoint', text }); return 'shared'; } catch { /* cancelled */ return 'failed'; } }
    await navigator.clipboard.writeText(text); return 'copied';
  } catch { return 'failed'; }
}

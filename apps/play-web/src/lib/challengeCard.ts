// Branded "challenge a friend" teaser image + share (change: challenge-a-friend).
// Draws the task question on a card and stamps the shared brand (logo + URL + a
// QR that deep-links straight to the ?challenge teaser), then routes through the
// native-share / download / clipboard ladder. Consumes share-branding's stampBrand.
import { buildChallengeParam } from '@rushpoint/shared';
import { stampBrand } from './brandWatermark';

const W = 1080;
const H = 1080;

function fit(ctx: CanvasRenderingContext2D, text: string, max: number, start: number): number {
  let size = start;
  do {
    ctx.font = `800 ${size}px Outfit, Inter, sans-serif`;
    if (ctx.measureText(text).width <= max) break;
    size -= 3;
  } while (size > 22);
  return size;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > max && line) { lines.push(line); line = w; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines.slice(0, 4);
}

export function challengeUrl(playBaseUrl: string, gameId: string, taskId: string): string {
  const base = playBaseUrl.replace(/\/+$/, '');
  return `${base}/?challenge=${encodeURIComponent(buildChallengeParam(gameId, taskId))}`;
}

export async function buildChallengeCard(opts: {
  question: string; gameName: string; deepLink: string; urlText: string;
}): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#1E293B');
  bg.addColorStop(1, '#0F172A');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#FB923C';
  ctx.font = '800 56px Outfit, Inter, sans-serif';
  ctx.fillText('😏  Can you solve this?', W / 2, 150);

  if (opts.gameName) {
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '600 34px Inter, sans-serif';
    ctx.fillText(opts.gameName, W / 2, 215);
  }

  // The question, wrapped + auto-sized.
  ctx.fillStyle = '#ffffff';
  const qSize = fit(ctx, opts.question, W - 160, 64);
  ctx.font = `800 ${qSize}px Outfit, Inter, sans-serif`;
  const lines = wrap(ctx, opts.question, W - 160);
  const lineH = qSize * 1.25;
  let y = H / 2 - ((lines.length - 1) * lineH) / 2;
  for (const ln of lines) { ctx.fillText(ln, W / 2, y); y += lineH; }

  await stampBrand(ctx, {
    width: W, height: H,
    urlText: opts.urlText,
    qrTarget: opts.deepLink,
    logoSrc: '/icon.svg',
  });

  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png', 0.92));
}

type ShareNav = Navigator & {
  share?: (d: { title?: string; text?: string; url?: string; files?: File[] }) => Promise<void>;
  canShare?: (d: { files?: File[] }) => boolean;
};

export async function shareChallenge(opts: {
  gameId: string; taskId: string; question: string; gameName: string;
  playBaseUrl: string; ctaText: string;
}): Promise<'shared' | 'downloaded' | 'copied' | 'failed'> {
  const deepLink = challengeUrl(opts.playBaseUrl, opts.gameId, opts.taskId);
  const urlText = opts.playBaseUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  try {
    const nav = navigator as ShareNav;
    const blob = await buildChallengeCard({ question: opts.question, gameName: opts.gameName, deepLink, urlText });
    if (blob) {
      const file = new File([blob], 'rushpoint-challenge.png', { type: 'image/png' });
      if (nav.share && nav.canShare?.({ files: [file] })) {
        try { await nav.share({ files: [file], text: opts.ctaText, url: deepLink }); return 'shared'; } catch { return 'failed'; }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'rushpoint-challenge.png'; a.click();
      URL.revokeObjectURL(url);
      return 'downloaded';
    }
    if (nav.share) { try { await nav.share({ title: 'RushPoint', text: opts.ctaText, url: deepLink }); return 'shared'; } catch { return 'failed'; } }
    await navigator.clipboard.writeText(`${opts.ctaText} ${deepLink}`); return 'copied';
  } catch { return 'failed'; }
}

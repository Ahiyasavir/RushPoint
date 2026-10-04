// Drawn icons on a canvas (change: no-stock-emoji): the share images (story, podium, recap, challenge
// cards) used to fillText stock emoji, which render differently on every phone and in some browsers
// not at all. These draw the SAME shared drawings (packages/shared/src/iconPaths.ts) with Path2D.
import { ICON_PATHS, type IconName } from '@rushpoint/shared';

/** Draw `name` centred on (cx, cy), `size` px square, in `color`. */
export function drawIcon(ctx: CanvasRenderingContext2D, name: IconName, cx: number, cy: number, size: number, color: string): void {
  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(size / 24, size / 24);
  ctx.lineWidth = 1.75;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  for (const part of ICON_PATHS[name]) {
    const path = new Path2D(part.d);
    if (part.fill) ctx.fill(path); else ctx.stroke(path);
  }
  ctx.restore();
}

const MEDAL_FILL: Record<1 | 2 | 3, string> = { 1: '#E0A800', 2: '#A7AFB8', 3: '#C2773A' };

/** A podium medal: ribbon, a disc in the place's colour, the number in white. */
export function drawMedal(ctx: CanvasRenderingContext2D, place: 1 | 2 | 3, cx: number, cy: number, size: number): void {
  const r = size * 0.32;
  ctx.save();
  ctx.strokeStyle = MEDAL_FILL[place];
  ctx.lineWidth = size * 0.09;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.75, cy - size * 0.5); ctx.lineTo(cx - r * 0.25, cy - r * 0.6);
  ctx.moveTo(cx + r * 0.75, cy - size * 0.5); ctx.lineTo(cx + r * 0.25, cy - r * 0.6);
  ctx.stroke();
  ctx.fillStyle = MEDAL_FILL[place];
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = `800 ${Math.round(r * 1.15)}px Inter, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(place), cx, cy + r * 0.05);
  ctx.restore();
}

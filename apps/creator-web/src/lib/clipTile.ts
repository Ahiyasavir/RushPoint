// How the console shows a submitted clip (change: video-upload-speed, D7). Pure, so
// scripts/test-clip-tile.ts pins it; components/ClipTile.tsx only renders it.

/** With a poster nothing is fetched until play. Without one (every clip sent before posters
 *  existed) keep today's `metadata`, which is what draws a first frame at all. */
export function clipPreload(posterUrl: string | null | undefined): 'none' | 'metadata' {
  return typeof posterUrl === 'string' && posterUrl ? 'none' : 'metadata';
}

/** "0:12" for the corner badge, or null when the length is unknown. A real clip never reads 0:00. */
export function clipLengthLabel(seconds: number | null | undefined): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return null;
  const whole = Math.max(1, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

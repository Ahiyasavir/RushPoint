// Which message index the <Working> panel shows at rotation tick N, for a set of
// `count` messages (change: play-working-feedback).
//
// A single or empty message set never rotates (always index 0). Otherwise the
// tick wraps: `((tick % count) + count) % count` keeps a negative or very large
// tick inside [0, count). Total — never throws for any tick or count.
export function workingMessageIndex(tick: number, count: number): number {
  if (!Number.isFinite(count) || count <= 1) return 0;
  const n = Math.floor(count);
  const t = Number.isFinite(tick) ? Math.floor(tick) : 0;
  return ((t % n) + n) % n;
}

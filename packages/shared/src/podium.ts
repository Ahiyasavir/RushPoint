// Podium selection + layout (change: podium-share-moment). The Final screen reveals
// the top-3 teams on a 1-2-3 podium and can share it as a branded image. Which
// teams stand where, and the block geometry, are pure so they're unit-tested and
// reused by both the on-screen reveal and the share-card builder.

export interface RankingLike { teamId: string; teamName: string; score: number; rank: number }

export interface PodiumEntry extends RankingLike { place: 1 | 2 | 3 }

/** Pick the top 3 (by rank) for the podium and the caller's own placement. */
export function selectPodium(
  rankings: RankingLike[],
  myTeamId?: string,
): { podium: PodiumEntry[]; myPlacement?: number } {
  const sorted = [...rankings].sort((a, b) => a.rank - b.rank);
  const podium = sorted.slice(0, 3).map((r, i) => ({ ...r, place: (i + 1) as 1 | 2 | 3 }));
  const myPlacement = myTeamId ? rankings.find((r) => r.teamId === myTeamId)?.rank : undefined;
  return { podium, myPlacement };
}

export interface PodiumBlock { place: 1 | 2 | 3; x: number; y: number; w: number; h: number }

/**
 * Geometry for up to 3 podium blocks, drawn bottom-aligned in visual order
 * (2nd · 1st · 3rd) so first place is centre and tallest. Blocks are centred
 * horizontally and stay within the canvas bounds.
 */
export function computePodiumLayout(opts: { width: number; height: number; count: number }): PodiumBlock[] {
  const n = Math.min(3, Math.max(0, opts.count));
  if (n === 0) return [];
  const blockW = opts.width * 0.26;
  const gap = opts.width * 0.03;
  const heights: Record<1 | 2 | 3, number> = {
    1: opts.height * 0.5,
    2: opts.height * 0.38,
    3: opts.height * 0.3,
  };
  const order: (1 | 2 | 3)[] = n >= 3 ? [2, 1, 3] : n === 2 ? [2, 1] : [1];
  const totalW = order.length * blockW + (order.length - 1) * gap;
  let x = (opts.width - totalW) / 2;
  const blocks: PodiumBlock[] = [];
  for (const place of order) {
    const h = heights[place];
    blocks.push({ place, x, y: opts.height - h, w: blockW, h });
    x += blockW + gap;
  }
  return blocks;
}

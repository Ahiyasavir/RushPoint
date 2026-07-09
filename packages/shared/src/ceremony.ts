// Ceremony mode (change: ceremony-mode). Pure, shared by the server (the
// ceremonyFeed selection inside getPublicLeaderboard) and the play-web
// CeremonyScreen phase machine, so both sides and the tests agree byte for byte.
// No Firestore, no DOM.

import type { FeedItem } from './types';

/** One slide of the ceremony slideshow — celebratory data only, no ids/uids. */
export interface CeremonyFeedItem {
  taskTitle: string;
  teamName: string;
  photoUrl: string;
  totalReactions: number;
}

/** Server-side cap on the ceremony slideshow selection. */
export const CEREMONY_FEED_CAP = 20;

/**
 * Select the ceremony slideshow from a run's feed items: active items only,
 * ranked by total reaction count desc, tie-broken by createdAt asc (the earlier
 * photo wins), capped at `n`. Output is exactly CeremonyFeedItem — reactedBy,
 * ids and the active flag never leak to the big screen.
 */
export function pickCeremonyFeed(items: FeedItem[], n = CEREMONY_FEED_CAP): CeremonyFeedItem[] {
  const total = (it: FeedItem) =>
    Object.values(it.reactions ?? {}).reduce((a, c) => a + (Number.isFinite(c) ? c : 0), 0);
  return (items ?? [])
    .filter((it) => it && it.active !== false && typeof it.photoUrl === 'string' && it.photoUrl)
    .map((it) => ({ item: it, total: total(it) }))
    .sort((a, b) =>
      b.total - a.total || (a.item.createdAt ?? '').localeCompare(b.item.createdAt ?? ''))
    .slice(0, Math.max(0, n))
    .map(({ item, total: t }) => ({
      taskTitle: item.taskTitle ?? '',
      teamName: item.teamName ?? '',
      photoUrl: item.photoUrl,
      totalReactions: t,
    }));
}

// ── Client sequence machine ───────────────────────────────────────────────────
// slideshow → podium3 → podium2 → podium1 → standings, with empty phases
// skipped. Pure reducer so the timing/skip logic is unit-testable.

export type CeremonyPhase = 'slideshow' | 'podium3' | 'podium2' | 'podium1' | 'standings';

/** First podium phase that exists for `teamCount` teams (standings when none). */
function firstPodium(teamCount: number): CeremonyPhase {
  if (teamCount >= 3) return 'podium3';
  if (teamCount === 2) return 'podium2';
  if (teamCount === 1) return 'podium1';
  return 'standings';
}

/** Where the ceremony begins: the slideshow when there are photos, else the
 * highest podium step that exists, else straight to the standings. */
export function ceremonyStart(feedCount: number, teamCount: number): CeremonyPhase {
  if (feedCount > 0) return 'slideshow';
  return firstPodium(teamCount);
}

/** Total successor function — every phase advances; `standings` is terminal. */
export function ceremonyNext(phase: CeremonyPhase, teamCount: number): CeremonyPhase {
  switch (phase) {
    case 'slideshow': return firstPodium(teamCount);
    case 'podium3':   return teamCount >= 2 ? 'podium2' : teamCount === 1 ? 'podium1' : 'standings';
    case 'podium2':   return teamCount >= 1 ? 'podium1' : 'standings';
    case 'podium1':   return 'standings';
    case 'standings': return 'standings';
  }
}

// Which secondary panels exist right now, and which one opens first.
// (change: play-card-simplification)
//
// Below the mission the screen used to stack six independent sections —
// standings, photo feed, HQ chat, trackables, territory, team devices — each
// always mounted, each its own bordered block, all competing in one long scroll.
// Every one of them is real, and almost nobody needs more than one at a time.
//
// They become ONE drawer with tabs. The rules that matter:
//
//   * A tab exists only when its feature is actually in play. Trackables and
//     zones already self-hid when empty; folding them into a fixed tab strip
//     would have RESURRECTED them as permanently-visible empty tabs, which is
//     worse than the scroll we are removing. So availability is decided here.
//   * The drawer is not rendered at all when nothing qualifies.
//   * Badges are what let a closed drawer stay honest: unread chat has to be
//     reachable without the player thinking to look.
//
// Pure and total: no React, no Firestore, no throw. The screen maps ids to
// components; anything it cannot render it simply omits.

export type DrawerTabId = 'board' | 'feed' | 'chat' | 'trackables' | 'zones' | 'devices';

export interface DrawerTab {
  id: DrawerTabId;
  /** Unread/attention count. 0 means no badge. */
  badge: number;
}

export interface MoreDrawerInput {
  /** A leaderboard has been published to participants. */
  hasBoard?: boolean;
  /** The creator left the live photo feed enabled AND we know who "I" am. */
  hasFeed?: boolean;
  /** Unread messages from HQ (already computed by countUnreadChatMessages). */
  unreadChat?: number;
  /** Chat is always available in a run — but only once we have a team id. */
  hasChat?: boolean;
  /** Number of trackable collectibles in this run. */
  trackableCount?: number;
  /** Number of territory zones in this run. */
  zoneCount?: number;
  /** This team has more than one phone attached. */
  hasTeammateDevices?: boolean;
}

export interface MoreDrawerPlan {
  tabs: DrawerTab[];
  /** Total badge count, for the closed drawer's own dot. */
  totalBadge: number;
  /** Nothing to show — the screen renders no drawer at all. */
  empty: boolean;
  /**
   * The tab to open on first expand: the one demanding attention, else the first
   * available. Never an id absent from `tabs`.
   */
  defaultTab: DrawerTabId | null;
}

/** Stable order: what you glance at most often comes first. */
const ORDER: DrawerTabId[] = ['board', 'feed', 'chat', 'trackables', 'zones', 'devices'];

function count(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : 0;
  return n > 0 ? n : 0;
}

export function planMoreDrawer(input: MoreDrawerInput | null | undefined): MoreDrawerPlan {
  const i = input ?? {};

  const present: Record<DrawerTabId, boolean> = {
    board: i.hasBoard === true,
    feed: i.hasFeed === true,
    chat: i.hasChat === true,
    trackables: count(i.trackableCount) > 0,
    zones: count(i.zoneCount) > 0,
    devices: i.hasTeammateDevices === true,
  };

  const badges: Partial<Record<DrawerTabId, number>> = {
    chat: count(i.unreadChat),
  };

  const tabs: DrawerTab[] = ORDER
    .filter((id) => present[id])
    .map((id) => ({ id, badge: badges[id] ?? 0 }));

  if (tabs.length === 0) {
    return { tabs, totalBadge: 0, empty: true, defaultTab: null };
  }

  const totalBadge = tabs.reduce((sum, t) => sum + t.badge, 0);
  // Something is waiting for them → open THAT. Otherwise the first tab.
  const attention = tabs.find((t) => t.badge > 0);
  return {
    tabs,
    totalBadge,
    empty: false,
    defaultTab: (attention ?? tabs[0]).id,
  };
}

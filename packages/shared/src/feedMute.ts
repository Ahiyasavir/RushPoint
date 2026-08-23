// Live photo feed per-device mute (change: feed-ugc-safety). Pure state helpers;
// persistence (localStorage) and all React/DOM wiring live in play-web — this
// module stays free of any browser/Firestore import so it runs in the
// no-emulator lane (scripts/test-feed-mute.ts).
//
// Participants are anonymous (uid == teamId), so there is no account to carry a
// server-side block list, and a client-written mute doc would violate the
// server-write-only rule. Mute is therefore local, per-device, per-run: "block"
// can only mean team-level suppression on THIS device.

export interface FeedMuteState {
  /** Muted feed item ids, insertion-order, deduped. */
  items: string[];
  /** Muted team ids, insertion-order, deduped. */
  teams: string[];
}

export const EMPTY_FEED_MUTE: FeedMuteState = { items: [], teams: [] };

function addUnique(list: string[], value: string): string[] {
  if (list.includes(value)) return list;
  return [...list, value];
}

/** Pure: returns a new state with `itemId` added to the muted item set. */
export function addMutedItem(state: FeedMuteState, itemId: string): FeedMuteState {
  const items = addUnique(state.items, itemId);
  if (items === state.items) return state;
  return { items, teams: state.teams };
}

/** Pure: returns a new state with `teamId` added to the muted team set. */
export function addMutedTeam(state: FeedMuteState, teamId: string): FeedMuteState {
  const teams = addUnique(state.teams, teamId);
  if (teams === state.teams) return state;
  return { items: state.items, teams };
}

/** True if this item is muted directly, or its team is muted. */
export function isFeedItemMuted(
  state: FeedMuteState,
  item: { id: string; teamId: string },
): boolean {
  return state.items.includes(item.id) || state.teams.includes(item.teamId);
}

/**
 * Tolerant JSON parse for a persisted mute value: a missing key, `null`,
 * malformed JSON, or a wrong-shaped payload all degrade to the empty state
 * rather than throwing — a corrupted localStorage key must never white-screen
 * the feed.
 */
export function parseFeedMute(raw: string | null | undefined): FeedMuteState {
  if (!raw) return EMPTY_FEED_MUTE;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return EMPTY_FEED_MUTE;
    const items = Array.isArray((parsed as { items?: unknown }).items)
      ? (parsed as { items: unknown[] }).items.filter((v): v is string => typeof v === 'string')
      : [];
    const teams = Array.isArray((parsed as { teams?: unknown }).teams)
      ? (parsed as { teams: unknown[] }).teams.filter((v): v is string => typeof v === 'string')
      : [];
    return { items, teams };
  } catch {
    return EMPTY_FEED_MUTE;
  }
}

export function serializeFeedMute(state: FeedMuteState): string {
  return JSON.stringify(state);
}

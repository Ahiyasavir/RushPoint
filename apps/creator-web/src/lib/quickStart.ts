// The instant first build (change: first-visit-instant-build; Ahiya, 30.10: people must understand what
// this is and build at once). The front page asks the first question itself, so a visitor's first act is
// already building. The answer travels as `?start=game&occasion=<id>` through sign in, which is why it
// lives in sessionStorage beside the start intent.
//
// Pure apart from the small storage pair, and total: a malformed URL means "not asked", never a throw.
import { OCCASION_IDS, type OccasionId } from './occasions';
import { OPEN_SETUP_NAV_STATE } from './quickSetup';

const OCCASION_KEY = 'rp-start-occasion';
const isOccasion = (v: unknown): v is OccasionId => (OCCASION_IDS as readonly unknown[]).includes(v);

export function readStartOccasion(search: unknown): OccasionId | null {
  if (typeof search !== 'string' || search === '') return null;
  try {
    const q = new URLSearchParams(search);
    const v = q.get('occasion');
    return q.get('start') === 'game' && isOccasion(v) ? v : null;
  } catch { return null; }
}

export function markStartOccasion(occasion: OccasionId): void {
  try { sessionStorage.setItem(OCCASION_KEY, occasion); } catch { /* storage unavailable */ }
}

/** Read once: the next "new game" must ask again. */
export function consumeStartOccasion(): OccasionId | null {
  try {
    const v = sessionStorage.getItem(OCCASION_KEY);
    sessionStorage.removeItem(OCCASION_KEY);
    return isOccasion(v) ? v : null;
  } catch { return null; }
}

/** The name a game gets when nobody typed one, so its first appearance reads like a game. */
export function quickGameTitle(
  typed: unknown,
  occasion: unknown,
  titles: Record<string, string>,
  untitled: string,
): string {
  const name = typeof typed === 'string' ? typed.trim() : '';
  if (name) return name;
  return (typeof occasion === 'string' ? titles[occasion] : undefined) || titles.other || untitled;
}

/** A freshly composed game opens on the mission feed; a walk resumed later does not replay it. */
export const MISSION_FEED_NAV_STATE = { ...OPEN_SETUP_NAV_STATE, rpMissionFeed: true } as const;

/** The building moment's length, counted once across the dashboard and the feed. */
export const BUILD_MS = 1900;

export function buildMsLeft(startedAt: unknown, now: number): number {
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt) || startedAt > now) return BUILD_MS;
  return Math.max(0, BUILD_MS - (now - startedAt));
}

export const MAX_HIGHLIGHTS = 5;

/**
 * The missions that get a whole screen. Sixteen identical text cards in a row read as work, so the feed
 * shows the opening, the ending and an even spread between them, and the rest sit on one card.
 */
export function pickHighlights<T>(ordered: readonly T[], max = MAX_HIGHLIGHTS): T[] {
  if (ordered.length <= max) return [...ordered];
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(ordered[Math.round((i * (ordered.length - 1)) / (max - 1))]);
  return out;
}

export function wantsMissionFeed(state: unknown): boolean {
  return !!state && typeof state === 'object' && (state as { rpMissionFeed?: unknown }).rpMissionFeed === true;
}

// No-signup demo (change: no-signup-demo). Pure local-draft helpers for the
// "Try the Builder" demo mode: serialize the in-progress game to/from
// localStorage and decide whether a draft is worth claiming into a real account.
// The AuthGate demo entry + claim flow are the deferred UI half; these helpers
// are the testable core. No DOM access here (localStorage lives in the caller).
import type { Game } from '@rushpoint/shared';

/** Bumped whenever the persisted draft shape changes — older payloads are dropped. */
export const DRAFT_VERSION = 1;

export type DraftGame = Partial<Game>;
interface DraftEnvelope { version: number; game: DraftGame; }

/** Serialize a draft game to a versioned JSON string for localStorage. */
export function serializeDraft(game: DraftGame): string {
  const envelope: DraftEnvelope = { version: DRAFT_VERSION, game };
  return JSON.stringify(envelope);
}

/**
 * Parse a persisted draft. Returns the game on a version match, or null for a
 * version mismatch, malformed JSON, or a missing game — so a stale/garbage draft
 * never half-loads into the Builder.
 */
export function deserializeDraft(raw: string | null | undefined): DraftGame | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DraftEnvelope>;
    if (!parsed || parsed.version !== DRAFT_VERSION) return null;
    if (typeof parsed.game !== 'object' || parsed.game == null) return null;
    return parsed.game;
  } catch {
    return null;
  }
}

/**
 * Whether a draft is worth claiming into a new account: it must have a non-empty
 * title and at least one task. An empty or malformed draft is not claimable.
 */
export function isDraftClaimable(game: DraftGame | null | undefined): boolean {
  if (!game || typeof game !== 'object') return false;
  const title = typeof game.title === 'string' ? game.title.trim() : '';
  if (!title) return false;
  const stages = Array.isArray(game.stages) ? game.stages : [];
  return stages.some((s) => Array.isArray(s?.tasks) && s.tasks.length > 0);
}

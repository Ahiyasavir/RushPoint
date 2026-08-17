// The Builder's update payload (change: surface-invisible-fields).
//
// This used to be an object literal inside BuilderPage.tsx, and it silently dropped
// fields the Builder itself let a creator edit. `scoringOptions` was the worst case:
// the wrong-answer-cost selector patched it into local state and read it back, so the
// control looked alive — but the payload never carried it, and because the Builder's
// dirty check is `JSON.stringify(buildSavePayload(g))`, the edit was not even seen as a
// change. Nothing was sent, and nothing said so.
//
// Two things fix that class of bug rather than that one instance:
//   1. the payload lives here, React-free, so a pure test can drive it, and
//   2. BUILDER_EDITABLE_FIELDS is the single declared list of what the Builder owns —
//      scripts/test-game-presentation.ts asserts every entry survives into the payload,
//      so a new control whose field is not added here fails `npm test`.
//
// It stays an ALLOW-LIST rather than a spread of the whole Game: a spread would post
// server-owned fields (ownerUid, visibility, playCount, deletedAt, timestamps) on every
// autosave and force updateGame to grow a rejection list to stay safe.
import type { Game, UpdateGamePayload } from '@rushpoint/shared';
import { propagateGameTagsToTasks } from '@rushpoint/shared';

/**
 * Every `Game` field the Builder may mutate. Adding a control to the Builder means
 * adding its field HERE — the completeness test reads this list, not the UI.
 */
export const BUILDER_EDITABLE_FIELDS = [
  'title',
  'description',
  'mode',
  'stages',
  'scoringPreset',
  // Wrong-answer cost lives under scoringOptions. Omitted from the old literal, which
  // is what made the Settings selector a no-op.
  'scoringOptions',
  'registrationFields',
  'tags',
  // Presentation. All three are rendered downstream (gallery card + map, promo hero,
  // and the accent/name of five participant screens) and had no author until now.
  'coverImage',
  'branding',
  'approxLocation',
  // Chat integration (change: chat-integrations). Undefined when unset (skipped
  // server-side); '' clears it. Only ever patched with an empty or valid URL.
  'integrationWebhookUrl',
  // Safe-zone boundary (change: expose-enforced-settings). The SERVER enforces this
  // one — updateLocation flags a team outside it and routing stops handing out tasks
  // — and until now nothing in either app could author it. `null` is an explicit
  // clear; `undefined` means "not sent" and would leave a stale boundary in place.
  'safeZone',
  // Marketplace instant play (change: marketplace-instant-play).
  'allowInstantPlay',
  // Live photo feed (change: live-photo-feed). Undefined means on (default).
  'photoFeedEnabled',
  // Power-ups (change: power-ups). Undefined means off (default).
  'powerUpsEnabled',
  // Staged leaderboard reveal (change: manual-leaderboard-reveal). Undefined means
  // off (default) = finalizeRun auto publishes, the prior behaviour.
  'manualLeaderboardReveal',
  // Game intro primer (change: game-intro-instructions). Undefined when unset
  // (skipped server-side); an empty/whitespace-only primer clears it on save.
  'instructions',
  // Task-library priority (change: task-library-priority-boost). Undefined
  // means off (default); when on, every task this game publishes sorts to the
  // top of the task library, regardless of popularity.
  'pinnedFirst',
] as const satisfies ReadonlyArray<keyof Game & keyof UpdateGamePayload>;

export type BuilderEditableField = typeof BUILDER_EDITABLE_FIELDS[number];

/**
 * Build the `updateGame` payload for a game as the Builder currently holds it.
 *
 * Every allow-listed key is copied unconditionally — including when its value is
 * `undefined`, which `updateGame` skips server-side. Copying unconditionally is what
 * lets `JSON.stringify` of this payload serve as the Builder's dirty check without the
 * key set shifting as fields are cleared.
 */
export function buildSavePayload(game: Game): UpdateGamePayload {
  const src = game as unknown as Record<BuilderEditableField, unknown>;
  const payload: Record<string, unknown> = { gameId: game.id };
  for (const key of BUILDER_EDITABLE_FIELDS) payload[key] = src[key];
  // Union the game's tags into every task before the Builder diffs this payload
  // (feature: game-tags-propagate). The server does the SAME union on save, and the
  // helper is idempotent, so the tasks `getGame` returns after a save already carry
  // these tags — which keeps `JSON.stringify(buildSavePayload(loaded))` STABLE and
  // stops a phantom "unsaved changes" the moment a game has tags. When either half is
  // absent (a tagless game, or a game with no stages) nothing changes.
  if (Array.isArray(payload.stages) && Array.isArray(payload.tags)) {
    payload.stages = propagateGameTagsToTasks(
      payload.tags as string[],
      payload.stages as Parameters<typeof propagateGameTagsToTasks>[1],
    );
  }
  // Drop `undefined` INSIDE stages so "unset" reaches the server as ABSENT
  // (change: builder-clear-optional-field). Clearing an opt-in group sets its fields
  // to `undefined`, but the callable serializer encodes `undefined` as `null`, and
  // the server's optional-field guards read `value !== undefined && typeof value !==
  // 'number'` — so a cleared duration arrived as `null` and was REFUSED as malformed.
  // Closing the "time and scoring" group therefore broke every autosave until a value
  // was put back. Absent is a state every one of those guards already accepts.
  //
  // Only `stages` is cleaned. Several TOP-LEVEL fields use an explicit `null` as a
  // documented "clear this" signal (safeZone), and `undefined` there means "not sent"
  // — conflating the two would silently resurrect a boundary a creator removed.
  payload.stages = dropUndefinedDeep(payload.stages);
  return payload as unknown as UpdateGamePayload;
}

/**
 * Recursively remove object keys whose value is `undefined`.
 *
 * `null` is KEPT: it is a deliberate value elsewhere in this payload, and only
 * `undefined` carries the "never set / just cleared" meaning. `0`, `false` and `''`
 * are kept too — they are authored values, and dropping them would discard the very
 * setting a creator chose. Arrays keep their length so no index shifts underneath a
 * task id. Non-plain values (Date, class instances) are returned as-is rather than
 * rebuilt, so this can never quietly flatten something it does not understand.
 */
function dropUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => dropUndefinedDeep(v)) as unknown as T;
  }
  if (value === null || typeof value !== 'object') return value;
  if (Object.getPrototypeOf(value) !== Object.prototype) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === undefined) continue;
    out[k] = dropUndefinedDeep(v);
  }
  return out as unknown as T;
}

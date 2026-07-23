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
  return payload as unknown as UpdateGamePayload;
}

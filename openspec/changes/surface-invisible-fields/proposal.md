## Why

Two bugs reported from real use this week were the same bug: a field that is **written and returned
but never surfaced**. `tags` was persisted on `Game`/`Task`, denormalized into `publicGames`/
`publicTasks` and returned by the callables — and no component rendered it. The task-library map was
empty because no published task carried an area. Both look like working features to everyone except
the person using the product.

A field-by-field sweep of `packages/shared/src/types/index.ts` against every read in
`apps/creator-web/src` and `apps/play-web/src` found more of the same class. Verified in this
working tree:

1. **The Builder's wrong-answer-cost selector does not save.** `BuilderPage.tsx:688` patches
   `scoringOptions.wrongAnswerPenalty` into local state and `:685` reads it back, so the button
   highlights and the creator believes the setting took. But `buildSavePayload`
   (`BuilderPage.tsx:112-137`) never includes `scoringOptions`. Worse, `serializeGame` is
   `JSON.stringify(buildSavePayload(g))` (`:139`) and the autosave effect (`:270`) compares that
   snapshot — so the edit is not even detected as dirty and **no save is attempted at all**. The
   value reverts on the next load to whatever `DashboardPage.tsx:210` seeded at creation. The whole
   wrong-answer-cost feature — server-enforced, unit-tested, e2e-covered — is unreachable from the
   only UI that offers it.
2. **A published game can never appear on the gallery map.** `GalleryPage.tsx:50-57` plots
   `publicGames` by `approxLocation`, and `:243` renders `approxLocation.label` on the card.
   `publishGame` (`functions/src/games/index.ts:704`) and the edit resync (`:324`) both copy
   `game.approxLocation` faithfully. Nothing ever sets it: `approxLocation` does not appear in
   `buildSavePayload`, and grepping `apps/creator-web/src` for it returns only gallery *reads* and
   `TaskLibrary.tsx:28`. Every published game therefore has an empty area and the games map is
   permanently blank — the exact shape of the task-library-map complaint, one collection over.
3. **`coverImage` has no author.** `GamePromoScreen.tsx:92-96` renders it as the promo hero, and it
   is denormalized on publish (`games/index.ts:702`) and resynced on edit (`:323`). `grep -r
   coverImage apps/creator-web/src` → **nothing**. The only way to get one is a game-file import.
4. **`branding` has no author.** `game.branding.primaryColor` is the accent of five participant
   screens (`JoinScreen:310`, `PlayScreen:362`, `FinalScreen:32`, `CeremonyScreen:95`,
   `PublicLeaderboardScreen:55`) and `branding.name` overrides the displayed game name in four more
   places. `grep -r branding apps/creator-web/src` matches exactly one line — a Wallet marketing
   string. `updateGame` accepts `branding` (`games/index.ts:214`); no UI sends it.

The unifying defect behind #1 is structural: **the Builder's save payload is a hand-maintained
literal**, and adding a control to the Settings panel does not add its field to that literal. There
is no test that fails when the two drift. That is why this proposal fixes the payload *and* pins it.

## What Changes

**The Builder saves every field it lets a creator edit.**
- `buildSavePayload` moves out of `BuilderPage.tsx` into a pure, React-free module and gains the
  fields it was dropping: `scoringOptions`, `coverImage`, `branding`, `approxLocation`.
- A pure test asserts, from a fully-populated game fixture, that every declared builder-editable
  field survives into the payload. A future control whose field is not added to the payload fails
  `npm test` instead of shipping as a dead button.

**A published game gets a map area without the creator doing anything.**
- When a game carries no authored `approxLocation`, `publishGame` and the public-edit resync derive
  one: the coarsened ~1 km centroid of the game's own publicly-locatable tasks, reusing
  `publicTaskLocation` — so `hideLocation` tasks, locationless tasks and unplaced (0,0) tasks
  contribute nothing, and no world-readable document ever gains a finer point than the task library
  already publishes. An authored area always wins; a game with no locatable task publishes no area.

**Presentation fields become authorable in the Builder's Details/Settings panel.**
- Cover image (https-only URL), brand display name, and accent colour, all normalized by pure
  helpers before they reach `updateGame`, all copy through `t.*` in Hebrew and English.

## Impact

- `apps/creator-web/src/lib/savePayload.ts` (new, pure), `apps/creator-web/src/lib/gamePresentation.ts`
  (new, pure), `apps/creator-web/src/pages/BuilderPage.tsx`, `apps/creator-web/src/i18n.ts`.
- `functions/src/games/gameArea.ts` (new, pure), `functions/src/games/index.ts` (publish + resync).
- Tests: `scripts/test-game-presentation.ts` (new), `functions/src/games/gameArea.test.ts` (new).
- No schema change, no new callable, no client write. `Game.approxLocation`, `coverImage`,
  `branding` and `scoringOptions` already exist and are already accepted by `updateGame`.
- Backward compatible: a game with an authored area keeps it; a game with none gains a derived area
  only in the world-readable gallery copy, and only at its next publish or edit.

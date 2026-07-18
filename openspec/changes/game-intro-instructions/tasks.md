# Tasks: game-intro-instructions

## 1. Shared helpers — RED then GREEN (pure)
- [x] 1.1 RED: add `scripts/test-game-instructions.ts` asserting `cleanGameInstructions` (trims
      strings, keeps an `https://` image but drops a non-https/`http://` one, returns `undefined`
      for an empty/whitespace-only primer, preserves a full primer), `gameInstructionsHasContent`
      (title/body/bodyHe/https-image → true; empty/whitespace/non-https-only → false), and
      `localizedInstructionsBody` (he→bodyHe, he falls back to body, en→body). Confirm it fails
      (helpers do not exist yet).
- [x] 1.2 GREEN: add `packages/shared/src/gameInstructions.ts` (the three helpers) + the
      `GameInstructions` interface and `Game.instructions?` / `UpdateGamePayload.instructions?` /
      `PublicGame.instructions?` in `types/index.ts`; export from `packages/shared/src/index.ts`.
      `npm run shared:build`; `npm test` → the new test passes.

## 2. functions — persist + echo
- [x] 2.1 `updateGame`: destructure `instructions`; when defined, set
      `updates.instructions = cleanGameInstructions(instructions) ?? FieldValue.delete()`; in the
      public resync block also write the cleaned primer (or delete) into `publicGames`.
- [x] 2.2 `getMyTeamState`: add `instructions: cleanGameInstructions(game.instructions) ?? null`
      to the returned `game` subset (https-guarded at the echo boundary).

## 3. creator-web authoring
- [x] 3.1 Builder settings `StepDetails`: collapsible "How to play" section editing
      `game.instructions` (title + EN body + HE body + optional image URL) via `patch`; authored
      fields `dir="auto"`; rides existing `updateGame`.
- [x] 3.2 i18n keys (`instructionsSectionTitle`, `instructionsHint`, `instructionsTitleLabel`,
      `instructionsBodyLabel`, `instructionsBodyHeLabel`, `instructionsImageLabel`) EN + HE,
      language-pure.

## 4. play-web display
- [x] 4.1 Add `game.instructions` to the play-web `MyTeamState` type.
- [x] 4.2 Waiting screen (before start): render a "How to play" primer card when the primer has
      content (title + `localizedInstructionsBody` + optional https image, `dir="auto"`).
- [x] 4.3 In-run: a "How to play" button in `PlayScreen` opens a modal reusing the
      `StoryInterstitial` card layout; body via `localizedInstructionsBody(instructions, lang)`.
- [x] 4.4 (Optional) `GamePromoScreen` shows `publicGames.instructions` under the description.
- [x] 4.5 i18n keys (`howToPlay`, `howToPlayTitle`, `howToPlayClose`) EN + HE, language-pure.

## 5. Tests / gates
- [x] 5.1 e2e scenario (`scripts/e2e-verify.mjs`): set a bilingual primer with a non-https image via
      `updateGame`, join, assert `getMyTeamState.game.instructions` echoes title/body/bodyHe, strips
      the image, and that a primer-less game returns `instructions === null`.
- [x] 5.2 `npm run typecheck` · `npm test` · `npm run lint` · `npm run creator:build` ·
      `npm run play:build` · `npm run i18n:check` — all green.
- [ ] 5.3 `npm run e2e` in the consolidated emulator run (batch gate).

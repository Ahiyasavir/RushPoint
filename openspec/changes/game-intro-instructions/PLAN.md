# Implementation Plan: game-intro-instructions

Optional game-level "How to play" primer (bilingual + optional https image), authored in the Builder,
persisted + https-guarded server-side, shown to players before start and in-game. Mirrors the
`narrative-chapters` `StoryBeat` shape/guard so nearly everything reuses a proven pattern.

## Exact files

### shared (`packages/shared/src`)
- `types/index.ts`
  - New `GameInstructions { title?; body?; bodyHe?; imageUrl? }` (place near `StoryBeat`, ~line 381).
  - `Game.instructions?: GameInstructions` (in the `Game` interface, ~line 428-476).
  - `UpdateGamePayload.instructions?: GameInstructions | null` (~line 1085).
  - `PublicGame.instructions?: GameInstructions` (~line 483) for the pre-join promo teaser.
- `gameInstructions.ts` (NEW) — pure helpers `cleanGameInstructions`, `gameInstructionsHasContent`,
  `localizedInstructionsBody` (see design.md for exact bodies).
- `index.ts` — add `export * from './gameInstructions';`.

### type + sanitize/clean helper (with RED test)
- `scripts/test-game-instructions.ts` (NEW, RED first) — assert `cleanGameInstructions`
  (trim; keep https image, drop non-https/http; empty→undefined; full primer preserved),
  `gameInstructionsHasContent`, `localizedInstructionsBody` (he→bodyHe w/ fallback, en→body).
  Run via `npm test` (picked up by `scripts/run-unit-tests.mjs`). Confirm RED, then GREEN after 1.2.

### functions (`functions/src`)
- `games/index.ts`
  - `updateGame`: add `instructions` to the `UpdateGamePayload` destructure (~line 110-115); after
    the existing field assignments add:
    ```ts
    if (instructions !== undefined) {
      const cleaned = cleanGameInstructions(instructions);
      updates.instructions = cleaned ?? (admin.firestore.FieldValue.delete() as unknown as undefined);
    }
    ```
  - In the `visibility === 'public'` resync block (~line 215-232), add
    `instructions: merged.instructions ?? admin.firestore.FieldValue.delete()`.
  - Import `cleanGameInstructions` from `@rushpoint/shared`.
- `runs/index.ts`
  - `getMyTeamState` `game` subset (~line 2785-2795): add
    `instructions: cleanGameInstructions(game.instructions) ?? null`. Import the helper.

### creator-web (`apps/creator-web/src`)
- `pages/BuilderPage.tsx` — `StepDetails` (settings tab, `tab === 'settings'` at ~line 352): add a
  collapsible "How to play" section editing `game.instructions` via the existing `patch` helper:
  title input, EN body `<textarea>`, HE body `<textarea>` (both `dir="auto"`), optional image URL
  input, and a hint line. Rides the existing `updateGame` wrapper (no `calls.ts` change).
- `i18n.ts` — add to `builder` (HE + EN, language-pure): `instructionsSectionTitle`,
  `instructionsHint`, `instructionsTitleLabel`, `instructionsBodyLabel`, `instructionsBodyHeLabel`,
  `instructionsImageLabel`.

### play-web (`apps/play-web/src`)
- `store.ts` / `MyTeamState` type — add `game.instructions?: GameInstructions | null`.
- `screens/PlayScreen.tsx`
  - Waiting/pre-start view: render a "How to play" primer card when `gameInstructionsHasContent`
    (title + `localizedInstructionsBody(instructions, lang)` + optional image, `dir="auto"`).
  - In-run: a "How to play" button in the header opening a modal that reuses the `StoryInterstitial`
    card layout (image header + title + `whitespace-pre-line` body + close button).
- `screens/GamePromoScreen.tsx` (optional) — show `game.instructions` (from `publicGames`) under the
  description for the pre-join teaser.
- `i18n.ts` — add to `play` (HE + EN, language-pure): `howToPlay`, `howToPlayTitle`, `howToPlayClose`.

## updateGame persistence
Clean-or-clear pattern identical to `integrationWebhookUrl`: defined + has content ⇒ store cleaned
primer; defined + empty ⇒ `FieldValue.delete()`. https-guard lives in `cleanGameInstructions` (a
non-https image is dropped, never persisted). Public games resync the cleaned primer into
`publicGames` so the teaser never drifts.

## getMyTeamState exposure
`game.instructions = cleanGameInstructions(game.instructions) ?? null`. Cleaning at the echo boundary
(not only on save) means a legacy/hand-edited doc with a non-https image is still guarded outbound —
same defensive posture as the narrative `cleanBeat`.

## Builder + play-web UI wiring
- Builder: settings-tab section, `patch({ instructions: {...} })`, all chrome via `t.builder.*`,
  authored textareas `dir="auto"`.
- play-web: waiting-screen card + in-run modal, chrome via `t.play.*`, authored body `dir="auto"`,
  body language via `localizedInstructionsBody`.

## i18n keys (EN + HE)
- creator-web `builder`: `instructionsSectionTitle` ("How to play" / "איך משחקים"),
  `instructionsHint`, `instructionsTitleLabel`, `instructionsBodyLabel` (English body),
  `instructionsBodyHeLabel` (Hebrew body), `instructionsImageLabel`.
- play-web `play`: `howToPlay`, `howToPlayTitle`, `howToPlayClose`.
- HE values must be pure Hebrew, EN pure English (brand tokens like `https` allowed). Run
  `npm run i18n:check` (PART A hard gate) after every UI edit; keep PART B additions at zero.

## Gates (run before done)
`npm run typecheck` · `npm test` (incl. the new pure test) · `npm run lint` ·
`npm run creator:build` · `npm run play:build` · `npm run i18n:check` · `npm run e2e` (payload
changed — the `getMyTeamState.game.instructions` echo/strip/null scenario).

## 1. RED — failing tests first

- [x] 1.1 Create `scripts/test-game-presentation.ts` in the house style of
      `scripts/test-demo-draft.ts` (`ok(cond, msg)`, `passed`/`failed`, `process.exit`), importing
      `buildSavePayload` + `BUILDER_EDITABLE_FIELDS` from
      `../apps/creator-web/src/lib/savePayload` and `normalizeHttpsUrl`, `normalizeBrandColor`,
      `hasBrandingValue` from `../apps/creator-web/src/lib/gamePresentation`. Synthetic fixtures
      only — no network, no Firestore, no emulator.
- [x] 1.2 Encode the payload-completeness cases from the design's Test Strategy: every key in
      `BUILDER_EDITABLE_FIELDS` present and deep-equal for a fully-populated fixture; `gameId`
      taken from `game.id`; server-owned keys (`id`, `ownerUid`, `visibility`, `playCount`,
      `createdAt`, `updatedAt`, `deletedAt`) absent from the payload.
- [x] 1.3 Encode the regression that started this change: two games differing only in
      `scoringOptions.wrongAnswerPenalty` MUST serialize to different payload JSON, so the
      builder's dirty check sees the edit.
- [x] 1.4 Encode the `normalizeHttpsUrl`, `normalizeBrandColor` and `hasBrandingValue` cases from
      the Test Strategy, including the rejections (`http:`, `javascript:`, non-hex, shorthand
      expansion, whitespace-only).
- [x] 1.5 Create `functions/src/games/gameArea.test.ts` (vitest) encoding the `deriveGameArea` and
      `resolveGameArea` cases from the Test Strategy: empty, single, mean-on-grid, hideLocation,
      locationless, null island, out-of-range/NaN, purity + no input mutation, authored-wins,
      authored-but-unusable falls back.
- [x] 1.6 Run `npx tsx scripts/test-game-presentation.ts` and
      `npx vitest run src/games/gameArea.test.ts` (in `functions/`) and confirm BOTH fail for the
      right reason — the modules under test do not exist yet. Record the failures.

## 2. GREEN — pure logic

- [x] 2.1 Add `apps/creator-web/src/lib/savePayload.ts`: `BUILDER_EDITABLE_FIELDS` (the explicit
      allow-list) and `buildSavePayload(game)` returning `{ gameId, ...allow-listed fields }`,
      including the four that were missing — `scoringOptions`, `coverImage`, `branding`,
      `approxLocation`. No React import.
- [x] 2.2 Add `apps/creator-web/src/lib/gamePresentation.ts` with `normalizeHttpsUrl`,
      `normalizeBrandColor` and `hasBrandingValue`, each a pure total function returning
      `undefined` rather than throwing on junk input.
- [x] 2.3 Add `functions/src/games/gameArea.ts` with `deriveGameArea(stages)` — per-task
      `publicTaskLocation`, mean of the surviving cell centres, re-snapped through
      `approximatePublicPoint`, `undefined` when nothing survives — and
      `resolveGameArea(authored, stages)` preferring a usable authored area (label preserved).
- [x] 2.4 Re-run both test files and confirm they pass.

## 3. GREEN — wiring

- [x] 3.1 `apps/creator-web/src/pages/BuilderPage.tsx`: delete the local `buildSavePayload`
      literal, import it from `../lib/savePayload`, and leave `serializeGame` defined in terms of
      it so the dirty check and the wire format stay the same function.
- [x] 3.2 `functions/src/games/index.ts`: in `publishGame`, write
      `resolveGameArea(game.approxLocation, game.stages)` into the `publicGames` document instead of
      `game.approxLocation`, omitting the field entirely when it resolves to `undefined`.
- [x] 3.3 `functions/src/games/index.ts`: apply the same resolution in the
      `visibility === 'public'` resync inside `updateGame`, so an edit cannot leave the gallery
      entry describing a layout that no longer exists.

## 4. GREEN — creator UI

- [x] 4.1 Add the Hebrew and English `builder` dictionary entries for the presentation section
      (section title, hint, cover-image label, brand-name label, accent-colour label) to
      `apps/creator-web/src/i18n.ts`. Hebrew must be Hebrew, English must be English.
- [x] 4.2 Add a collapsible `PresentationField` to the Builder's details panel (same `Advanced`
      pattern as `InstructionsField`): cover image URL (`dir="ltr"`, normalized on blur), brand
      display name (`dir="auto"`), accent colour (`<input type="color">` + normalization).
      Static Tailwind class strings, logical `ms-`/`text-start` spacing, all copy through `t.*`.
- [x] 4.3 Patch branding as `undefined` when every value is empty, via `hasBrandingValue`, so the
      participant screens' `branding?.name ?? title` fallback cannot resolve to an empty string.

## 5. REFACTOR / VERIFY

- [x] 5.1 Re-read the audit's UNCREATABLE list and confirm nothing else was silently added to the
      Builder without a payload field.
- [x] 5.2 Gates: `npm run typecheck`, `npm run lint`, `npm test`, `npm run creator:build`,
      `npm run play:build`, `npm run i18n:check`, `npm run i18n:check:strict` — all green, output
      recorded verbatim.
- [x] 5.3 Record what is left unverified: no emulator lane was run (a live playtest stack is
      serving from this tree), so `publishGame`'s derived-area write is verified by unit test and
      static reading, not by an end-to-end publish.

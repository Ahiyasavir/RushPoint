# Tasks — הקמה מהירה (Quick Setup)

Strict RED then GREEN then REFACTOR. Each task is one cycle and independently checkable.

## Shared logic

- [ ] 1. RED: `scripts/test-template-wizard.ts` asserting `TemplateWizardStep` resolution
      (absolute and leaf-relative paths, ids beating indexes, unresolvable yields null),
      `isWizardStepConfigured` per field kind, and `orderQuickSetupSteps`. Run `npm test`, confirm
      it fails because `packages/shared/src/templateWizard.ts` does not exist.
- [ ] 2. GREEN: add `packages/shared/src/templateWizard.ts` with the type, `resolveWizardTarget`,
      `readWizardFieldValue`, `isWizardStepConfigured`, `orderQuickSetupSteps`,
      `remapWizardStepIds`; export from the barrel; add `Game.wizardSteps` and
      `UpdateGamePayload.wizardSteps`. Test passes.
- [ ] 3. RED: extend the same test with the marker rules: `stripOperatorNotes`, `isPlaceholderValue`
      and `extractQuickSetupSteps` over the shapes the real exported template uses
      (`[הערת מפעיל - למחוק]: …`, `[הוראות למפעיל - למחוק]: …`, `(ערכו את התשובה)` as an answer key).
      Confirm it fails.
- [ ] 4. GREEN: implement `OPERATOR_NOTE_MARKERS`, `stripOperatorNotes`, `isPlaceholderValue`,
      `extractQuickSetupSteps`. Test passes.

## Creator flow logic

- [ ] 5. RED: `scripts/test-quick-setup-flow.ts` for `quickSetupReducer` (open/next/defer/jump/
      close/resume/reset, next-into-deferred, empty list, index clamping), the derived badge count,
      `quickSetupLaunchBlockers`, persistence round trip plus malformed data, and
      `quickSetupFocusPlan` covering every registry entry. Confirm it fails.
- [ ] 6. GREEN: add `apps/creator-web/src/lib/quickSetup.ts`. Test passes.

## Server carry through

- [ ] 7. RED: `functions/src/games/wizardSteps.test.ts` (vitest) asserting `updateGame`
      normalization keeps a valid array, rejects a malformed one and drops dangling ids. Confirm it
      fails.
- [ ] 8. GREEN: normalize and validate `wizardSteps` in `updateGame`; carry it through
      `exportGameFile`/`importGameFile`, `duplicateGame`/`translateGame` and
      `createGameFromTemplate` (`cloneTemplateStages` returns its id map, `remapWizardStepIds`
      applies it). Add `wizardSteps` to `BUILDER_EDITABLE_FIELDS`.
- [ ] 9. Extend `scripts/e2e-verify.mjs`: save a game with `wizardSteps`, read it back from
      `getGame`, and round trip it through `exportGameFile` then `importGameFile`.

## Content clean up

- [ ] 10. Rewrite `apps/creator-web/src/templates.ts` so every seeded title, description, answer and
       step prompt is strictly player facing, and express each removed instruction as a
       `wizardSteps` entry on that template. No template ships `(ערכו את התשובה)` as an answer key.
- [ ] 11. Add the admin action that runs `extractQuickSetupSteps` over a Firestore-resident template
       from `AdminTemplatesPage`, showing what it would strip before it saves.

## UI

- [ ] 12. i18n: add `t.quickSetup` to both dictionaries (HE and EN), naming the feature
       `הקמה מהירה` / `Quick Setup` only. No raw dashes.
- [ ] 13. Add the `data-qs-field` anchors to `TaskWizard.tsx` and `BuilderPage.tsx` for every
       registry entry, and the `rp-qs-pulse` class to the creator stylesheet.
- [ ] 14. Build `components/QuickSetup.tsx`: the floating bar (step X of Y, the prompt, `הבא`,
       `חזור לזה מאוחר יותר`, `סגור הקמה מהירה`), the header pill, and `useQuickSetupFocus`.
- [ ] 15. Wire the Builder: open the target stage and mission editor, switch the editor tab, open the
       opt-in group, then focus and pulse the control.
- [ ] 16. Launch guard: intercept `saveAndLaunch` on `quickSetupLaunchBlockers`, and add the modal
       whose rows deep link back into the flow.

## UX refinement — warm, oriented and delightful

The first implementation worked but read as robotic: it jumped straight into input fields, had to be
found before it could help, spoke the template author's raw operational prose, and ordered a
mission's fields by whatever the author happened to write first.

- [x] 19. RED: extend `scripts/test-template-wizard.ts` for **"explain, then place"** — within one
       mission, fields sort identity → media → completion → place → conditions regardless of authored
       order, and two fields sharing a rank keep authored order (stable sort). Confirm it fails.
- [x] 20. GREEN: add `FIELD_RANK` / `quickSetupFieldRank` / `UNRANKED_FIELD_RANK` to
       `packages/shared/src/templateWizard.ts` and fold the rank into `orderQuickSetupSteps`.
- [x] 21. RED: extend `scripts/test-quick-setup-flow.ts` for the **context-first** state machine —
       `welcome`/`intro` statuses, `invite`/`begin` actions, `quickSetupChapterKey`, entry always
       landing on `intro`, same-mission moves going straight to `running`, `next` inert on an intro
       card while `defer` stays live, plus `shouldAutoOpenQuickSetup` and `missionSummaryLine`.
       Confirm it fails.
- [x] 22. GREEN: implement all of the above in `apps/creator-web/src/lib/quickSetup.ts`, and add
       `QUICK_SETUP_COPY_KEYS` + a `copy` slot on every `QUICK_SETUP_FIELDS` entry (asserted covered
       by the test, so a new field cannot ship speechless).
- [x] 23. i18n: add `welcome*`, `intro*`, `celebrate*` and the per-slot `copy` record to BOTH
       dictionaries — short, conversational, original copy, never the raw `instructionPrompt`.
- [x] 24. Build `QuickSetupWelcome`, `QuickSetupIntro`, `QuickSetupCelebration` and
       `QuickSetupProgressTrail`; move every surface onto the shared `GLASS_CARD`; demote the
       authored note to a quiet secondary line under the flow's own headline.
- [x] 25. Add the confetti + checkmark keyframes to `apps/creator-web/src/index.css`, with
       `prefers-reduced-motion` removing the confetti entirely and `pointer-events: none` on the field.
- [x] 26. Wire the Builder: auto-invite on load via `shouldAutoOpenQuickSetup`, gate the navigation
       effect on `running` so nothing moves behind a card, and fire the celebration on the `done`
       edge via a `useRef` check.

## Focus mode, accessible contrast, strict ordering, and stronger cleanup

Live review against the user's real exported template surfaced four more defects: the screen stayed
cluttered while quick setup ran, the welcome/completion copy read as low-contrast, the field order
put verification before location on a numeric-riddle mission (backwards for that mission type), and
one verb form of "delete this note" survived stripping.

- [x] 27. RED: extend `scripts/test-template-wizard.ts` for the FIVE lettered tiers (a. concept →
       b. details/riddle → c. location → d. verification → e. advanced), including the two order
       reversals from the old scheme (`locationClue` before the pin; verification AFTER the pin, not
       before it). Confirm it fails against the two-tier "explain then place" scheme.
- [x] 28. GREEN: rewrite `FIELD_RANK` in `packages/shared/src/templateWizard.ts` to the five-tier
       scheme; `locationClue` moves to tier b, `answers`/`numericAnswer`/`steps`/`smart.autoApprove`
       move to tier d (after location).
- [x] 29. RED: extend `scripts/test-quick-setup-flow.ts` for the synthetic game-name step
       (`quickSetupSteps` prepends `SYNTHETIC_GAME_TITLE_STEP` when a flow has real steps and none
       already targets the game's title; a flow with zero real steps gets none; a real title step
       pre-empts it). Confirm it fails, then fix every index shifted by the new leading step across
       the existing reducer assertions.
- [x] 30. GREEN: implement `SYNTHETIC_GAME_TITLE_STEP` + the prepend logic in
       `apps/creator-web/src/lib/quickSetup.ts`.
- [x] 31. Strengthen `OPERATOR_SENTENCE` (`packages/shared/src/templateWizard.ts`) with the verb
       forms a single infinitive missed: `תמחקו`, `מחקו`, `כשתסיימו`, `לאחר הקריאה`.
- [x] 32. Contrast: replace every `text-[--ink-3]` in `apps/creator-web/src/components/QuickSetup.tsx`
       with `text-[--ink-1]` (AAA in both themes; `--ink-2` falls short in dark mode at 6.15:1).
       Headline-vs-note hierarchy now comes from size/weight only.
- [x] 33. Focus mode: `BuilderPage` computes `qsFocusMode` from `qsState.status`; `StepStages` hides
       `StageRail` and scrims the canvas (`relative` + an absolute inset-0 layer) behind it, while the
       mission editor (`ContextPanel`, a sibling) stays untouched.
- [x] 34. Demo content polish: the seed script for live review renames the real template's two
       identically-titled "מצאו את המקום" missions so they read unambiguously.

## Gates

- [ ] 17. Run and confirm green: `npm run typecheck`, `npm run lint`, `npm test`,
       `npm run creator:build`, `npm run play:build`, `npm run bundle:budget`,
       `npm run base:check`, `npm run origin:check`, `npm run i18n:check:strict` (the whole of
       `npm run verify`). The i18n gate must add zero new PART B findings.
- [ ] 18. Run `npm run e2e` against the emulator and confirm the new assertions pass with the
       callable coverage guard still green.

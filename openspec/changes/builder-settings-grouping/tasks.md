# Tasks — builder-settings-grouping

## RED

- [x] 1. Write `scripts/test-game-feature-toggles.ts` against the not yet existing
      `apps/creator-web/src/lib/gameFeatureToggles.ts`: empty game ⇒ count 1 (photo feed default on),
      `photoFeedEnabled:false` alone ⇒ 0, all four on ⇒ 4, the mixed case ⇒ 2, `gameFeatureToggleState`
      resolves each field to its effective boolean per the design table, and the totality sweep over
      `null`/`undefined`/`42`/`'x'`/`[]`. Run it, confirm it fails on the missing module, record output.
- [x] 2. Add the wiring guard to the same suite (source scan): `i18n.ts` defines the new "Game
      features" section title key and the "N on" badge key in BOTH language maps. RED.

## GREEN

- [x] 3. Create `apps/creator-web/src/lib/gameFeatureToggles.ts`: `GameFeatureToggleState`,
      `gameFeatureToggleState()`, `enabledGameFeatureCount()`. Pure, total, no React, no Firebase.
      Re-run the suite to green on the pure half.
- [x] 4. Add the HE + EN copy to `apps/creator-web/src/i18n.ts` under `builder` (additive only; the
      file is contended by parallel agents, so re-read immediately before editing): the section title
      and the `featuresOnBadge(n)` label. No em dash, no en dash, no spaced hyphen.
- [x] 5. Reflow `StepDetails` in `apps/creator-web/src/pages/BuilderPage.tsx`: add `advFeatures`
      state; wrap the four existing toggle `label`/`input` pairs and their help paragraphs, verbatim,
      in one collapsed `Advanced` titled `b.featuresSection` with a `meta` badge reading
      `enabledGameFeatureCount(game)`; move `TagsField` down into the collapsed stack; keep Mode and
      Short description flat. Change NO checkbox `checked`/`onChange` expression.
- [x] 6. Re-run `npx tsx scripts/test-game-feature-toggles.ts` and confirm ALL PASS.

## REFACTOR / VERIFY

- [x] 7. `npx tsx scripts/check-i18n.ts --strict` clean, zero new PART B findings.
- [x] 8. Preview check (creator-web): Builder ▸ Settings ▸ the four toggles are inside a collapsed
      "Game features" section whose badge shows the right count; expand reveals all four; each still
      toggles and autosaves; Tags is now in the collapsed stack; Mode + Short description stay flat.
- [x] 9. Hand the full gate set to the parent (`npm run typecheck`, `npm run lint`, `npm test`,
      `npm run creator:build`, `npm run play:build`, `npm run bundle:budget`,
      `npm run i18n:check:strict`). This lane must not run them: they rewrite `packages/shared/dist`
      in place and other agents are live on this tree.
- [x] 10. Confirm no e2e owed: no callable added or changed, no `Task` field, `ALLOWED_TASK_KEYS`
      untouched, `savePayload.ts`/`BUILDER_EDITABLE_FIELDS` untouched.

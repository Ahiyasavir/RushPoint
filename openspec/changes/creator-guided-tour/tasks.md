# Tasks — creator-guided-tour

## RED

- [x] 1. Write `scripts/test-creator-tour.ts` against the not-yet-existing tour exports
      (`TOUR_STEPS`, `buildTourSteps`, `tourReducer`, `currentTourStep`, `tourProgress`,
      `readTourRecord`, `writeTourRecord`, `tourRecordFor`, `tourStorageKey`,
      `shouldAutoStartTour`, `resolveTourAnchoring`, `tourStepTarget`, `tourCardPosition`):
      the design §9 list, all ten groups. Confirm RED for the right reason (missing exports),
      record the output.

## GREEN

- [x] 2. Extend `apps/creator-web/src/lib/creatorOnboarding.ts` with the tour data + reducer +
      persistence + resolvers. Pure: no React, no Firebase, no DOM. Existing checklist exports
      unchanged.
- [x] 3. Append the `tour` block (HE + EN) to `apps/creator-web/src/i18n.ts` — 15 step titles and
      bodies plus chrome. Re-read the file immediately before editing (contended).
- [x] 4. Run `npx tsx scripts/test-creator-tour.ts` — GREEN.

## RENDER

- [x] 5. New `apps/creator-web/src/components/CreatorTour.tsx`: spotlight overlay driven entirely by
      the pure module, plus the exported `restartCreatorTour()` helper. Every string from `t.tour`,
      logical RTL classes, real buttons with accessible names, dynamic geometry via inline style.
- [x] 6. Mount it in `App.tsx`, add the header `?` help button, add `data-tour` to the desktop nav
      links only — a second copy in the mobile drawer would make the selector ambiguous, and a
      hidden (0x0) element is treated as absent so the step centres on a phone.
- [x] 7. Add the `data-tour` anchors: `DashboardPage.tsx` (`new-game`, `game-list`),
      `BuilderPage.tsx` (`builder-canvas`, `builder-tabs`, `builder-launch`),
      `StageRail.tsx` (`builder-stages`). Attributes only.
- [x] 8. Add the "replay the tour" card to `SettingsPage.tsx`.

## VERIFY

- [x] 9. `npx tsx scripts/test-creator-tour.ts` green; `npx tsx scripts/check-i18n.ts --strict`
      clean (PART A zero errors, zero NEW PART B findings).
- [x] 10. Report to the parent: files touched, the one out-of-scope attribute in `StageRail.tsx`,
      and the gates the parent must run (`typecheck`, `lint`, `test`, `creator:build`,
      `bundle:budget`, `i18n:check:strict`).

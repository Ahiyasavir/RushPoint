## 1. The arbiter contract (pure) — RED

- [x] 1.1 Write `scripts/test-builder-guidance.ts` against a not-yet-existing
      `apps/creator-web/src/lib/builderGuidance.ts`, encoding the EXHAUSTIVE priority table: all
      2^5 = 32 subsets of `{launch-confirm, quick-setup, tour, spotlight, ready-nudge}` produce
      exactly one winner, and that winner is the first member of `GUIDANCE_PRIORITY` present in
      the subset; the empty set yields `null`. No case implicit — this is the decision that can
      put two overlays on screen. Run it and confirm it fails because the module does not exist.
- [x] 1.2 Extend the same test with totality: `null`, `undefined`, an empty iterable, a duplicated
      surface, and an unrecognised surface name each resolve to a defined value, never throw, and
      an unrecognised name never wins. Confirm RED.
- [x] 1.3 Extend the same test with a completeness guard: `GUIDANCE_PRIORITY` contains every
      member of the `GuidanceSurface` union exactly once, so a sixth surface that is never ranked
      fails the gate rather than silently never rendering. Confirm RED.
- [x] 1.4 Extend the same test with the deferred-tour table over
      {source: help, auto} x {tour wins, tour loses} → `start` / `hold` / `drop`, asserting that
      an `auto` request that loses is DROPPED and never held. Confirm RED.

## 2. The arbiter contract (pure) — GREEN

- [x] 2.1 Write `apps/creator-web/src/lib/builderGuidance.ts` with the minimum to pass 1.1-1.4:
      `GuidanceSurface`, `GUIDANCE_PRIORITY`, `activeGuidance`, `tourRequestOutcome`. Every
      function total and non-throwing on malformed input.
- [x] 2.2 Run `node --import tsx scripts/test-builder-guidance.ts` and confirm ALL PASS.

## 3. The provider

- [x] 3.1 Add `apps/creator-web/src/components/GuidanceProvider.tsx` — a context holding the
      candidate set, deriving the winner via `activeGuidance`, exposing
      `useGuidanceCandidate(surface, wants)`, `useGuidanceVisible(surface)` and
      `requestTour(source)`. Memoise the context value on the derived winner, not the set (design
      D2 risk). Hooks must sit above any early return in their consumers (React #300).
- [x] 3.2 Mount it in `App.tsx` ABOVE both `<CreatorTour />` and the routed Builder, so both can
      consult it.

## 4. Convert the five surfaces

- [x] 4.1 `CreatorTour.tsx`: register candidacy from its `running` status; route the auto-start
      and the `rp-tour-restart` event through `requestTour('auto' | 'help')`; DELETE
      `isCreatorTourRunning()` and the render-time `tourRunning` module global.
- [x] 4.2 `BuilderSpotlight.tsx`: register candidacy instead of deciding once at the 700 ms
      settle; render on `useGuidanceVisible('spotlight')`; DELETE the `quickSetupActive` prop and
      the `isCreatorTourRunning` import. Confirm the `spotlightSeenKey` write stays on `finish()`
      only and is unreachable from the suppression path (design D4).
- [x] 4.3 `BuilderPage.tsx`: register `quick-setup` candidacy from `qsState.status` and drop the
      `quickSetupActive` prop it was passing; gate the five Quick Setup render sites on
      `useGuidanceVisible('quick-setup')` (welcome, intro, floating bar, inline bar, celebration —
      `QuickSetupBlocked` is a launch refusal, not guidance: leave it ungated and say so in a
      comment).
- [x] 4.4 `BuilderPage.tsx`: gate the ready nudge (~L1395) on `useGuidanceVisible('ready-nudge')`
      alongside its existing conditions.
- [x] 4.5 `BuilderPage.tsx`: register `launch-confirm` candidacy around the awaited
      `dialog.confirm` (~L657), cleared in a `finally` so a throw cannot leak candidacy (design
      D5).
- [x] 4.6 Implement the deferred-tour acknowledgement using the console's existing transient
      acknowledgement pattern; add its string to BOTH dictionaries in `i18n.ts`. No hardcoded
      literal.

## 5. Verify in a real browser

- [x] 5.1 At 375 px and 1280 px on a templated game: הקמה מהירה wins on first open and the
      spotlight is absent; confirm no "spotlight seen" record was written (task 4.2's rule) by
      reopening the Builder after closing quick setup and seeing the spotlight offered.
- [x] 5.2 Press "?" mid-הקמה-מהירה: no second overlay, the acknowledgement shows, and the tour
      starts once quick setup is closed. Then press "?" with nothing running: the tour starts
      immediately.
- [x] 5.3 Confirm the ready nudge appears only on an otherwise-quiet ready game, and that a
      launch confirmation suppresses it.
- [x] 5.4 Sweep for a two-overlay combination at 375 px; assert in the page that at most one
      guidance surface is in the DOM at a time.

## 6. Gates

- [x] 6.1 Re-run the neighbouring pure suites: `scripts/test-builder-spotlight.ts`,
      `scripts/test-quick-setup-flow.ts`, `scripts/test-creator-tour.ts`. All green.
- [x] 6.2 Run `npm run verify` redirected to a file and read the captured exit code — never a
      piped tail (CLAUDE.md). All nine gates green.
- [x] 6.3 Confirm `npm run i18n:check:strict` reports zero NEW PART B findings for the
      acknowledgement string.
- [ ] 6.4 Run `npm run e2e` against a FRESH emulator (`emulator-exec`, not a re-used dev stack —
      a re-used one aborts the authz scenario on `auth/email-already-exists`) and confirm green.
      Regression check only; no callable changed.
- [ ] 6.5 Report what was verified in a real browser vs. what still needs a real iPhone, per the
      standing rule that no gate in this repo can see overlay stacking on a device.

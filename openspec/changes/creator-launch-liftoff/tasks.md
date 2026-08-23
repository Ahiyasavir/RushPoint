## 1. RED — failing test for the rotation seam

- [x] 1.1 Add `scripts/test-launch-liftoff.ts` (auto-discovered by the `npm test` aggregator)
      asserting `liftoffStepIndex(tick, count)` from `apps/creator-web/src/lib/launchLiftoff.ts`:
      - count `0` and `1` ⇒ always `0` (no rotation);
      - count `3`, tick `0,1,2,3,4` ⇒ `0,1,2,0,1` (wraps);
      - negative tick and non-finite tick/count ⇒ defined, in `[0, count)`, never throws.
- [ ] 1.2 Run `npm test` and confirm this suite FAILS (module does not exist yet) — RED.
      (Left for the parent — this implementer does not run the build/test lane.)

## 2. GREEN — minimum code to pass + the UI

- [x] 2.1 Add `apps/creator-web/src/lib/launchLiftoff.ts` exporting `liftoffStepIndex` per design
      (total, never throws) so the test goes GREEN.
- [x] 2.2 Add the `launch` i18n namespace (HE + EN, in parity) to `apps/creator-web/src/i18n.ts`:
      `title`, `step1`, `step2`, `step3` with the design's copy. No em-dash.
- [x] 2.3 Add `@keyframes rp-liftoff-sweep` + its `prefers-reduced-motion` guard to
      `apps/creator-web/src/index.css`, mirroring the existing `rp-skeleton` block.
- [x] 2.4 Add `apps/creator-web/src/components/LaunchLiftoff.tsx`: dark-theme full-screen overlay,
      rotates `messages` via `liftoffStepIndex` on a `setInterval` (cleared on unmount),
      `role="status"` + `aria-live="polite"` + `dir="auto"`, indeterminate sweeping bar; under
      `prefersReducedMotion()` show `messages[0]` only + a static bar fill; renders `null` when
      `!open`. No store, no callable, no new dependency.
- [x] 2.5 Wire `BuilderPage.tsx`: add a `launching` state, set it around `saveAndLaunch`'s
      save+`launchRun`, render `<LaunchLiftoff open={launching} title={t.launch.title}
      messages={[t.launch.step1, t.launch.step2, t.launch.step3]} />`, pass `loading={launching}`
      to both launch buttons (lines 531-532), and clear `launching` in a `finally`.
- [x] 2.6 Wire `DashboardPage.tsx`: same `launching` state + overlay + `loading` on the launch
      control + `finally` clear, passing the SAME `t.launch.*` messages.

## 3. REFACTOR

- [x] 3.1 Confirm both call sites pass identical messages; extract a tiny shared messages array if it
      reduces duplication without adding indirection. (Both pass the same inline
      `[t.launch.step1, t.launch.step2, t.launch.step3]`; kept inline — no shared array needed since
      each page already reads `t` and the literal is a one-liner, avoiding cross-page indirection.)
- [x] 3.2 Confirm the reduced-motion branch degrades to a static label + fill (no chasing bar), and
      that the overlay always clears on the error path. (Component branches on
      `prefersReducedMotion()` for a static 35% fill and shows `messages[0]` only; both call sites
      clear `launching` in a `finally`.)

## 4. Gates

- [ ] 4.1 `npm test` green (includes `test-launch-liftoff`).
- [ ] 4.2 `npm run i18n:check:strict` clean (mandatory after this UI change — HE is HE, EN is EN, no
      new PART B hardcoded string).
- [ ] 4.3 `npm run verify` green (typecheck · lint · test · creator:build · play:build ·
      bundle:budget · base:check · i18n:check:strict).

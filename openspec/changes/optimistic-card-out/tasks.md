# Tasks — optimistic-card-out

TDD: the one pure module (`resolveCardExit`) is written test-first; the rest is a play-web UI lane
(no component test runner) verified by build + i18n gates.

> ⚠️ **Sequence AFTER `play-working-feedback`.** It edits the same `TaskRunner.tsx` success region
> (the `onChanged()` success calls + the routing card). Re-read that region **by content** before
> wiring — the design's line anchors will have drifted. Do not clobber its success beat or `<Working>`
> panel; this change only adds the outgoing card's exit motion.

## RED → GREEN — pure exit-decision helper

- [x] 1. **RED:** add `scripts/test-card-exit.ts` asserting `resolveCardExit(reducedMotion)`:
      `false` ⇒ `{ animate: true, delayMs: CARD_EXIT_MS }` with `0 < delayMs <= 400`;
      `true` ⇒ `{ animate: false, delayMs: 0 }`. Run `npm test` — it must FAIL (module absent).
- [x] 2. **GREEN:** create `apps/play-web/src/lib/cardExit.ts` exporting `CARD_EXIT_MS` (~220) and
      `resolveCardExit` per design §2 (total, no side effects, never throws). `npm test` green.

## GREEN — CSS + UI

- [x] 3. Add `@keyframes rp-card-exit` + `.rp-card-exit` (and the `[dir="rtl"]` flip of
      `--rp-card-exit-dx`) to `apps/play-web/src/index.css`, beside `rp-working`, per design §4. Confirm
      the existing `@media (prefers-reduced-motion: reduce)` block already neutralizes it (no new
      reduced-motion CSS needed).
- [x] 4. In `TaskRunner.tsx`, add an `exiting` state flag and a one-shot `runOnChanged` wrapper around
      the existing `onChanged()`. On each **confirmed-success** branch (`submitCheckIn`, `verify`, the
      `res.correct` branch of `answer()` and `submitOrdered()`, `geofenceArrive`), replace the direct
      `onChanged()` with: read `prefers-reduced-motion` (mirror `confetti.ts:13`), `resolveCardExit(...)`,
      then either set `exiting` + `setTimeout(runOnChanged, plan.delayMs)` or call `runOnChanged()`
      immediately. Design §3. **Do NOT** touch the wrong-answer path, the sequence-*step* `onChanged`
      (`:675`), or the arrival-unlock `onChanged` (`:524`).
- [x] 5. Apply the `rp-card-exit` class to the active task `<Card>`'s className when `exiting` is set
      (both the interactive and the sealed `data-testid="task-card"` variants). Clear the pending timer
      on unmount so a navigation-away mid-exit is a no-op.

## Verify (build lane — this agent)

- [x] 6. `npm test` — `test-card-exit` green (plus the whole aggregator).
- [x] 7. `npm run verify` (typecheck · lint · test · creator:build · play:build · bundle:budget ·
      base:check · i18n:check:strict) — green. Especially `bundle:budget` (no new dependency / eager
      heavy import) and `i18n:check:strict` (zero new PART B warnings — the change adds no copy).
- [x] 8. `npx openspec validate optimistic-card-out --strict` — passes.

## Manual (parent / owner — UNVERIFIED here)

- [ ] 9. A correct answer visibly slides the task card toward the reading end (left in Hebrew, right in
      English) then the next phase (`<Working>` / next card) mounts; wrong answers and viewer/readonly
      devices show **no** card-out.
- [ ] 10. A `prefers-reduced-motion: reduce` device advances instantly with no animation, and the next
      task always appears even when the exit animation is interrupted (the JS timer, not `animationend`,
      drives progression).

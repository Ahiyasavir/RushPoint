# Tasks — play-working-feedback

TDD: the one pure module (`workingMessageIndex`) is written test-first; the rest is a play-web UI
lane (no component test runner) verified by build + i18n gates. `TaskRunner.tsx` is being edited by
another agent — anchor by content (the routing `Card` with `t.task.routing` + `shouldOfferRetry`;
the `onChanged()` success calls), not by absolute line.

## RED → GREEN — pure message-index helper

- [x] 1. **RED:** add `scripts/test-working.ts` asserting `workingMessageIndex(tick, count)`:
      count 0 and 1 ⇒ always `0` (static); count 3 ⇒ `0,1,2,0,1,2` across ticks 0..5; a negative tick
      and a very large tick both stay in `[0,count)`. Run `npm test` — it must FAIL (helper absent).
- [x] 2. **GREEN:** create `apps/play-web/src/lib/working.ts` exporting `workingMessageIndex` per
      design §2 (`count<=1 ⇒ 0`, else `((tick % count)+count)%count`; total, never throws). `npm test`
      green.

## GREEN — UI

- [x] 3. Add the three i18n keys to **both** dictionaries in `apps/play-web/src/i18n.ts` under
      `task.*`: `workingChecking` / `workingLocating` / `workingPrepping` (HE + EN per design §5, no
      em-dash).
- [x] 4. Add `@keyframes rp-working` (indeterminate left→right sweep) to
      `apps/play-web/src/index.css`, near `rp-shimmer`; ensure the reduced-motion block neutralizes it.
- [x] 5. Create `apps/play-web/src/components/Working.tsx` per design §1: `messages` rotation via
      `workingMessageIndex` on an interval (default 1800 ms), `role="status" aria-live="polite"
      dir="auto"` status line, the brand-gradient advancing bar (indeterminate sweep, or determinate
      when `progress` given), logical (`start`/`inset-inline-start`) inset for RTL, a `children` slot,
      and a `prefers-reduced-motion` guard that skips the rotation timer and the sweep. Interval
      cleaned up on unmount. Pure/presentational — no store, no callable, no dictionary import.
- [x] 6. Wire `<Working>` into the routing/grading `Card` in `TaskRunner.tsx` (the `t.task.routing`
      branch) passing `[t.task.workingChecking, t.task.workingLocating, t.task.workingPrepping]` and
      the existing `shouldOfferRetry(...)` retry Button as `children`. Preserve the retry handler and
      the aria-live announcement.
- [x] 7. Add the success beat: import `feedback` from `../lib/sound` and call `feedback('task')` on
      each server-confirmed success (`submitCheckIn`, `verify`, the `res.correct` branch of `answer()`,
      geofence arrive). Fire only on confirmed success — never on a wrong answer, never for a
      viewer/readonly device. Do not edit `sound.ts`.

## Verify (build lane — this agent)

- [x] 8. `npm test` — `test-working` green.
- [x] 9. `npm run verify` (typecheck · lint · test · creator:build · play:build · bundle:budget ·
      base:check · i18n:check:strict) — green. Especially `bundle:budget` (no new heavy/eager import)
      and `i18n:check:strict` (both dicts define the three keys, zero new PART B warnings).
- [x] 10. `npx openspec validate play-working-feedback --strict` — passes.

## Manual (parent / owner — UNVERIFIED here)

- [ ] 11. On a real slow route the routing panel cycles the three branded lines and the bar advances
      left→right; reduced-motion shows a static first message + static bar.
- [ ] 12. A correct answer plays the cue with sound on and is silent when muted; wrong answers stay
      silent as before.

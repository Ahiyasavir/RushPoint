## 1. RED — failing tests first

- [x] 1.1 Create `scripts/test-stuck-player-guards.ts` in the house style of
      `scripts/test-async-action-guard.ts` (`check(label, cond, detail)`, a `failures` counter,
      `process.exit`), importing `gpsRetryDelayMs`, `offlineSubmitGate` and `helpAlreadySent` from
      `../apps/play-web/src/lib/stuckGuards`.
- [x] 1.2 Encode the `gpsRetryDelayMs` cases from the design's Test Strategy: 1/2/3/4/5/100, the
      cap boundary (`4 → 24000`, `5 → 30000`), invalid inputs (`0`, `-1`, `NaN`, `±Infinity`,
      non-number) mapping to the base, and the 0…200 sweep invariants (finite, `> 0`, `<= 30000`,
      non-decreasing) that encode "the watcher never gives up".
- [x] 1.3 Encode the `offlineSubmitGate` cases: online, unknown connectivity, first offline attempt
      (blocked + records the task), repeat attempt on the same task (NOT blocked), a different task
      (blocked once more), and the reload case (a fresh `nudgedForTaskId: null` state behaves like a
      first run and nothing is read from storage).
- [x] 1.4 Encode the `helpAlreadySent` cases, including the failed-request case
      (`sentForTaskId === null` ⇒ affordance still available) and the task-change re-arm.
- [x] 1.5 Add the clock-skew invariance sweep: re-run every case with `Date.now` stubbed to `0`,
      `+6h` and `−6h` and assert identical results in all three worlds.
- [x] 1.6 Add the wiring guards over `apps/play-web/src/components/TaskRunner.tsx` source:
      `gpsRetryDelayMs(`, `offlineSubmitGate(`, `helpAlreadySent(` are all referenced, and
      `GeofenceAuto` restarts its watch (a `setTimeout` in the error path) instead of only clearing
      it.
- [x] 1.7 Run `npx tsx scripts/test-stuck-player-guards.ts` and confirm it FAILS for the right
      reason (`lib/stuckGuards.ts` does not exist and the component is not wired). Record the
      failure verbatim.

## 2. GREEN — pure guards

- [x] 2.1 Add `apps/play-web/src/lib/stuckGuards.ts` with `gpsRetryDelayMs`, `offlineSubmitGate`
      and `helpAlreadySent` per design D1/D3/D4/D5. No React, no storage, no `Date.now`.
- [x] 2.2 Re-run `npx tsx scripts/test-stuck-player-guards.ts`; the pure-function sections go GREEN
      and only the wiring guards remain red.

## 3. GREEN — component wiring

- [x] 3.1 `GeofenceAuto` (`TaskRunner.tsx`): restart `watchPosition` after an error using
      `gpsRetryDelayMs(consecutiveErrors)`, clear `gpsError` and reset the counter on a successful
      fix, and cancel both the watch and the pending retry timer in the effect cleanup.
- [x] 3.2 Replace `helpSent: boolean` with `helpSentFor: string | null`; set it to the task id after
      a successful `triggerSOS`, and pass `helpAlreadySent(helpSentFor, task.id)` to `GeofenceAuto`.
- [x] 3.3 Rewrite `blockedOffline` to decide via `offlineSubmitGate`, keeping the per-task nudge
      memory in a ref, and append the new "tap again to try anyway" copy to the nudge.
- [x] 3.4 Add `t.task.offlineTapAgain` and `t.task.gpsRetrying` to BOTH dictionaries in
      `apps/play-web/src/i18n.ts` (Hebrew in Hebrew, English in English); show the retrying line on
      the GPS error card.
- [x] 3.5 Re-run `npx tsx scripts/test-stuck-player-guards.ts` and confirm fully GREEN.

## 4. REFACTOR + gates

- [x] 4.1 Re-read the changed regions of `TaskRunner.tsx` for a concurrently-edited file, and check
      that no other `begin()` call site lost its `finally`.
- [x] 4.2 `npm run typecheck` — green.
- [x] 4.3 `npm run lint` — 0 errors.
- [x] 4.4 `npm test` — green (includes the new file via `run-unit-tests.mjs`).
- [x] 4.5 `npm run i18n:check` clean (PART A hard gate) and `npm run i18n:check:strict` with zero
      NEW PART B warnings.
- [x] 4.6 `npm run play:build` and `npm run creator:build` — green.
- [x] 4.7 Record the verbatim gate output and flag what stays unverified (on-device GPS-loss
      recovery; the emulator-bound gates are deliberately not run — a live playtest stack owns the
      emulator).

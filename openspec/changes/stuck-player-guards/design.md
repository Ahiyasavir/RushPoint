## Context

The participant app already treats the server as the only authority on whether an action is allowed
(`completeTask`, `submitTaskAnswer`, `verifyStationCode`, `reportArrival` all re-validate). The
danger is therefore never "the client let them try and the server refused" — it is "the client
refused on the client's own say-so, and nothing cleared it".

State of the audited surface, each item verified in this working tree:

- `TaskRunner.tsx:1094-1118` — `GeofenceAuto`'s effect starts ONE `watchPosition`. The error
  callback (`:1113`) is `() => { setGpsError(true); navigator.geolocation.clearWatch(id); }`. There
  is no retry, no timer, and the success callback never sets `gpsError` back to `false`. The effect
  deps are `[coords?.lat, coords?.lng, radius]`, all constant for the assigned task, so the only
  recovery is being routed to a different geofence task or a full reload — and a reload lands on the
  same task and the same dead spot.
- `TaskRunner.tsx:107` — `const [helpSent, setHelpSent] = useState(false)`, set at `:377` inside
  `requestHelp`'s try (a FAILED `triggerSOS` correctly leaves it false — that part is sound), read
  at `:754` and rendered at `:1123`. The per-task reset effect at `:190`
  (`useEffect(() => { setHint(null); setMsg(null); }, [assignedRec?.taskId])`) does not include it.
- `TaskRunner.tsx:286-292` — `blockedOffline` reads `navigator.onLine` at call time and is the first
  statement of 10 handlers (`:392,411,426,449,465,483,542,559,576,598`), including `geofenceArrive`,
  which is fired by the watcher rather than by a tap.
- Already sound, and deliberately unchanged: `withLocation` (one of its two callbacks always fires,
  `timeout: 5000`); the `begin()`/`end()` in-flight pair (every call site releases in a `finally`
  or `.finally`); `useAsyncAction` (`finally` on resolve AND reject); `ExpiryCountdown` and
  `StageDropCountdown` (display-only — neither disables a control, and the 12 s poll opens the stage
  regardless of the countdown); `GeofenceAuto`'s `fired` latch (already un-latches on a failed
  arrival); `PlayScreen`'s `reconnecting` pill (never blocks, and a 3 s retry loop clears it).

Hard constraint: a live playtest stack (Vite 5180/5181, Firestore emulator 8080) serves from this
tree. Nothing in this change may start, stop or restart a process, and the emulator-bound gates
(`e2e`, `test:rules`, `simulate`) are deliberately not run — every decision here is pure logic
verified in the no-emulator lane, and the React wiring is verified statically plus by the production
builds.

## Goals / Non-Goals

**Goals:**
- No client-only state may permanently prevent a participant from attempting progress.
- Every blocking decision is a pure function taking counters/durations — never an absolute instant
  compared against the device clock, never anything read back from storage.
- Recovery is automatic where the environment recovers on its own (GPS), and one tap away where it
  does not (offline).

**Non-Goals:**
- Relaxing any SERVER gate. Nothing here makes an invalid submission succeed; it only lets the
  player reach the server so the server can answer.
- Adding a manual "I'm here" button to `geofence` tasks for real runs. That is a product decision
  about the task type (test-drive already has one) and is out of scope; this change makes the
  automatic path recover instead.
- Touching the wrong-answer retry lockout (`packages/shared/src/wrongAnswerPenalty.ts` and its
  `TaskRunner` consumer). It is already duration-based and owned by another change.

## Decisions

### D1 — The guards live in `apps/play-web/src/lib/stuckGuards.ts`, not in the component

`play-web` has no component test runner, so any decision left inside a `.tsx` can only be eyeballed.
`lib/failureCopy.ts` already established the pattern (extract the decision, cover it in
`scripts/test-*.ts`). Three exported functions:

| Function | Signature | Fails open by |
|---|---|---|
| `gpsRetryDelayMs` | `(consecutiveErrors: number) => number` | always returning a finite, bounded delay — there is no input for which the watcher gives up |
| `offlineSubmitGate` | `({ online, nudgedForTaskId, taskId }) => { blocked, reason, nudgedForTaskId }` | blocking at most ONE attempt per task, then allowing |
| `helpAlreadySent` | `(sentForTaskId, taskId) => boolean` | returning `false` for a different task, so the affordance re-arms |

None of them takes a clock. `gpsRetryDelayMs` returns a DURATION the caller feeds straight to
`setTimeout`; `offlineSubmitGate` and `helpAlreadySent` are decided by identity comparison only.
This is the generalization of the lesson from the motivating bug — a duration is safe across a
skewed clock, an instant is not — applied by construction rather than by convention.

### D2 — Test lane: `scripts/test-stuck-player-guards.ts`, not vitest

The task template asks for vitest. `apps/play-web` has no vitest dependency and no vitest config
(`apps/play-web/package.json` — only `vite`/`tsc`/Playwright), and `turbo run test` reaches only
`functions`. The repo's canonical lane for play-web pure logic is a `scripts/test-*.ts` tsx
assertion script imported directly from the app source — `scripts/test-async-action-guard.ts` does
exactly this against `apps/play-web/src/hooks/useAsyncAction.ts`, and `run-unit-tests.mjs` wires
every such file into `npm test`. Using it keeps the guards in the same gate without adding a second
test runner to a workspace that has none. Deviation recorded here deliberately.

### D3 — Bounded exponential backoff for the GPS watch, and NO give-up state

`gpsRetryDelayMs(n) = min(3000 · 2^(n-1), 30000)`, with any non-finite / non-positive input mapped
to the 3 s base. Rationale: a dead spot usually clears in seconds, so the first retry must be quick;
a genuinely denied permission would otherwise re-prompt in a tight loop, so the delay grows; and the
cap keeps a long outage recovering within half a minute of the signal returning. There is no
terminal state — a permission the player later grants in Settings is picked up by the next retry
without a reload.

The error card stays on screen while retrying (the player still needs to know why nothing is
happening) and the existing host-help affordance stays reachable from it. A successful fix clears
`gpsError` and resets the error counter, so an intermittent signal does not accumulate backoff.

### D4 — The offline gate nudges once per task, then defers to the network

Alternatives considered:
- *Drop the gate entirely.* Rejected: when the device really is offline, the localized nudge is
  better than a raw callable rejection, and it is the common case.
- *Add a "try anyway" button.* Rejected: a second control on ten call sites, including the automatic
  `geofenceArrive` path where there is no tap to attach it to.
- **Chosen:** the gate remembers the task id it nudged for. A second attempt on that same task is
  allowed through; the request either succeeds (the flag was wrong) or fails and is surfaced by the
  existing `submitError` classifier. Being per-TASK means a genuinely offline player still gets the
  nudge on each new task instead of a growing pile of silent failures.

For `geofenceArrive` the "second attempt" is simply the next GPS fix, so a phone with a wrong
`onLine` flag recovers by itself within seconds. The attempt rate is bounded by the fix rate
(`maximumAge: 5000`).

The nudge copy tells the player that tapping again will try anyway — a new key in BOTH dictionaries
(`t.task.offlineTapAgain`), appended to the existing offline message so `arrivalNeedsOnline` keeps
its distinct wording.

### D5 — `helpSent` becomes `helpSentFor: string | null`

The smallest change that fixes it: store the task id, compare through `helpAlreadySent`. A failed
`triggerSOS` still records nothing (the existing try/catch is already correct), so a network failure
cannot latch the button off.

## Risks / Trade-offs

- **A truly-offline player now reaches the network on the second tap and sees a generic failure
  instead of the offline nudge.** Accepted: they saw the offline nudge first, and `submitError`
  maps the rejection to localized copy. The alternative is the stuck state this change exists to
  remove.
- **The GPS watch retry re-arms the browser permission prompt on a denied device.** Bounded by the
  backoff and capped at 30 s; a permanently denied device shows the same error card it shows today.
- **Runtime behaviour on a real phone is not verified here** (no device, and the live stack must not
  be disturbed). The pure decisions are unit-tested and the wiring is asserted statically; on-device
  GPS-loss recovery is flagged as unverified.

## Test Strategy

Lane: `scripts/test-stuck-player-guards.ts` (tsx assertion script, no emulator), run by
`npm test` via `scripts/run-unit-tests.mjs`. RED before any behaviour changes.

1. **`gpsRetryDelayMs`**
   - 1→3000, 2→6000, 3→12000, 4→24000 (the exact value below the cap), 5→30000 (the cap boundary),
     100→30000.
   - Missing / invalid inputs: `0`, `-1`, `NaN`, `Infinity`, `-Infinity`, a non-number → the 3 s base.
   - Invariants over a sweep of 0…200: always finite, always `> 0`, always `<= 30000`, monotonically
     non-decreasing. "Always finite and positive" IS the fail-open property — no input makes the
     watcher stop retrying.
2. **`offlineSubmitGate`**
   - `online === true` → not blocked; `online === undefined` (no `navigator`) → not blocked.
   - `online === false`, never nudged → blocked, and the result carries the task id to remember.
   - `online === false`, already nudged for THIS task → NOT blocked (the fail-open case).
   - `online === false`, nudged for a DIFFERENT task → blocked once for the new task.
   - Reload persistence: a freshly-constructed state (`nudgedForTaskId: null`) behaves identically to
     a first run — the guard reads nothing from storage, so a reload cannot restore a blocked state.
   - Empty-string / missing task id does not make "never nudged" compare equal to "nudged".
3. **`helpAlreadySent`**
   - `(null, 'a') → false` (including after a FAILED request, which records nothing → the button
     stays available: the request-failure path leaves no latched flag).
   - `('a','a') → true`, `('a','b') → false`, `('a', null) → false`.
4. **Clock-skew invariance (both directions).** Every case above is re-run with `Date.now` stubbed
   to `0`, to `now + 6h` and to `now − 6h`; every result must be byte-identical. This is the
   generalized regression test for the motivating bug: these gates must not have a clock at all.
5. **Wiring guards** (static assertions over `TaskRunner.tsx` source, in the spirit of
   `scripts/test-callable-exports.ts`): the geofence watcher schedules a retry via
   `gpsRetryDelayMs(`, `blockedOffline` decides via `offlineSubmitGate(`, the help affordance is
   derived via `helpAlreadySent(`, and `clearWatch` is no longer the last word in the error path
   (`GeofenceAuto` must contain a `setTimeout` restart). These fail in RED and pass only once the
   component is actually wired to the guards.

Gates run (no emulator, live stack untouched): `npm run typecheck`, `npm run lint`, `npm test`,
`npm run play:build`, `npm run creator:build`, plus `npm run i18n:check` and
`npm run i18n:check:strict` for the two new dictionary keys.

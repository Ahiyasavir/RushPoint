# Test-drive "I'm here" proximity bypass — design & investigation (wave-j)

**Status:** DESIGN ONLY. No source touched. Implementation waits until the hidden-map
feature agent frees `functions/src/runs/index.ts`.

**Goal.** In a **test run** (`run.isTestDrive === true`), every "I'm here" / arrival /
proximity gate accepts the submission **regardless of physical distance**, so a creator
can walk the whole course from their desk while rehearsing. In a **real run**
(`isTestDrive` falsy) every gate is **byte-for-byte unchanged** — the anti-cheat that
rejects far-away check-ins still holds.

**Server-authoritative invariant.** The bypass keys on **nothing but the run doc's
`isTestDrive` flag** (server-read, CF-written at launch, `runs/index.ts:234`). It is
NEVER a client-supplied flag, header, or payload field. `session.isTestDrive` on the
client is UI-only (banner + affordance) and is never trusted for the accept/reject
decision.

---

## 1. Every proximity / presence gate a player hits

| # | Gate (callable) | File:line | What it checks | Blocks a far-away desk tester **today**? |
|---|---|---|---|---|
| 1 | **completeTask** — `field` / `self_report` / `geofence` check-in | `functions/src/runs/index.ts:2905-2919` | `hasRealCoords && (radius\|exact)` → `haversineKm(sub, coords)` then `evaluateTrigger(mode, distM, geofenceRadiusMeters, {hidden})`; throws `failed-precondition` "Too far…" | **YES** — the primary "I'm here" gate |
| 2 | **reportArrival** — unseal a hidden-location task | `functions/src/runs/index.ts:3071-3084` | Same predicate, `{hidden:true}`; returns `{arrived:false, reason}` (no throw, no distance leaked) | **YES** — sealed treasure-hunt tasks never unseal from the desk |
| 3 | **geofence auto check-in** (client) | client `apps/play-web/src/components/TaskRunner.tsx:441-455, 814-895` (`geofenceArrive` / `GeofenceAuto`) → server gate #1 | `GeofenceAuto` only calls `onArrive` when the position watcher reports `dist <= radius`; the completion then hits completeTask gate #1 | **YES** (double: client never auto-fires off-site **and** server would reject). Note: `geofence` type normalizes to `radius` via `normalizeTriggerMode`, so there is no *separate* server gate — it flows through #1. |
| 4 | **submitTaskAnswer** — `requirePresence` quiz/numeric/survey | `functions/src/runs/index.ts:3218-3223` | Only when `task.requirePresence`: `evaluatePresence(task.coordinates, {lat,lng}, geofenceRadiusMeters)` (lenient 150 m default); throws `failed-precondition` | **YES, but only if the creator set `requirePresence`** (default OFF ⇒ no gate) |
| 5 | **updateLocation** — safe-zone boundary soft-pause | `functions/src/index.ts:359-372` sets `team.outOfBounds`; enforced in **requestNextTask** `functions/src/runs/index.ts:2949-2952` (returns `{taskId:null, outOfBounds:true}`) | `isOutsideSafeZone({lat,lng}, game.safeZone)` → flags team out-of-bounds → no new task assigned | **INDIRECTLY YES** — only if the game has a `safeZone` **and** the tester's device pings real coords outside it. A tester who denies GPS / never pings is never flagged. |
| 6 | **verifyStationCode** — smart_station secret code | `functions/src/index.ts:784-908` | **NO proximity check.** Secret-code compare + attemptLimit + schedule/expiry only. | **NO** (not a proximity gate; the tester just needs the code) |
| 7 | **submitStationPhoto** — photo/audio task | `functions/src/index.ts:911-1010+` | **NO proximity check.** Storage-path IDOR (own run/team folder) + content-type + schedule/expiry only (wave-h). | **NO** (not a proximity gate) |
| — | shared `evaluateTrigger` / `evaluatePresence` / `haversineKm` | `packages/shared/src/geo.ts:38, 74-101, 118-131` | The pure distance predicates behind #1/#2/#4 | — (helpers, not callables) |

**Scope conclusion.** Exactly **three server callables** carry a real GPS-distance gate:
`completeTask` (#1, also covers geofence #3), `reportArrival` (#2), and
`submitTaskAnswer` when `requirePresence` (#4). Plus **one indirect** gate: the
`updateLocation`→`requestNextTask` safe-zone latch (#5). `verifyStationCode` and
`submitStationPhoto` need no bypass. That is the complete set to touch.

**`isTestDrive` reachability.** `resolveCallerTeam` (`runs/index.ts:2384-2407`) does
**NOT** load the run doc — it returns only `{ctx, teamId, team, teamRef}`. So none of
gates #1/#2/#4 currently have `run.isTestDrive` in hand at the gate. Each already reads
the run doc **conditionally** (only when a task carries a schedule/expiry): completeTask
`runs/index.ts:2869`, verifyStationCode `index.ts:845`, submitStationPhoto `index.ts:1010`,
`assertTaskNotExpired` `runs/index.ts:3169-3178`. `getJoinInfo` already surfaces
`isTestDrive` (`runs/index.ts:362`), confirming it lives on the run doc. **The bypass
therefore costs one run-doc read per gated submission in a test run** (see §2 for how to
keep the real-run path read-free).

---

## 2. Bypass design — one shared predicate, applied at every gate

### 2.1 The predicate (pure, in `packages/shared/src/geo.ts`)

```ts
/**
 * Whether a proximity/presence gate is satisfied.
 * In a TEST RUN (server-authoritative run.isTestDrive) any submission passes so a
 * creator can rehearse from their desk. In a real run the distance verdict rules.
 * `isTestDrive` MUST come from the server-read run doc, never a client payload.
 */
export function proximitySatisfied(distanceOk: boolean, isTestDrive: boolean | undefined): boolean {
  return isTestDrive === true || distanceOk;
}
```

Rationale for a single OR-predicate (vs. threading a `bypass` flag into
`evaluateTrigger`/`evaluatePresence`): it keeps the two distance functions **pure and
unchanged** (their existing unit/property tests stay green), and it makes the bypass a
**one-line, greppable wrapper** at each callsite so no gate is silently missed. The
predicate is trivially unit-testable in isolation.

### 2.2 Applied at each gate (all in the currently-held files)

- **Gate #1 completeTask** (`runs/index.ts:2905-2919`): after computing
  `verdict = evaluateTrigger(...)`, replace `if (!verdict.ok)` with
  `if (!proximitySatisfied(verdict.ok, run.isTestDrive))`. Also the missing-coords
  throw at `2906-2908` must be wrapped the same way (`if (!isTestDrive && (lat==null||…))`)
  — a desk tester with GPS denied sends no coords and must still pass.
- **Gate #2 reportArrival** (`runs/index.ts:3074-3083`): same two wraps — the
  missing-coords throw at `3074-3076` and the `if (!verdict.ok)` at `3079`. In a test
  run, `reportArrival` latches `arrivedAt` and returns `{arrived:true}` regardless.
- **Gate #4 submitTaskAnswer** (`runs/index.ts:3218-3223`): wrap
  `if (!verdict.ok)` with `proximitySatisfied(verdict.ok, run.isTestDrive)`. Note
  `evaluatePresence` returns `{ok:false}` for missing GPS too, so the single wrap
  covers both.
- **Gate #5 safe-zone** (`functions/src/index.ts:353-372`): cleanest to **short-circuit
  at the source** — in `updateLocation`, skip the breach/flag branch when
  `run.isTestDrive` (never set `team.outOfBounds:true` on a test run; a desk tester
  pinging their office would otherwise dead-end `requestNextTask`). This needs the run
  doc in `updateLocation` (it currently reads only the game for `safeZone`). Simpler
  alternative: gate the enforcement in `requestNextTask` (`runs/index.ts:2949-2952`) —
  `if (team.outOfBounds === true && !run.isTestDrive)`. **Recommend the requestNextTask
  guard** because `requestNextTask` can read the run doc once and it keeps the bypass
  co-located with the other run-flag checks; leave `updateLocation`'s alert untouched
  (a harmless test-run alert is fine and self-clears on the next inside ping).

### 2.3 Getting `run.isTestDrive` to each gate cheaply

Add the run flag to `resolveCallerTeam`'s return, loading the run doc **once**, OR read
it locally at each gate. To honor "real run byte-for-byte unchanged" **including
read-cost**, prefer a **lazy read**: only fetch the run doc for the flag when the gate is
about to *reject* (`!verdict.ok`), i.e.

```ts
if (!verdict.ok) {
  const run = await loadRun(ctx);            // one read, only on the would-reject path
  if (!proximitySatisfied(false, run?.isTestDrive)) throw …;
}
```

This means a **real run's happy path adds zero reads** (the gate passes on distance
before ever touching the run doc), and only a *failing* check pays the extra read — which
in a real run is the already-rejected far-away spoof, and in a test run is every desk
check-in (acceptable; test runs are 2-person rehearsals). This is the recommended shape.

### 2.4 Safety argument (server-flag-only)

- The accept decision reads **only `run.isTestDrive`** from the CF-written run doc. No
  client input (payload, header, `session.*`) can flip it.
- For a **real run** `isTestDrive` is absent/false (the `buildRun` spread keeps the key
  off non-test runs entirely — `runs/index.ts:234`, confirmed by
  `test-drive-mode/design.md:165`), so `proximitySatisfied(distanceOk, undefined)`
  ≡ `distanceOk` — the exact current behavior. With the lazy-read shape, a real run also
  keeps the exact current read-count on the happy path.
- The adversarial sim's **SPOOF lane** (`scripts/simulate-adversarial.mjs:18, 207-212,
  272-273`) submits far-away check-ins on a **normal** run and asserts every one is
  rejected — that run has no `isTestDrive`, so the bypass is inert and SPOOF stays green.

---

## 3. Client "I'm here" affordance

**Where the player presses today** (`apps/play-web/src/components/TaskRunner.tsx`):
- Field / self_report check-in button `data-testid="task-field-checkin"` (line 553-558)
  → `field()` (279-291) → `withLocation(cb, onDenied)` → `completeTask({...ctx, lat, lng})`.
- Sealed hidden-location "check arrival" button `data-testid="task-check-arrival"`
  (line 504) → `checkArrival()` (298-313) → `reportArrival`.
- Geofence: **no button** — `GeofenceAuto` (814-895) auto-fires `geofenceArrive` only
  when the watcher reports inside the radius (569-570).

**The client problem for a desk tester.** `withLocation` (`utils/withLocation.ts`) calls
`onDenied` when GPS is denied/absent and then **never submits** (`field()` shows
`gpsWarning` and returns). And `GeofenceAuto` **never** fires off-site. So even with the
server bypass, a desk tester on a geofence task, or one who denies GPS, never reaches the
server. The client needs a test-run affordance.

**Design (tie to the existing TEST-RUN banner).** `session.isTestDrive` is already on the
session (`store.ts:13`) and already drives the banner in `PlayScreen.tsx:453-457`.
`session` is a prop of `TaskRunner` (`TaskRunner.tsx:56`), so `session.isTestDrive` is
in scope. Add:

1. **Field / hidden-arrival:** when `session.isTestDrive`, `field()` / `checkArrival()`
   still call `withLocation` to send REAL coords **when available**, but on `onDenied`
   they **submit anyway** (call `completeTask` / `reportArrival` with omitted lat/lng)
   instead of bailing to `gpsWarning`. The server bypass then accepts.
2. **Geofence:** when `session.isTestDrive`, render an explicit **"I'm here (test run)"**
   button next to `GeofenceAuto` that calls `geofenceArrive(lat?, lng?)` directly — the
   auto-watcher stays, the button is the desk escape hatch. Reuse the existing
   `t.task.imHere` copy; add one test-run-only label if desired (i18n: route through
   `t.*`, run `npm run i18n:check`).
3. Optionally show a small "test run — location checks are relaxed" hint under the
   button, gated on `session.isTestDrive`, so the tester understands why it accepts.

**Real vs synthetic coords — recommendation: send REAL coords when available, OMIT when
not; skip only the DISTANCE check server-side. NEVER send synthetic at-the-spot coords.**

- Sending synthetic "at the station" coords would (a) **leak the hidden-location
  coordinates to the client** (defeats the whole sealed-task design — the client must
  never learn the secret spot), and (b) **pollute the movement heatmap / locationTrack**
  with fake points.
- Sending real desk coords keeps routing's transit term meaningful *relative to where the
  tester actually is* (routing uses distance for transit, `assignNextTask.ts`) and keeps
  the heatmap honest. Trade-off: a desk tester's transit is computed from their office,
  which is arbitrary — but a test run's **scores/leaderboard are already excluded from all
  cross-run aggregates** (see §6), so routing quality in a rehearsal is cosmetic. This is
  the right trade.

---

## 4. TDD plan (RED first)

### 4.1 Pure unit test for the predicate (no emulator)
Co-located `packages/shared/src/geo.test.ts` (or a `scripts/test-*.ts` assertion picked
up by `npm test`). RED before the predicate exists:

```
proximitySatisfied(true,  false) === true     // real run, close → pass
proximitySatisfied(false, false) === false    // real run, far   → reject  (anti-cheat)
proximitySatisfied(false, true ) === true      // TEST run, far   → pass    (the feature)
proximitySatisfied(true,  true ) === true      // test run, close → pass
proximitySatisfied(false, undefined) === false // missing flag treated as real run
```
Also add a property/invariant row: `∀ d: proximitySatisfied(d, false) === d` (real run is
identity) — pairs with the existing `functions/src/__property__` lane.

### 4.2 e2e assertions (`scripts/e2e-verify.mjs`, extend the existing `test-drive` scenario)
The suite already has a test-drive scenario (`e2e-verify.mjs:1333-1350`) and a callable
coverage guard. Add, **asserting BOTH directions**:

- **Test run accepts far-away check-in.** Launch with `testDrive:true`, join, then
  `completeTask` for a `field`/`radius` task with coordinates far from the task
  (reuse the SPOOF far-coords pattern) → expect `{ok:true}` (NOT `failed-precondition`).
- **Test run unseals a hidden task from afar.** `reportArrival` far away on a
  hidden-location task in a test run → expect `{arrived:true}`.
- **Test run accepts a `requirePresence` answer from afar** → `submitTaskAnswer` with
  far/absent GPS → `{correct:true}`.
- **REAL run still rejects (regression guard).** The SAME far-away `completeTask` on a
  **normal** run → expect `failed-precondition` "Too far…". (This is what the SPOOF lane
  already proves at scale; assert it inline here too so the two directions live together.)
- Keep the adversarial sim SPOOF lane green on the normal run — it is the standing
  anti-cheat oracle.

---

## 5. Ownership / sequencing (collisions to flag to the parent)

This change spans four files; two are contended:

| File | Why | Contention |
|---|---|---|
| `functions/src/runs/index.ts` | Gates #1, #2, #4 + `resolveCallerTeam`/`requestNextTask` safe-zone guard | **HELD by the hidden-map feature agent.** Sequence AFTER it frees the file. Gate #2 (`reportArrival`) especially overlaps hidden-location work — coordinate the exact lines. |
| `functions/src/index.ts` | Gate #5 (`updateLocation`) *if* flagging there instead of requestNextTask | Low, but confirm no concurrent safe-zone edits |
| `packages/shared/src/geo.ts` | New `proximitySatisfied` predicate (additive export) | Low — pure add; but `geo.ts` is imported by functions/creator/play, so land the shared build first. Beware the `shared:build` `dist` race called out in CLAUDE.md (never run `verify` + `verify:emulator` concurrently). |
| `apps/play-web/src/components/TaskRunner.tsx` | Client affordance (§3) | Low — check whoever owns play-web TaskRunner for the wave |

**Recommended order:** (1) shared predicate + unit test (RED→GREEN) → (2) server gates
once `runs/index.ts` frees, with e2e RED→GREEN → (3) client affordance + i18n check.
Predicate and client can start immediately; only the server gates block on the held file.

---

## 6. Flags / decisions for the user

- **Test-run scores are ALREADY excluded** from cross-run aggregates: `finalizeRun` gates
  the player-profile fold and platform-benchmark on `!run.isTestDrive`
  (`runs/index.ts:1592, 1614`); `game.playCount` is skipped (`runs/index.ts:318`); wallet
  is never charged. So the bypass does **not** contaminate real leaderboards/benchmarks.
  The run's *own* live leaderboard still computes normally (intended — the tester wants to
  see it). **Confirmed: no additional exclusion work needed.**
- **Decision — safe-zone alert on a test run.** The recommended `requestNextTask` guard
  leaves `updateLocation`'s out-of-bounds **alert** firing in a test run (self-clears on
  the next inside ping). Harmless, but if the creator finds a "left the play area" alert
  during rehearsal confusing, also suppress the alert write under `run.isTestDrive`. Flag
  for the user; default = leave it (less code in the held file).
- **Not a bad idea, but worth stating:** because gates #6/#7 (`verifyStationCode`,
  `submitStationPhoto`) have no proximity check, a desk tester can already complete those
  task types with just the code / a photo — no bypass needed. The feature is complete
  once #1/#2/#4/#5 are covered.
- **Do NOT** add any client-trusted bypass path (payload flag, query param). The whole
  safety story rests on the decision reading only the server-side run doc.

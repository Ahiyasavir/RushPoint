# Wave-J implementation — test-drive proximity bypass + instant-play consent gate

Spec-driven + TDD record for two wave-J changes implemented together (they share
`functions/src/runs/index.ts` and the same e2e scenario harness). Design inputs:
[testdrive-here-bypass-plan.md](testdrive-here-bypass-plan.md) (feature) and
[privacy-lifecycle.md](privacy-lifecycle.md) finding **J1** (compliance).

---

## A) Test-run "I'm here" proximity bypass

### What & why
In a **test run** (`run.isTestDrive === true`, server-written at launch) every "I'm here" /
arrival / presence gate accepts the submission **regardless of physical distance**, so a
creator can walk the whole course from their desk while rehearsing. In a **real run**
(`isTestDrive` falsy) every gate is **byte-for-byte unchanged** — including read-cost on the
happy path — so the anti-cheat that rejects far-away check-ins still holds.

### Design decisions
- **One pure predicate, not a threaded bypass flag.** `proximitySatisfied(distanceOk,
  isTestDrive)` = `isTestDrive === true || distanceOk`, added to `packages/shared/src/geo.ts`.
  This keeps `evaluateTrigger`/`evaluatePresence` pure and unchanged (their existing
  unit/property tests stay green) and makes the bypass a single greppable wrapper at each
  gate so no gate is silently missed.
- **Server-flag-only.** The accept decision reads **only** `run.isTestDrive` from the
  CF-written run doc. No client payload / header / `session.*` can flip it. For a real run
  the key is absent (`buildRun` spread keeps it off non-test runs), so
  `proximitySatisfied(distanceOk, undefined) === distanceOk` — the exact current behavior.
- **Lazy run-doc read on the would-reject path only.** A new helper `runIsTestDrive(owner,
  game, run)` reads the run doc, but each gate calls it **only when the distance verdict is
  about to reject**. A real run's happy path (verdict ok) never touches the run doc → zero
  extra reads, byte-identical. Only an already-rejected far-away spoof (real run) or a desk
  check-in (test run) pays the one extra read. Test runs are 2-person rehearsals, so the
  cost is irrelevant there.

### Gates changed (all in `functions/src/runs/index.ts`)
| # | Callable | Predicate applied |
|---|---|---|
| 1 | `completeTask` field/self_report/geofence check-in | wrap the missing-coords throw AND the `!verdict.ok` throw; test run passes both |
| 2 | `reportArrival` hidden-location unseal | same two wraps; test run latches `arrivedAt`, returns `{arrived:true}` |
| 4 | `submitTaskAnswer` `requirePresence` | wrap the `!verdict.ok` throw (covers missing-GPS too, `evaluatePresence` returns `ok:false`) |
| 5 | `requestNextTask` safe-zone soft-pause | `if (team.outOfBounds === true && !(await runIsTestDrive(...)))` — read only when already out of bounds |

`geofence` type normalizes to `radius` and flows through gate #1 (no separate server gate).
`verifyStationCode` / `submitStationPhoto` carry no proximity check — no bypass needed.
Safe-zone: gated at the `requestNextTask` enforcement point (co-located with the other
run-flag checks); the harmless `updateLocation` out-of-bounds alert is intentionally left as
is (self-clears on the next inside ping) — less code in the hot path, matches the plan's
recommendation.

### Real-run-unchanged proof
- Predicate identity: `∀ d: proximitySatisfied(d, false) === d` and `=== proximitySatisfied(d,
  undefined)` (unit-tested). A real run never has `isTestDrive`, so every gate reduces to its
  prior verdict.
- Read-cost identity: each wrap fetches the run doc **inside the `!verdict.ok` branch**, which
  a real-run happy path never enters; `requestNextTask` only reads when `outOfBounds` is
  already true. So the real-run happy path adds zero reads.
- e2e regression guard: the SAME far-away `completeTask` on a **normal** run still throws
  `failed-precondition` (asserted inline next to the test-run accept), and the adversarial sim
  SPOOF lane keeps proving it at scale.

### Client affordance (`apps/play-web/src/components/TaskRunner.tsx`)
Tied to the existing TEST RUN banner via `session.isTestDrive` (already a prop):
- **field / self_report:** `withLocation` still sends REAL coords when granted; on GPS denied
  in a test run it submits anyway (coords omitted) instead of bailing to `gpsWarning`.
- **hidden-arrival (`checkArrival`):** same — on GPS denied in a test run, `reportArrival` is
  called with coords omitted.
- **geofence:** an explicit "I'm here (test run)" button (there is otherwise no button — it
  auto-fires only on-site). Sends real coords when granted, omits when not.
- A small "test run, location checks relaxed" hint under those affordances.
- **Never synthetic at-the-spot coords** — that would leak a hidden task's secret coordinates
  to the client and pollute the movement heatmap. Real-when-available, omit-when-not; the
  server skips only the DISTANCE check.
- New strings routed through `t.*` (HE+EN), no hyphens/dashes: `t.task.testDriveImHere`,
  `t.task.testDriveHint`.

---

## B) J1 — instant-play guardian-consent bypass

### The bug
`startInstantPlay` seeds `launched:true` and hands out the first task **without ever checking
`game.requiresGuardianConsent`** — the consent gate exists only in `startTeams`
(`isConsentSatisfied`). A published game that is both `allowInstantPlay` and
`requiresGuardianConsent` therefore lets a minor play with **zero consent**.

### Fix & justification
**Refuse instant-play entirely for a consent-required game** (throw `failed-precondition`
before seeding the run), rather than routing through the consent flow.

Justification: instant-play is anonymous, on-demand, self-guided **solo** play with **no
organizer and no out-of-band guardian channel**. The organized-run consent flow
(`requestGuardianConsent` → guardian link → `grantGuardianConsent`, then `startTeams` filters
on `isConsentSatisfied`) has no analogue here — there is no roster held pending, no host to
release it, and (J2, out of scope) the token flow is itself self-forgeable. Holding an
instant-play team "unlaunched pending consent" would deliver a broken dead-end UX with no path
to completion. The safest, simplest, and honest behavior is to **not offer instant-play at all
for a game that requires guardian consent**. This mirrors `startTeams`' intent (consent
required ⇒ no play without it) while not weakening any other surface. A creator who needs both
minors and instant-play must run an organized launch that collects consent.

J2 (consent self-forgeability) is a separate product decision and is explicitly **not**
addressed here.

---

## TDD plan (RED first)

- **Pure:** `scripts/test-proximity-bypass.ts` asserts `proximitySatisfied`:
  real-close→true, real-far→false (anti-cheat), test-far→true (the feature), test-close→true,
  `undefined`→identity, and the `∀ d: p(d,false)===d` invariant. RED before the export exists.
- **e2e (`scripts/e2e-verify.mjs`, extend the existing test-drive scenario):**
  - test-drive run accepts a far-away `completeTask` on a `field`/radius task → `{ok:true}`.
  - test-drive run unseals a hidden task via `reportArrival` from afar → `{arrived:true}`.
  - the SAME far-away `completeTask` on a **normal** run → `failed-precondition` (SPOOF holds).
  - instant-play of a `requiresGuardianConsent` game → `failed-precondition` (J1 closed);
    control: the same game without the flag instant-plays fine.
  - No new callable ⇒ callable-coverage guard stays 66/66.

## Gates
`npm run shared:build` → `npm run build --workspace=functions` → typecheck/lint/test → e2e via
`node scripts/emulator-exec.mjs "node scripts/e2e-verify.mjs"` → `npm run i18n:check` (UI touched).

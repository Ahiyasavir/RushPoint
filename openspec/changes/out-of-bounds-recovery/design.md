## Context

The safe-zone feature (archived change `safe-zone-boundary`) is small and entirely server-side:

- `packages/shared/src/safeZone.ts:16-26` — `isOutsideSafeZone(coords, safeZone)`: haversine distance
  vs `radiusMeters`, `>` so on-boundary is inside; **throws** on non-finite coordinates; no zone or
  non-positive radius ⇒ never outside.
- `functions/src/index.ts:334-355` — inside `updateLocation`: read the game doc's `safeZone`, compute
  `outside`, read the team's current `outOfBounds`, and on a *transition* either write an alert +
  `outOfBounds: true` or write `outOfBounds: false`.
- `functions/src/runs/index.ts:3025-3027` — `requestNextTask` returns `{ taskId: null, outOfBounds:
  true }` when the flag is set, unless `run.isTestDrive`.
- `apps/play-web/src/components/TaskRunner.tsx:337-345` — the actionless amber card, rendered only in
  the `!task` branch; `apps/play-web/src/components/InRunAlerts.tsx:52-56` — the in-run banner.

What that adds up to, stated precisely:

1. The flag is a **latch with a single opener**. `functions/src/index.ts:352` is the only line in the
   repository that writes `outOfBounds: false`. If the opener never runs, the latch never opens.
2. The opener runs **only** from `updateLocation`, which runs only when the participant's
   `watchPosition` produces a fix *and* the team's controller device is foregrounded *and* the 20 s
   client throttle allows it (`PlayScreen.tsx:172-176`). Any of those failing stops the opener.
3. There is **no timestamp on the latch**, so no timeout could be retrofitted at read time without
   adding one — and no timeout exists.
4. **Accuracy is discarded at the source** (`PlayScreen.tsx:167-169` reads only lat/lng;
   `calls.ts:256` cannot carry more), so the server's "outside" is a point verdict on a value whose
   real uncertainty may be an order of magnitude larger than the miss distance.
5. There is **no human override**. Repo-wide, `outOfBounds` appears in `functions/` at exactly
   `functions/src/index.ts:338,342,350,352` and `functions/src/runs/index.ts:3025-3026`, and in
   `apps/creator-web/` **not at all**.

Blast radius of the flag itself (checked, and smaller than feared): it gates **only** `requestNextTask`.
`completeTask`'s post-completion assignment (`functions/src/runs/index.ts:3005`) does **not** consult
it, so a team already holding a task can finish it and be handed the next one. Scoring, finalization,
`buildRankings`, hints, station verification and chat are all untouched by the flag. The trap
therefore bites precisely when a team has **no** assigned task — which is every stage transition.

Refutations attempted, and their outcomes:
- *Is there an auto-clear or timeout?* No. Grep for the field yields six server references, all listed
  above; none is time-based.
- *Does acknowledging the breach alert clear it?* No — `acknowledgeAlert` (`functions/src/index.ts:510-528`)
  updates only `acknowledged`/`acknowledgedBy`/`acknowledgedAt` on the alert document.
- *Can staff clear it?* No — no staff-or-owner callable writes team `outOfBounds`.
- *Does the participant app retry a failed location watch?* `PlayScreen.tsx:191` is `() => undefined`.
  (The sibling `GeofenceAuto` watch in `TaskRunner.tsx` was given bounded-backoff retry by another lane;
  this one was not, and is owned by that lane — this change does not touch it, and deliberately does
  not depend on it either: the server-side fix must hold even if the client never pings again.)
- *Is there test coverage of recovery?* `scripts/test-safe-zone.ts` covers the pure predicate only
  (centre / inside / far / no zone / zero radius / throws-on-NaN). `scripts/e2e-verify.mjs:4259-4265`
  covers breach → pause → return-inside → resume, i.e. exactly the happy recovery path, and nothing
  about a device that stops reporting.
- *Is `isTestDrive` a general escape?* No — `runIsTestDrive` is false on a real run, by construction.

Hard constraint: a live playtest stack serves from this tree. No emulator/Vite/tunnel/backup process
may be started, stopped or restarted; `npm run e2e`, `verify:emulator`, `test:rules` and
`npm run shared:build` are off limits. All verification here is pure-logic and static.

## Goals / Non-Goals

**Goals:**
- No player is ever blocked by a condition they cannot physically clear.
- The verdict is a **pure total function** of (last fix, accuracy, timestamps, zone, override, now) —
  testable adversarially with no emulator, no clock, no I/O.
- Fail **open**: absent, stale, malformed or low-confidence signal is never proof of a violation.
- A human (staff or owner) can release a team, visibly, from the run console, with an audit trail.
- The server stays the sole authority; the client only reports raw sensor data.
- Genuine, verifiable breaches keep behaving exactly as they do today.

**Non-Goals:**
- No change to `isOutsideSafeZone` or its tests.
- No client-side bounds decision, no play-web copy changes, no change to the alert surface.
- No change to geofence *tasks*.

## Decisions

### D1 — One pure evaluator, `evaluateSafeZoneStatus`, in `packages/shared/src/safeZone.ts`

```ts
evaluateSafeZoneStatus({ fix, safeZone, nowMs, overrideUntilMs?, policy? })
  → { outOfBounds, reason, distanceMeters, stalenessMs, confidenceMeters }
```

`reason` is one of `no_zone` · `override` · `no_fix` · `invalid_fix` · `stale_fix` · `low_confidence`
· `inside` · `outside`. Returning the *reason* rather than a bare boolean is deliberate: the caller
(and the tests, and the logs) must be able to distinguish "we know they are inside" from "we cannot
tell", because those must produce the same *player* outcome and different *operator* outcomes.

*Why a new function instead of widening `isOutsideSafeZone`:* the existing predicate throws on NaN
and has five callers'-worth of settled semantics plus its own test file. Fail-open behaviour that
*returns* on NaN is a contradictory contract. The evaluator wraps it, guarding the inputs first.

### D2 — Precedence order, fixed and total

1. `overrideUntilMs` in the future ⇒ `override`, not out of bounds. A human decision outranks a sensor.
2. No zone / `radiusMeters <= 0` ⇒ `no_zone`.
3. No fix object, or `lat`/`lng` absent ⇒ `no_fix`.
4. `lat`/`lng` non-finite ⇒ `invalid_fix`.
5. Fix age unknown, or greater than `staleAfterMs` ⇒ `stale_fix`.
6. Accuracy above `maxTrustedAccuracyMeters`, or the miss distance not exceeding the accuracy radius
   ⇒ `low_confidence`.
7. `distance > radius` ⇒ `outside`; else `inside`.

Every branch except (7) returns `outOfBounds: false`. The order matters: an override must win even
over a fresh, confident, genuinely-outside fix (that is what a rescue *is*), and `no_zone` must win
over `no_fix` so a game without a safe zone never reports a location problem it does not have.

### D3 — Staleness, and clock skew

`stalenessMs = nowMs - fix.atMs`, clamped at `0`. A **negative** age (the device's clock is ahead of
the server's, or the two disagree) is clamped rather than treated as stale — a skewed clock is not
evidence of anything, and clamping keeps the function monotone in `nowMs`.

An **unknown** age (`atMs` missing / non-finite) is `stale_fix`, not "assume fresh". Every real caller
has a timestamp (`updateLocation` evaluates a fix it is receiving right now; the latch re-evaluation
reads `teamLocations.updatedAt`), so unknown means the data is malformed or pre-dates this change —
and the fail-open direction for malformed data is release, not detain.

Default `staleAfterMs` = **5 minutes**. The client pings at most every 20 s (`PlayScreen.tsx:172`), so
five minutes is ~15 missed pings: far past transient GPS noise, far short of a player being able to
sit out a breach.

### D4 — Accuracy is a confidence radius, not a coordinate

A fix is `outside` only when `distanceMeters - confidenceMeters > radiusMeters`. `confidenceMeters` is
the reported accuracy when finite and positive, else `0` (an unreported accuracy must not *widen* the
tolerance — it just cannot narrow the verdict either; the staleness and override paths remain the
safety valves).

Separately, a fix with `accuracyMeters > maxTrustedAccuracyMeters` (default **200 m**) is
`low_confidence` outright, even if it lands 5 km away. *Why both rules:* the subtraction alone lets a
wildly bad fix flag a team when the zone is small and the reported miss is huge, which is exactly the
cell-tower-fix scenario. 200 m is chosen because a typical urban play area radius in this product is
150–500 m; a fix worse than 200 m cannot meaningfully locate a team relative to such a zone.

*Why not also require two consecutive breaching fixes:* it would add per-team state and would not fix
the latch (the real defect), while delaying legitimate breach alerts. Accuracy + staleness + override
covers the observed failure modes without new state machines.

### D5 — The latch is re-evaluated before it may block (the actual unsticking)

`requestNextTask` currently trusts `team.outOfBounds` outright. It will instead, **only on the already
abnormal path where the flag is set** (so the happy path adds zero reads — the same discipline the
test-drive bypass follows), read the team's last known location and the game's safe zone and re-run
`evaluateSafeZoneStatus`. If the verdict is anything other than `outside`, the latch is cleared and
assignment proceeds normally.

This is what makes the condition physically clearable: the latch now survives **only while fresh,
confident, out-of-zone fixes keep arriving**. A phone that stops reporting releases its team after
`staleAfterMs`; a phone reporting garbage never detains its team at all; a team that walks back in is
released by their next ping *or*, if the pings have stopped, by staleness.

*Why re-evaluate at read time instead of a scheduled sweep:* no new trigger, no scheduler, no fan-out
over teams, and the check is exactly at the point where the flag has consequences. A sweep would have
to run for every team of every live run to achieve the same thing.

### D6 — `clearTeamOutOfBounds`, a staff/owner override with a grace window

New callable, `assertStaffOrOwner`-gated like `adjustTeamScore`/`acknowledgeAlert`, which sets
`outOfBounds: false` **and** `outOfBoundsOverrideUntil = now + graceMs` (default **30 minutes**), and
writes an audit-log entry.

The grace window is the point: without it, the very next bad fix from the same broken phone re-latches
the team seconds after the rescue, and staff are stuck in a loop they cannot win. During the window
`updateLocation` still records the position and still raises breach alerts on a genuine crossing — the
organizer keeps their safety signal — but does not re-set the flag. The window is deliberately short,
so an override is a rescue, not a permanent exemption.

### D7 — Making the condition visible in the run console

`listRunTeams` projects `outOfBounds` (it currently does not), the creator `RunTeamRow` type carries
it, and the teams panel shows a badge plus a "let them back in" button on flagged teams only. Copy
goes through the existing `t.runConsole` dictionaries in **both** Hebrew and English; the team name is
already rendered `dir="auto"`; classes are static Tailwind and the spacing uses the logical `ms-*`
form the neighbouring buttons already use.

The control is classified `routine`, not `destructive` (`apps/creator-web/src/lib/runConsoleActions.ts`):
releasing a stuck player is a safety action and must not be buried behind a scary red confirm.

### D8 — Accuracy on the wire

`updateLocation` gains an optional `accuracyMeters`, validated as finite and non-negative and ignored
otherwise (never a hard error — a client that cannot supply it must keep working). It is persisted on
the `teamLocations` document alongside `lat`/`lng`/`updatedAt` so the latch re-evaluation in D5 can
read the accuracy of the last fix, not just its coordinates.

### D9 — What is deliberately NOT done

- The `PlayScreen.tsx:191` silent `watchPosition` error handler is left to the lane that owns the GPS
  retry work. This change is designed to hold **without** it: the server releases the team on staleness
  even if the client never recovers.
- No change to the play-web out-of-bounds card copy, to avoid colliding with the i18n lane that owns
  `apps/play-web/src/i18n.ts`. The card will simply stop being permanent.

## Risks / Trade-offs

- **A genuinely-outside team is released after 5 minutes of silence.** Accepted, and it is the whole
  point: the server cannot distinguish "outside and hiding" from "inside with a dead GPS", and the
  guiding principle is that an unverifiable condition must not strand a player. The organizer still
  received the breach alert, still sees the team's last position on the live map, and can still act.
- **Extra reads on the flagged path.** Two document reads (`teamLocations`, game) inside
  `requestNextTask`, and only when `outOfBounds` is already set. The normal path is byte-identical.
- **Accuracy is client-reported and therefore spoofable.** A malicious client could claim 10 km
  accuracy to become unflaggable. This is not a regression: the same client already chooses the
  coordinates it reports, so bounds enforcement was never adversary-proof. Safe zones are a *safety*
  feature, not an anti-cheat one, and the trust ceiling caps how much a claim can buy.
- **Override abuse.** Bounded by the grace window and recorded in the audit log.

## Migration Plan

Purely additive. New team fields (`outOfBoundsAt`, `outOfBoundsOverrideUntil`) and the new location
field (`accuracyMeters`) are optional; documents written before this change evaluate as "unknown age"
→ fail open → released, which is the desired outcome for anyone stuck right now. No backfill, no
rules change, no data migration. Older play-web clients that do not send accuracy keep working
(`confidenceMeters` 0) and still benefit from staleness release and the staff override.

## Test Strategy

**Lane: pure logic, vitest in `packages/shared` (`src/safeZoneStatus.test.ts`), no emulator.**
`evaluateSafeZoneStatus` cases:

- inside the zone, at the centre, and well outside → `inside` / `outside` verdicts;
- **boundary ±1 m**: exactly on the radius → inside; 1 m beyond with a confident fix → outside; 1 m
  inside → inside (computed by projecting a metre offset in latitude, so the assertion is about the
  predicate, not about a hand-tuned coordinate);
- **low accuracy that only *appears* outside**: 50 m beyond a 150 m radius with 200 m accuracy →
  `low_confidence`, not out of bounds; the same position with 5 m accuracy → `outside`;
- **accuracy above the trust ceiling**: 5 km outside with 900 m accuracy → `low_confidence`;
- **no fix ever reported**: `undefined` / `null` fix, and a fix object with absent `lat`/`lng` → `no_fix`;
- **NaN / Infinity coordinates** → `invalid_fix`, and crucially **does not throw** (contrast with
  `isOutsideSafeZone`, whose throwing behaviour is asserted unchanged);
- **stale fix**: age just under, exactly at, and just over `staleAfterMs` → `outside` / `outside` /
  `stale_fix` for a position that is genuinely outside;
- **unknown age** (`atMs` missing / NaN) → `stale_fix`;
- **clock skew**: `atMs` in the future → `stalenessMs === 0` and the position verdict still computed;
- **override**: `overrideUntilMs` in the future beats a fresh confident outside fix → `override`;
  exactly at `nowMs` and in the past do not → `outside`;
- **no zone / zero / negative / NaN radius** → `no_zone` regardless of position;
- **totality invariant** asserted across a matrix of every fix shape × zone shape: the function always
  returns an object with a known `reason`, never throws, and `outOfBounds === (reason === 'outside')`.

**Lane: e2e (`scripts/e2e-verify.mjs`, safe-zone scenario) — WRITTEN, NOT RUN.** A live playtest stack
is serving from this tree, so `npm run e2e` must not be started. Assertions added: a staff/owner
`clearTeamOutOfBounds` releases a flagged team and `requestNextTask` assigns again; the grace window
prevents an immediate re-latch from the same out-of-zone position; a participant calling it is denied.
The callable-coverage guard requires this — the callable ships RED until the suite is next run.

**Lane: UI.** Verified by `npm run creator:build`, `npm run lint`, and `npm run i18n:check` /
`i18n:check:strict` (PART B must stay at zero). No browser verification: the preview tools would
require touching the live stack.

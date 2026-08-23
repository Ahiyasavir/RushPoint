## Context

`scripts/e2e-verify.mjs` (7 400 lines) is the repo's callable-behavior lane: isolated scenarios, a
sanitizer allowlist guard, a leaderboard invariant oracle, a station-contention race, a table-driven
authz denial matrix, seeded boundary fuzz, and a closing **callable coverage guard** that
introspects `functions/lib/index.js` for `__endpoint.callableTrigger` and fails if any deployed
callable was never invoked.

The diff `5a204f1..HEAD` adds 249 lines to that file from five distinct lanes, none of which could
execute it:

| Lane (change) | Scenario it edited | What it added |
|---|---|---|
| `retry-lockout-clock-skew` | wrong-answer cost | duration-shaped lockout fields on `submitTaskAnswer` + the replay reply; `answerCost.cooldownRemainingMs`; kept the deprecated `cooldownUntil` |
| `out-of-bounds-recovery` | safe-zone boundary | the whole `clearTeamOutOfBounds` escape hatch: participant denial, owner release, `listRunTeams` projection, re-assignment, grace window, low-confidence fix |
| `run-retention-completeness` | callable coverage | back-dated abandoned run is pruned; a fresh live run is not; borrowed state restored |
| `game-task-tags` | NEW scenario | server-side tag normalization on create/update/publish and back out of the gallery |
| `game-import-hardening` | game file export/import | hostile-file refusals (wrong type, forbidden key, over-long array, over-deep document) + the smuggling surface |

Constraints this design works under:

- The emulator is owned by a live playtest stack. **Nothing may be executed** beyond
  `node --check`. No `npm run e2e`, `verify:emulator`, `test:rules`, `simulate`, `dev:all`,
  `playtest`; no starting/stopping any emulator, Vite, tunnel or backup process.
- Ownership is `scripts/e2e-verify.mjs` alone. A defect found in `functions/**`, `apps/**`,
  `packages/**` or the rules files is **reported, not fixed** — a test lane must not edit the thing
  it is judging.

## Goals / Non-Goals

**Goals**

- Every asserted response field exists, with the asserted shape, in the callable that produces it.
- Every assertion is **falsifiable**: there is a realistic regression that makes it fail.
- Every new assertion builds its own state (scenario isolation is the suite's core property).
- The sanitizer allowlists match the current `Task` / `SmartStationConfig` shape.
- The callable coverage guard is known-satisfiable before the emulator is available.

**Non-Goals**

- Running anything. Making a green run likelier by weakening a check. Restructuring scenarios.
  Patching implementation defects. Adding coverage-guard exemptions.

## Decisions

### D1 — `__proto__` cannot be asserted over the callable wire; `constructor` can

`FORBIDDEN_KEYS` in `packages/shared/src/gameFile.ts` is `['__proto__', 'constructor', 'prototype']`
and `scanCandidateGraph` catches any of them at any depth via `Object.keys`. The lane chose
`__proto__` — the one member of that set that **cannot survive the transport**:

- client: `@firebase/util` `mapValues` builds `res[key] = f(obj[key])`;
- server: `firebase-functions` `decode` builds `obj[k] = decode(v)`.

For `k === '__proto__'` those assignments invoke `Object.prototype`'s `__proto__` **setter**: the new
object's prototype is re-pointed and **no own property is created**. `Object.keys` then reports
nothing, the scan finds no forbidden key, and the import **succeeds** — failing the `expectError`
and the "no half-game was written by any refusal" count check that follows it.

`constructor` is an ordinary writable data property on `Object.prototype`, so an assignment creates
an **own** property on the receiver and the key arrives intact. The assertion is therefore rewritten
to use `constructor`, with the transport reasoning written into the file so the next author does not
"fix" it back. The prototype-pollution class is still covered; only the carrier key changes.

*Reported, not fixed:* the same transport quirk means a `__proto__` key in a callable payload
silently re-points the decoded object's prototype server-side. It is inert for `importGameFile`
(`pick()` reads only allow-listed key names, and no allow-listed name was polluted), but it is a
property of the SDK worth knowing before someone relies on `FORBIDDEN_KEYS` to stop it on this path.
`FORBIDDEN_KEYS` remains correct and necessary for the Builder's file-upload path, which parses raw
JSON bytes and never crosses `decode`.

### D2 — a masked assertion gets its own fixture, it is not softened

`evaluateSafeZoneStatus` has a fixed precedence: `override → no zone → no fix → invalid fix →
stale fix → low confidence → position`. The out-of-bounds lane asserted the **low-confidence** rule
on the `wanderer`, immediately after `clearTeamOutOfBounds` had given that team a 30-minute
override — so the verdict is `override` and the check passes no matter what the accuracy rule does.

Two ways out: wait out the grace (30 minutes, unacceptable), or use a team that has no override. The
scenario gets a second participant (`blurry`) joined to the SAME run, which reports one out-of-zone
fix with `accuracyMeters: 900` (above `DEFAULT_MAX_TRUSTED_ACCURACY_M = 200`). The assertion now
also pins `reason === 'low_confidence'`, so it can only pass through the branch it names. The
override case keeps its own assertion, likewise tightened to `reason === 'override'` — otherwise
`outOfBounds === false` would also be satisfied by a fix that simply landed inside the zone.

`joinRun` accepts a join into a live, already-started run (it refuses only `status === 'finished'`)
and sets `controllerUid` to the joining uid, which is what `updateLocation`'s
`resolveCallerTeam(..., { requireController: true })` needs. No `startTeams` is required, because the
safe-zone evaluation does not read launch state.

### D3 — an emptiness assertion is only a test if something was there

"abandoned-run prune removes its raw GPS pings" read `teamLocations` on a run whose scenario never
calls `updateLocation`: 0 before, 0 after, unfalsifiable. The repair seeds one ping through the Admin
SDK (the same handle the surrounding block already uses to back-date the run) **and** asserts the
fixture took (`size > 0`) before the sweep. A missing fixture now fails as a fixture, not as a
mysterious pass.

A second assertion is added on the sweep's own report: `results` from `pruneExpiredRunDataNow`
carries one `{ runId, … }` per pruned run, so `results.some(r => r.runId === cvRun)` proves the sweep
reached *this* run rather than merely returning `ok: true`. `prunedCount` alone would not — other
runs could satisfy it.

### D4 — assert the positive outcome, not the absence of a flag

`requestNextTask` returns `{ taskId, reason }` on success and `{ taskId: null, outOfBounds: true,
reason }` only on the soft-pause path. "released team is assigned a task again" asserted
`outOfBounds !== true`, which `undefined` satisfies on every success AND on several failures. It is
tightened to also require `typeof taskId === 'string'`. `assignNextInActiveStage` returns the
in-flight task id when the team already holds one, so a released team that still holds `sz-a` yields
a string — the assertion is exact, not hopeful.

### D5 — allowlist drift is checked against the sanitizer, not the type

`sanitizeTaskForParticipant` emits `...rest` for a non-hidden task, so **any** new `Task` field
reaches the participant payload and trips `assertTaskPayloadAllowlisted` unless allowlisted. The
correct reference is therefore the sanitizer's output surface, i.e. the `Task` interface minus the
destructured secrets (`smart`, `hint`, `answers`, `numericAnswer`, `steps`, `orderItems`), plus the
sanitizer's own synthesized keys.

Checked in this tree: tonight's `packages/shared/src/types/index.ts` diff adds fields to **`RunTeam`**
only (`outOfBoundsAt`, `outOfBoundsOverrideUntil`, `lastBreachAlertAt`, and the three optional
lockout fields inside `answerPenalties`). `RunTeam` is not sanitized through this path. `Task.tags`
and `Task.media` predate tonight and are already listed. `ALLOWED_SMART_KEYS` matches the explicit
`smart` projection in `sanitizeTask.ts` one-for-one, and `secretCode` is correctly absent from both.
**No allowlist edit is needed, and none is made** — adding an entry "just in case" is the failure
mode that silently permits a leak.

### D6 — the coverage guard has no gap

`latencySamples` is recorded in a `finally`, so a callable invoked only to be DENIED (the authz
matrix) still counts as exercised. Cross-checking the 94 `loggedCallable('…')` definitions under
`functions/src/**` against `call('<name>'` in the suite leaves exactly one name absent as a direct
call — `skipStage` — and it is present as an authz-denial row, so it registers. `clearTeamOutOfBounds`
is invoked twice by the new safe-zone block (denied as participant, accepted as owner). **No new
scenario is required**, and the `EXEMPT` map stays empty, which is the only state that means 100 %
coverage.

### D6b — coverage restoration: `setRunTaskStatus` (change: live-task-pause)

D6 was true when it was written and is **stale now**: `live-task-pause` merged into
`functions/src/index.ts` after that arithmetic was done, adding `setRunTaskStatus`. Re-running the
count against the callables actually re-exported from `functions/src/index.ts` leaves exactly one
name with no invocation anywhere in the suite — `setRunTaskStatus` — which means the coverage guard
would have failed the whole run on its own, before any behavior was tested. `clearTeamOutOfBounds`
was **re-verified rather than assumed**: it is invoked twice by the safe-zone scenario (denied as a
participant, accepted as the owner) and its `{ ok, overrideUntil }` shape matches the callable.
`skipStage` remains covered only through an authz-denial row, which registers because `latencySamples`
is written in a `finally`.

Coverage is restored by a real scenario, not an `EXEMPT` entry — the map stays empty, which is the
only state that means 100 %. Four design points are worth recording, because each one is where a
blind author would have written something unfalsifiable:

1. **The routing assertion is built to be falsifiable.** Asserting "the paused task was not returned"
   over two interchangeable tasks proves nothing: a tie-break could produce the same answer with the
   pause filter deleted. The fixture therefore makes the paused task the one routing would
   *certainly* pick — it sits on the team's own coordinates, the alternative is ~2.2 km away, and
   `fixed_points_speed` scores `0.6·load − 0.4·transit` with both stations equally unloaded. Three
   consecutive `requestNextTask` calls (releasing the slot with `checkOutTask` between, so each call
   re-runs the same decision) must all return the far task. Resuming makes the near one win again,
   which is the same predicate proving itself in the opposite direction.
2. **`requiredTaskCount` had to be chosen deliberately.** With `requiredTaskCount` absent, the stage
   requires all N tasks, so `planTaskStatusChange` flags *any* pause as `stageUnwinnable` and refuses
   it — the routing fixture would have died on the guard instead of testing routing. The routing
   fixtures use 1-of-2 (a pause is legal); the guard fixture uses 2-of-2 (a pause is refused). One
   fixture cannot serve both, because the two states are mutually exclusive by arithmetic.
3. **The "unchanged" assertion is a real before/after comparison.** `taskStatusOverrides` is read
   into a JSON string *before* the refused call and again after, and the two strings are compared —
   not the same value against itself, and not a hard-coded `undefined` that would also pass if the
   field were never implemented. The guard fixture's run has never had an override written, so `null`
   is the complete before-image and the comparison is the literal contract.
4. **The ALLOWED side cannot live in the denial matrix.** The matrix is `expectError` over every row
   by construction, so "owner and run-scoped staff may do this" is asserted inside the new scenario
   (a staff PIN minted for *this* run, exchanged via `staffSignIn`, then a successful call), while
   participant / stranger / other-run-staff denials are three new matrix rows. The matrix's existing
   post-sweep "nothing was written" block gains one more line: no task-status override exists on the
   run after the sweep.

### D7 — a tautological shape check is left alone

`Math.ceil(retryAfterMs / 1000) === retryAfterSeconds` is true by construction: both come from one
`evaluateRetryLockout` verdict, where `remainingSeconds = Math.ceil(remainingMs / 1000)`. It cannot
fail today. It is kept because it is a *contract* check that would fail if the two fields were ever
sourced from different verdicts (the exact drift that made the absolute-instant bug survive) — and
because removing a stricter check to tidy up is the behavior this change exists to prevent. It is
listed here so it is a known-tautology, not an unnoticed one.

## Test Strategy — validating a suite that cannot be run

This change's deliverable IS a test file, so "write a failing test first" has no meaning: the RED
step would require executing the very suite the emulator embargo forbids. The strategy is therefore
**static reconciliation**, and it is stated in full so the parent can audit it rather than trust it.

**Lane 1 — syntax.** `node --check scripts/e2e-verify.mjs` after every edit. It is the only thing
that can be executed, and it catches the whole class of "a blind edit unbalanced a brace".

**Lane 2 — field reconciliation (the highest-yield check).** For every response field asserted in
the diff, locate the `return` statement in `functions/src/**` (or the shared helper it spreads) that
produces it, and confirm the field name, type and range. A field that no longer exists reads
`undefined` on both sides of a comparison and turns into a vacuous pass or a runtime red. Every
field in this diff was traced to its producer:

- `submitTaskAnswer` → `retryAfterMs` / `retryAfterSeconds` on both the charge and the replay
  return; `evaluateRetryLockout` bounds them by the level ceiling.
- `answerCostDisplay` → `cooldownRemainingMs` (server-computed duration) and the deprecated
  `cooldownUntil` (absolute instant, kept for cached bundles).
- `clearTeamOutOfBounds` → `{ ok: true, overrideUntil: <ISO string> }`; `assertStaffOrOwner` throws
  `permission-denied` for a participant.
- `updateLocation` → `{ ok, outOfBounds, reason }`, and it accepts the optional `accuracyMeters`.
- `listRunTeams` → each team carries `outOfBounds: t.outOfBounds === true`.
- `pruneExpiredRunDataNow` → `{ ok, prunedCount, stoppedEarly, results }`, each result
  `{ runId, locationsDeleted, … }`; `pruneRunPII` stamps `piiPrunedAt` and wipes
  `PII_BULK_SUBCOLLECTIONS` (which includes `teamLocations`).
- `createGame` / `updateGame` / `publishGame` → `normalizeTags` on every write path;
  `searchGallery` / `searchTaskLibrary` return the stored documents, so `tags` survives outbound.
- `importGameFile` → every refusal path returns `invalid-argument`; `pick()` against
  `EXPORTED_GAME_KEYS` drops `deletedAt`/`deletedBy`/`integrationWebhookUrl`/`integrationPlatform`
  and any unknown key (`credits`, `wallet`).

**Lane 3 — falsifiability.** For each assertion ask: *what regression makes this fail?* If the answer
is "none", it is a defect. Three were found (D2, D3, D4) and repaired by adding fixtures or
tightening the predicate — never by deleting the check. D7 documents the one tautology kept on
purpose.

**Lane 4 — reachability.** Simulate the assertion's own preconditions by hand against the
implementation: does the state machine actually reach the branch being asserted? This is what caught
D2 (the override branch pre-empts the confidence branch) and D1 (the key never arrives).

**Lane 5 — isolation.** Every new assertion must create the state it reads. The tags scenario builds
its own game; the out-of-bounds block reuses the safe-zone scenario's own run and adds its own second
participant; the retention block borrows one run, seeds its own fixture, and restores the borrowed
timestamps afterwards.

**Lane 6 — coverage arithmetic.** Enumerate `loggedCallable('…')` across `functions/src/**` and
intersect with `call('<name>'` in the suite (plus the authz matrix rows, which register through the
`finally`). Result: 94 / 94.

**What this strategy CANNOT prove**, stated plainly so nobody reads a green static pass as a green
run: real Firestore index availability, real timing (a cooldown assertion assumes the two
`expectError` round trips finish inside the 15 s lockout), real gallery window sizes
(`searchGallery`'s 50-doc / `searchTaskLibrary`'s 100-doc caps as the suite's published corpus
grows), and every genuine behavioral regression. `npm run e2e` remains the authority. **The suite has
not been run.**

## Risks / Trade-offs

- **The repairs can now fail.** Three checks that could not fail can now. If the underlying behavior
  was never correct, the first real run goes red — which is the desired outcome and is why the
  reasoning is written at each assertion.
- **A pending flake, disclosed not silenced:** `acWA4.cooldownRemainingMs > 0` assumes the two
  `expectError` round trips complete within the 15 s lockout. On a heavily loaded emulator that
  could expire. It is left strict; if it flakes, the fix is to shorten the intervening work, not to
  loosen the bound.
- **Corpus-growth pressure:** the tags scenario publishes one more game and one more task into the
  shared gallery. `searchTaskLibrary` fetches at most 100 documents, and a later scenario asserts
  across that window. Not a defect today; a slow squeeze worth a cap-aware rewrite if the published
  corpus keeps growing.
- **A borrowed run stays pruned.** The retention block back-dates the coverage scenario's own run,
  lets the sweep prune it, then restores the timestamps but NOT `piiPrunedAt`. Nothing later reads
  that run, and `piiPrunedAt` is exactly the idempotence tombstone, so a re-sweep is a no-op.
- **Static review can be wrong.** It reasons about code, not about a running system. This is why the
  report says UNRUN rather than "should pass".

## Open Questions

- **No lane-vs-lane behavioral disagreement was found.** The one place two lanes touch the same
  field — `answerCost.cooldownUntil` — is consistent: `retry-lockout-clock-skew` replaced the old
  `cooldownUntil > Date.now()` comparison with a duration assertion and kept a separate
  `cooldownUntil > 0` check for the deprecated field, matching `answerCostDisplay`, which ships both.
- Should `FORBIDDEN_KEYS` also be enforced after `decode`, given that a `__proto__` in ANY callable
  payload re-points the decoded object's prototype? Inert for `importGameFile` today. Raised for the
  owner of `functions/**`; deliberately not acted on here.

## Addendum â€” second wave: the assertions six lanes owed but could not write

### Context (second wave)

Sections 1â€“4 repaired what other lanes had already written. This addendum covers the opposite
problem: six lanes finished, each REPORTED in its own handoff the e2e coverage it owed, and none
could write it, because ownership of `scripts/e2e-verify.mjs` is exclusive. Left alone, `npm run e2e`
would have gone green over six changes it never exercised â€” the same "reports safety it does not
provide" failure the original proposal is about, arrived at from the other direction.

| Lane (change) | Where the coverage went | Why there |
|---|---|---|
| `pause-clock-tasks` | NEW scenario + an extension to the leaderboard invariant ORACLE | six independent properties, and one of them (duration well-formedness) belongs on every board the suite builds, not on one |
| `task-duration-defaults` | NEW scenario (save door) + `withTaskOverride` block in export/import (file door) | the two doors run the same validator and must be proven not to drift |
| `held-team-visibility` | extension of `guardian consent gate` | its fixtures already carry a consent-required run and an approved team; only a second, un-consented team was missing |
| `photo-review-throughput` | NEW scenario | the existing feed scenario counts feed items exactly; adding teams to it would have invalidated those counts |
| `expose-enforced-settings` | extension of `safe-zone boundary` + export/import | the zoned game and the import helper already exist |
| `run-console-attention` | NEW row allowlist + core lifecycle + consent scenario | there was no `listRunTeams` row allowlist to extend, so one was created |

### Decisions (second wave)

**D5 â€” the duration invariant belongs in the oracle, not in one scenario.** `durationSeconds` stopped
being a measurement and became a derivation (`raw âˆ’ excluded`) the moment `pause-clock-tasks`
shipped. That makes it the one leaderboard field a subtraction bug can reach, on EVERY board, so the
three properties (finite, non-negative, never longer than the team's own wall clock) went into
`assertLeaderboardInvariants` where all existing call sites inherit them. The wall-clock bound needs
a second, independent source for `startedAt` â€” the team documents â€” so it is an OPTIONAL fourth
parameter: a caller that does not hold that data omits it and every existing call site is unchanged.
Comparing the board's own `finishedAt` against the board's own `durationSeconds` would have been a
tautology; comparing it against the team document is a real comparison.

**D6 â€” assert the PREMISE, or the conclusion proves nothing.** Four of the new checks rest on a
precondition that could quietly fail to hold, and each precondition is asserted separately rather
than assumed: the Tortoise really did take longer on the wall clock (otherwise "the paused team
outranks the faster wall clock" is satisfied by it simply being faster); the cap-1 station really was
reserved before it was released (otherwise "counter returns to 0" passes on a counter that was never
1); a valid `expectedDurationMinutes` really is stored (otherwise the three refusals would also pass
against a door that rejected the field outright); and the safe-zone fixture really did have a stored
boundary before the clear. This is the same class of defect section 2 repaired â€” a check that passes
for a reason unrelated to the thing under test.

**D7 â€” key ABSENCE, not falsiness, is the safe-zone clear's contract.** The bug being defended
against is `db.settings({ ignoreUndefinedProperties: true })` turning `updates.safeZone = undefined`
into a no-op, which is why the implementation writes an explicit `FieldValue.delete()`. A check of
the form "the zone is falsy" would have passed while that bug was live, because the field the buggy
path left behind was the OLD boundary â€” and, on the wire, an absent field and an undefined one are
indistinguishable to a falsiness test. The assertion is therefore `!('safeZone' in game)`, and the
accepted-import assertion compares KEY SETS rather than a JSON string so Firestore's map-key ordering
can neither break it nor accidentally satisfy it.

**D8 â€” one owed assertion was narrowed, and the reason is a real product boundary, not a weakening.**
The `photo-review-throughput` handoff asked for "a submission from an already-finalised team still
reviews without throwing". Read against the implementation there are two distinct states, and they
behave differently on purpose:

- an already-finished TEAM on a live run â€” `completeTaskForTeam` short-circuits on the terminal task
  record and returns `completed: false`, so the review resolves `ok` and scores nothing. This is what
  the scenario asserts, and it is the state a reviewer working a backlog actually meets.
- an already-finalised RUN â€” `completeTaskForTeam` throws `failed-precondition` at both the pre-txn
  and in-txn status checks (WO Fix 3 / wave-G #2), deliberately, so a straggler completion cannot
  rewrite a published final board. Asserting "reviews without throwing" there would have contradicted
  an existing, intentional guard that the `post-finalize grading is rejected` scenario already pins.

Reported rather than silently reinterpreted, per the lane's own rule.

**D9 â€” the `listRunTeams` row allowlist is new surface, and that is deliberate.** The handoff said
"add the three keys to the allowlist if one exists". None did. Rather than skip it, the allowlist was
created, because the argument for it is the same one that justifies `ALLOWED_TASK_KEYS` one level
down: the row is projected BY HAND from a team document that carries answer-attempt counters, device
uids, guardian-consent records and raw submission urls, and a future `...t` spread would ship all of
that to every staff console with nothing failing anywhere. The three attention keys are additionally
asserted PRESENT, because an allowlist is blind to a field being DROPPED â€” and a console that reads
an absent key renders "no evidence" forever, which is precisely the silent failure
`run-console-attention` exists to remove.

**D10 â€” the NaN transport fact, written down once and referenced.** `NaN` cannot cross a callable:
JSON has no NaN, so the client encodes it as `null`. Every "refuses NaN" assertion therefore
exercises the `typeof !== 'number'` arm of the validator, not the `Number.isFinite` arm. That is
still a real arm â€” it is the one a hand-written client or a hand-edited game file actually hits â€” but
the distinction is recorded inline at each site so a later author does not "fix" the assertion by
reaching for a spelling that cannot survive the wire. Same category as D1's `__proto__` finding.

### What this addendum still cannot prove

Identical to the first wave, plus two timing dependencies introduced here, disclosed rather than
hidden:

- The pause scenario sleeps ~2.6 s so the excluded span dominates scheduling jitter, and asserts
  `durationSeconds == wall âˆ’ excluded` within Â±1 s. Both terms are read from server-written stamps,
  so emulator load cannot break the equality â€” only the Â±1 s bound, and only if the two round trips
  around the read straddle a second boundary by more than a second, which the bound already absorbs.
- The all-paused case asserts `durationSeconds === 0` EXACTLY. That is exact by construction â€”
  `startTeams` writes the team's `startedAt` and the task record's `startedAt` from the same `now`,
  and `completeTaskForTeam` writes the record's `completedAt` and the team's `finishedAt` from the
  same `now`, so raw and excluded are the same subtraction. If it ever comes back non-zero, that is a
  finding about the stamp sites, not a tolerance to loosen.

**The suite remains UNRUN.** These assertions are written and statically checked
(`node --check`) only.


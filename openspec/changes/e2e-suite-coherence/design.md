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

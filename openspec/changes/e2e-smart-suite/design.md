# Smart E2E Suite — design

## Harness shape (scripts/e2e-verify.mjs)

```js
const scenarios = [];               // { name, ms, checks, failures }
let current = null;
async function scenario(name, fn) {
  current = { name, ms: 0, checks: 0, failures: 0 };
  const t0 = Date.now();
  try { await fn(); }
  catch (e) { current.failures++; failures++; console.error(`FAIL  [${name}] scenario aborted :: ${e.code ?? ''} ${e.message}`); }
  current.ms = Date.now() - t0;
  scenarios.push(current); current = null;
}
```

- `check(label, cond, detail)` keeps its signature; it also increments the current scenario's
  counters so the summary can group by scenario.
- `expectError(label, promise, { code?, match? })` replaces the repeated try/catch-flag idiom:
  awaits the promise, fails if it resolves, and asserts `e.code`/`e.message` when given.
- `makeParty(name)` wraps `call` to record `{fn, ms}` samples; the run ends with a per-callable
  table (count, p50, max) — a soft latency budget: log-only, no hard failure (emulator timing is
  noisy; hard limits would flake).
- The **core lifecycle** (create → launch → join → play → staff → finalize → prune → recap) stays
  one dependent chain inside a single scenario: its steps genuinely depend on each other.
  Everything already independent (partial stages, hints, task types, hidden location, referral,
  attempt limit, consent, safe zone, translate, discovery, hot zone, challenge) becomes its own
  scenario so one regression no longer hides the rest.

## Invariant oracle

`assertLeaderboardInvariants(label, rankings, expectedTeamIds)` asserts: length matches, each
expected team exactly once, `rank[i] === i+1`, scores finite, and sorted per preset
(non-time: `score` non-increasing). Parity: with all teams finished, call
`refreshLeaderboard({publish:false})` then `finalizeRun` and require identical team ordering —
this is the executable form of the "live and final standings can't drift" promise.

Per-team score conservation, asserted from `getMyTeamState`:
`Σ stages[].tasks[].earnedScore === team.score` and for each completed task
`scoreBreakdown.total === earnedScore` (and `taskScore × hotZoneMultiplier === total` when
multiplied).

## Contention (TDD: RED → GREEN)

Scenario: one stage, TWO station tasks with `maxConcurrentTeams: 1` (single-task stages bypass
routing by design, so two tasks are needed to hit `assignTask`). Three teams issue
`requestNextTask` in `Promise.all`. The creator (owner) then reads the run doc:
`taskCounts[t] ≤ 1` for both tasks must hold. Today's `assignTask` reads `taskCounts`, filters,
then increments outside a transaction — expected to FAIL (RED).

GREEN: `assignTask` runs inside `db.runTransaction`: `tx.get(runRef)` → filter candidates by the
fresh counts → `tx.update` the increment. Retries on contention give each concurrent caller a
consistent view. `releaseTask` keeps its shape (floor-at-zero) but also moves to a transaction to
avoid decrement races. Pure-logic unit tests in `assignNextTask.test.ts` keep passing (the
priority math is untouched).

Duplicate-submission checks ride the transactional idempotence already in `completeTaskForTeam`
(`if (taskRec.status === 'completed') return`): fire `verifyStationCode` twice concurrently and
`completeTask` twice concurrently; assert the task's `earnedScore` counted once in `team.score`.

## Sanitizer allowlist

The e2e asserts `Object.keys(activeTask) ⊆ ALLOWED_TASK_KEYS` and
`Object.keys(activeTask.smart) ⊆ ALLOWED_SMART_KEYS` (mirroring `sanitizeTask.ts`'s explicit
smart allowlist and the known top-level shape). Adding a field to `Task` now requires a conscious
allowlist update in the test — the failure mode flips from "silent leak" to "loud test".

## Authz matrix

```js
const DENIED = [
  { as: player, fn: 'startTeams',        data: {...}, codes: ['permission-denied', 'not-found'] },
  { as: player, fn: 'finalizeRun',       ... },
  ...
];
for (const row of DENIED) await expectError(`authz: ${row.who} cannot ${row.fn}`, row.as.call(row.fn, row.data), { codeIn: row.codes });
```

`not-found` is accepted where the callable resolves the run under the CALLER's uid (e.g.
`startTeams`) — the important property is denial, not the exact code.

## Boundary fuzz

Seeded LCG (same constants as simulate-tournament) so failures reproduce. Cases: quiz answer with
random casing + surrounding whitespace (accept), decoy answer differing by one char (reject);
numeric `12 ± 1`: `'13'` accept, `'14'` reject, `'11'` accept, `'10.99'` reject; geofence 60 m:
check-in at ~55 m accepts, ~70 m rejects (offsets computed via ~111,320 m/° latitude, safely away
from haversine rounding).

## Load simulator (scripts/simulate-run.mjs)

Callable-only driver (no admin SDK writes to game state): creator builds a 3-stage game (station
codes + field tasks + a locationless stage, mixed caps), launches, N teams (default 12,
`--teams=N`) join and play concurrently via a bounded `pMap`. Teams use seeded jittered GPS along
a route. Ends with: finalize, the same leaderboard invariant oracle, `taskCounts` audit
(every counter back to 0 after all completions/releases), and a latency table. Exit non-zero on
any invariant violation. `package.json`: `"simulate": "node scripts/simulate-run.mjs"`,
`"simulate:v1": "node scripts/simulate-tournament.mjs"` (deprecated header comment added).

## Test strategy

- The e2e IS the test artifact; TDD applies to the backend fix: the contention scenario is
  written and observed RED against the emulator before `assignTask` is made transactional.
- Unit lane: `assignNextTask.test.ts` still covers priority math; no new unit tests needed
  (the transactional wrapper is emulator-verified by the contention scenario).
- Gates: `npm run typecheck`, `npm test`, `npm run lint`, both builds, `npm run e2e` all green.
  No UI touched → no i18n gate.

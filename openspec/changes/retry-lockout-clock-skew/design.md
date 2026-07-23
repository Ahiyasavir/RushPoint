## Context

The retry lockout was introduced by the in-flight `wrong-answer-cost` change. Its current shape, as
read in this working tree:

- `packages/shared/src/wrongAnswerPenalty.ts`
  - `wrongAnswerCost(level, preset, attemptIndex, alreadyChargedPoints)` → `{ points,
    cooldownSeconds, chargedIndex }`. Pure, capped, finiteness-guarded. **Unchanged by this change.**
  - `cooldownRemainingSeconds(cooldownUntilMs, nowMs)` (`:151-156`) → `Math.ceil((until - now)/1000)`,
    0 for missing/non-finite/past. Fails open. **No upper bound.**
  - `answerCostDisplay(level, preset, attemptsUsed, charged, cooldownUntil)` (`:210-232`) →
    `AnswerCostDisplay`, which carries `cooldownUntil` — an absolute epoch instant — straight to the
    participant.
- `functions/src/runs/index.ts`
  - `:3377` `penaltyRec: { charged; lastHash; cooldownUntil }` read from the team doc.
  - `:3411-3412` duplicate-submission replay response returns `cooldownUntil` + `retryAfterSeconds`.
  - `:3424-3429` the **submit gate**: `cooldownRemainingSeconds(penaltyRec.cooldownUntil,
    Date.now())` — server instant vs server clock. Waived for a test-drive run.
  - `:3480-3499` the charge transaction: writes `cooldownUntil = nowMs + cost.cooldownSeconds*1000`
    into `answerPenalties[taskId]` (a real nested object — the dotted-key footgun is already
    respected) and returns the same instant.
  - `:3719-3726` `getMyTeamState`'s participant task payload calls `answerCostDisplay(..., penRec?.cooldownUntil ?? 0)`.
- `apps/play-web/src/components/TaskRunner.tsx`
  - `:201-210` `cooldown` state keyed by `taskId`, raise-only within one task.
  - `:215-218` adopts `task.answerCost.cooldownUntil` — **a server instant** — as the local deadline.
  - `:219-226` ticks `Date.now()` every 500 ms and derives `cooldownLeft =
    cooldownRemainingSeconds(cooldownUntil, cooldownNow)` — **client clock vs server instant.**
  - `:234` `answerFrozen = frozen || cooldownLeft > 0` disables the graded answer controls.
  - `:511-512` `applyAnswerCost` adopts `res.cooldownUntil` — the same instant — after a wrong answer.
- `packages/shared/src/types/index.ts:869` types the ledger record.
- `scripts/e2e-verify.mjs` scenario `wrong answers cost (…)` (`:1262`) already asserts the server
  gate, including `:1345-1347` which asserts `answerCost.cooldownUntil > Date.now()` — an assertion
  that is itself written in the units this change is removing from the wire.

**The defect, stated exactly:** the *decision* is server-side and correct. The *number on the wire*
is an absolute instant that only means anything relative to the clock that produced it, and the
client re-interprets it against a different clock. The failure mode is a player frozen out of a live
game by their own phone's clock, not a cheat.

**Hard constraint:** a live playtest/dev stack (Vite 5180/5181, Firestore emulator 8080) is serving
from this working tree. No emulator/Vite/tunnel/backup process may be started, stopped or restarted,
and `npm run e2e`, `verify:emulator`, `test:rules`, `dev:all`, `playtest` must not be run. All
verification here is pure-logic + static + the non-emulator gates.

## Goals / Non-Goals

**Goals**
- One pure, total, bounded function is the single answer to "is this team locked out, and for how
  much longer?".
- The participant receives a **duration**, never an instant. Client clock skew becomes irrelevant to
  the countdown.
- A stored lockout can never exceed the policy ceiling that produced it, and can never be negative.
- Lockout records written before this change keep behaving correctly — neither stuck locked nor
  silently unlocked.
- Zero behavior change for a game with no cost level (`off`), which is every pre-existing game.

**Non-Goals**
- No change to the cost curve, the levels table, or `wrongAnswerCost`.
- No new callable, rule, index or env var; no i18n copy change.
- No removal of the existing absolute-instant fields from the wire or the ledger (compatibility).
- No audit of the other absolute-instant surfaces (task expiry, hint escalation, throttles).

## Decisions

### D1 — `evaluateRetryLockout(nowMs, record, policy)` is the single decision point

New export in `packages/shared/src/wrongAnswerPenalty.ts`:

```ts
export interface RetryLockoutRecord {
  cooldownUntil?: number | null;   // legacy absolute expiry (server clock)
  lastFailureAt?: number | null;   // server instant of the failure that started the lockout
  lockoutMs?: number | null;       // the duration that failure earned
  failureCount?: number | null;    // charged-attempt index; carried for diagnosis, never trusted
}
export interface RetryLockoutPolicy { maxCooldownSeconds: number }
export interface RetryLockoutVerdict {
  locked: boolean;
  remainingMs: number;      // always finite, always >= 0, always <= policy ceiling
  remainingSeconds: number; // ceil(remainingMs / 1000) — what the UI shows
  clamped: boolean;         // the stored value exceeded the ceiling and was cut down
  source: 'duration' | 'legacy' | 'none';
}
export function evaluateRetryLockout(
  nowMs: number, record: RetryLockoutRecord | null | undefined, policy: RetryLockoutPolicy,
): RetryLockoutVerdict
```

*Why a verdict object rather than a bare number:* the submit gate needs `locked`, the wire needs
`remainingMs`, the UI needs `remainingSeconds`, and `clamped`/`source` make the migration path
observable in tests instead of inferred.

*Why `policy` is passed in:* the ceiling belongs to the level that created the lockout
(`WRONG_ANSWER_LEVELS[level].maxCooldownSeconds`). Hard-coding a global ceiling would either be too
loose for `gentle` (30 s) or too tight for `strict` (180 s). `retryLockoutPolicyFor(level)` is a
one-line helper so callers cannot invent a ceiling.

### D2 — Resolution order: duration form first, legacy absolute second, else unlocked

1. If `lastFailureAt` and `lockoutMs` are both finite and `lockoutMs > 0` → `end = lastFailureAt +
   lockoutMs`, `source: 'duration'`.
2. Else if `cooldownUntil` is finite and `> 0` → `end = cooldownUntil`, `source: 'legacy'`.
3. Else → `{ locked: false, remainingMs: 0, source: 'none' }`.

`remainingMs = clamp(end - nowMs, 0, ceilingMs)`. `locked = remainingMs > 0`.

*Why duration-first:* once both forms are present the duration form is the one that carries its own
bound. *Why legacy still works:* step 2 is byte-for-byte the current semantics, so a record written
before this change cools down and expires exactly as it does today (test 8 pins this) — it is simply
also protected by the ceiling.

*Why a non-finite / negative / absent value is UNLOCKED, never locked:* the failure this change
exists to eliminate is a player frozen out of a live game. Every ambiguity resolves toward "let them
play". The cost of failing open is one uncharged retry; the cost of failing closed is a ruined run.

### D3 — The ceiling is applied on READ, not only on write

Clamping at write time would leave every already-written bad value bad forever. Clamping on read
means a poisoned `cooldownUntil` (corrupt write, imported snapshot from a machine with a different
clock, a server clock jump between write and read) decays to at most the level ceiling — 90 s at
`standard` — instead of locking that team out of that task for the rest of the run. `clamped: true`
records that it happened.

*Boundary rule:* `remaining === 0` is **unlocked** (`locked = remainingMs > 0`). At exactly the
expiry instant the team may answer. This matches the existing `cooldownRemainingSeconds` `until <=
now → 0` behavior, so the boundary does not move.

### D4 — The wire carries `remainingMs`; the instants stay for compatibility

- `AnswerCostDisplay` gains `cooldownRemainingMs: number` (server-computed at response time).
  `cooldownUntil` is **kept** and documented as deprecated-for-display.
- `submitTaskAnswer`'s wrong-answer and replay responses gain `retryAfterMs`; `retryAfterSeconds`
  and `cooldownUntil` are kept.

*Why keep the old fields:* play-web is a PWA with a service worker. A phone mid-run is running the
bundle it cached, and removing a field it reads would break a live game — the exact class of bug
this change is fixing. Additive-only is the safe shape; the deprecated fields can be dropped once
the change is archived and no cached bundle predates it.

*Why `remainingMs` and not `remainingSeconds` on the wire:* the round trip and the render both cost
time; shipping ms lets the client take `Date.now() + remainingMs` as its own local deadline and
apply the `Math.ceil` at display, so the countdown does not jump a whole second on arrival.

### D5 — The client converts the duration into a LOCAL deadline immediately

`TaskRunner` keeps its existing keyed, raise-only `cooldown` state but stores
`Date.now() + remainingMs`, where `Date.now()` is the **client's own** clock — the same clock the
500 ms tick reads. Both sides of the countdown subtraction now come from one clock, so skew cancels
exactly. Network latency remains as a small over-count (the player waits marginally longer than the
server requires), which is the correct direction: the client never re-enables the button before the
server would accept it.

The raise-only rule is preserved and still matters: `getMyTeamState` polls and a wrong-answer
response can land out of order, so `Math.max` on the derived local deadline prevents a stale
response shortening a live lockout.

### D6 — The server writes both forms

The charge transaction writes `answerPenalties[taskId] = { charged, lastHash, cooldownUntil,
lastFailureAt: nowMs, lockoutMs: cost.cooldownSeconds * 1000, failureCount: chargedIndex }` as a
**real nested object** (the `.set({merge})` dotted-key footgun stays respected, and this is a map
keyed by taskId, never an array element). `cooldownUntil` keeps being written so a rollback of the
functions bundle alone does not strand the ledger.

### D7 — Where the level comes from at the gate

The submit gate already resolves `costLevel` before reading the ledger, so
`retryLockoutPolicyFor(costLevel)` is free there. `answerCostDisplay` already takes `level`. No new
reads, no extra Firestore round trip — the performance shape of the hot path is unchanged.

### D8 — What is NOT changed

`cooldownRemainingSeconds` stays exported and unmodified: it is used by
`functions/src/__property__/invariants.property.test.ts` and by `scripts/test-wrong-answer-penalty.ts`,
and it remains the right primitive for "seconds left until a local deadline" on the client. This
change adds a decision function above it rather than mutating a primitive other code depends on.

## Test Strategy

**Lane: pure logic, vitest, no emulator** — new `functions/src/retryLockout.test.ts` (co-located
vitest lane, run by `npm test` via `turbo run test`; the existing wrong-answer pure tests live in
`scripts/test-wrong-answer-penalty.ts` and the property lane, both of which stay green unchanged).

Cases, each an explicit `test(...)`:

1. **No failures** — `undefined` record, `{}`, and `{ charged: 0, lastHash: '' }` → `locked:false`,
   `remainingMs:0`, `source:'none'`.
2. **First failure at `standard` is free** — `wrongAnswerCost('standard', …, 1, 0).cooldownSeconds
   === 0` ⇒ `lockoutMs 0` ⇒ not locked. The free attempt must not produce a lockout.
3. **Escalating failures** — drive attempts 2..8 at `standard` through `wrongAnswerCost`, build the
   record from each, and assert `remainingMs` is 15 s, 30 s, 45 s, 60 s, 75 s, 90 s, 90 s — i.e. the
   verdict tracks the curve and saturates at the level ceiling. Repeat for `gentle` (30 s ceiling)
   and `strict` (180 s ceiling).
4. **Boundary ±1 ms** — at `end - 1` → locked with `remainingMs === 1`; at `end` → **unlocked**,
   `remainingMs === 0`; at `end + 1` → unlocked. Pinned for both the duration and the legacy form.
5. **Expired lockout** — `now` well past `end` → unlocked, `remainingMs === 0`, never negative.
6. **Client clock skewed hours FORWARD** — the client-side conversion is exercised as the pure
   identity it now is: `remainingMs` is a function of the SERVER `now` only, so evaluating with a
   server `now` and then deriving a local deadline with a client clock offset by +6 h yields the
   same countdown length. Asserted as: `evaluateRetryLockout(serverNow, rec, policy).remainingMs`
   is independent of any client offset, and the naive legacy computation
   (`cooldownRemainingSeconds(rec.cooldownUntil, serverNow + 6h)`) is shown to return **0** —
   pinning the bug this change removes.
7. **Client clock skewed hours BACKWARD** — same, with `-6 h`: the naive computation returns
   ~21600 s (a six-hour freeze) while the verdict-based path returns the true remaining. This is the
   stuck-player regression test.
8. **Migration / backward compatibility (explicit)** — a legacy record `{ charged, lastHash,
   cooldownUntil }` with **no** `lastFailureAt`/`lockoutMs`:
   - still locked while `now < cooldownUntil` (**not permanently unlocked**),
   - unlocked once `now >= cooldownUntil` (**not permanently locked**),
   - `source === 'legacy'`,
   - a legacy `cooldownUntil` absurdly far in the future (`now + 30 days`) is **clamped** to the
     level ceiling and `clamped === true` — the self-healing property from D3.
9. **Malformed stored timestamps** — `cooldownUntil` of `-1`, `NaN`, `Infinity`, `-Infinity`,
   `null`, `undefined`, `'123'` (wrong type), and the same set for `lastFailureAt`/`lockoutMs`
   (including `lockoutMs` negative and `lastFailureAt` in the future) → every one yields a finite
   `remainingMs >= 0` and never a `NaN`; none produces an unbounded lock.
10. **Never negative, never NaN, never above the ceiling** — a seeded sweep over random
    `now`/`record`/level combinations asserting the three invariants on every output, in the style of
    `functions/src/__property__/invariants.property.test.ts`.
11. **Precedence** — a record carrying BOTH forms with conflicting values resolves to the duration
    form (`source:'duration'`).
12. **`retryLockoutPolicyFor`** — returns each level's `maxCooldownSeconds` and falls back to `off`
    (ceiling 0 ⇒ never locked) for a garbage level.

**Lane: callable behavior, e2e — WRITTEN BUT NOT RUN.** Assertions are added to the existing
`wrong answers cost (escalate, cap, cooldown, replay, preset)` scenario in `scripts/e2e-verify.mjs`:
- the wrong-answer response carries `retryAfterMs > 0` and `retryAfterMs <= 15000` on the 2nd wrong
  answer, and `retryAfterMs` is consistent with `retryAfterSeconds`;
- `getMyTeamState`'s active task carries `answerCost.cooldownRemainingMs > 0` **and** that value is
  a plain duration (`<= level ceiling in ms`), replacing reliance on comparing an instant to the
  test runner's own `Date.now()`;
- the replay response also carries `retryAfterMs`.
The suite is **not executed** — a live playtest stack owns the emulator. This is recorded as an
outstanding verification in tasks.md, not glossed over.

**Lane: UI.** `TaskRunner.tsx` changes only which number seeds the countdown; no user-facing string
is added or altered. `npm run i18n:check` is still run (mandatory for any UI edit) and
`npm run i18n:check:strict` is compared against the pre-change baseline to prove zero NEW PART B
findings. Interactive preview verification is **not** performed — driving the live play-web against
the shared stack risks the running playtest — and is flagged as unverified.

**Gates run:** `npm run typecheck`, `npm run lint`, `npm test`, `npm run play:build`,
`npm run creator:build`, `npm run i18n:check`. **Not run (constraint):** `npm run e2e`,
`npm run verify:emulator`, `npm run test:rules`.

## Risks / Trade-offs

- **This function decides whether a player can play.** Mitigation: pure, total, fail-open, ceiling
  on read, and the invariant sweep in test 10.
- **Two stored forms coexist.** Mitigation: explicit precedence (D2), `source` in the verdict so
  tests can prove which path ran, and the migration case asserted in both directions (test 8).
- **Additive wire fields mean the deprecated instants linger.** Accepted deliberately (D4); removal
  is a follow-up once no cached bundle predates the change.
- **Latency makes the client's local deadline slightly late.** Accepted: it errs toward the player
  waiting a few hundred ms longer, never toward the button re-enabling before the server accepts.
- **The e2e assertions are unrun.** Stated plainly; they are additive to a scenario that already
  passes, and the pure lane covers the logic they exercise.

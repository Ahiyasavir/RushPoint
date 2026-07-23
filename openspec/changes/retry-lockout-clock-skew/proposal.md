## Why

The wrong-answer retry lockout (change: `wrong-answer-cost`) ships the participant an **absolute
epoch instant** and asks the participant's device to decide, against **its own clock**, whether the
lockout is over. The reported issue — "the lockout decision is clock-skew sensitive so a device can
bypass it entirely" — is **half right, and the half that is wrong matters**, so it is stated
precisely here rather than fixed as reported.

Verified in this working tree:

1. **Enforcement is already server-authoritative and is NOT bypassable.**
   `functions/src/runs/index.ts:3424` gates `submitTaskAnswer` with
   `cooldownRemainingSeconds(penaltyRec.cooldownUntil, Date.now())`, where `cooldownUntil` was
   written by the server at `:3481` (`nowMs + cost.cooldownSeconds * 1000`) and `Date.now()` is the
   **server** clock. Both sides of that comparison come from the same clock. A device with a skewed
   clock cannot shorten or skip the wait — `submitTaskAnswer` still throws `failed-precondition`.
   **There is no cheat here.** The e2e scenario already pins this (`scripts/e2e-verify.mjs:1335-1340`:
   even the correct answer waits out the cooldown).

2. **The DISPLAY is the real defect, and it is a stuck-player defect.**
   `answerCostDisplay` (`packages/shared/src/wrongAnswerPenalty.ts:229`) puts the raw server instant
   `cooldownUntil` on the wire, and `submitTaskAnswer` returns the same absolute instant
   (`runs/index.ts:3505`). `TaskRunner.tsx:215-226` adopts it as a local deadline and counts it down
   against `Date.now()` — the **client** clock — via `cooldownRemainingSeconds(cooldownUntil,
   cooldownNow)`. Skew is therefore applied to the countdown at full magnitude:
   - A phone whose clock is **hours behind** sees `until - now` of hours. `answerFrozen`
     (`TaskRunner.tsx:234`) disables the answer controls for that whole period. The player is locked
     out of a game the server would happily let them play. On a real field game this reads as "the
     app froze" and there is no recovery short of a reload — and a reload re-reads the same absolute
     instant from `getMyTeamState` and freezes again.
   - A phone whose clock is **hours ahead** sees 0 and re-enables the controls immediately. It gains
     nothing (the server refuses), but it converts a clear countdown into an opaque
     `failed-precondition` rejection loop.
   The skew magnitude is unbounded, so the UI-side lockout can be arbitrarily long. Phones with
   wrong clocks are common in exactly the population that plays these games (kids' devices, phones
   restored from backup, devices with no SIM and no NTP on a foreign SSID).

3. **The stored value has no ceiling on the read path.** `cooldownRemainingSeconds` fails open only
   for missing/non-finite/past values. A `cooldownUntil` that is far in the future for any reason —
   a corrupt write, a manual edit, a clock jump on the *server*/emulator between the write and the
   read, an imported emulator snapshot from a machine with a different clock — locks that team out
   of that task with no bound and no expiry, on the server too. Nothing today clamps it to the
   level's own `maxCooldownSeconds` (90 s at `standard`, 180 s at `strict`).

So the fix is not "move the decision to the server" — it is already there. It is: **stop putting an
absolute instant on the wire at all**, and **bound the stored lockout by the policy that produced
it** so no single value can outlive its own rule.

## What Changes

**The wire carries a remaining DURATION, never an instant.**
- Everything the participant receives about a retry lockout is a number of **milliseconds left**,
  computed server-side at the moment of the response against the server clock. The client never
  re-interprets a server instant against its own clock; it starts a countdown from the duration it
  was handed, using only its own clock for the tick.
- Consequence: a device whose clock is wrong by any amount counts down the correct number of
  seconds. Clock skew stops being able to freeze a player out of their game.

**The lockout decision becomes one pure, total function.**
- A single function of `(nowMs, stored lockout state, policy)` returns `{ locked, remainingMs }` and
  is the only place the question "is this team still locked out?" is answered — for the submit gate,
  for the display object, and for the response to a wrong answer. Three call sites cannot drift.
- It is **total**: every input, including a negative, `NaN`, `Infinity`, `undefined` or absent
  stored timestamp, maps to an explicit decision. Ambiguity resolves to **unlocked**, because a bug
  in this function must never be able to lock a team out of their own game.
- It is **bounded**: the remaining time can never exceed the maximum lockout the governing policy
  can produce, and can never be negative. A stored instant far in the future decays to the policy
  ceiling instead of locking forever.

**The stored ledger records the lockout as a server instant PLUS the duration that produced it.**
- New writes record when the failure happened (server clock) and how long the lockout is, alongside
  the existing absolute expiry. The duration is what makes the ceiling check meaningful and what
  lets the server answer "how much is left" without trusting a bare instant.

**Backward compatibility is a requirement, not a hope.**
- Team documents already written carry only the absolute `cooldownUntil`. Those SHALL keep working:
  a legacy record still cools down, still expires, and — critically — a legacy record can neither
  become permanently locked nor permanently unlocked. The old field keeps being written so a
  play-web PWA still running cached older JS keeps counting down.

### Non-goals

- **No change to the cost curve.** Levels, free attempts, point steps, caps and cooldown steps in
  `WRONG_ANSWER_LEVELS` are untouched; `wrongAnswerCost` is not modified.
- **No change to who is authoritative.** The server already decides; this change does not relax,
  tighten or relocate that gate. No new bypass, no new trust in the client.
- **No new callable**, no Firestore rule change, no new index, no new env var.
- **No user-facing copy change.** No new i18n keys; the countdown string
  (`t.task.answerCooldown`) is unchanged.
- **Does not touch the other absolute-instant surfaces** (task expiry `expiryInstantMs`, hint
  escalation, staff throttle, rate limiting). They are a separate audit.
- **Does not remove `cooldownUntil`** from the wire or the ledger. Removing it would break clients
  mid-run; it is retained and deprecated in place.

## Capabilities

### New Capabilities
- `retry-lockout`: the retry lockout after a wrong answer is decided by the server against the
  server clock, expressed to the participant purely as a remaining duration, bounded by the policy
  that created it, total over malformed stored state, and compatible with lockout records written
  before this change.

## Impact

- **Surfaces touched:** `packages/shared` (new pure function + one added display field + one widened
  ledger type), `functions/src/runs/index.ts` (submit gate, wrong-answer response, participant task
  payload), `apps/play-web` (`TaskRunner.tsx` countdown source, `services/calls.ts` response type).
  **No** creator-web, **no** Firestore rules, **no** i18n dictionary change.
- **Files:** `packages/shared/src/wrongAnswerPenalty.ts`, `packages/shared/src/types/index.ts`,
  `functions/src/runs/index.ts`, `apps/play-web/src/components/TaskRunner.tsx`,
  `apps/play-web/src/services/calls.ts`, new `functions/src/retryLockout.test.ts`,
  `scripts/e2e-verify.mjs` (assertions added, see below).
- **Wire compatibility:** `answerCost.cooldownRemainingMs` and `retryAfterMs` are **added**;
  `answerCost.cooldownUntil`, `cooldownUntil` and `retryAfterSeconds` are **kept** so an older
  cached play-web bundle keeps working exactly as it does today.
- **Data compatibility:** `answerPenalties[taskId]` gains two optional fields. Existing records with
  only `{ charged, lastHash, cooldownUntil }` are explicitly covered by a test.
- **Risk:** this function decides whether a player can play. Mitigated by making it pure, total and
  fail-open, by clamping to the policy ceiling on the read path (so an already-bad stored value
  self-heals), and by asserting the migration case directly.
- **Testing:** pure-logic lane (`functions/src/retryLockout.test.ts`, vitest, no emulator).
  Callable-level assertions are **added** to `scripts/e2e-verify.mjs` but **deliberately not run** —
  a live playtest stack is serving from this working tree and the emulator must not be restarted.
  That gap is stated in tasks.md rather than assumed away.

# Wave-H — backend hardening batch (SDD)

Spec-driven + TDD record for the coherent backend hardening batch drawn from the
three wave-h read-only audits:
- `docs/wave-h/task-grading-secrecy.md` (grading-gate asymmetry findings #1–#6)
- `docs/wave-h/liveops-webhook-billing.md` (P2 #1 mirrorToChat timeout)
- `docs/wave-h/auth-join-devices.md` (H1 device code CSPRNG, H3 display-char strip)

Branch `topographic-maps`. Ownership is scoped to `functions/src/index.ts`,
`functions/src/runs/{index.ts,teamDevices.ts}`, `packages/shared/src/{validation.ts,
geo.ts,challenge.ts}` (+ tests), `scripts/e2e-verify.mjs`, `scripts/test-*.ts`.
No `apps/**` touched.

---

## Why (proposal)

The shared `completeTaskForTeam` choke point never carried the release/expiry or
attempt-limit gates, so each callable *wrapper* must add them. `submitTaskAnswer`
(attempt-limit) and `completeTask` (release/expiry) do; the smart_station and photo
wrappers (`verifyStationCode`, `submitStationPhoto`) did **not** — a grading-gate
asymmetry an attacker can use to brute-force a short `secretCode` or score an
expired station/photo. Plus three defense-in-depth items (CSPRNG device code,
display-char strip, webhook fetch timeout) and two safe pure-logic tightenings.

---

## What / How (design + test strategy)

### MED (priority — grading gates)

**1. `verifyStationCode` — enforce `smart.attemptLimit`** (`functions/src/index.ts`).
Mirror `submitTaskAnswer` (`runs/index.ts:3264-3275`): read the per team/task wrong
count from `team.taskAttempts[taskId]` and throw `resource-exhausted` once
`attemptLimitReached(attempts, limit)` — BEFORE the code compare, so even a correct
code is blocked once locked. The wrong-code count is the same one already
incremented at `index.ts:836-841` (per team/task). Test: e2e — 2 wrong codes exhaust
`attemptLimit:2`, the 3rd (correct) code is refused `resource-exhausted`.

**2. `verifyStationCode` — release/expiry gate** (`functions/src/index.ts`).
Mirror `completeTask` (`runs/index.ts:2864-2878`): when the station task carries a
`releaseAt`/`releaseAfterMinutes`/`expiresAfterMinutes` gate, load the run's
`launchedAt` once and refuse a not-yet-released (`!isReleased`) or expired
(`isExpired`) station. Placed right after `assertStageActiveForTask`. Test: e2e — a
station expiring while held rejects the correct code with `/expired/`.

**3. `submitStationPhoto` — release/expiry gate** (`functions/src/index.ts`).
Same gate as #2, added right after the existing `assertStageActiveForTask`, without
disturbing the stage-active / idempotency / station-slot guards. The schedule/expiry
fields ride the SAME game snapshot already read for `autoApprove`/title/feed (no
extra read on the common path). Test: e2e — an expired photo task rejects a submit
with `/expired/`.

### P2 (hardening)

**4. `mirrorToChat` fetch timeout** (`functions/src/index.ts:141`). Add
`signal: AbortSignal.timeout(3000)` (Node-20 global). The owner console `await`s
the mirror, so a slow allow-listed endpoint would hang the callable up to the
function timeout. Already wrapped in try/catch → a timeout fails open and never
breaks the participant broadcast (doc write precedes the fetch). No new test lane —
covered by the existing chat-webhook scenario staying green.

**5. `generateDeviceJoinCode` CSPRNG** (`functions/src/runs/teamDevices.ts:48`).
Replace `Math.random` with `crypto.randomInt(0, ALPHABET.length)` per char (matching
`generatePin`, `index.ts:15`). Same alphabet + length. The injected-float `rng`
parameter is retained (now optional) so the deterministic unit tests keep working;
production (no arg) uses the CSPRNG. Test: existing `teamDevices.test.ts` stays green
+ a new assertion that the crypto path emits valid-length, in-alphabet codes.

**6. `requireString` display-char strip** (`packages/shared/src/validation.ts:114`).
New pure `stripUnsafeDisplayChars` strips C0/C1 controls (`U+0000–U+001F`,
`U+007F–U+009F`), bidi override/isolate formatters (`U+202A–U+202E`, `U+2066–U+2069`)
and zero-width (`U+200B–U+200D`, `U+FEFF`). Deliberately KEEPS Hebrew (`U+0590–U+05FF`)
and the plain directional marks LRM/RLM (`U+200E`/`U+200F`) that legitimate RTL
content relies on. Applied in `requireString` before trim/empty check. Test:
`scripts/test-payload-validation.ts` — strips a U+202E override, keeps Hebrew intact,
an all-invisible string is rejected non-empty.

### LOW (safe one-liners — DONE)

- **geo `evaluateTrigger` radius>0 guard** (`packages/shared/src/geo.ts:84`). Add
  `&& radiusM > 0` so a `geofenceRadiusMeters:0` task is not permanently unwinnable
  (matches `evaluatePresence:124`). Test: `scripts/test-trigger-modes.ts`.
- **numeric strict parse** (`packages/shared/src/challenge.ts:40`). Replace
  `parseFloat(raw)` with a trimmed `Number()` + empty-string guard so `"42abc"`
  rejects while decimals/negatives/whitespace-padded answers still grade. Test:
  `scripts/test-challenge.ts`.

### LOW — DEFERRED

- **`checkChallengeAnswer` rate limit**. `enforceRateLimit` is keyed on the caller
  `uid`; the public teaser callable is unauthenticated (no uid). A real fix needs an
  IP/appId key derived from `context.rawRequest` (finding #6's own suggestion) — not
  a trivial one-liner. Deferred, noted here.

### DEFERRED — product decision (NOT implemented)

- Staff `permissions[]` (auth-join-devices H2) is minted into the token but never
  enforced; `assertStaffOrOwner` grants full run-scoped power. Per-permission gating
  is a FEATURE (needs UI + role semantics) contained within the owner's own trust
  domain, not a hardening fix. Behavior left as-is; recorded for the user.

---

## Tasks (RED → GREEN)

1. RED: add failing pure-logic assertions (validation strip, geo radius>0, numeric
   strict) to `test-payload-validation.ts` / `test-trigger-modes.ts` / `test-challenge.ts`.
2. GREEN: implement the three pure-logic fixes (#6, geo, numeric).
3. RED: add e2e assertions (attempt-limit lockout + expiry rejection on
   `verifyStationCode`/`submitStationPhoto`) to `scripts/e2e-verify.mjs`.
4. GREEN: implement the MED gates (#1/#2/#3) + P2 (#4/#5) in the callables.
5. Gates: `shared:build` → `build --workspace=functions` → emulator e2e (read the
   full log: ✅ ALL PASS, 0 FAIL, new station-gate checks pass) → verify lane.

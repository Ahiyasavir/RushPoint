# Design — Authorization & anti-cheat hardening

## Current behavior (authoritative refs — from the audit)

- `functions/src/index.ts`:
  - `verifyStationCode` (≈L362) — `const uid = context.auth.uid` but the team is keyed by the
    **payload** `teamId`; `completeTaskForTeam(..., teamId, ...)` is called with that payload value.
  - `submitStationPhoto` (≈L414) — **no** uid/teamId check; writes `teams/{payload.teamId}` and, when
    `autoApprove`, calls `completeTaskForTeam` for that arbitrary team. `photoUrl` is an unvalidated
    client string.
  - `staffSignIn` (≈L128) — `where('pin','==',pin).where('used','==',false)`, no attempt cap. `pin` and
    access codes via `Math.random()` (`generateCode`, `runs/index.ts` L65).
- `functions/src/runs/index.ts`:
  - `launchRun` (L105) — billing `runTransaction` (L125) consumes a credit, then a **separate**
    `db.batch()` (L189) writes run + accessCode. Not atomic end-to-end.
  - `submitTaskAnswer` (L976) — checks `answerMatches` but never reads/enforces `task.smart.attemptLimit`.
- `firestore.rules` (L112) — `match /accessCodes/{code} { allow read: if isAuthenticated(); }`
  (`read` = `get` + `list`).
- `packages/shared/src/validation.ts` — complete bilingual validators (`requireString`,
  `optionalCoordinatePair`, size caps), **imported by no v2 callable**; header names dead v1 callables.
- `functions/src/payments/index.ts` — `claimReferral` (L227) grants both sides a free run, guarded only
  by the newcomer's `referredBy` flag (a referrer can be named by unlimited newcomers). `launchRun`
  treats `plan === 'pro'` as active without checking `proExpiresAt`.

## Files to touch

| File | Change |
|---|---|
| `functions/src/index.ts` | `submitStationPhoto`/`verifyStationCode`: ignore payload `teamId`, use `context.auth.uid`; if a payload `teamId` is present and `!== uid` → `permission-denied`. Validate `photoUrl` via `requireStorageUrl`. `staffSignIn`: attempt-cap + lockout (see below); `crypto.randomInt` PIN. |
| `functions/src/runs/index.ts` | `generateCode` → `crypto.randomInt`. `launchRun`: move run + accessCode `set` **inside** the billing transaction. `submitTaskAnswer`: read `attemptLimit`, persist `taskAttempts[taskId]`, refuse past the cap. |
| `functions/src/payments/index.ts` | `claimReferral`: per-referrer velocity guard (cap bonus-granting referrals per window). `launchRun` Pro branch: require `proExpiresAt == null || proExpiresAt > now`. |
| `firestore.rules` | `accessCodes`: `allow get: if isAuthenticated(); allow list: if false;`. |
| `packages/shared/src/validation.ts` | Add `requireStorageUrl(url, runId, uid)`; correct the header (drop v1 callable names). Re-export from `@rushpoint/shared`. |
| `scripts/test-rules.mjs` | Assert `accessCodes` `get` allowed / `list` denied. |
| `scripts/e2e-verify.mjs` | New assertions: IDOR rejection, photoUrl rejection, PIN lockout, attemptLimit lockout, launch atomicity, Pro-expiry, size caps. |
| `scripts/test-staff-throttle.ts`, `scripts/test-attempt-limit.ts`, `scripts/test-storage-url.ts` | **new** pure helpers (lockout predicate, attempt predicate, storage-URL matcher). |

## Lockout / throttle model (pure, unit-testable)

A pure predicate keeps the emulator out of the logic test:

```
shouldLockout(failedAttempts, limit)          → failedAttempts >= limit
isWithinCooldown(lastFailedAtIso, now, ms)    → now - lastFailedAt < ms
```

Persist per-(run, callerUid) staff attempts in a small doc
(`…/runs/{runId}/staffAttempts/{callerUid}` = `{ count, lastFailedAt }`), reset on success. Answer
attempts persist as `taskAttempts[taskId]` on the team doc, incremented in the same transaction that
would score — so the count can't be raced. Defaults: staff PIN = 5 attempts / 10-min cooldown;
answer `attemptLimit` honors the task value (fallback: no limit, preserving current behavior).

## Test strategy (TDD — proves each row)

- **Rules (row 39)** → `npm run test:rules` (emulator-bound, `@firebase/rules-unit-testing`):
  `get(accessCodes/CODE)` succeeds; `getDocs(collection('accessCodes'))` fails.
- **IDOR (row 38)** → `e2e`: as Team A, call `submitStationPhoto`/`verifyStationCode` with Team B's
  `teamId` → `permission-denied`; Team B unchanged. RED first (currently succeeds).
- **Validation/photoUrl (row 41)** → pure `test-storage-url.ts` + `e2e`: `javascript:` / foreign-path
  URLs rejected; oversized `displayName`/`memberNames` rejected with typed error.
- **PIN lockout (row 40)** → pure `test-staff-throttle.ts` + `e2e`: N wrong PINs lock out even a
  subsequently-correct PIN. Assert PIN built from an injectable RNG seam (not `Math.random`).
- **attemptLimit (row 42)** → pure `test-attempt-limit.ts` + `e2e`: wrong answers past the cap →
  `resource-exhausted`; a correct answer while locked is refused.
- **launch atomicity (row 43)** → `e2e` with a forced post-billing failure: `eventCredits` unchanged.
- **referral/Pro (row 44)** → `e2e`: capped referral farming; expired-Pro wallet falls through to
  free/credit/refuse at launch.

## Conventions / footguns respected

- Server-write-only state and `FIRESTORE_PATHS` are unchanged; this only tightens auth + validation.
- No dotted-array updates; `taskAttempts` is a map keyed by taskId (safe), not an array element.
- Answer keys remain server-secret (sanitizer untouched). No new env var; `crypto` is Node built-in.
- `accessCodes` `get`-by-id (used by `getJoinInfo`/`getPublicLeaderboard` server-side) keeps working.

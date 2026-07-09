# Proposal — Authorization & anti-cheat hardening

## Why

A 2026-06-25 production audit (reading the live callables, `firestore.rules`, and the payments path)
found server-side **authorization correctness** gaps that let one participant act on another team's
state, let any client enumerate every run, and leave answer/credit/referral flows brute-forceable.
These are the highest-leverage launch blockers after the shipped rules suite (§26.0). None are new
features — they close holes in existing behavior, proven by extending `test-rules` + `e2e-verify`.

## What Changes

> Observable behavior. None are new features — they close holes in existing behavior.

**P0 — launch blockers**
- A participant can **no longer** submit a photo or verify a station code **for another team**.
  `submitStationPhoto` / `verifyStationCode` act only on the caller's own team (`context.auth.uid`);
  a mismatched payload `teamId` is rejected with `permission-denied`.
- A client can **no longer list** the `accessCodes` collection (enumeration of every run's
  `{ownerUid, gameId, runId}` is denied); a `get` by known code still works for joining.
- Staff-PIN sign-in **locks out** after a small number of failed attempts per (run, caller); PINs and
  access codes are generated with a cryptographic RNG.
- Every callable enforces **payload size caps + typed bilingual errors** via the shared validator;
  `photoUrl` must point at the caller's own run/team Storage path.

**P1**
- Quiz/numeric answers are refused once a task's `attemptLimit` is reached (server-enforced).
- `launchRun` consumes a credit and writes the run + access code in **one transaction** — a failure
  no longer burns a paid credit.

**P2**
- `claimReferral` is rate-limited per referrer (anti-farming); `launchRun` treats Pro as active only
  when `proExpiresAt > now`.

## Capabilities

### New Capabilities
- `authorization`: station callables act on the caller's own team only (IDOR fix, row 38); access
  codes cannot be enumerated (`get` allowed, `list` denied, row 39).
- `staff-authentication`: staff-PIN sign-in is rate-limited with lockout, and PINs/codes use a
  cryptographic RNG (row 40).
- `input-validation`: all callables enforce shared payload validation + size caps, and `photoUrl` is
  constrained to the caller's own Storage path (row 41).
- `answer-submission`: server enforces per-task answer `attemptLimit` (row 42).
- `run-billing`: `launchRun` is atomic end-to-end, referral grants are rate-limited per referrer, and
  Pro entitlement requires an unexpired subscription at launch (rows 43–44).

### Modified Capabilities
<!-- None — there are no archived baseline specs in openspec/specs/ yet; these guarantees are
     introduced as new requirements and become the baseline at archive time. -->

## Surfaces touched

- **Callables:** `functions/src/index.ts` (`submitStationPhoto`, `verifyStationCode`, `staffSignIn`,
  `inviteStaff`), `functions/src/runs/index.ts` (`launchRun`, `submitTaskAnswer`),
  `functions/src/payments/index.ts` (`claimReferral`, the Pro check in `launchRun`).
- **Rules:** `firestore.rules` (`accessCodes` get/list split).
- **Shared:** `packages/shared/src/validation.ts` (wire in; add `requireStorageUrl`; fix stale header).
- **Tests:** `scripts/test-rules.mjs`, `scripts/e2e-verify.mjs`, new `scripts/test-*.ts` pure helpers.
- **No UI changes.** (`attemptLimit`/error messages already render client-side.)

## Non-goals

- **No App Check** (that's Appendix B #27 — this change is App-Check-ready but doesn't add it).
- **No RTDB / velocity validation** (#2/#3) — GPS anti-spoof is a separate change.
- **No Storage read-scope tightening for minors' photos** — tracked with the minors gate (#31/§26.4);
  noted here, implemented there.
- **No new callables** beyond hardening existing ones.

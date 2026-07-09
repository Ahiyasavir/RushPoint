# Tasks — Authorization & anti-cheat hardening (RED → GREEN → REFACTOR)

> Strict TDD, P0 first. Each task ≈ one red-green cycle. Do them in order.

## P0 — launch blockers

### Row 38 — IDOR fix (station callables)
- [x] **1. RED (e2e):** in `scripts/e2e-verify.mjs`, join two teams (uid_A, uid_B); as uid_A call
  `submitStationPhoto({ teamId: uid_B, … })` and `verifyStationCode({ teamId: uid_B, … })`. Assert
  they currently **succeed / advance uid_B** (documents the hole) — then flip the assertion to expect
  `permission-denied` + uid_B unchanged. Run; confirm it fails RED.
- [x] **2. GREEN:** in `functions/src/index.ts`, both callables derive `const uid = requireAuth(ctx)`;
  if `data.teamId && data.teamId !== uid` → `permission-denied`; use `uid` as the team key everywhere.
  Re-run e2e → green.

### Row 39 — access-code enumeration
- [x] **3. RED (rules):** in `scripts/test-rules.mjs`, assert `getDocs(collection('accessCodes'))`
  **fails** and `getDoc(doc('accessCodes', CODE))` **succeeds**. Run `npm run test:rules` → list
  assertion fails RED (list currently allowed).
- [x] **4. GREEN:** `firestore.rules` → `allow get: if isAuthenticated(); allow list: if false;` on
  `/accessCodes/{code}`. Re-run; confirm `getJoinInfo`/`getPublicLeaderboard` e2e still pass.

### Row 41 — validation wiring + photoUrl (P0 part)
- [x] **5. RED (pure):** new `scripts/test-storage-url.ts` — `requireStorageUrl(url, runId, uid)`
  accepts only the caller's own `runs/{runId}/teams/{uid}/…` path (gs:// or Firebase https download);
  rejects `javascript:`, foreign paths, oversized strings. Run via tsx → fails (function absent).
- [x] **6. GREEN:** add `requireStorageUrl` to `packages/shared/src/validation.ts`, export it; call it
  in `submitStationPhoto`. Wire `requireString`/size caps into `joinRun` (displayName, memberNames,
  registrationData) + the ops callables (`message` etc.). Fix the module header (drop v1 names).
  Extend `e2e-verify.mjs`: `javascript:` URL + oversized displayName → `invalid-argument`. Green.

### Row 40 — staff-PIN hardening (P0/P1)
- [x] **7. RED (pure):** `scripts/test-staff-throttle.ts` — `shouldLockout(attempts, limit)` +
  `isWithinCooldown(...)` boundary cases. Run → fails (helpers absent).
- [x] **8. GREEN:** implement the predicates (shared or functions util); in `staffSignIn` persist
  `…/runs/{runId}/staffAttempts/{callerUid}`, lock out after 5 fails / 10-min cooldown (reset on
  success). Replace `Math.random()` PINs (and `generateCode`) with `crypto.randomInt` behind an
  injectable RNG seam. Extend `e2e-verify.mjs`: N wrong PINs → lockout even with the correct PIN. Green.

## P1

### Row 42 — answer attemptLimit
- [x] **9. RED (pure + e2e):** `scripts/test-attempt-limit.ts` boundary predicate; e2e: a quiz with
  `attemptLimit: 3`, wrong ×4 → 4th is `resource-exhausted`, and a correct answer while locked is
  refused. Run → fails RED (limit unenforced).
- [x] **10. GREEN:** in `submitTaskAnswer`, read the task's `attemptLimit`; persist `taskAttempts[taskId]`
  on the team doc (map key, not array) inside the scoring path; refuse past the cap. Green.

### Row 43 — launchRun atomicity
- [ ] **11. RED (e2e):** stub/force the post-billing write to throw; assert `wallet.eventCredits`
  is decremented with no run created (documents the leak), then flip to expect **unchanged** credits.
- [x] **12. GREEN:** move the run + accessCode `set` into the billing `runTransaction`; `playCount`
  stays best-effort outside. Re-run; credit rolls back on failure. Green.

## P2

### Row 44 — referral anti-abuse + Pro-expiry
- [ ] **13. RED (e2e):** (a) call `claimReferral` from K+1 fresh uids all naming one referrer → expect a
  per-referrer cap/velocity rejection past K. (b) `launchRun` with `{plan:'pro', proExpiresAt:<past>}`
  → expect it does **not** launch as Pro. Run → fails RED.
- [x] **14. GREEN:** add a per-referrer window/cap in `claimReferral`; require `proExpiresAt > now` in
  the `launchRun` Pro branch. Green.

## Gate — all green before done
- [x] **15. Full gate set:** `npm run typecheck` · `npm run lint` · `npm test` (incl. new pure tests) ·
  `npm run creator:build` · `npm run e2e` · `npm run test:rules`. All green. Update TECH_SPEC §26.9 /
  Appendix B rows 38–44 status as each lands.

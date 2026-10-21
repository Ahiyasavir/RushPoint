## 1. RED

- [x] 1.1 Add `planDeviceReplacement` cases to `functions/src/runs/teamDevices.test.ts`:
  - swap in place at the limit
  - the controller moves with it
  - the founder uid is replaced
  - an unknown, absent or self `replacesUid` ⇒ `attach`
  - a caller already attached ⇒ `duplicate`
  - a finished team ⇒ `refused`
  - a legacy doc with no `devices`/`deviceUids`

  Run and confirm it fails (no such export).
- [x] 1.2 Add a `rejoin-replaces-lost-phone` scenario to `scripts/e2e-verify.mjs`: full team, founder replacement, device count, foreign `replacesUid`. Run and confirm it fails on the full-team refusal.

## 2. GREEN

- [x] 2.1 Implement `planDeviceReplacement` until 1.1 passes.
- [x] 2.2 In `joinTeamAsDevice`:
  - accept and validate `replacesUid`
  - apply the plan inside the existing transaction
  - delete the replaced `runDeviceMember`
  - skip the counter on a replacement

  Run 1.2.
- [x] 2.3 In play-web, add `replacesUid` to the `joinTeamAsDevice` wrapper type, and make `rejoinTeam` send `replacesUid: saved.deviceUid` when it differs from the new identity.

## 3. Browser proof

- [x] 3.1 Add three scenarios to `scripts/browser-auth-loss.mjs`: a full-team rejoin, three losses in a row, and a founder rejoin whose controller moves. Run `npm run verify:auth-loss` (WebKit + Chromium).

## 4. Gates

- [x] 4.1 `npm run verify` and `npm run e2e`, all green. (18.10: e2e ALL PASS, 140/140 callables covered; verify green except `origin:check`, which correctly refuses this worktree's missing `.env` files. Deploy from the main checkout.)

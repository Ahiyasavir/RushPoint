## 1. RED: encode the race-day failure as failing tests

- [x] 1.1 Write `scripts/test-auth-recovery.ts` for a new pure module `apps/play-web/src/lib/authRecovery.ts` (`authLossVerdict`, `recoveryPhase`): an unrequested null with a retained user ⇒ `reinstate`; a requested sign-out ⇒ `ignore`; a non-null event ⇒ `ignore`; no retained user before joining ⇒ `freshSignIn`; no retained user after joining ⇒ `signedOut`; totality on malformed input. Run it and confirm it fails because the module does not exist.
- [x] 1.2 Extend `scripts/test-join-code.ts`: `unauthenticated` ⇒ `'signIn'`, and never `'connection'` (flip the assertion that encoded the bug). Run it and confirm it fails on the current mapping.
- [x] 1.3 Extend `scripts/test-sync-error.ts`: `unauthenticated` with state and recovery already failed ⇒ `'signedOut'`; still `'reconnect'` while recovery is pending. Run it and confirm it fails.
- [x] 1.4 Write `scripts/browser-auth-loss.mjs` (Playwright WebKit + Chromium, an iPhone profile, emulator + play-web dev server, setup pattern from `scripts/simulate-browser-run.mjs`). Scenario "join": create a team; open the QR link `?code=…&join=…` in a fresh context; after the code check, wipe the stored Firebase user from IndexedDB and `localStorage`; tap join; assert the phone joined and the server saw the same uid as the code check. Add the npm script `verify:auth-loss` (under `scripts/emulator-exec.mjs`). Run it and confirm it fails for the right reason (the join is refused unauthenticated, and the screen shows the connection message).

## 2. GREEN: recovery in the app

- [x] 2.1 Implement `lib/authRecovery.ts` to the minimum that makes 1.1 pass.
- [x] 2.2 `services/firebase.ts`: keep a `retainedUser` and a per-tab `signOutRequested`; on an unrequested null, call `auth.updateCurrentUser(retainedUser)`; set `signOutRequested` in `switchToPlayer`.
- [x] 2.3 `ensureAuth()`: after the first sign-in, re-check `auth.currentUser` on every call; wait (bounded, 1.5 s) for reinstatement; then fresh sign-in before joining, or a signed-out state after joining.
- [x] 2.4 `callable()`: on `functions/unauthenticated`, run `ensureAuth()` and retry once. Keep `unauthenticated` out of `RETRYABLE_CALLABLE_CODES`.
- [x] 2.5 Run 1.4 and confirm the join scenario now passes in WebKit and Chromium.

## 3. GREEN: truthful messages and rejoin

- [x] 3.1 `lib/joinCode.ts`: the `'signIn'` key; `JoinScreen`: the sign-in message with a reload action; `attach()`: `'full'` ⇒ the team-full copy (D05). Makes 1.2 pass.
- [x] 3.2 `lib/syncError.ts`: the `'signedOut'` verdict after failed recovery; `PlayScreen`: the honest card with a one-tap rejoin. Makes 1.3 pass.
- [x] 3.3 Store the team's `deviceJoinCode` in the saved session when team state first loads; the rejoin calls `joinTeamAsDevice` with it and maps "full" to the team-full copy.
- [x] 3.4 Copy for all of the above in `apps/play-web/src/i18n.ts`, Hebrew (plural voice) and English.
- [x] 3.5 Extend 1.4 with the "mid-game" scenario (wipe on the play screen ⇒ the next poll succeeds with the same uid) and a "reload after wipe" scenario (the rejoin offer appears and works). Run both and confirm they pass.

## 4. GREEN: storage order and migration

- [x] 4.1 Extend 1.4 with a "migration" scenario: a context whose user is stored only in IndexedDB loads the app ⇒ the same uid. Run it on the current build: it should pass, as a baseline.
- [x] 4.2 `services/firebase.ts`: `initializeAuth(app, { persistence: [browserLocalPersistence, indexedDBLocalPersistence] })` behind the existing `globalThis` memo.
- [x] 4.3 Re-run 4.1 (migration keeps the uid) and the whole of 1.4. Confirm all pass.

## 5. Visibility: `reportClientEvent`

- [x] 5.1 RED: add failing assertions to `scripts/e2e-verify.mjs`: a valid `authLost` report is accepted; an unauthenticated caller is refused; an unknown `kind` or an oversized field is refused; no Firestore document is written.
- [x] 5.2 GREEN: `functions/src/obs/clientEvents.ts` (validation, per-uid rate limit, one structured log line); re-export from `functions/src/index.ts`; add it to the declared lists in `scripts/lib/callableHardening.mjs`.
- [x] 5.3 Send the report after recovery, fire-and-forget. **Deviation:** sent with `httpsCallable` directly from `services/firebase.ts` (queue + flush there), not via a wrapper in `services/calls.ts`, because `calls.ts` imports `firebase.ts` and the reverse import would be circular. Reporting can never fail a player action.
- [x] 5.4 Extend 1.4: after the join scenario, the server log contains one `authLost` entry with outcome `reinstated`.

## 6. REFACTOR and verify

- [x] 6.1 Refactor: one recovery path, shared by `ensureAuth`, `callable` and the play screen; remove any duplicated checks; no behaviour change (all tests stay green).
- [x] 6.2 Preview at 375 px: the join sign-in message, the attach team-full message, and the play signed-out card with rejoin, in Hebrew and English.
  Done in Hebrew at iPhone 15 and Pixel 7 width (`SHOTS_DIR`, browser-auth-loss.mjs): the team-full message and the signed-out card. Not previewed: English, and the join `signIn` message, which only appears when recovery itself fails and so cannot be reached by the wipe scenarios (its copy is pinned by test-join-code.ts).
- [x] 6.3 Gates: `npm run verify` (typecheck · lint · test · both builds · bundle:budget · base:check · origin:check · i18n:check:strict), `npm run e2e`, and `npm run verify:auth-loss`. All green, captured to files and not piped through `tail`.
- [ ] 6.4 Real device, after Ahiya approves a deploy: the IPHONE-TESTS rounds on at least two iPhones with the server log watched: 0 `auth=MISSING` refusals, and any loss shows up as a `reportClientEvent` line.
- [ ] 6.5 Note for the commit: `functions/src/index.ts` and `functions/src/runs/index.ts` also carry uncommitted `prepared-run` work; stage only this change's hunks.

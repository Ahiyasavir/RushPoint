## Context

**What the evidence says** (`investigations/2026-10-14-race-to-zion/REPORT.md` §3.1, `ROOT-CAUSES.md` chain 1):

1. play-web calls `getAuth(app)`, which persists the user in IndexedDB (`firebaseLocalStorageDb`).
   `@firebase/auth` 1.7.9 `IndexedDBLocalPersistence._poll()` runs `getAll()` every 800 ms, and if the
   cached user is missing from ONE result it notifies "deleted", and `AuthImpl._onStorageEvent` sets the
   current user to null. No network, no error.
2. `ensureAuth()` (`apps/play-web/src/services/firebase.ts`) caches the promise of the first sign-in and
   never looks again, so every later `callable()` proceeds.
3. The Functions SDK omits the `Authorization` header when there is no user ("leave it off"), and the
   server answers `unauthenticated` ("Sign in required") in 0 ms.
4. `joinErrorKey` (`lib/joinCode.ts`) maps `unauthenticated` to `'connection'`: "check your reception".
   Retrying on the same page can never succeed.
5. Only a reload helps, and it mints a new anonymous uid: a new identity, a new team, or a ghost.
6. Mid-game, `syncErrorVerdict` (`lib/syncError.ts`) treats `unauthenticated` as transient forever
   while there is state on screen (D51).

**Reproduction.** On a real iPhone (iOS 27.0.1), 15.10 10:17: QR scan, the code check succeeded with a
valid token, and 11 s later the join went out with no token. About 20 retaps failed the same way, and a
rescan produced a new uid and succeeded. Over the day: 1 failure in 10 attempts on three iPhones (iOS
26.6.2 and 27.0.1). On desktop WebKit 26.5 with the real SDK it never reproduced (0 in 112). It is
iOS-specific, intermittent and not version-dependent. Server-side, Auth recorded 0 errors and 37 of the
40 lost race-day users were never refreshed again, so the user was lost locally and permanently.

Chain links 2–6 are ours and deterministic. Link 1 is iOS's and intermittent.

## Goals / Non-Goals

**Goals:**
- A storage glitch never costs the player their identity while the page is open.
- No call ever leaves without a token because of a stale "already signed in".
- Every message on this path is true and names the action that works.
- Every loss is visible on the server, with the browser it happened on.

**Non-Goals:** see the proposal. In particular: no phone-slot changes (`team-phones-capacity`), no
attempt to find the iOS trigger, and no server eligibility change.

## Decisions

### D1. Reinstate the same user from memory on an unrequested sign-out (the guarantee)

A module-level `retainedUser` holds the last non-null `User` seen by `onAuthStateChanged`. A flag
`signOutRequested` is set only by our own sign-out paths (`switchToPlayer`, and any future explicit
sign-out). When the listener sees `null` while `retainedUser` is set and `signOutRequested` is false,
the app calls `auth.updateCurrentUser(retainedUser)`. That is the public API: it clones the user into
this Auth instance, makes it current again and **re-persists it**, so storage heals too.

- *Why:* the User object (uid and refresh token) is still alive in the page when the SDK drops it. A
  local sign-out revokes nothing server-side, so the same identity is valid. No network, no new uid, no
  new team.
- *Alternatives considered:*
  - Sign in anonymously again. Rejected as the primary path: it is a new uid, i.e. exactly the
    duplicate-team failure. It is kept only as the pre-join fallback (D3).
  - Keep our own copy of the refresh token in `localStorage` and rebuild the user on reload. Rejected:
    it needs non-public SDK internals (`UserImpl._fromJSON`) and stores a credential twice.
- The decision itself ("reinstate", "ignore", "sign in fresh", "offer rejoin") is a pure function in
  `lib/authRecovery.ts`, so it is unit-tested without a browser.

### D2. `ensureAuth()` re-checks on every call

`ensureAuth()` keeps its single in-flight first sign-in, but once that has resolved it no longer returns
the cached promise blindly: if `auth.currentUser` is null it first awaits the reinstatement from D1 (a
short, bounded wait). Then:
- if the user came back, it continues;
- if not, it falls through to D3.

`callable()` therefore never fires without a user unless recovery has genuinely failed.

### D3. What happens when the same user cannot be restored

The phase decides:
- **Before joining** (no saved session): sign in anonymously afresh and continue. Nothing is lost,
  because the phone is not in a team yet. This turns the race-day failure (code check OK, join refused)
  into a silent success.
- **After joining** (saved session, same page): this only happens if D1 failed, which should not happen
  while the page is alive. The app does not sign in fresh silently, because a new uid is not a member.
  It surfaces the honest state (D6).
- **After a reload with the stored user gone:** the same as today, a fresh uid. The saved session now
  also carries the team's `deviceJoinCode` (stored the first time team state loads), so the play screen
  can offer a one-tap rejoin of the same team through `joinTeamAsDevice`. If the team is full (D40 is
  out of scope), the message says exactly that.

### D4. A call refused with `unauthenticated` is recovered and retried once

In `callable()`, a `functions/unauthenticated` rejection triggers `ensureAuth()` (D2/D3) and **one**
retry. This is separate from `RETRYABLE_CALLABLE_CODES`, which retries without re-checking the sign-in
and must not include `unauthenticated` (retrying the same tokenless request is the race-day loop).

### D5. Persistence order: `localStorage` first, IndexedDB second (mitigation, not guarantee)

Replace `getAuth(app)` with
`initializeAuth(app, { persistence: [browserLocalPersistence, indexedDBLocalPersistence] })`.

- *Migration:* `PersistenceUserManager.create` (auth 1.7.9) looks for the user in **every** listed
  persistence and moves it to the first available one that allows migration, clearing the old copy. A
  player who is signed in at deploy time keeps their uid. This is checked in the SDK source, and
  re-checked by a test (task 4.3).
- *Why it may help:* the race-day failure mode is an async IndexedDB read coming back empty. A
  `localStorage` read is synchronous.
- *Why it is NOT the guarantee:* on mobile `BrowserLocalPersistence` also polls (every 1 s,
  `fallbackToPolling = _isMobileBrowser()`), and a `null` from `getItem` would sign out the same way.
  D1 covers that too.
- `popupRedirectResolver` is not needed: play-web uses only anonymous and custom-token sign-in.
- *Alternative:* keep IndexedDB and rely on D1 only. Rejected: two independent layers are cheap here.

### D6. Truthful messages

- `joinErrorKey`: `unauthenticated` gets its own key `'signIn'`, no longer `'connection'`. Because D3/D4
  run first, the player only sees it when recovery truly failed. The copy says the phone lost its
  sign-in, and the action is **reload**: a button that reloads the page, not "check reception".
- `attach()` in `JoinScreen`: `'full'` gets its own copy (the team already has the most phones; ask the
  organizer) instead of `t.devices.attachFailed` "check the device code" (D05).
- `syncErrorVerdict`: `unauthenticated` with state on screen stays `'reconnect'` only until recovery
  has been attempted and failed. Then it returns a new verdict `'signedOut'`, and the play screen shows
  the honest card with the rejoin action (D3).
- All copy goes through `t.*` in `apps/play-web/src/i18n.ts`, in Hebrew (plural voice) and English.

### D7. Visibility: `reportClientEvent`

A new callable in a new module, `functions/src/obs/clientEvents.ts`:
- Authenticated (it runs after recovery, when a user exists). Rate-limited per uid with the existing
  in-process limiter.
- Validates a small closed payload: `{ kind: 'authLost', outcome: 'reinstated' | 'freshSignIn' |
  'failed', phase: 'join' | 'play', msSinceSignIn, userAgent }`, strings length-capped.
- Writes **one structured log line** and no Firestore document. That keeps quota at zero, needs no rules
  and no index, and fits the `docker logs` investigation workflow.

play-web queues the event in memory and sends it fire-and-forget after recovery. A failure to send is
ignored, because reporting must never break playing.

## Test strategy (RED first)

1. **Pure: `scripts/test-auth-recovery.ts`** (new, in `npm test`) for `lib/authRecovery.ts`:
   - an unrequested `null` with a retained user ⇒ reinstate;
   - a requested sign-out ⇒ ignore;
   - no retained user before joining ⇒ fresh sign-in;
   - no retained user after joining ⇒ signed-out (rejoin offer);
   - totality on malformed input.

   Fails first because the module does not exist.
2. **Pure: `scripts/test-join-code.ts`** (extend): `unauthenticated` ⇒ `'signIn'`, never
   `'connection'`; the existing assertion that encodes the race-day bug is flipped.
3. **Pure: `scripts/test-sync-error.ts`** (extend): `unauthenticated` with state after failed recovery
   ⇒ `'signedOut'`.
4. **Browser: `scripts/browser-auth-loss.mjs`** (new; under `scripts/emulator-exec.mjs`, npm script
   `verify:auth-loss`; Playwright WebKit **and** Chromium, an iPhone device profile, against the emulator
   and the play-web dev server, reusing the setup pattern of `scripts/simulate-browser-run.mjs`). It
   reproduces the race-day mechanism deterministically:
   - **join:** a team exists; a fresh context opens the QR link `?code=…&join=…`; after the code check,
     the test deletes the stored Firebase user from both IndexedDB and `localStorage`; then it taps
     join. **Today:** the "connection" message and a tokenless request. **After:** the phone joins, and
     the server sees the same uid as the code check.
   - **mid-game:** the same wipe on the play screen ⇒ the next poll succeeds with the same uid; no
     endless "reconnecting".
   - **migration:** a context with a user stored only in IndexedDB loads the new build ⇒ the same uid.
5. **Callable: `scripts/e2e-verify.mjs`** (extend): `reportClientEvent` accepts a valid payload, refuses
   an unauthenticated caller and an oversized or unknown payload, and writes nothing to Firestore. The
   callable coverage guard then passes.
6. **Real device:** the IPHONE-TESTS rounds (delete site data, scan, join) on at least two iPhones, with
   the server log watched for `auth=MISSING` (0 expected) and for `reportClientEvent` lines.
7. **UI:** preview of the three messages (join `signIn`, attach full, play signed-out) at 375 px, plus
   `npm run i18n:check:strict` clean.

## Risks / Trade-offs

- **[Risk]** `updateCurrentUser` with a user whose refresh token was revoked server-side (it was not, in
  this failure mode) → the next token refresh fails with `user-token-expired`. *Mitigation:* that error
  routes to D3 (fresh sign-in before joining, rejoin offer after).
- **[Risk]** A listener loop: reinstating fires `onAuthStateChanged` again. *Mitigation:* reinstating
  is idempotent (same uid ⇒ no-op), and the pure verdict ignores a non-null event.
- **[Risk]** Two tabs, one of which really signs out (staff "switch to player") → the other tab could
  reinstate the old user. *Mitigation:* `signOutRequested` is per tab, and a cross-tab sign-out shows
  up as a *different* uid, not null, so it is not treated as a loss. Covered by a two-tab case in the
  browser test.
- **[Trade-off]** `localStorage` is shared synchronously across tabs and smaller than IndexedDB. A
  Firebase user blob is about 2 KB, so it is irrelevant here.
- **[Risk]** `initializeAuth` throws if called twice (Vite HMR). *Mitigation:* the same `globalThis`
  memo pattern `initDb()` already uses.

## Migration Plan

- Players signed in at deploy time are migrated by the SDK (D5) and keep their uid. Verified by browser
  test 4 (migration) before deploy.
- The callable deploys first (VPS), then play-web (Hosting). A play-web without the callable only loses
  the report, because sending is fire-and-forget.
- *Rollback:* revert play-web hosting. A user already moved to `localStorage` is found again by
  `getAuth()` only if `browserLocalPersistence` is in its hierarchy. So a rollback build must keep
  `[browserLocalPersistence, indexedDBLocalPersistence]` (or `getAuth` plus an explicit
  `setPersistence`) and be checked with the migration test. This is noted in tasks.
- No new Firestore index, no rules change, no new env var.

## Open Questions

- The length of the bounded wait in D2 before falling through (proposed: 1.5 s, which covers two
  IndexedDB polls of 800 ms in case the SDK restores the user by itself).
- Whether `reportClientEvent` should also carry the other client failures we were blind to (upload
  rejections, D21; uncaught errors, D22). Proposed: add the `kind` field now; implement other kinds in
  package 8 (visibility).

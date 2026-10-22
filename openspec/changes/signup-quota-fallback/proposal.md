## Why

Firebase Auth allows **100 new accounts an hour from one IP address** (firebase.google.com/docs/auth/limits).
Every phone that opens the player link creates one anonymous account. At an event where the phones share
the venue WiFi they all leave from one address, so at Chanukah (100 teams, 2 to 3 phones each, plus every
reopen after an iPhone loses its sign-in) the 101st phone in the hour is refused with
`auth/too-many-requests` and cannot join at all. Today the phone at least explains it ("switch off WiFi"),
but a child cannot be expected to fix a network setting, and a school WiFi may be the only connection.

## What Changes

- New public callable **`startPlayerSession({ code })`**: for a live, valid join code, the API creates
  the user itself (Admin SDK `createUser`) and returns a custom token (claim `player: true`). The phone
  signs in with it (`signInWithCustomToken`). Staff already sign in this way.
- The phone keeps anonymous sign-in as the FIRST path (proven in the field). Only when it is refused with
  `auth/too-many-requests` and a join code is known (the link's `?code=`, or the code being checked or
  joined) does it fall back to `startPlayerSession`. Everything after sign-in is identical: uid == teamId,
  the same recovery, the same join callables.
- What authentication would carry is carried by: the code must resolve to a run that is not finished,
  revoked or trashed; a budget keyed on the CONNECTION (not the payload); and a budget per run.
- The staff console's "a player is signed in here" check reads the `player` claim as well as
  `isAnonymous`, so issue #16 keeps working for a fallback player.

## Not proven by any local gate

The emulator does not enforce the per-IP quota. Whether `createUser` + custom-token sign-in really escape
it must be proven once in production: more than 100 sessions from ONE address within an hour, then the
test users deleted. That needs Ahiya's approval (it writes to the production project).

## Impact

`functions/src/runs/playerSession.ts` (new), `functions/src/index.ts`, `packages/shared/src/rateLimit.ts`,
`scripts/lib/callableHardening.mjs` (PUBLIC_CALLABLES), `apps/play-web/src/services/firebase.ts`,
`apps/play-web/src/lib/signUpFallback.ts` (new, pure), `StaffConsole.tsx`, `scripts/e2e-verify.mjs`,
`scripts/test-signup-fallback.ts`. No data shape change.

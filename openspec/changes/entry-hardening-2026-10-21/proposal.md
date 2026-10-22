## Why

Getting phones into the game was the worst failure of 14.10 (about a third of 120 phones). The
self-healing entry (15.10) fixed the cause that was found, and the field shows it working: on 20.10 an
iPhone lost its sign-in 2.3 s after creating it and the app put it back (`authLost` · `reinstated`),
then joined and played. A review of every OTHER way a phone can fail to get in (21.10) found four
that remained, each of which would again look like "it does not work" to a child at the event:

1. **The join rate limit reads as "the race is full".** `joinRun` and `joinTeamAsDevice` allow 10
   attempts a minute per phone. The 11th answers `resource-exhausted`, the same code as a real
   capacity refusal, and the phone said "המירוץ מלא, הוא יכול לפתוח עוד מקומות": false, and it sent
   the organizer after a problem that did not exist.
2. **A sign-in that fails before reaching the server shows a generic failure.** Anonymous sign-in
   rejects with a Firebase AUTH code (`auth/network-request-failed`, `auth/too-many-requests`), which
   the mapping did not know, so a dropped connection and Firebase's 100-sign-ups-an-hour-per-IP limit
   both read "ההצטרפות לא עברה".
3. **A code typed on a Hebrew keyboard is silently wrong.** The field dropped every non-Latin letter
   AS IT WAS TYPED, so on a Hebrew keyboard "EH3L25" (ק י 3 ך 2 5) produced "325" and each Hebrew
   key looked dead. The same in the team (phones) code and the staff code fields.
4. **The 18.10 rejoin fix was never deployed** (`rejoin-replaces-lost-phone`): a phone that lost its
   sign-in mid-game could not take its place back in a full team, losses used up slots, and a lost
   sending phone came back as a viewer.

5. **A game screen that never arrives** (found 22.10 by the production stress: a phone joined in 5 s,
   then showed nothing and asked for nothing). The game screen is a lazy chunk; `lazyWithRetry`
   healed one that FAILED, but waited forever on one that never settled.

## What Changes

- The server's rate-limit refusal carries `details: { reason: 'rateLimited', retryAfterMs }`; the
  phone shows "wait half a minute" for it, on the join, the add-a-phone and the rejoin paths.
- `auth/network-request-failed`, `auth/internal-error`, `auth/timeout` read as a connection problem;
  `auth/too-many-requests` gets its own advice (switch off Wi-Fi, use mobile data, or tell the host).
- Every code field (join, team phones, staff) reads a Hebrew-keyboard letter as the key it sits on,
  when the input has no spaces (a pasted sentence keeps the old reading).
- `rejoin-replaces-lost-phone` is carried into this release.
- Every lazy route import has a 30 s deadline (`lib/chunkDeadline.ts`, both apps): a hang becomes the
  existing one-reload heal. The join screen fetches the game screen in advance. Proven with the
  first chunk request held forever: healed in ~36 s; the same test without the fix stayed on
  "טוען" past 75 s.
- `scripts/browser-auth-loss-stress.mjs`: the 14.10 wipe on many fresh phones, at four moments,
  both entry paths, WebKit and Chromium. `scripts/vps-join-funnel.sh`: the live join funnel from the
  production log, for the event itself.

## Impact

`functions/src/rateLimitStore.ts`, `apps/play-web/src/lib/joinCode.ts`, `JoinScreen.tsx`,
`PlayScreen.tsx`, `StaffConsole.tsx`, play-web `i18n.ts`, `scripts/test-join-code.ts`,
`scripts/e2e-verify.mjs`. No new callable, no data change.

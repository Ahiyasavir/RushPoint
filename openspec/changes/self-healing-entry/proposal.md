## Why

At המירוץ לציון (14.10.2026) about a third of the phones could not join: 169 join requests reached the
server with no sign-in token, the app told children to "check your reception", and reopening the link
minted a new identity, which produced duplicate and ghost teams (investigation:
`investigations/2026-10-14-race-to-zion/`, defects D01 D02 D03 D05 D51). The loss was reproduced on a
real iPhone on 15.10: the anonymous Firebase user vanished from the page about 11 seconds after sign-in,
without the player leaving Safari. It is intermittent and comes from inside iOS, so we cannot remove the
trigger with certainty; what turned it into an outage is that the app neither notices nor recovers and
then tells the player something false. The next event is 22.10.

## What Changes

- **The participant app notices when its sign-in disappears and restores it.** When the Firebase user
  goes from present to absent without the app asking for a sign-out, the app reinstates the same user it
  still holds in memory, so the player keeps the same identity and team with no network round trip.
- **Every server call re-checks the sign-in first.** A call never leaves without a token because a
  remembered "already signed in" was stale. Before joining, when no identity can be restored, the app
  signs in afresh and continues (nothing is lost: the player is not in a team yet).
- **A call refused for a missing sign-in is recovered and retried once**, instead of being shown.
- **Messages tell the truth.** A sign-in failure the app could not recover is no longer shown as "check
  your reception"; it says the phone lost its sign-in and offers the one action that works (reload).
  A full team is no longer shown as "check the device code" (D05).
- **Mid-game, a lost sign-in is not "reconnecting" forever** (D51): after recovery fails, the player is
  told what happened and offered a one-tap rejoin of their own team.
- **The sign-in is stored in the browser's simple storage first** (`localStorage`, then IndexedDB as a
  fallback). Existing signed-in players are migrated by the Firebase SDK itself. This is a mitigation of
  the suspected trigger, not a guarantee; the recovery above is the guarantee.
- **The server sees it happen.** The phone reports each detected loss and whether it recovered, with the
  browser it ran on, through a new callable `reportClientEvent` (log only, no Firestore writes).

Surfaces: **play-web** (auth wiring, call wrapper, join and play screens, i18n), **a new callable**
(`reportClientEvent` in `functions/`, typed wrapper in play-web, e2e coverage), **no** shared types beyond
the event payload, **no** rules changes, **no** creator-web changes.

## Capabilities

### New Capabilities
- `participant-identity-recovery`: the participant app keeps one identity per phone across storage
  glitches: it detects an unrequested sign-out, reinstates the same user, re-checks before every call,
  recovers a call refused for a missing sign-in, and reports every loss to the server.

### Modified Capabilities
- `participant-join`: a sign-in failure is no longer reported as a connection problem; it is recovered
  automatically, and if that fails the message names the real cause and the working action. A full team
  is reported as a full team on the add-a-phone path too.
- `participant-offline-continuity`: a lost sign-in mid-game is not treated as a transient connectivity
  drop forever; once recovery has failed the player is told and offered a rejoin.

## Non-goals

- Finding the exact iOS trigger. It is intermittent (1 in 10 at home, about a third at the race) and
  not version-dependent; this change is designed to work without knowing it.
- Phone-slot problems in a team: dead phones holding a slot (D40), the hidden phone cap (D04), the
  device code being reachable only on the founder's phone (D39), Latin device codes read aloud (D52),
  and the English default phone name (D54). These are a separate change (`team-phones-capacity`).
- Server-side changes to who may join; the server stays the only authority on eligibility.
- Recovering an identity after the page itself is reloaded and storage was truly wiped. That case gets
  a fresh identity before joining, and the rejoin offer after joining.
- Staff (custom-token) sign-in, beyond making sure an intentional staff sign-out is never "recovered".

## Impact

- `apps/play-web/src/services/firebase.ts`: auth initialisation (persistence order), `ensureAuth`, the
  `callable` wrapper, a loss detector.
- New pure module `apps/play-web/src/lib/authRecovery.ts` (the decisions), unit-tested by a new
  `scripts/test-auth-recovery.ts`.
- `apps/play-web/src/lib/joinCode.ts`, `apps/play-web/src/lib/syncError.ts`,
  `apps/play-web/src/screens/JoinScreen.tsx`, `apps/play-web/src/screens/PlayScreen.tsx`,
  `apps/play-web/src/i18n.ts` (Hebrew and English copy).
- New callable `reportClientEvent` (`functions/src/obs/clientEvents.ts`, re-exported from
  `functions/src/index.ts`), its typed wrapper, the public/authenticated callable lists in
  `scripts/lib/callableHardening.mjs`, and an e2e scenario.
- A new browser-level regression test that wipes the stored sign-in mid-join and asserts the join
  still succeeds with the same identity.
- `functions/src/index.ts` and `functions/src/runs/index.ts` already carry uncommitted work from
  another change (`prepared-run`); this change touches `functions/src/index.ts` by one re-export line
  only, and any commit must separate the two.

# Held-team visibility

## Why

When an organizer starts a run, the server holds back any team that still needs guardian consent.
That hold is real, it is enforced, and it is invisible to the only person it affects.

Confirmed by reading this working tree:

1. **The hold happens.** `startTeams` (`functions/src/runs/index.ts:614`) partitions the cohort via
   `partitionTeamsByConsent` (`packages/shared/src/guardianConsent.ts:52`) and launches only
   `ready`. A held team's doc is not touched: `launched` stays `false`.
2. **The organizer is told a NUMBER.** `startTeams` returns `heldForConsent: held.length`, and
   `RunConsolePage.tsx:327-330` raises `t.runConsole.heldForConsent({ launched, held })` as a toast.
   The count is all there is: `listRunTeams` (`functions/src/runs/index.ts:2415-2471`) projects no
   consent field, so with 12 teams milling around the console cannot say WHICH team is held. A count
   with no names is not actionable on an event day.
3. **The held team is told NOTHING.** `grep -rni consent apps/play-web/src` returns exactly one hit,
   inside legal prose (`LegalScreen.tsx:15`). The participant app has no awareness of this state.
   `PlayScreen.tsx:373` branches on `!team.launched` and renders the same "waiting for the host to
   start" screen for every unlaunched team. So a held team watches the field leave and sits on a
   screen that says the host has not started yet, which for them is false and never resolves.
4. **The state is not even on the wire.** `getMyTeamState` echoes the team doc (so
   `team.guardianConsent` is present) but its `game` projection
   (`functions/src/runs/index.ts:3990-4006`) omits `requiresGuardianConsent`. A client therefore
   cannot tell "no consent recorded, and none is needed" from "no consent recorded, and that is
   exactly why you are still standing here". The hold is genuinely underivable client-side.

## What Changes

An already-computed server state is made visible to the person it affects. Nothing about how consent
is obtained, granted, or defined changes.

- **`getMyTeamState` gains one read-only field**: `holdReason: 'guardian_consent' | null`, derived
  from `isConsentSatisfied(team, game)` and `team.launched`. A reason string only. No guardian name,
  no email, no phone, no token, no age. `null` whenever the team is not held, which is every team of
  every run that does not require consent, so the payload is byte-identical for existing games.
- **A pure decision function** `heldNotice()` in `apps/play-web/src/lib/holdNotice.ts` maps
  `{ launched, holdReason }` to the notice kind. Total: an unknown or future reason degrades to a
  generic "the host is sorting something out" message, never to a blank screen and never to a
  fabricated cause. Covered by `scripts/test-held-team-notice.ts` in the no-emulator `npm test` lane.
- **The waiting screen tells the held team the truth**: that they are not waiting on the start, that
  it is not something they did wrong, and that the host can clear it. It reuses the SOS/host
  affordance already on that screen; no new mechanism, and no button that clears the hold.
- **`listRunTeams` gains `heldForConsent: boolean` per team**, and the run console renders it as one
  more row badge in the pattern `lib/teamAttention.ts` established, so the organizer can see WHICH
  teams are held instead of how many.

## What this deliberately does NOT do

- No consent flow, no consent UI, no legal copy, no definition of who may grant consent, no minimum
  age handling. Those are the product owner's pending decisions.
- **No self-clear.** The participant app gains no way to grant, request, bypass or dismiss the hold.
  `startTeams` remains the only path out, and the server remains the sole authority.
- No new PII on the wire, in either direction.

## Impact

- Affected specs: `play-held-team-visibility` (new capability).
- Affected code: `functions/src/runs/index.ts` (two read-only projections),
  `apps/play-web/src/lib/holdNotice.ts` (new), `apps/play-web/src/screens/PlayScreen.tsx`,
  `apps/play-web/src/services/calls.ts`, `apps/play-web/src/i18n.ts`,
  `apps/creator-web/src/services/calls.ts`, `apps/creator-web/src/pages/RunConsolePage.tsx`,
  `apps/creator-web/src/i18n.ts`, `scripts/test-held-team-notice.ts` (new).
- No schema change, no migration, no write path touched.

# Design

## Decision (pure, lib/creatorOnboarding.ts)
`tourInviteVerdict({ record, later, accountCreatedMs, nowMs })` → `'card' | 'bell' | 'none'`.
- a tour record (completed or skipped) → none
- account age unknown, in the future, or 14 days or more → none (fail CLOSED: an invitation is an
  interruption, and a returning creator must never get one)
- `later` → bell
- otherwise → card

"New" is the account's creation time (Firebase `user.metadata.creationTime`, set for anonymous
guests too), not the game count: a guest already owns a game seconds after the home question, so
`isEstablishedCreator` would call every guest established.

`later` lives in localStorage under `rp-tour-invite:<uid>`, read through `readTourInviteLater`
(total). The tour record already lives under `tourStorageKey(uid)`.

## Rendering
- `components/TourInvite.tsx`: `useTourInvite(uid)` (verdict + start + later, re-read on the
  `rp-tour-record` event CreatorTour fires after it writes a record, and on `storage`), and the card.
- The card is a guidance surface `'tour-invite'`, ranked after `'tour'` and before `'spotlight'`, and
  also hides while any `[aria-modal="true"]` dialog is open.
- `NotificationBell` takes an optional pinned entry; it counts toward the badge.
- Start calls `restartCreatorTour()` (the help path, which holds while another surface owns the
  screen and says so).

## Tests
`scripts/test-tour-invite.ts`: every verdict branch, the storage reader, and that the surface is
ranked. `test-creator-tour` and `test-post-signup-redirect` drop `shouldAutoStartTour`.
UI verified in the emulator.

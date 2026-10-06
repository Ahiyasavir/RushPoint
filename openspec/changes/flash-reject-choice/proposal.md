## Why

Ahiya, 2026-10-06 (issue 26 in docs/ISSUES-2026-10-05.md): "When I reject the media of a flash
mission it does not let them film again and does not tell them anything. I would like that when the
admin rejects, he can choose whether to offer the mission to everyone or give them another chance."

Today a rejection marks the team's claim `rejected` and, in first-team mode, frees the mission for
the other teams. On the phone a small line "the organizers did not approve it this time" REPLACES
the take button, inside the flash banner, so the team can never retry and there is no notice at all.

## What Changes

- `reviewFlashMission({ action: 'reject', retry })`:
  - `retry: true` ("another try"): the claim is `rejected` with `retryAllowed: true`, and in
    first-team mode the mission STAYS with this team (`takenBy` kept), so nobody takes it meanwhile.
  - `retry` absent or false ("open it up"): today's behaviour. In first-team mode the mission is free
    for the other teams; this team may not take it again.
- `claimFlashMission` lets a team with `retryAllowed` take it again (also while it holds `takenBy`),
  and refuses a team whose sending was rejected without a retry (`FLASH_REJECTED`).
- The phone: a rejection is an EVENT. The first time a phone sees its claim rejected it shows a
  notice ("the organizers did not approve the flash mission") with "try again" when allowed, or that
  it is closed for this team. The banner line says the same and, with a retry, shows the button.
- Console and staff app: "reject" asks "another try for the team" or "open it to everyone" (in a
  many-teams mission: "another try" or "close it for this team").

## Capabilities

### Modified Capabilities
- `flash-missions`: rejecting a flash sending offers a retry.

## Impact

- `packages/shared/src/flashMission.ts` (`FlashClaim.retryAllowed`, `flashClaimVerdict`,
  `flashMyClaimLine`).
- `functions/src/index.ts` (`reviewFlashMission`, `claimFlashMission` through the verdict).
- play-web `LiveOps.tsx`, `StaffConsole.tsx`, `services/calls.ts`, i18n; creator-web
  `RunConsolePage.tsx`, `services/calls.ts`, i18n.
- Tests: `scripts/test-flash-missions.ts`, `scripts/e2e-verify.mjs`.

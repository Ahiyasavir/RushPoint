# Proposal — Streamlined solo-mode registration (one name field, not two)

## Why

In `apps/play-web/src/screens/JoinScreen.tsx` step 2, the registration form renders team-level
fields (which can include a "Team name") **and** a separate name/member block. When a game is
configured for solo play (`info.mode !== 'team'`, i.e. `'individual'`), the participant is asked for
both a "Team name" and a "Player name" — but in solo play the team and the player are the same
entity. This is redundant and confusing. Solo players should provide exactly one name.

## What Changes

> Observable behavior. In solo/individual mode the join form shows a single name field; team mode is
> unchanged.

- In individual mode: hide team-level *name* fields and the "Team members" / "Add member" UI, and
  show one name input labeled "Your name" / "השם שלך". That single name becomes the participant's
  display name.
- In team mode: behavior is unchanged (team name field + member list + add-member).
- The field-resolution and display-name logic is extracted into a **pure helper** in
  `@rushpoint/shared` so it is unit-tested without rendering.

## Capabilities

### New Capabilities
- `solo-registration`: mode-aware resolution of registration fields and display name so solo players
  enter a single name.

## Surfaces touched

- **shared:** new pure helpers `resolveRegistrationFields(mode, fields)` and
  `resolveDisplayName(mode, values, memberNames)` in `packages/shared/src/registration.ts`,
  re-exported from `packages/shared/src/index.ts`.
- **play-web:** `src/screens/JoinScreen.tsx` consumes the helpers.
- **Tests:** `scripts/test-registration-fields.ts` (pure).
- **No callable change** — `joinRun` already accepts `displayName` + `memberNames`; the server
  contract is unchanged.

## Non-goals

- No change to the `joinRun` callable signature or server-side validation.
- No change to the creator-side configuration of registration fields.
- No change to team-mode behavior.

## Why

Field report 2026-09-25: *"… and I also want an option that I choose to set up a quick dial for
myself"*. Clarified with Ahiya on 2026-09-25: he means **both**:

1. **Tap-to-call**: one tap to phone a team, the organizer or a staff member.
2. **A quick-actions bar**: the organizer chooses which actions sit one tap away in the console.

Researched 2026-09-25:
- A team's phone number may already exist: registration fields support `type: 'phone'`
  (`packages/shared/src/types/index.ts:204`, `RegistrationField`), stored in
  `RunTeam.registrationData` keyed by field id, readable by the owner and run staff through the team
  document. Nothing renders it as a call link.
- There is no organizer/HQ phone number anywhere, so players and staff cannot call the organizer
  from the app. The SOS button raises an alert; it does not connect a voice call.
- Console actions are reached by opening the right section and panel. The run header has no
  customisable shortcut area. `users/{uid}` is owner-writable (`firestore.rules:30-32`), so a
  preference can be stored without a callable.

## What Changes

**Calling**
- The organizer sets the run's contact numbers ("organizer", "HQ", a named staff member), each
  marked for whom it is visible (players / staff).
- Players see "call the organizer" in the SOS sheet and in the mission's help menu, when a number is
  visible to players.
- Staff see the run's contact numbers in the staff app.
- The team page and the staff app show "call" and "WhatsApp" for a team whose registration included a
  phone field; the team page explains how to collect one when the game does not ask for it.

**Quick actions**
- A quick-actions bar at the top of the console, with up to six actions the organizer chooses from a
  catalogue (message all teams, start all teams, refresh standings, open the photo queue, add points
  to a team, open a team by search, call HQ, pause a mission…). Actions that need a team open a team
  picker first.
- The choice is saved on the organizer's profile and follows them to any device. A sensible default
  set is shown until they customise it.
- The staff app gets the same bar, limited to actions its capabilities allow, saved on that device.

## Non-goals

- In-app voice calling or SMS sending (the phone's own dialer/WhatsApp does it).
- Collecting phone numbers the game did not ask for.
- Macros (multi-step actions).

## Surfaces

- shared: `Run.contacts` type; the quick-action catalogue (ids, needs-team flag, required capability).
- functions: **new callable** `setRunContacts` (owner-only, audited); `getMyTeamState` returns the
  player-visible contacts; `staffSignIn`/grant path returns staff-visible contacts.
- creator-web: contacts editor in the console, quick-actions bar + customiser, team page call buttons.
- play-web: SOS sheet + help menu call link; staff app contacts, team call buttons, quick-actions bar.

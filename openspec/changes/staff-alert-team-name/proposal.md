## Why

On the Staff console, an SOS / alert card identifies the team in trouble by the first 8
characters of its anonymous uid — "Team a1b2c3d4"
(`apps/play-web/src/screens/StaffConsole.tsx:361`, `{t.staff.teamLabel} {a.teamId.slice(0, 8)}`).
The same path fires from the participant "stuck" geofence help flow, not just an explicit SOS, so
this is the surface a marshal reads in an actual emergency — and it is the one place that still
shows a raw uid. The component already has every team's display name loaded (`teams` state) and
already resolves ids→names for the chat section (`nameFor()` at `:541`). The emergency card just
does not use it.

## What Changes

- On the SOS / alert card, resolve `a.teamId` to the team's display name using the `teams` array
  already in state, falling back to the uid slice when no name is found — the exact behaviour of
  the existing `nameFor()` helper.
- Reuse (or lift) that one resolver so the alert card and the chat section can never disagree about
  how a team is named.

## What does NOT change

- No backend, no callable, no `firestore.rules`, no new fetch — the names are already in `teams`.
- The alert itself, its coordinates link, the ack button, and the new-alert audio cue are
  untouched.
- The uid-slice fallback stays for a team whose name has not loaded yet.
- No new i18n key — the card keeps `t.staff.teamLabel` and shows existing team display names.

## Impact

- Affected UI: `apps/play-web/src/screens/StaffConsole.tsx` (SOS/alerts section only).
- Affected specs: `staff-console` (ADDED requirement — human-readable team identity on alerts).
- Risk: low. Pure label resolution over data already in hand.

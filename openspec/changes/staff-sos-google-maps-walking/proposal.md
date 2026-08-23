## Why

The Staff console renders an "open location" link on each SOS / alert card
(`apps/play-web/src/screens/StaffConsole.tsx`, the alerts list) so staff can jump to a team's
reported position on the map. It opens Google Maps as a **bare pin**
(`https://www.google.com/maps?q=${a.lat},${a.lng}`) — a dropped pin, not directions. RushPoint is a
**walking** field game: when a staff member needs to reach a team that pressed SOS, they are on foot,
so the link should open **walking directions**, not a stationary pin.

## What Changes

- Change the staff SOS location link to open **Google Maps in walking mode** — a directions URL
  carrying a walking travel mode (`https://www.google.com/maps/dir/?api=1&destination=<lat>,<lng>&travelmode=walking`)
  — instead of the bare `?q=` pin.

## What does NOT change

- **No Waze, no second provider.** This is a single link; it stays Google Maps only.
- **No handler/behavior change beyond the URL mode.** The link still only renders when
  `a.lat != null && a.lng != null`, still uses `target="_blank" rel="noreferrer"`, and still uses the
  existing `t.staff.openLocation` label. Coordinates still come only from the alert document.
- **No new i18n strings.** Reuses `t.staff.openLocation`.
- **No change to alerts, SOS triggering, acknowledgement, or any callable.** Presentation/URL only.

## Impact

- `apps/play-web` — `src/screens/StaffConsole.tsx` (the SOS/alert "open location" `<a href>` only).
- **Not touched:** `functions/`, `packages/shared`, `apps/creator-web`, `src/i18n.ts`, alert data,
  triggerSOS / acknowledgeAlert or any callable.

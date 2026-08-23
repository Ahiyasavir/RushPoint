## Why

A participant standing outdoors in an unfamiliar neighbourhood, holding a phone, is given a 208px
static map (`PlayScreen.tsx` `NavMap`, `className="h-52"`) and a text badge reading
"📍 400 m away" (`TaskRunner.tsx` `DistanceBadge`). That is the entire wayfinding story.

Grepping `waze|google\.com/maps|geo:` across `apps/play-web/src` returns exactly one hit —
`StaffConsole.tsx:337-344`, the SOS alert's "open location" link for staff. Staff can hand a
location to a real navigation app; **the people actually walking to it cannot.** This is the largest
functional gap the audit found in the participant app, and it costs a team minutes per stop in the
exact moment the product is being judged.

Every ingredient is already on the client: `DistanceBadge` derives the target coordinates from
`task.smart?.stationCoords ?? task.coordinates` and already validates them
(`Number.isFinite` on both axes, plus a `(0, 0)` rejection) before starting its geolocation watch.
Nothing new needs to come from the server.

## What Changes

- **A "Navigate here" link sits beside the distance badge** on a located task. It opens Waze
  (`https://waze.com/ul?ll=<lat>,<lng>&navigate=yes`) with a Google Maps link
  (`https://www.google.com/maps?q=<lat>,<lng>`) offered alongside it, following the same
  `target="_blank" rel="noreferrer"` shape as the staff SOS link that already ships.
- **The link is suppressed whenever revealing the coordinates would break a game mechanic or be
  meaningless.** For a hidden-location (treasure-hunt) task, *the coordinates are the puzzle
  answer* — the server strips them entirely while the spot is still secret
  (`sanitizeTaskForParticipant`'s sealed-stub early return). The client must not re-introduce a leak
  the server went out of its way to prevent, so the decision is a **pure function with tests**, not
  a condition inlined in JSX.

## Capabilities

### New Capabilities
- `play-navigation-handoff`: A participant walking to a located task can hand its coordinates to a
  real turn-by-turn navigation app, and a task whose location is part of the puzzle, not yet
  reached, absent, or invalid never offers that hand-off.

### Modified Capabilities
<!-- None. -->

## Impact

- **Surfaces touched:** `apps/play-web` **only** — `components/TaskRunner.tsx` (the `DistanceBadge`
  area), new `lib/navigateTo.ts`, `i18n.ts`. No callables, no payloads, no Firestore rules, no
  `packages/shared` changes, no creator-web changes.
- **New pure logic (the TDD surface):** `navigationTarget(task)` — the visibility decision — plus
  `wazeUrl` / `googleMapsUrl`. Tested by a new `scripts/test-navigate-handoff.ts` in the existing
  `npm test` lane **before** any component is edited, with cases for: hidden location,
  sealed/arrival-pending, locationless, missing coordinates, non-finite coordinates, `(0, 0)`,
  a `smart.stationCoords` station, and the ordinary located task.
- **Security note:** this is the one part of this work where a client bug has a *game* consequence
  rather than a cosmetic one. The visibility function fails **closed** — anything it does not
  positively recognise as a released, valid, non-hidden coordinate pair returns `null`.
- **Gates:** `npm run e2e` is **excluded** — no callable, payload or server behavior is touched, and
  the emulator must not be started (a live playtest tunnel owns it). The server-side secrecy this
  change relies on is already covered by the existing hidden-location e2e scenario and
  `functions/src/runs/sanitizeTask.test.ts`.

## Non-goals

- **No in-app turn-by-turn.** The hand-off opens the user's own navigation app; RushPoint does not
  become a routing engine.
- **No change to what the server sends.** In particular, no attempt to obtain coordinates for a
  sealed task — they legitimately do not exist on the client.
- **No hand-off on the run-wide map or the completed-task pins.** Scope is the current task's
  distance badge.
- **No app-store deep links or platform sniffing.** Both links are plain https URLs that the OS
  resolves to an installed app when one exists.
- **No changes to the touch-target / RTL / dialog work** — that is the sibling change
  `play-touch-rtl-a11y`, which lands first.

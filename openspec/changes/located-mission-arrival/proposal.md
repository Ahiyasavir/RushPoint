## Why

Field report 2026-09-27 items 11, 11b, 12, 13, plus Ahiya's decisions of 2026-09-28.

- Players did not understand they had to walk to the point on the map. The active mission is a plain
  dot in the game's brand colour; its name appears only in a tap popup; the map frames its content
  ONCE when it opens (`fitted` latch in `apps/play-web/src/components/NavMap.tsx`) and never moves
  when a new mission arrives.
- A located mission shows its full content before the team gets there, which confused players.
  Decision: **every located mission opens only on arrival** (not a setting).
- Decision: the player map shows **every** mission's location, **locked ones included**; hidden
  missions keep showing only their search circle.
- Requested moment: when a located mission arrives, animate to it, a clearer icon, zoom out to show
  both the mission and the team, and an arrow from the team toward it.

The arrival machinery exists: `reportArrival` checks distance against the mission's radius with the
GPS accuracy rules and grace window (`arrival-needs-a-usable-fix`) and latches `arrivedAt`; the
participant sanitizer seals a mission until then. Both are scoped to `hideLocation` missions only.
Actionbound unlocks location tasks the same way (20 m) and warns that GPS fails indoors, so an
operator "let them in" is part of this change (see `docs/field-report-2026-09-27.md`).

## What Changes

- **Arrival-gated located missions.** In a run launched after this change, a mission with a real
  location and a location trigger is sealed until the team arrives. Before arrival the player sees
  the mission's name, points, distance and "walk to the point on the map"; on arrival the
  instructions and answer inputs open. Locationless missions are unchanged. Runs already live keep
  today's behaviour.
- **Let them in.** The organizer (team page) and staff with the routing permission can mark a team
  as arrived at its mission when GPS cannot prove it. Audited.
- **The map moment.** When the team's located mission changes: the map flies to the mission, then
  frames both the mission and the team, and draws a line with an arrowhead from the team to the
  mission. The mission pin becomes a flag with a pulse, labelled with its name; a chip over the map
  says "🚩 לכו לנקודה במפה · 350 מ׳" and updates with the distance.
- **All missions on the map.** Every located mission of the game is on the map: done (check),
  current (the flag), open (plain pin), locked (grey pin with a lock). Hidden missions: search
  circle only, never the pin.

## Capabilities

### New Capabilities
- `mission-arrival`: arrival-gated located missions, operator arrival, the map moment, the
  all-missions layer.

## Non-goals

- A compass/bearing arrow that needs device orientation (the map line needs no permission).
- Turn-by-turn directions (the existing external map link stays).
- Changing hidden-mission rules.

## Surfaces

- **Shared (pure):** `arrivalGateApplies(task, run)`, `missionPins(game, team)`, bearing/line helper.
- **Callables (changed):** `launchRun` stamps `run.arrivalGate: true`; `reportArrival` checks any
  gated mission; the sanitizer seals gated missions; `getMyTeamState` returns `missionPins`.
- **Callable (new):** `markTeamArrived` (owner/admin/staff `route`, audited, e2e + authz row).
- **play-web:** `NavMap` (fly/fit per mission change, arrow line, flag pin, all pins, chip),
  `TaskRunner` sealed-located card. **creator-web:** team page "let them in". i18n both.

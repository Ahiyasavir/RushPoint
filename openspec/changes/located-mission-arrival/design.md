## Context (verified 2026-09-28)

- `reportArrival` (`functions/src/runs/index.ts`) returns `{ arrived: true }` immediately for any
  task without `hideLocation`; for hidden tasks it runs `evaluateArrivalFix` + `evaluateTrigger`
  (radius/exact modes, accuracy, coarse-fix grace, test-drive bypass) and latches
  `RunTaskRecord.arrivedAt` (+ `arrivalUnverified`) in a transaction.
- `sanitizeTaskForParticipant` (`functions/src/runs/sanitizeTask.ts`) builds a sealed stub BY
  CONSTRUCTION for `hideLocation && !revealed`.
- `PlayScreen` probes `reportArrival` from its geolocation watcher for the sealed mission
  (`sealedId`); `TaskRunner` calls it on the player's press.
- `NavMap` draws targets as plain `div` markers (active = brand colour dot), frames once
  (`fitted`), has overlays for search areas/zones/hot zone and a `recenterVerdict` button.
- `getMyTeamState` ships task content only for assigned/completed tasks (wave D).

## Decisions

### D1: the gate is fixed per run at launch

`launchRun` writes `run.arrivalGate = true`. `arrivalGateApplies(task, run)` ⇔ `run.arrivalGate`
∧ task has real coordinates ∧ `normalizeTriggerMode(task)` ∈ {radius, exact} ∧ not locationless.
Runs launched before the deploy have no flag ⇒ unchanged, so no team mid-mission is re-sealed.
Hidden missions keep their own (stricter) seal regardless of the flag.

### D2: one seal, two stubs

The sanitizer seals when `hideLocation && !revealed` (unchanged stub) OR
`arrivalGateApplies && !revealed` (new "located, not arrived" stub: id, title, titleHe,
coordinates, geofenceRadiusMeters, pointValue, difficulty, estimatedMinutes, media,
`arrivalPending: true`; built by construction like the hidden stub — no description, no smart,
no inputs, no answer fields). The e2e sanitizer allowlist is extended for this stub only.

### D3: reportArrival checks every gated mission

The early `return { arrived: true }` applies only when `!hideLocation && !arrivalGateApplies`.
Otherwise the same fix/trigger evaluation runs (with `hidden: false` messages: "עוד לא הגעתם —
X מ׳ מהנקודה"). `PlayScreen`'s probe targets the current mission when it is sealed of either kind.
Geofence missions: arrival and auto check-in coincide; the arrival latch is written first, then
the existing geofence completion runs.

### D4: markTeamArrived

`markTeamArrived({ ownerUid?, gameId, runId, teamId, taskId, reason? })`: owner/admin/staff
`route`; sets `arrivedAt` + `arrivalByOperator: { at, by }` (organizer-facing, never allow-listed
to the participant); audited `team_arrival_marked`; idempotent.

### D5: map moment (play-web NavMap)

- Track the active target id; on change: `flyTo` the mission (zoom 17, 900 ms), then
  `fitBounds([team, mission], padding 72, maxZoom 17, 900 ms)`. Only on CHANGE, so a player's
  own panning is never fought (the reason `fitted` exists).
- A GeoJSON line source from the team's fix to the mission + a `symbol` arrowhead at the mission
  end (rotation from `bearingDeg`), redrawn on each fix, hidden when there is no usable fix.
- Destination marker: SVG flag with a CSS pulse ring, `aria-label` with the mission name.
- Chip above the map: "🚩 לכו לנקודה במפה · {distance}" while sealed, "📍 הגעתם" after.

### D6: all missions layer

`missionPins(game, team, run)` → `{ id, lat, lng, state: 'done' | 'current' | 'open' | 'locked',
title }[]` for every mission with real coordinates, all stages, EXCLUDING `hideLocation` missions
(they keep `searchArea`). Returned by `getMyTeamState` from the cached game doc (no extra reads).
Drawn as small markers under the current flag; tapping one shows its name and state.

## Test strategy

- **Pure** `scripts/test-mission-arrival.ts`: `arrivalGateApplies` truth table (flag, coords,
  modes, locationless, hidden); sealed stub carries NO description/smart/answers (deep key sweep,
  the house pattern); `missionPins` states per record status, hidden excluded, locked included,
  malformed input total; `bearingDeg` known pairs.
- **e2e** scenario "arrival gate": new run ⇒ a located mission's payload is the stub; a far fix ⇒
  `arrived:false`; a near fix ⇒ full payload; `markTeamArrived` unseals; a run launched without the
  flag keeps the full payload; `missionPins` includes a locked mission and excludes a hidden one.
  Authz row for `markTeamArrived`. Sanitizer allowlist updated for the stub.
- **UI** preview (play-web, synthetic GPS via the browser-fidelity helpers): the fly/fit, the arrow,
  the chip, unseal on arrival; the console's "let them in". `npm run i18n:check:strict`;
  `npm run bundle:budget` (no new heavy dependency).

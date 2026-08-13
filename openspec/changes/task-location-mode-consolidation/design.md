## Context

`TaskWizard.tsx` exposes location/trigger controls across three disconnected spots: a 4-way
`triggerMode` button row (`:229-237`), a radius number input just below it (`:1298-1300`), and a
"Hide location" checkbox lower in the form, inside an unrelated `rules` section (`:1120-1126`).
`Task.triggerMode` (`packages/shared/src/types/index.ts:170`) is
`'radius' | 'exact' | 'instant' | 'locationless'`; `hideLocation` (`:297`) is a separate boolean
the type comment already documents as orthogonal — "layers on any located task". The schema
already models this correctly; the UI just scatters it.

## Goals / Non-Goals

**Goals:**
- Exactly 2 top-level buttons, zero visible technical detail (radius numbers, GPS-check behavior)
  until a creator opts into the Advanced panel.
- Every located-task technical control lives in one place, nested under "Specific Location".
- Zero server-side change, zero data migration — this is entirely a `apps/creator-web`
  presentation change.

**Non-Goals:**
- Do not remove or rename any `TriggerMode` value in `packages/shared`. Existing tasks/runs read
  `triggerMode` server-side (`assignNextTask.ts`, `reportArrival`); a value rename or merge would
  be a migration, which this change explicitly avoids.
- Do not merge `'instant'` into `'locationless'` at the schema or routing level (see Decisions).
- Do not change `smart_station`'s configuration UI.

## Decisions

- **"Specific Location" is the single located-task entry point; `'radius'`/`'exact'` become one
  slider-backed control, not two buttons.** The Advanced panel's radius input drives
  `triggerModeFromRadius(radiusMeters)`: `<= 4m ⇒ 'exact'`, `> 4m ⇒ 'radius'`. Reusing the two
  existing defaults (40m / 4m) as slider presets means a creator who never touches anything gets
  today's `'radius'` behavior, and one who picks the "precise" preset gets exactly today's
  `'exact'` behavior — nothing already saved changes meaning.
- **`'instant'` stays a distinct value, exposed only as an Advanced toggle nested under "Specific
  Location", never folded into "Anywhere".** This was an explicit product decision after review:
  `'instant'` tasks are located (have coordinates, get routed to, contribute transit distance) and
  only skip the GPS verification step on completion. `locationless` tasks have no coordinates at
  all and zero transit. Merging the two top-level buttons would have been a UI simplification with
  a real behavioral cost — any task currently using `'instant'` mode would lose its map pin and
  routing distance the moment its authoring UI collapsed the two concepts together. Keeping
  `'instant'` as a same-side (Specific Location) toggle instead avoids that regression entirely
  while still cutting the top-level choice count to 2.
- **Reposition "Hide location", don't redesign it.** Move the existing checkbox + clue field
  (`:1120-1151`) into the same Advanced panel as the radius/skip-GPS-check controls. No new
  component, no new field — a JSX reorder plus conditional render tied to "Specific Location"
  being selected.

## Risks / Trade-offs

- [Risk] A creator who specifically relied on "Exact" as a named, discoverable preset for tight
  spots may not find it as an explicit top-level button anymore. → Mitigation: the Advanced
  panel's radius control ships with the 40m/4m presets front and center, so the information isn't
  lost, only moved one level deeper (behind "Specific Location" → Advanced).
- [Risk] A creator who wants a task to skip GPS verification (today's "Instant" button) now has to
  find that behind "Specific Location" → Advanced rather than as its own top-level option. →
  Mitigation: this is the deliberate trade-off that avoids the routing/scoring regression described
  above; the Advanced panel's toggle copy will call out explicitly what it does ("fires without
  checking GPS — the task still shows on the map and counts toward travel").
- [Risk] The radius→triggerMode cutoff (`<= 4m`) is a judgment call with no prior product decision
  behind it, but it exactly reproduces today's two named defaults, so no existing task's behavior
  changes on load — it only affects newly-authored tasks going forward.

## Migration Plan

None required — `Task.triggerMode` values, `geofenceRadiusMeters`, and `hideLocation` are
unchanged in the data model. Existing tasks render and behave identically regardless of which
`triggerMode` they were saved with; only the authoring UI changes for tasks created or edited
after this ships.

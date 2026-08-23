## ADDED Requirements

### Requirement: Live distance is shown as a large, high-contrast, tabular number
The play screen SHALL render the live distance-to-task figures — the always-on
`DistanceBadge` and the geofence "walk closer" line — as large, high-contrast,
fixed-width numbers, so a walking participant can read them at arm's length outdoors
in direct sun. These figures SHALL use a strong ink color (not the metadata gray
`text-zinc-500`) and `tabular-nums` so the digits do not jitter or reflow as the value
updates. This is a presentation contract only: the distance value, its computation and
units, and all `t.*` copy SHALL remain unchanged.

#### Scenario: The live distance is shown as a large high-contrast tabular number
- **WHEN** a participant is en route and the `DistanceBadge` or geofence "walk closer"
  distance is displayed
- **THEN** the number renders at a larger type size with a strong high-contrast ink
  color (near-black `text-zinc-100`, not `text-zinc-500`) and `tabular-nums`

#### Scenario: Value and copy are unchanged
- **WHEN** the distance figure updates as the participant moves
- **THEN** the rendered value, rounding, units, and the `t.task.metersAway` /
  `t.task.kmAway` / `t.task.walkCloser` copy are identical to before — only the
  presentation classes differ, with no behavior or i18n change

#### Scenario: Only the live-distance numbers are restyled
- **WHEN** the geofence status block renders its non-distance sibling states
- **THEN** the `findingLocation` status message and the `youreHere` arrival line keep
  their existing styling; only the live-distance figures are restyled

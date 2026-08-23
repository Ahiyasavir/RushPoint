## Why

`TaskRunner`'s `field()` handler is shared by two task types: `field` (a located check-in) AND
`self_report` (the "mark complete from anywhere" type, `t.task.markComplete`), wired together at
`apps/play-web/src/components/TaskRunner.tsx:832-837`. A `field` task can also be `locationless`
(`task.locationless`, read at `:954`).

`field()` calls `withLocation(onFix, onDenied)`, and its `onDenied` branch
(`TaskRunner.tsx:482-488`) does `showError(t.task.gpsWarning); end();` for every non-test-drive run.
It never submits. That is correct for a genuinely located `field` task (the server needs proximity),
but it is a **fail-CLOSED trap** for `self_report` and `locationless` tasks, which need no location at
all:

- The server does not require coordinates for these. `completeTask` enforces proximity only when
  `(mode === 'radius' || mode === 'exact') && hasRealCoords` (`functions/src/runs/index.ts:3357-3385`),
  and `normalizeTriggerMode` returns `'locationless'` for a locationless task
  (`packages/shared/src/geo.ts:152-161`). A `self_report` / `locationless` task carries no real
  coordinates, so the proximity gate is never reached.
- So a participant who declines the location permission prompt (or is indoors on a slow fix) literally
  cannot complete a "mark complete from anywhere" task for the rest of the run.

This is exactly the pattern CLAUDE.md forbids: "every client-side blocking flag must fail OPEN ... the
server re-validates every submission." The client blocks on its own say-so and nothing clears it.

## What Changes

- For a `self_report` task, or any task marked `locationless`, `field()`'s `onDenied` branch SHALL
  submit the check-in **without coordinates** instead of showing the terminal GPS warning. The server
  stays the only authority and refuses if it truly needs proximity.
- The decision "may this task be completed without a location fix?" is extracted as a pure, fail-open
  predicate `canCompleteWithoutLocation` in `apps/play-web/src/lib/stuckGuards.ts` (the repo's home for
  fail-open participant guards), covered by `scripts/test-stuck-player-guards.ts` in the `npm test`
  fast lane.
- A genuinely located `field` task keeps the exact current behavior: the GPS warning is shown and the
  submission is not sent, because the server needs proximity coordinates.

## What does NOT change

- Located `field` tasks still show `t.task.gpsWarning` on GPS denial and do not submit blind.
- The test-drive bypass (`session.isTestDrive`) is untouched; it already submits from anywhere.
- No server change, no `withLocation` change, no geofence auto-fire change.
- No new UI string (the existing `t.task.markComplete` / `t.task.gpsWarning` copy is reused).

## Impact

- Affected specs: `gps-error-ux` (one requirement MODIFIED to distinguish located vs. locationless).
- Affected code: `apps/play-web/src/lib/stuckGuards.ts` (new pure predicate + export),
  `apps/play-web/src/components/TaskRunner.tsx` (`field()`'s `onDenied` branch),
  `scripts/test-stuck-player-guards.ts` (new cases).
- NOT touched: every server gate, `withLocation`, `GeofenceAuto`, and the i18n dictionaries.

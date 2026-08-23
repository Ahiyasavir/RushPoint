## Context

Read in this working tree:

- `apps/play-web/src/components/TaskRunner.tsx:832-837` renders ONE button for both
  `task.type === 'field'` and `task.type === 'self_report'`, both wired to the same `field()` handler
  (`:476-490`). A `field` task may additionally be `locationless` (used at `:954` for the distance
  badge).
- `field()`'s success path submits real coordinates via `submitCheckIn({ lat, lng })`; its `onDenied`
  path (`:482-488`) submits from anywhere ONLY for `session.isTestDrive`, otherwise
  `showError(t.task.gpsWarning); end();` with no submission.
- `submitCheckIn(coords?)` (`:470-474`) already OMITS coordinates when its argument is absent, sending
  `completeTask({ ...ctx, taskId, ...(coords ?? {}) })`. The mechanism to submit without a fix already
  exists; only the `onDenied` decision is wrong.

Server facts this change relies on (unchanged):

- `completeTask` accepts `field`, `self_report` and `geofence` types
  (`functions/src/runs/index.ts:3347-3349`) and enforces proximity ONLY when
  `(mode === 'radius' || mode === 'exact') && hasRealCoords` (`:3357-3385`). `hasRealCoords` requires a
  valid, non-null-island coordinate on the task.
- `normalizeTriggerMode` (`packages/shared/src/geo.ts:152-161`) returns `'locationless'` for a
  `locationless` task; a `self_report` task carries no coordinates, so `hasRealCoords` is false and the
  proximity block is skipped. Either way the server needs no client coordinates to complete the task.

So submitting a `self_report` / `locationless` completion without coordinates is exactly what the
server expects. If a creator ever placed real coordinates on such a task and the server does gate it,
the existing `submitCheckIn` catch surfaces the localized `submitError`, which is still strictly better
than a permanent client block and matches the fail-open mandate.

## Goals / Non-Goals

**Goals:**
- A participant who denies location can still complete a `self_report` or `locationless` task.
- The located-`field` case is unchanged: warn, do not submit blind.
- The decision is a pure function with a co-located test, not an inline condition only eyeballed.

**Non-Goals:**
- Relaxing any server gate. The server remains the sole authority on whether a completion is allowed.
- Sending synthetic `(0,0)` or at-the-spot coordinates. Omission is the contract; never fake a fix.
- Changing the geofence auto-fire path or `withLocation`.

## Decisions

### D1 — A pure predicate `canCompleteWithoutLocation` in `lib/stuckGuards.ts`

`play-web` has no component test runner, so any decision left inside a `.tsx` can only be eyeballed.
`lib/stuckGuards.ts` is already the home for fail-open participant guards (`offlineSubmitGate`,
`helpAlreadySent`, `gpsRetryDelayMs`). Add one more, in the same shape (no React, no clock, no
storage):

```ts
export function canCompleteWithoutLocation(task: {
  type?: string;
  locationless?: boolean;
}): boolean {
  return task.type === 'self_report' || task.locationless === true;
}
```

Fail-open property: it returns `true` for the "no location needed" types and `false` otherwise, and a
`false` only means "show the warning" — never a hard block, since the server is still reachable on the
next tap once GPS is granted. It reads only the task shape the participant payload already carries.

### D2 — `field()`'s `onDenied` consults the predicate after the test-drive branch

```ts
() => {
  if (session.isTestDrive) { void submitCheckIn(); return; }
  if (canCompleteWithoutLocation(task)) { void submitCheckIn(); return; }
  showError(t.task.gpsWarning); end();
}
```

The test-drive branch stays first and untouched (its bypass keys on the server run flag, not on the
task type). The predicate is a task-shape decision, kept separate from the session decision.

### D3 — Test lane: extend `scripts/test-stuck-player-guards.ts`

The existing pure-guard test file already imports from `lib/stuckGuards.ts` and is wired into
`npm test` via `scripts/run-unit-tests.mjs`. Add cases for `canCompleteWithoutLocation`:

- `self_report` with no `locationless` flag → `true`.
- `field` with `locationless: true` → `true`.
- `field` with no `locationless` (a located task) → `false`.
- `geofence`, `quiz`, `photo` and an unknown/empty type → `false` (only the two intended types open).
- Missing `type` and missing `locationless` → `false` (default closed, so a located task never submits
  blind by accident).

Add a wiring guard over `TaskRunner.tsx` source (in the spirit of the file's existing static checks):
`field`'s denial path references `canCompleteWithoutLocation(`.

## Risks / Trade-offs

- **A `self_report` task with real placed coordinates would now submit without a fix and could be
  server-rejected.** Accepted and preferred: the participant reaches the server and sees the localized
  rejection, instead of being permanently stuck behind a client-only warning. This matches the
  fail-open rule the codebase already applies to the offline gate.
- **On-device behavior is not verified here** (no device, live stack must not be disturbed). The pure
  predicate is unit-tested and the wiring is asserted statically; browser verification (deny location,
  complete a self-report task) is flagged as the manual follow-up.

## Test Strategy

Lane: `scripts/test-stuck-player-guards.ts` (tsx assertion script, no emulator), run by `npm test`.
RED before the predicate exists and before `field()` is wired.

1. Unit-test `canCompleteWithoutLocation` per D3, including the default-closed cases.
2. Wiring guard: `TaskRunner.tsx` source references `canCompleteWithoutLocation(` in `field()`.

Gates (no emulator, live stack untouched): `npm run typecheck`, `npm run lint`, `npm test`,
`npm run play:build`, `npm run creator:build`. No i18n key is added, so `i18n:check` is unaffected, but
`i18n:check:strict` is still run because a `.tsx` was touched.

## RTL / i18n notes

No new dictionary key. The reused copy (`t.task.markComplete`, `t.task.gpsWarning`) is already
bilingual. No hardcoded UI string is introduced, so PART B stays at zero new warnings.

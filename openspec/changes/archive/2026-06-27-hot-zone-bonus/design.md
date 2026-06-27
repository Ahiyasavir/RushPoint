# Design — Hot zone bonus

## Current behavior

- Task completion scoring happens server-side in `functions/src/runs/index.ts` (the
  `completeTaskForTeam` / scoring path); `earnedScore` is written to the team doc.
- Server already re-validates geofence distance with `haversineKm` and trusts the server clock.
- Live-ops actions (announcements, flash missions) write to run subcollections.

## Approach

### Pure helper → `packages/shared/src`

```ts
hotZoneMultiplier(
  hotZone: HotZone | undefined,
  coords: GeoPoint | undefined,
  nowMs: number
): number
  // returns hotZone.multiplier when: hotZone defined, now within [startedAt, expiresAt],
  // and haversineKm(coords, center)*1000 <= radiusMeters; else 1 (no multiplier).
```

Tested in `scripts/test-hot-zone.ts`: active + inside → multiplier; active + outside → 1; expired → 1;
before start → 1; no zone → 1; missing coords → 1.

### Callables

`activateHotZone(runId, center, radiusM, multiplier, durationMin)` — owner/staff only; writes
`run.hotZone = { center, radiusMeters, multiplier, startedAt: now, expiresAt: now+duration }`.
`deactivateHotZone(runId)` clears it. (Validated: multiplier in a safe range, radius/duration capped.)

### Scoring integration

In the completion-scoring path, after computing the base `earnedScore`, multiply by
`hotZoneMultiplier(run.hotZone, completionCoords, Date.now())`. The bonus delta is recorded so the
leaderboard/recap reflect it. No client input controls the multiplier.

## Test strategy (TDD)

- **Pure (RED first)** → `scripts/test-hot-zone.ts`: the multiplier predicate cases above.
- **e2e** → activate a hot zone over a task's location; complete it within the window → score is
  multiplied; complete an out-of-zone task → not multiplied; let it expire → not multiplied.
- **UI (preview):** participant sees the banner + countdown + map circle; organizer activate panel works.

## Conventions

- New callables + re-export + wrappers; writes `run.hotZone` (server-write-only). Uses `haversineKm`.
- Multiplier applied server-side only (Appendix A rule 12 — never trust client completion/location).
- `run.hotZone` is a single nested object (no dotted-array writes).

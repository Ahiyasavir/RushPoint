# Design — visible-time-estimates

## 1. The two fields, verified

Every premise below was read before any code was written.

| claim | evidence |
|---|---|
| `expectedDurationMinutes` has exactly one reader | `packages/shared/src/scoringPresets.ts:80` (`t.expectedDurationMinutes ?? t.estimatedMinutes`) |
| `estimatedMinutes` drives the smart sigmoid | `functions/src/runs/index.ts:918-921`; skip award `scoringPresets.ts:229` |
| ... and the routing pace model | `functions/src/routing/assignNextTask.ts:141-145` |
| ... and the public gallery total | `packages/shared/src/gameStats.ts:12` |
| ... and both creator-visible numbers | `apps/creator-web/src/components/TaskCard.tsx:168`, `apps/creator-web/src/pages/BuilderPage.tsx:1932` |
| `blankTask()` seeds a flat 15 | `apps/creator-web/src/lib/wizardLogic.ts:53` |
| `startedAt` is stamped at ASSIGNMENT | `functions/src/runs/index.ts:3059` (inside `requestNextTask`'s claim transaction) |
| the measured span therefore includes the walk | `functions/src/runs/index.ts:853-857` — `startedAt = taskRec.startedAt ?? ...`, `rawMinutes = now - startedAt` |
| walking is modelled as haversine x 12 | `functions/src/routing/assignNextTask.ts:46-58`; `locationless` returns 0, coords-unavailable returns 5 |

One correction to the brief: the assignment stamp is at `runs/index.ts:3059`, not `:3022`
(`:3022` is where `wizardLogic.ts`'s comment points, and it has drifted). The behaviour is exactly
as described.

## 2. The transit allowance

### What we are estimating

The span the server measures is `assignment -> completion` = **walk to the stop + interaction at
the stop**. The interaction half already has a defended model:
`defaultExpectedDurationMinutes(task)` (`packages/shared/src/taskDuration.ts`). This change adds
only the walk, and reuses that function verbatim rather than restating any of its numbers.

### The walking model

Reused from routing, unchanged, so the authoring estimate and the routing cost cannot drift:

```
walkMinutes(a, b) = haversineKm(a, b) * 12        // 12 min/km == 5 km/h
```

### Which leg?

At authoring time there is no "previous stop" — routing decides that at run time, per team, from
live station load. So the allowance must be a statistic over the legs that *could* be walked.

Three candidates were considered against how routing actually behaves
(`0.5*load - 0.3*transit + 0.2*skill`, or `0.6*load - 0.4*transit`):

- **minimum leg** (nearest sibling). Matches routing's *first* pick, but routing consumes stops:
  the last task a team is handed in a stage is whatever is left, which is typically far. A minimum
  systematically under-estimates and would make every late-stage completion score as slow. Rejected.
- **mean leg**. One outlier stop across town drags the estimate for every other task in the stage,
  over-estimating them all and paying free points. Rejected.
- **median leg**. Sits between the optimistic "nearest" and the pessimistic "mean", and is robust
  to a single far outlier by construction. **Chosen.**

So:

```
transitAllowance(task, siblings) =
  0                                            if the task is locationless
  TRANSIT_UNKNOWN_MINUTES                      if the task has no usable coordinates
  TRANSIT_UNKNOWN_MINUTES                      if no sibling has usable coordinates
  clamp(median(walkMinutes(task, sibling)),    otherwise
        TRANSIT_MIN_MINUTES, TRANSIT_MAX_MINUTES)
```

### Constants and why

| constant | value | defence |
|---|---|---|
| `WALK_MINUTES_PER_KM` | 12 | routing's own number (`assignNextTask.ts:58`). Not re-tuned here, deliberately. |
| `TRANSIT_UNKNOWN_MINUTES` | 5 | routing's own coords-unavailable / hidden-location constant (`assignNextTask.ts:51,53,55`). Using the same value means "we do not know this leg" costs the same in both places. |
| `TRANSIT_MIN_MINUTES` | 1 | two stops in one courtyard still cost arriving, orienting and finding the marker. A 0 floor would make the estimate collapse back to interaction-only, which is the exact bug this change exists to avoid. |
| `TRANSIT_MAX_MINUTES` | 15 | a creator who parks one stop 4 km away must not push every sibling's estimate to an unreachable target. 15 min == 1.25 km on foot, past which a stage is mis-designed rather than mis-estimated. |
| `TASK_ESTIMATE_MIN_MINUTES` | 1 | `taskScoreSmart` returns 0 for `estimatedMinutes <= 0` (`scoringPresets.ts:116`) and `computeSkillRatio` divides by it (`assignNextTask.ts:145`). Never 0, never negative. |
| `TASK_ESTIMATE_MAX_MINUTES` | 60 | one task is not an hour. Also bounds the gallery total against an absurd authored value. |

### Locationless and no-coordinates, stated explicitly

- **`locationless`** (`task.locationless`, or `normalizeTriggerMode(task) === 'locationless'`, or
  `triggerMode === 'instant'`) gets **exactly zero** transit, matching `transitMinutes()`'s first
  branch. Its estimate is the interaction alone.
- **No usable coordinates** — absent, `NaN`, out of range, or the Builder's `{lat: 0, lng: 0}`
  "not placed yet" sentinel (`wizardLogic.ts:78` treats `0,0` as unplaced) — gets
  `TRANSIT_UNKNOWN_MINUTES`. The task is located, we simply do not know where yet, so it is charged
  the same unknown-leg constant routing charges. When the creator drops the pin the suggestion
  recomputes and the one-tap apply is offered again.
- **A single-stop stage** has no leg to measure and is treated identically to "no coordinates":
  `TRANSIT_UNKNOWN_MINUTES`. Falling back to 0 would silently re-create the interaction-only bug for
  the most common stage shape in the product.

### Rounding

The result is rounded to a **whole minute**. `estimatedMinutes` is rendered as `{n}m` on the task
card and summed into a whole-minute gallery total, and the Builder's own override input is
`parseInt`-based (`TaskWizard.tsx:1152`), so a fractional default could never be re-typed by hand.

### The numbers a creator will now see

A four-stop urban stage with roughly 300 m between stops (median leg ~0.30 km -> 3.6 min transit):

| task | interaction | transit | estimate | was |
|---|---|---|---|---|
| `geofence` auto check-in | 0.5 | 3.6 | **4** | 15 |
| `field` check-in | 1 | 3.6 | **5** | 15 |
| `photo` capture | 2 | 3.6 | **6** | 15 |
| `smart_station` code | 3 | 3.6 | **7** | 15 |
| 6-step `sequence` | 5 | 3.6 | **9** | 15 |
| any `locationless` task | 1-2 | 0 | **1-2** | 15 |
| a brand new unplaced task | 1 | 5 | **6** | 15 |

## 3. Scoring safety — the hard constraint

### Where the value is read at scoring time

`completeTaskForTeam` reads `gameTask.estimatedMinutes` off the **live game template**
(`users/{ownerUid}/games/{gameId}`, loaded per call) and computes `earnedScore` there
(`functions/src/runs/index.ts:918-921`). It then **persists** that number onto the team's
`RunTaskRecord.earnedScore`. `scoreSmartWeighted` (`scoringPresets.ts:122-135`) sums those
persisted per-task values; `buildRankings` (`functions/src/runs/index.ts:1215+`) calls it.

Two consequences, both load-bearing:

1. **A smart_weighted score, once earned, is frozen.** Re-reading the template later cannot change
   it. So a finalised run can never be re-scored by an authoring-time edit, and an in-flight run's
   already-completed tasks are equally immune.
2. **`fixed_points_speed` is the one preset that does re-derive from the template** — its expected
   route total is recomputed on every `buildRankings` call (`scoringPresets.ts:76-82`). That is
   pre-existing behaviour (a creator editing a live template already moves it) and this change does
   not widen it, because this change writes nothing to any stored game.

### Decision: no snapshot, because nothing is written

The safest possible design is the one that requires no snapshot at all: **do not change any stored
value.** Concretely:

- No migration, no backfill, no callable that rewrites `estimatedMinutes`.
- No write-on-read anywhere. `getGame`, `listGames`, `launchRun` and the sanitizer are untouched.
- The derived value reaches a stored game through exactly two doors, both authoring-time and both
  requiring a creator to be sitting in the Builder:
  - `blankTask()` — a task that has never existed, so it has no score basis to change; and
  - the editor's one-tap apply — an explicit creator action on an explicit control.
- An already-authored `estimatedMinutes` is never overwritten. `effectiveEstimatedMinutes` fills the
  gap only.

A snapshot of the template onto the run was therefore considered and **rejected**: it would be a
schema change and a new divergence surface (the run's copy vs the template) to solve a problem this
change does not create.

### Live / final parity

`buildRankings` is shared by `refreshLeaderboard` and `finalizeRun`, and this change touches neither
it nor any function it calls. Parity is preserved by not participating: the pure function added here
has no caller inside `functions/` except a property test.

## 4. Test Strategy

**Lane: pure logic, vitest, no emulator** (`packages/shared/src/taskEstimate.test.ts`, run by
`npm test` via the `packages/shared` `vitest run` script).

RED first: the test file is written against `packages/shared/src/taskEstimate.ts` before that module
exists, so the RED phase is a resolution failure, then GREEN is the minimum implementation.

Cases, one per bullet of the brief:

- every task type (`geofence`, `field`, `self_report`, `numeric`, `photo`, `smart_station`, `quiz`,
  `survey`, `sequence`) derives a finite whole number inside `[1, 60]`
- the estimate is never below the interaction default it wraps (the walk can only add)
- `locationless` gets exactly zero transit -> estimate equals the interaction default, rounded
- a task with **no coordinates** and a task on the `{0,0}` sentinel both get the unknown constant
- a **single-stop stage** (empty siblings) gets the unknown constant, not zero
- a stage with **far-apart stops** clamps at `TRANSIT_MAX_MINUTES`
- **absurd coordinates** (lat 900, lng -4000) and **`NaN`** coordinates fall back to the unknown
  constant rather than throwing out of `haversineKm`
- a non-array / poisoned `siblings` argument is treated as no siblings
- **median, not mean**: three siblings at 100 m, 120 m and 4 km derive from the 120 m leg
- an **explicit author value wins** in `effectiveEstimatedMinutes`, and a `NaN`/`0`/negative/absurd
  authored value does not
- the clamps hold at both ends
- `null` / `undefined` task returns a finite positive number

**Property lane** (`functions/src/__property__/invariants.property.test.ts`): extend the existing
seeded-random block with the scoring-relevant invariant — for any randomly built task and sibling
list, `defaultEstimatedMinutes` is finite, `>= 1` and `<= 60`, so it can never feed
`taskScoreSmart` a value that returns 0 nor `computeSkillRatio` a division by zero or a negative.

**Payload-completeness guard** (`scripts/test-game-presentation.ts`): `estimatedMinutes` is a
TASK-level field carried by the already-registered `stages` key, so no `BUILDER_EDITABLE_FIELDS`
entry is added; instead the fixture task carries an `estimatedMinutes` and the guard asserts it
survives into the save payload, exactly as `pausesTimer` and `expectedDurationMinutes` do.

**UI**: verified by build + `i18n:check:strict`; no component test runner. New copy is routed
through `t.builder.*` in both Hebrew and English and carries no em-dash.

**e2e (owed, not written here — another lane owns `scripts/e2e-verify.mjs`):**

1. In the `smart_weighted` lifecycle scenario, assert that completing a task whose game template
   declares `estimatedMinutes` yields a `taskScore` equal to
   `taskScoreSmart(difficulty, actualMinutes, estimatedMinutes)` computed from the run's own
   `startedAt`/`completedAt` stamps — pinning that the scored span is assignment-to-completion.
2. Assert that editing a game's `estimatedMinutes` via `updateGame` **mid-run** does not change the
   already-persisted `earnedScore` of a task completed before the edit (the frozen-score property
   this design leans on), while a task completed after the edit uses the new value.
3. Assert `refreshLeaderboard` and `finalizeRun` return identical `score` for every team across such
   an edit (live/final parity under a template edit).

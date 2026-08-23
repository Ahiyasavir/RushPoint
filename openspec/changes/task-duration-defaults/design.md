# Design — task-duration-defaults

## 1. What `expectedDurationMinutes` actually affects today (audited, with file:line)

The field is read in **exactly one place** in the whole repository:

| Consumer | Location | Effect |
|---|---|---|
| `scoreFixedPointsSpeed` — expected route total | `packages/shared/src/scoringPresets.ts:80` | `t.expectedDurationMinutes ?? t.estimatedMinutes`, summed over every task, then `speedBonus(expectedTotal, actualTotal)`. A task missing BOTH contributes `0` (finiteness-guarded on the same line). Only the `fixed_points_speed` preset. |
| Game file export / import allow-list | `packages/shared/src/gameFile.ts:150`, `:363` | round-trips the field; typed `'number'`. |
| e2e sanitizer allow-list | `scripts/e2e-verify.mjs:238` | asserts the field is not a leak. |

**The parent brief's premise that it feeds the `smart_weighted` sigmoid is incorrect.** The sigmoid
reads `estimatedMinutes`, not `expectedDurationMinutes`:

- `functions/src/runs/index.ts:918-921` — `taskScoreSmart(gameTask.difficulty, actualMinutes, gameTask.estimatedMinutes)`
- `packages/shared/src/scoringPresets.ts:229` — `skipAward('smart_weighted')` likewise.

Other consumers of the **sibling** `estimatedMinutes` (which the derived default also seeds at
authoring time, because it is the required field a creator actually sees):

| Consumer | Location | Effect |
|---|---|---|
| `taskScoreSmart` sigmoid | `packages/shared/src/scoringPresets.ts:107-120` (called at `functions/src/runs/index.ts:918`) | `x = actualMinutes / estimatedMinutes`; `estimatedMinutes <= 0` ⇒ score `0`. |
| `computeSkillRatio` routing pace model | `functions/src/routing/assignNextTask.ts:141-145` | `clamp((actual − estimatedMinutes) / estimatedMinutes, −1, 1)`; `<= 0` skips the sample. |
| `sumEstimatedMinutes` → `publicGames.estimatedTotalMinutes` | `packages/shared/src/gameStats.ts:12-16`, used at `functions/src/games/index.ts:374`, `:716` | gallery "≈ N min" badge. |
| Builder total-time readout | `apps/creator-web/src/pages/BuilderPage.tsx:1895` | sums `estimatedMinutes`. |
| Task card badge | `apps/creator-web/src/components/TaskCard.tsx:168` | "⏱ Nm". |
| Participant payload | `functions/src/runs/sanitizeTask.ts:54` | echoed to the player. |
| Recommendations payload | `functions/src/routing/assignNextTask.ts:242` | echoed. |
| Structural validation | `packages/shared/src/validation.ts:163` | negative ⇒ save refused. |

### Current default: there is none
`expectedDurationMinutes` is `number | undefined` (`packages/shared/src/types/index.ts:260`) and no
code path assigns it. When absent, `scoreFixedPointsSpeed` silently falls back to
`estimatedMinutes`; when BOTH are absent the task contributes **0** to the expected route total,
which inflates the speed bonus (the team "beat" a target of 0 extra minutes). That guard stays.

## 2. Travel time stays separate — verified

Routing computes walking cost in its own term and never consults either duration field:

```
functions/src/routing/assignNextTask.ts:46-58   transitMinutes(teamLocation, task)
  locationless        -> 0
  hideLocation        -> 5 (constant, so the secret spot is not triangulable)
  invalid coords      -> 5
  otherwise           -> haversineKm(...) * 12       // 5 km/h walking
:88   transitNorm = min(transitMinutes, 30) / 30
:93   0.6 * load - 0.4 * transitNorm                 // fixed_points_speed / time_only
:96   0.5 * load - 0.3 * transitNorm + 0.2 * skill   // smart_weighted
```

`estimatedMinutes` enters routing only through `computeSkillRatio` (pace), never through transit.
Therefore the derived default **must model the interaction at the stop only**. Folding the walk in
would double-count it in routing and would make the number meaningless for `locationless` tasks,
which have no walk at all.

### The consequence found during implementation: `estimatedMinutes` must NOT be re-seeded

`RunTaskRecord.startedAt` is stamped at **assignment**, not on arrival
(`functions/src/runs/index.ts:3022`, inside `requestNextTask`'s claim transaction). So
`actualMinutes` (`:852-856`) measures **walk + interaction**, and both scoring consumers compare
against that span:

- `taskScoreSmart(difficulty, actualMinutes, estimatedMinutes)` — `x = (walk + interaction) / estimate`
- `computeSkillRatio` — `(actual − estimatedMinutes) / estimatedMinutes`

Seeding `blankTask()`'s `estimatedMinutes` with the interaction-only default (a `field` check-in
derives **1 minute**) would therefore have made a team that walked six minutes score
`sigmoid(6) ≈ 0.2`, i.e. near-zero on every check-in. **`blankTask()` keeps its 15.** The derived
default fills `expectedDurationMinutes` only, and the Builder surfaces it as a suggestion the
creator opts into.

Making `estimatedMinutes` itself accurate would need a per-task **transit allowance** on top of the
interaction time, which is per-team and unknowable at authoring time. That is a separate decision
and is explicitly out of scope here; it is reported to the owner rather than guessed at.

## 3. The number table (the owner reviews these)

`M = defaultExpectedDurationMinutes(task)`, minutes, clamped to `[MIN 0.5, MAX 30]`.

| Task type | Formula | Example | Justification |
|---|---|---|---|
| `geofence` | `0.5` | 0.5 | Auto check-in. The server fires it on arrival; the player does nothing at all. Floor of the clamp. |
| `field` | `1` | 1 | Arrive and tap one confirm button. |
| `self_report` | `1` | 1 | Read the instruction and tap "I did it". |
| `numeric` | `1.5` | 1.5 | Count / read off / work out one number, then type it. |
| `photo` (`smart.captureKind` absent or `'photo'`) | `2` | 2 | Frame, shoot, look at it, retake once, upload. The owner's stated figure. |
| `photo` with `smart.captureKind === 'audio'` | `2` | 2 | Record a short clip; same capture-and-upload shape. |
| `quiz` — choice/typed | `1 + 0.25 × max(choices.length, 1)` | 4 choices ⇒ 2 | Read the question, read the options, pick. Scales mildly with how much there is to read. |
| `quiz` — ordering (`orderItems`) | `1 + 0.4 × orderItems.length` | 3 items ⇒ 2.2; 10 ⇒ 5 | Ordering is a real puzzle: every item must be read and placed relative to the others. |
| `survey` — choice (`surveyChoices`) | `min(2, 0.75 + 0.15 × surveyChoices.length)` | 2 opts ⇒ 1.05; 8 ⇒ 1.95 | One considered pick. **Hard ceiling 2 min**, the owner's stated number. |
| `survey` — free text | `min(2, 2)` = `2` | 2 | Typing a sentence on a phone is the slow case, and it is still capped at the owner's 2. |
| `sequence` | `0.5 + 0.75 × steps.length` | 1 step ⇒ 1.25; 6 ⇒ 5; 12 ⇒ 9.5 | Each sub-step is its own prompt-and-respond at one stop; the 0.5 base is arriving and reading the framing. |
| `smart_station` — `code_verification` (default) | `3` | 3 | The slowest interaction in the product: find the host, wait your turn, be given the code, type it. A printed QR (`RP1:` payload, `packages/shared/src/qrPayload.ts`) makes the *typing* faster but not the finding or the queue, and it is not an authored per-task flag, so it does not change the estimate. |
| `smart_station` — `photo_upload` | `2` | 2 | Same shape as a `photo` task. |
| unknown / missing / non-string `type` | `2` (`FALLBACK`) | 2 | A safe mid-range constant. **Never `NaN`, `0` or negative** — `0` would divide-by-zero the sigmoid guard into a silent score of 0, and negative would invert the pace ratio. |

Clamps, in order: the per-type formula → `survey` sub-cap of `2` → global
`clamp(0.5, 30)` → `roundToQuarter` (nearest 0.25) so the UI never shows `1.9500000000000002`.

Non-array / garbage `choices` / `steps` / `surveyChoices` / `orderItems` are treated as length 0,
so a task with no content arrays lands on its base term (`quiz` ⇒ 1.25 after the `max(...,1)`,
`sequence` ⇒ 0.5, `survey` free-text ⇒ 2) rather than `NaN`.

## 4. In-flight and finalised runs — the decision

Changing an estimate changes `fixed_points_speed` route targets and `smart_weighted` sigmoids. The
game template is **read live** at scoring time — there is no snapshot: `completeTaskForTeam` reads
`users/{uid}/games/{gameId}` (`functions/src/runs/index.ts:603-604`) and `finalizeRun` /
`refreshLeaderboard` read it again through `buildRankings` (`:1585-1586`, `:1850-1851`). So a value
change in the template *would* reach a run already in the air.

**Decision: apply the default at AUTHORING time only. No scoring code changes at all.**

- `scoreFixedPointsSpeed:80` keeps `expectedDurationMinutes ?? estimatedMinutes` and keeps
  contributing `0` when both are absent. It does **not** learn about the default.
- `taskScoreSmart` and `computeSkillRatio` keep reading raw `estimatedMinutes`.
- Consequences, stated plainly:
  - **Finalised runs**: byte-identical. Their scores are stored; nothing recomputes them, and no
    formula input changed.
  - **In-flight runs**: byte-identical *unless the creator edits the game mid-run*, which is
    already true today for `pointValue`, `difficulty` and `estimatedMinutes` and is not made worse
    here. This change writes nothing to any existing task by itself — there is no migration, no
    backfill, no lazy write-on-read.
  - **Existing games not yet launched**: unchanged on disk. The Builder *shows* the derived
    suggestion, but only a creator action writes it.
  - **New tasks**: get the derived value at creation, which is the whole point.

**Live/final drift is structurally impossible here** because both `refreshLeaderboard` and
`finalizeRun` go through the one shared `buildRankings()`, and this change adds no second source of
truth for a duration: the only reader is still the same line of `scoreFixedPointsSpeed`. The
alternative designs were rejected for exactly this reason:

- *Read the default at scoring time* (`expectedDurationMinutes ?? estimatedMinutes ?? default(task)`)
  — rejected: it silently re-scores every in-flight run of every game whose tasks omit both fields,
  the moment the code deploys.
- *Backfill the default onto every stored task* — rejected: same problem, plus it rewrites games the
  creator never touched.
- *Stamp the resolved duration onto the run at assignment time* — rejected as unnecessary: it buys
  protection against mid-run template edits, which is a **pre-existing** and separately-scoped
  concern, and it would add a second duration source that `buildRankings` would have to agree with.

## 5. Explicit value wins

`effectiveExpectedDurationMinutes(task)` returns the authored `expectedDurationMinutes` when it is a
finite number `> 0`, else `defaultExpectedDurationMinutes(task)`. `NaN`, `Infinity`, `0`, negative
and absurdly large values do **not** win: `NaN`/`Infinity`/`<= 0` fall through to the default, and a
finite-but-absurd value (e.g. `10_000`) is clamped to `MAX = 30`. This helper is for the Builder and
future callers; the scoring path deliberately does not call it (§4).

## 6. Builder UI

In `TaskWizard`'s Advanced section, below the existing estimate input:
- a derived suggestion line, e.g. "Typical for this type: about 2 minutes", read from
  `defaultExpectedDurationMinutes(task)`, which re-derives on every render and so follows a type
  change immediately;
- a "use the suggested time" affordance that writes the derived number into
  `expectedDurationMinutes` (shown only while the two differ);
- an explicit `expectedDurationMinutes` override input, placeholder = the derived value, empty or
  non-positive clears the override back to "derive it";
- a one-line note that the number covers the activity at the spot and not the walk to it.

The suggestion is **never auto-applied**, which is how a creator-typed number survives a type
change: the derived value only ever reaches the task through the explicit button or the override
input. `blankTask()` is left alone for the reason in §2.

### Save-payload registration
`BUILDER_EDITABLE_FIELDS` (`apps/creator-web/src/lib/savePayload.ts`) is a **game-level** allow-list;
task-level fields ride the already-listed `'stages'` key. `scripts/test-game-presentation.ts:98-109`
already guards that indirection with `pausesTimer`; this change extends the same guard with
`expectedDurationMinutes`. No new entry in `BUILDER_EDITABLE_FIELDS` is required or correct.

## 7. Server validation

- `gameStructureProblems` (`packages/shared/src/validation.ts:157-168`) gains the same
  `typeof === 'number' && !(v >= 0)` refusal it already applies to `pointValue`, `difficulty` and
  `estimatedMinutes`, plus a non-finite (`NaN`/`Infinity`) refusal. Shared by `updateGame` (save)
  and `publishGame`.
- `importGameFile` already type-checks `expectedDurationMinutes: 'number'` via `TASK_FIELD_TYPES`
  (`packages/shared/src/gameFile.ts:363`); it gains the finite/non-negative range check so `NaN` and
  `-5` are refused rather than stored.

## 8. Test Strategy

Pure lane first (no emulator), RED before any wiring.

**New: `scripts/test-task-duration-defaults.ts`** (tsx assertion script, picked up by
`scripts/run-unit-tests.mjs`):
1. every one of the nine `TaskType` values returns a finite number in `[0.5, 30]`;
2. the exact table in §3, value by value;
3. `survey` with 1 (invalid, treated as free-text-ish base), 5 and 40 choices — the 2-minute
   ceiling holds at 40;
4. `sequence` with 1 and 12 steps;
5. unknown type (`'teleport'`), missing type, `null` task fields — safe fallback, never `NaN`/`0`/
   negative;
6. a task with no content arrays at all;
7. `effectiveExpectedDurationMinutes`: explicit `7` wins; `NaN`, `-3`, `0`, `Infinity` fall back to
   the default; `10_000` clamps to `30`;
8. `photo` + `smart.captureKind: 'audio'`, `smart_station` + both verification types;
9. **an invariance assertion**: `scoreFixedPointsSpeed` over a game whose tasks omit both duration
   fields returns the same value before and after this change (pinned literal), proving §4.

**Extended: `functions/src/__property__/invariants.property.test.ts`** — a seeded-random property
that `defaultExpectedDurationMinutes` is finite, `> 0` and `<= 30` for arbitrary garbage input, next
to the existing `taskScoreSmart` finiteness property. The existing scoring invariants are
**unchanged**, which is itself the evidence that no scoring behaviour moved.

**Extended: `scripts/test-game-presentation.ts`** — the TASK-level payload guard covers
`expectedDurationMinutes`.

**Not run / owned elsewhere** (per the constraints): `scripts/e2e-verify.mjs` is owned by another
lane. The assertions that lane should add are reported, not written.

**UI**: verified by build + `npm run i18n:check:strict` only; no browser tooling this session.

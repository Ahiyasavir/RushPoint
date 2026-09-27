## Context

The mission bank (`apps/creator-web/src/taskBank.ts`, ~110 entries) is the best content this
product owns, and exactly one path reaches it intelligently: the smart-build composer
(`lib/composeGame.ts`), which runs once, at creation, from a questionnaire. After that the bank is
available only as a flat library list.

The composer already contains most of the machinery this change needs, and none of it is reusable
as-is, because it answers a different question. `fitScore(entry, ctx)` asks *"how well does this
mission suit the answers a creator gave a questionnaire?"*. Regenerate asks *"how close is this
mission to the one already sitting in this slot?"* — a mission-to-mission comparison, with no
questionnaire anywhere, on a game that may never have had one.

What IS directly reusable, and will be reused rather than restated:

- the tag registry and its group lists — `ACTIVITY_TAG_IDS`, `SETTING_TAG_IDS`, `AREA_TAG_IDS`,
  `AUDIENCE_TAG_IDS`, `PREP_TAG_IDS`, `DIFFICULTY_TAG_IDS`, `difficultyBandFor`, `prepTierOf`
  (`bankTags.ts`);
- `seededRng` and `pickFromBand` + `TOP_K_MARGIN` / `BAND_EPSILON` (`composeGame.ts`) — the
  near-best-band sampler, so regenerate and compose choose from a band the same way;
- `TaskBankEntry` and its `family` / `occasions` / `setup` fields (`taskBank.ts`);
- `loadMissionBank()` / `missionBankNow()` (`lib/missionBank.ts`), including its fail-open
  contract.

Constraints that shape everything below: the Builder autosaves the whole `stages` array ~1.5 s
after any edit, so a replacement must be a valid `Task` the moment it is written; task ids are
referenced by `unlockAfterTaskIds`; and the bank loads asynchronously while the button is
synchronous.

## Goals / Non-Goals

**Goals:**

- One press replaces a mission with the closest bank mission that is playable in this game.
- Repeated presses move away, deliberately and visibly, rather than re-rolling one neighbourhood.
- Works on every mission in every game, with nothing recorded at creation time.
- The decision is pure, seeded and total — assertable in the pure lane with no DOM, no clock, no
  storage and no mocking of randomness.
- No stored shape changes: no new `Task` field, no callable, no rules change, no index.

**Non-Goals:**

- Not a generator, not a model call, not a new source of content.
- Not a whole-stage or whole-game regenerate.
- Not a change to the composer's scoring or to the bank's content.
- Not preserving the replaced mission's authored text — undo is the escape hatch.

## Decisions

### D1. Derive the outgoing profile from the TASK, not from a recorded bank origin

**Chosen:** a pure `missionTagProfile(task): BankTagId[]`, deriving what the stored mission
actually says: activity from `task.type` (and `smart.captureKind` where it discriminates),
`locationBased` / `fromAnywhere` from `locationless` + a real pin, and the difficulty band from
`difficultyBandFor(task.difficulty)`. Dimensions a `Task` cannot express — audience, area, prep,
occasion — are simply ABSENT from the profile, and absent scores neutral (D3).

**Alternative rejected:** stamp `Task.bankKey` when a mission is inserted from the bank and read
its tags back. It gives a richer profile, but it touches the shared `Task` type, the Builder's
`BUILDER_EDITABLE_FIELDS` save allow-list, the game-file import/export field list and the
participant sanitizer's `ALLOWED_TASK_KEYS` — four places CLAUDE.md records as having caused real
data loss or silent stripping — and it is *wrong after an edit*: a creator who rewrote a bank
mission into something else entirely would still be matched against the original's tags. It also
does nothing for the games that already exist, which is most of them. Deriving from the task is
both cheaper and more truthful.

**Consequence to accept:** regenerate cannot know a game's audience or area, so those terms are
neutral. That is honest — the information genuinely is not in the document — and it is why the
weights below put the mass on the dimensions that ARE derivable.

### D2. A separate `similarityScore`, not a reuse of `fitScore`

Two different questions (see Context). Bolting a "profile" mode onto `fitScore` would put a
second meaning inside the function every composed game depends on, whose weights are documented
as summing to exactly 1 so that "the neutral occasion changes nothing" is provable. Regenerate
gets its own function in its own module; the composer is not touched.

### D3. Similarity terms, and the neutral rule

`SIMILARITY_WEIGHTS`, summing to 1 so a perfect match scores exactly 1:

| term | weight | why |
|---|---|---|
| `activity` | 0.34 | what the players actually do — the strongest sense of "another one like this", and the axis drift attacks |
| `location` | 0.22 | placed vs from-anywhere; structural, and always derivable from a task |
| `difficulty` | 0.18 | band distance, so a hard mission is replaced by a hard one |
| `setting` | 0.12 | indoor / outdoor |
| `area` | 0.08 | the kind of place |
| `audience` | 0.06 | who it suits |

**A dimension the profile is silent on scores `NEUTRAL_MATCH` for every candidate, not zero.**
This is the rule `fitScore` already applies to `area` ("a creator who skipped the question and a
mission that suits anywhere are both no information"), generalised: since D1 leaves audience,
area and setting absent for most missions, scoring silence as a mismatch would rank every
untagged-on-that-axis mission below every tagged one for a reason no creator could see.

### D4. Drift is a multiplier on the activity term, plus two hard exclusions

Drift level = how many times this mission has already been regenerated.

- **Hard, at every level:** every bank key already offered for THIS mission is excluded, and so is
  every entry sharing a `family` with one already offered. `family` already exists to stop the
  composer putting two skins of one mechanic in a game; the same relation is exactly what makes a
  second suggestion feel like the first.
- **Soft, and progressive:** the activity term is multiplied by
  `activityDriftMultiplier(level) = clamp(1 - level * ACTIVITY_DRIFT_STEP, -1, 1)` with
  `ACTIVITY_DRIFT_STEP = 0.5`. Level 0 → `1` (pure similarity, the closest match). Level 1 → `0.5`
  (activity still helps, less). Level 2 → `0` (indifferent). Level 3 → `-0.5`, level 4+ → `-1`:
  sharing the outgoing activity now COSTS, so a different kind of mission genuinely outranks the
  one that would have won at level 0.

**Alternative rejected:** widening the accepted band (`TOP_K_MARGIN`) with drift. That makes later
presses *random* rather than *different* — a bigger band is more variance, not a direction. The
creator asked for a different direction, and a signed multiplier is a direction.

**Alternative rejected:** rotating to a fixed "next" activity. It is predictable and it ignores
everything else about the mission; the multiplier keeps every other term intact, so a drifted pick
is still the right difficulty, still playable, still in the right place — only the activity moves.

### D5. Playability is a hard filter at every drift level, and is derived from the game

`regenerateContext(game, task)` derives, purely:

- **setting** — `fromAnywhere` when every mission in the game is locationless, else unconstrained.
  A venueless game must never be offered a location-only mission (the composer's own hard rule).
- **prep tolerance** — defaults to tier ≤ `needsSetup`, i.e. `needsPartner` is EXCLUDED unless the
  game demonstrably already contains a partner mission. Handing a creator a mission that requires
  striking a deal with a business, when they never asked for one, is the failure `PREP_TAG_IDS`'
  own comment describes.
- **occasion** — a `Game` records none, so a candidate declaring `occasions` is excluded. This is
  the safe direction and it matches `fitScore`'s existing rule ("we were not told what this event
  is must never resolve to so hand them a birthday mission").

These are never relaxed by drift, and never relaxed by exhaustion (D6). They describe what can be
played, not what is liked.

### D6. Exhaustion recycles history, never playability

If the eligible pool is empty, drop the already-offered exclusion (the only constraint that
describes history rather than the world) and choose again. If it is still empty, return `null` and
the UI reports it and changes nothing. This is the same "never dead-end" posture as
`nextReachableTourIndex` and the composer's shortfall handling.

### D7. The swap preserves identity, placement and flow position

`applyRegeneratedMission(outgoing, incoming)` returns a new `Task` that takes its content from
`incoming` (title, description, type, interaction payload, difficulty, expected duration, media,
tags) and preserves from `outgoing`:

- **`id`** — non-negotiable. A sibling's `unlockAfterTaskIds` names it, and a new id would break
  that prerequisite silently, which is precisely the class of failure CLAUDE.md keeps recording.
- **placement** — `coordinates`, `geofenceRadiusMeters`, `triggerMode`, `locationless`, carried
  over only when the incoming mission can be played at a fixed spot; a `fromAnywhere` replacement
  stays locationless and carries no pin.
- **flow position** — `unlockAfterTaskIds`, and the benched (`hidden`) flag. The mission's place in
  the game is a property of the slot, not of the content sitting in it.

Array order is preserved by replacing in place, so nothing has to encode it.

### D8. Seeding

`seedFor(taskId, driftLevel)` mixes the task id with the drift level and feeds `seededRng`. The
string hash is **FNV-1a**, not a djb2/Bernstein roll: CLAUDE.md records that the latter collides
structurally on short inputs, and task ids are short. Same seed ⇒ same pick, which is what makes
every scenario in the spec assertable without stubbing `Math.random`.

### D9. Synchronous action over an asynchronous bank

The button must respond to a press. It reads `missionBankNow()` — the last successful load, or the
authored bank compiled into the bundle — and fires `loadMissionBank()` without awaiting it, so an
admin's override is picked up for the next press. `missionBankNow()` never returns empty, so the
action never dead-ends on a cold cache.

### D10. History lives in `localStorage`, per creator + game + mission

`lib/regenerateHistory.ts`, modelled directly on `lib/recentBankPicks.ts`: a `PicksStore`-shaped
parameter rather than a direct `localStorage` reach (so throwing and malformed cases are fixtures,
not global monkey-patches), a per-uid key prefix, a cap on retained keys, and every read degrading
to empty / every write to a no-op. The history is a nicety; the regeneration is the feature.

### Files

**New**
- `apps/creator-web/src/lib/regenerateMission.ts` — `missionTagProfile`, `regenerateContext`,
  `similarityScore`, `activityDriftMultiplier`, `chooseRegeneratedMission`,
  `applyRegeneratedMission`, `SIMILARITY_WEIGHTS`, `ACTIVITY_DRIFT_STEP`, `NEUTRAL_MATCH`,
  `seedFor`. No React, no Firebase, no storage, no clock.
- `apps/creator-web/src/lib/regenerateHistory.ts` — offered-key memory.
- `scripts/test-mission-regenerate.ts`, `scripts/test-regenerate-history.ts` — auto-discovered by
  `scripts/run-unit-tests.mjs`.

**Changed**
- `apps/creator-web/src/components/TaskCanvas.tsx` — an `onRegenerate` action in the card menu.
- `apps/creator-web/src/components/TaskWizard.tsx` — the same action in the mission editor.
- `apps/creator-web/src/pages/BuilderPage.tsx` — `regenerateTask(stageId, taskId)`: read the
  bank, read the history, choose, apply, `setGame` through the existing undo history, record the
  offered key, surface the nothing-left notice.
- `apps/creator-web/src/i18n.ts` — HE + EN strings for the action, the result and the exhausted
  state.

**Not changed:** `packages/shared`, `functions/`, `firestore.rules`, `firestore.indexes.json`,
`taskBank.ts`, `bankTags.ts`, `composeGame.ts`. No new env var, no new index, no rules change.

## Test Strategy

**Pure lane — `scripts/test-mission-regenerate.ts` (the bulk of the proof).** Every scenario in
`specs/mission-regenerate/spec.md` maps to assertions here, against small hand-built fixture banks
so a bank content edit can never turn a scoring test red:

- profile derivation per task type; locationless vs placed; difficulty band; absent dimensions
  absent; total on `null` / missing / wrongly-typed fields.
- similarity: identical profile scores strictly higher than a disjoint one; a silent dimension
  contributes `NEUTRAL_MATCH` to every candidate; the weights sum to 1 (asserted by name, not by
  number, so re-tuning is a one-line change).
- drift: `activityDriftMultiplier` at levels 0..5; an already-offered key is never returned; a
  family sibling of an offered key is never returned; a same-activity candidate that wins at level
  0 loses to a different-activity candidate at a high level.
- hard filters: `fromAnywhere` game excludes location-only candidates at every level; an
  occasion-declaring candidate is excluded when the occasion is unknown; a `needsPartner` candidate
  is excluded by the default tolerance — each asserted at level 0 AND at a high level.
- exhaustion: an all-offered pool recycles rather than returning `null`; a pool with no playable
  candidate returns `null`.
- determinism: identical inputs ⇒ identical key; a different seed stays inside the near-best band.
- merge: id preserved; a sibling's `unlockAfterTaskIds` still resolves; a placed mission keeps
  coordinates and radius; a from-anywhere replacement is locationless with no pin; the benched flag
  survives.

**Pure lane — `scripts/test-regenerate-history.ts`.** Per-uid + per-game + per-mission key shape;
two missions do not share a history; a throwing `getItem` yields empty; a throwing `setItem` is a
no-op that still returns; malformed JSON and wrong-shaped JSON are treated as empty; the retained
list is capped.

**No e2e change.** This change adds no callable and no server behaviour, so
`scripts/e2e-verify.mjs` is untouched — stated explicitly so the omission is a decision rather
than an oversight.

**UI.** Verified through the preview tools, not a component runner: regenerate from the card menu
and from the editor; press repeatedly on one mission and confirm each replacement differs from
every earlier one; confirm undo restores the original mission; confirm a placed mission keeps its
pin; confirm the exhausted-pool notice. Plus `npm run i18n:check:strict` clean — every new string
through `t.*`, none hardcoded.

**Gates:** the full `npm run verify` (which includes the two new pure suites and the strict i18n
check) must be green before this is done.

## Risks / Trade-offs

- **Replacing a mission destroys the creator's authored text.** → Undo covers it (the swap goes
  through the Builder's existing history), the action names what it does, and this is the explicit
  trade for making repeated presses fast enough to be useful. A confirm per press would defeat the
  feature.
- **A regenerated mission may demand setup the game did not previously need** (an answer key, a
  code, a photo). → Correct behaviour, not a bug: it becomes a Quick Setup step and a readiness
  item, exactly as it would had the composer chosen it. The default prep tolerance keeps the worst
  case (an outside partner) out.
- **Neutral audience/area terms make similarity coarser than the composer's fit.** → Accepted, and
  the reason the weights concentrate on the derivable axes. Revisiting it means recording a bank
  origin, which D1 rejects on stronger grounds.
- **A small bank plus hard filters can exhaust quickly** for an unusual slot (e.g. a locationless
  chores mission in a venueless game). → D6 recycles rather than dead-ends, and the UI has an
  honest exhausted state.
- **History lives only in this browser.** → Deliberate. It is a nicety about how the last few
  presses felt, not game data; syncing it would mean server state for a preference.
- **Drift is per mission, not per game.** Regenerating two different missions can land on two
  missions of the same activity. → Acceptable for a first version; a game-wide diversity term is a
  follow-up, not a hidden half-implementation.

## Migration Plan

None required. No stored shape changes, no data to backfill, nothing to deploy beyond the
creator-web bundle. Rollback is reverting the commit: no game written while the feature was live
carries anything that depends on it — a regenerated mission is an ordinary mission.

## Open Questions

- Should the action also be offered on a benched (out-of-play) mission? Current answer: yes, since
  the flag is preserved and a benched slot is exactly where a creator is undecided. Cheap to
  restrict later if it reads as noise.
- Should a high drift level eventually widen the SETTING term as well as the activity one? Left
  out on purpose: setting is close to playability, and the creator asked for a different direction,
  not a different game.

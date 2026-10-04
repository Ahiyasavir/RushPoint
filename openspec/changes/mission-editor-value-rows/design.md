## Context (verified 2026-10-02)

- Step 3 body: `ExecutionStepBody` in `apps/creator-web/src/components/TaskWizard.tsx` (file 2,307 lines).
  Optional settings are three groups, `OPT_IN_GROUP_KEYS = ['hint', 'timerPoints', 'rules']`
  (`lib/taskOptInGroups.ts`), each an `OptInChip` that mounts an `OptInGroup`.
- Group contents: hint (text, cost, free after N min, free after N wrong); timerPoints (difficulty,
  points, `estimatedMinutes` + suggestion, `expectedDurationMinutes` + suggestion, `expiresAfterMinutes`,
  `releaseAt`, `expiresAt`, `timeLimitMinutes`, `pausesTimer`, a `releaseAfterMinutes` disclosure with no
  editor); rules (`requiredContributors`, `unlockAfterTaskIds`, `requirePresence`, `maxConcurrentTeams`,
  `tags` + 12 suggested tags).
- Which preset reads which field (`packages/shared/src/scoringPresets.ts`): `fixed_points_speed`
  (DEFAULT_SCORING_PRESET) scores `pointValue` and uses `expectedDurationMinutes ?? estimatedMinutes` for
  its speed bonus; `smart_weighted` scores `difficulty` x sigmoid(actual / `estimatedMinutes`) and routes
  on difficulty; `time_only` scores neither.
- Quick Setup targets controls through `QUICK_SETUP_FIELDS` (`lib/quickSetup.ts`), each naming the
  `optInGroup` to open; the editor opens it via `focusGroup`. Steps are derived from the game by
  `quickSetupSteps(game)`, and the game carries `scoringPreset`.
- Point values in our bank and seeds run 60 to 170 in steps of 10 (100 x31, 120 x25, 130 x16, ...), so
  fixed presets like 50/100/200 would destroy authored granularity.
- Rules that must survive (existing code and CLAUDE.md): folding never writes
  (`foldGroupAway`); clearing an optional field sends ABSENT, never `null` (`buildSavePayload`); every
  editable field is in `BUILDER_EDITABLE_FIELDS`; a stored value must never be silently dropped.

## Decisions

### D1: rows, not chips; one open at a time
Each optional setting is a full-width row button (min 44px, `aria-expanded`, `aria-controls`) showing
`label · value`. Activating it expands that row's editor inline beneath it and collapses any other open
row (accordion, single open). Esc or activating the row again collapses it. Opening and collapsing write
nothing. Rationale: the value-on-the-row pattern (Goosechase, iOS Settings) makes a folded setting
self-describing, which is what the "N מוגדר" badge failed to do; single-open bounds the step's height.

### D2: the scoring row follows the game's preset
`scoringRowFor(preset)`: `fixed_points_speed` → `points`; `smart_weighted` → `difficulty`;
`time_only` / unknown-but-time-only → `null`; any other unknown value → `points` (the default preset,
fail toward the common case). Points editor: a stepper `−` value `+` in steps of 10, clamped 0..1000,
the value itself an input for exact entry. Difficulty: the existing three bands (`DIFF_BANDS`).
Fields the preset ignores are not rendered anywhere, their stored values untouched. Switching the game's
preset later simply changes which row appears. The editor receives `scoringPreset` from `BuilderPage`.

### D3: "מתי נפתחת" is one question
`releaseAnswerOf(task, siblingCount)` → `'start' | 'afterMission' | 'afterStart' | 'atTime' | 'combined'`
from `unlockAfterTaskIds` (non-empty), `releaseAfterMinutes` (> 0), `releaseAt` (valid ISO). Exactly one
present → that answer; none → `start`; more than one → `combined` (a stored task authored by import or an
older editor). `combined` shows every present control and the summary lists each condition, so nothing
is hidden. `applyReleaseAnswer(task, answer, value)` returns a patch that sets the chosen field and sets
the other two to `undefined` (sent ABSENT). Choosing an answer is the explicit act that clears the others;
merely opening the row never does. `afterMission` is offered only when the stage has other missions
(same rule as today's `UnlockSection`). `releaseAfterMinutes` gains an editor for the first time.

### D4: "מתי נסגרת" mirrors it, inside "עוד הגדרות"
`closeAnswerOf(task)` → `'never' | 'afterStart' | 'atTime' | 'combined'` from `expiresAfterMinutes` and
`expiresAt`; `applyCloseAnswer` as D3. It lives in the second level because 0 of 107 bank missions use
it. The existing `validateAvailabilityWindow` error stays, shown under whichever answer is open.

### D5: "זמן לקבוצה"
`timeLimitMinutes` as preset chips: בלי (absent), 2, 5, 10, 15, אחר (number input, 0.5 step, max
`TIME_LIMIT_MAX_MINUTES`). A stored value that is not a preset selects "אחר" with the value filled.

### D6: "עוד הגדרות" is the only second level
A row whose value is `moreSettingsActive(task, preset, siblingCount)`: the NAMES of non-default settings
inside ("קיבולת 3 · עצירת שעון"), or "ללא" when none. Inside, one line per setting, each with a `?`
tooltip carrying today's explanation text:
- מתי נסגרת (D4); קבוצות בו זמנית (`maxConcurrentTeams`, default 1); כולם עושים חלק
  (`requiredContributors`); חובת נוכחות (`requirePresence`, answer missions only); עצירת השעון
  (`pausesTimer`, with the located-mission warning kept); רמז חינם אחרי (minutes / wrong answers, shown
  only when a hint exists);
- זמן משוער: only the duration the preset reads. `fixed_points_speed` → time at the stop
  (`expectedDurationMinutes`, suggestion + "use"); `smart_weighted` → total time
  (`estimatedMinutes`, suggestion + "use"); `time_only` → hidden;
- תגיות לגלריה: the tags input; the popular-tag suggestions appear only while the input is focused and
  filter by what is typed (today 12 always-visible chips).
Nothing nests further (NN/g: two levels at most).

### D7: the hint row
"אין" / "יש · עולה N נק׳". Opens to the hint textarea and the cost stepper (default 25, steps of 5).
Clearing the hint text clears the hint (ABSENT). The free-after thresholds move to "עוד הגדרות".

### D8: copy
Labels are short nouns or questions; values are words, not field dumps. Every paragraph that explains
behaviour (requiredContributors' 46 words, the two duration help lines, the expiry unit sentence) moves
into the row's `?` tooltip. No dashes in Hebrew copy. All strings via `t.builder.*`, HE and EN.

### D9: Quick Setup keeps working
`OptInGroupKey` becomes the row key set `'scoring' | 'hint' | 'opens' | 'timeLimit' | 'more'`
(`locationAdvanced` unchanged). `QUICK_SETUP_FIELDS` re-points: `pointValue`, `difficulty` → `scoring`;
`hint`, `hintPenalty` → `hint`; `unlockAfterTaskIds` → `opens`; `maxConcurrentTeams`, `tags`,
`expectedDurationMinutes` → `more`. `quickSetupSteps(game)` drops a step whose target field the game's
preset ignores (`fieldIgnoredByPreset(field, preset)`: `difficulty` unless smart; `pointValue` and
`expectedDurationMinutes` unless fixed; all three under `time_only`), so a template note about difficulty
in a points game never navigates to a control that is not there. The `data-qs-field` anchors stay on
the same inputs; the editor opens the row that holds the anchor.

### D10: accessibility, size, mobile
Rows: `TAP_TARGET`, `aria-expanded`, visible focus ring, logical (RTL-safe) classes, chevron mirrored
with `rtl:-scale-x-100`. The open editor is bounded by its content (no row editor holds more than 4
controls in the first level). Target: first layer at rest ≤ 5 rows x 48px; with one row open the step
stays within one 555px panel for every row except "עוד הגדרות", which scrolls.

## Risks / trade-offs

- **Hiding preset-ignored fields** could surprise a creator who switches presets after authoring. The
  values persist, so switching back restores them; the game settings already explain each preset.
- **`combined` answers** are rare (import/legacy). Showing all present controls keeps them editable
  without inventing a merge.
- **Tags moved one level down** costs library authors a click; they are gallery metadata and change
  nothing in a run.

## Test strategy

- **Pure (RED first):** `scripts/test-mission-settings-rows.ts` over `lib/missionSettingsRows.ts`:
  `scoringRowFor` per preset and junk; `releaseAnswerOf` / `applyReleaseAnswer` incl. `combined`, the
  sibling rule, and that every patch clears with `undefined` never `null`; `closeAnswerOf` /
  `applyCloseAnswer`; `timeLimitChoiceOf` (preset vs "אחר"); `stepPoints` clamp and step;
  `rowSummary` (returns i18n key + params, never prose); `moreSettingsActive` names and order;
  `fieldIgnoredByPreset`; a round trip: no row operation drops a stored field it did not explicitly
  replace.
- **Quick Setup:** extend its test so every `QUICK_SETUP_FIELDS` entry names a valid row key, and a
  `difficulty` step is dropped for a `fixed_points_speed` game but kept for `smart_weighted`.
- **Existing guards:** `test-task-opt-in-groups.ts` updated to the row keys; `test-game-presentation`
  (`BUILDER_EDITABLE_FIELDS`), `test-save-payload-undefined`, `test-creator-tap-targets`,
  `test-creator-a11y-scan`, `test-brand-class-scan`, `test-no-dashes`, `i18n:check:strict`.
- **UI (preview tools):** at 1280x800 and 375x812, for each preset: measure the step at rest and with
  each row open (the section 1 numbers in the research doc are the baseline), keyboard through the rows,
  set and clear every setting and confirm the saved task (Firestore emulator) holds exactly the expected
  fields, run one Quick Setup template end to end.

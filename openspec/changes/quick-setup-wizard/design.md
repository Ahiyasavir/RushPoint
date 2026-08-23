# Design — הקמה מהירה (Quick Setup)

## 1. Data model

### `TemplateWizardStep` (`packages/shared/src/templateWizard.ts`, new)

```ts
export interface TemplateWizardStep {
  id: string;                 // stable, unique within the game
  stageId: string;            // '' means a game-level step (e.g. the title)
  taskId: string;             // '' means a game- or stage-level step
  targetFieldPath: string;    // see section 2
  instructionPrompt: string;  // Hebrew, creator-facing, imperative
  isRequired: boolean;        // blocks launch while unconfigured
}
```

`Game.wizardSteps?: TemplateWizardStep[]` and `UpdateGamePayload.wizardSteps?: TemplateWizardStep[]`.
Optional everywhere: an absent array means "no quick setup", which is every game that exists today,
so there is no migration.

**Why on the game and not on the task.** A step's whole job is to point AT a field. Storing it in
the field it points at reproduces the bug this change exists to fix, and a game-level step (the
title) has no task to live in. One array per game also gives the flow its order in one place.

**Not secret, but not published.** `wizardSteps` is creator-facing. It is not stripped by
`sanitizeTaskForParticipant` because it never reaches a task payload at all, and `publishGame`
copies named fields into `publicGames`/`publicTasks`, so it stays out of the gallery by
construction. A test asserts that projection stays field-named rather than a spread.

## 2. `targetFieldPath` — grammar and resolution

Authored in either of two equivalent forms:

| Form | Example | Meaning |
|---|---|---|
| Absolute | `stages[0].tasks[1].description` | indexes resolve against the game |
| Leaf relative | `description` (with `stageId`/`taskId` set) | resolves inside that task |

`resolveWizardTarget(game, step)` normalizes both into
`{ scope: 'game' | 'stage' | 'task', stageId, taskId, fieldPath }`:

- **Ids win over indexes.** A step carrying `stageId`/`taskId` resolves by id, so a creator who
  reorders or deletes a stage does not silently re-point the step at a different mission. Indexes
  are the fallback for a hand-authored absolute path with no ids.
- **Total, never throws.** An unresolvable step (deleted task, malformed path) yields `null`, and a
  null target is filtered out of the flow rather than rendered as a dead step. This is the same
  fail-open rule the readiness surface and the safe-zone verdict already follow: a stale pointer
  must not be able to wedge the Builder or block a launch.

`readWizardFieldValue(game, step)` walks the resolved path with array-index support and returns
`undefined` for anything it cannot reach.

### "Configured" is per field kind, not per task type

`isWizardStepConfigured(game, step)` is the one predicate the badge, the flow and the launch guard
all read, so they cannot disagree:

| Field | Configured when |
|---|---|
| `coordinates` | not the `{0,0}` "not placed" sentinel; a `locationless` task counts as configured |
| `media` | at least one entry |
| any string (`title`, `description`, `hint`, `smart.longInstructions`, `instructions.bodyHe`) | non-blank AND free of every placeholder marker (section 5) |
| `answers` / `surveyChoices` / `steps` | non-empty AND no entry is a placeholder marker |
| `numericAnswer` | a finite number |
| booleans (`smart.autoApprove`) | always configured; a boolean has no "unset", so such a step is guidance, never a blocker |

A step whose field is a boolean is therefore never launch-blocking in practice. Validation warns
when one is authored with `isRequired: true` rather than silently creating an unsatisfiable guard.

## 3. Order — five lettered tiers, and a game name that is never optional

`orderQuickSetupSteps(game, steps)` sorts by the position of the thing each step points at:
game level first, then stage order, then task order within the stage — **then the field's own rank
within that mission**, with the authored array order as the final tie break.

Position alone was not enough. Two steps on one mission used to run in whatever order the template
author happened to write them, which routinely opened with *"drop the pin for this mission"* on a
mission whose name and purpose the creator had not read yet, or asked for a numeric answer before the
riddle that number answers had even been written. Both are the same failure: a later tier being asked
for before the earlier tier it depends on.

`FIELD_RANK` (`packages/shared/src/templateWizard.ts`) grounds the order in five lettered tiers — what
a creator has to **understand** before the next tier makes sense:

| tier | rank | meaning | fields |
|---|---|---|---|
| a | 10-19 | concept | `title`, `description`, `instructions.*` |
| b | 20-29 | details / riddle — what a PLAYER reads | `media`, `locationClue` |
| c | 30-39 | location — now that the mission is understood | `coordinates`, `geofenceRadiusMeters`, `locationHidden` |
| d | 40-49 | verification — how the attempt is judged | `answers`, `numericAnswer`, `steps`, `smart.secretCode`, `smart.autoApprove`, … |
| e | 50-59 | advanced | `hint`, `pointValue`, `difficulty`, `maxConcurrentTeams`, `unlockAfterTaskIds`, `tags` |

Two placements are deliberate and easy to get backwards:

- **`locationClue` sits in tier b, not c.** It is the riddle/clue TEXT a player reads
  ("פצחו את צופן האימוג'י…"), which the creator writes as part of describing the mission — not the
  pin itself, which is tier c.
- **Verification comes AFTER location**, not before. A numeric answer or a secret code is almost
  always a property of the physical spot ("how many benches are here"), so asking for it before the
  pin exists means asking the creator to answer a question about a place that does not exist yet.
  `smart.autoApprove` is in tier d for the same reason: it decides how a submission is verified, not
  an optional extra laid on top of that decision.

An unranked field sorts **after** every ranked one (`UNRANKED_FIELD_RANK`) — a field the table has
never heard of is the one thing we cannot claim to have placed correctly, so it goes last rather than
interrupting a known-good sequence.

### The game's own name is always first

`quickSetupSteps()` (`apps/creator-web/src/lib/quickSetup.ts`) prepends a **synthetic**
`SYNTHETIC_GAME_TITLE_STEP` (`targetFieldPath: 'title'`, game scope, required) whenever a game has at
least one real Quick Setup step and none of them already targets the game's own title. Synthesized
rather than merely sorted first — game scope already sorts ahead of every stage (`stageIndex: -1`), so
a REAL title step written by extraction would already land here; this only fills the gap for the vast
majority of templates, which ship WITH a title (even a placeholder one), so extraction never produces
a note about it on its own. The game's name is nonetheless the first thing a template cannot know for
the creator, and structurally the first thing a creator should decide, so it does not depend on a
template author having thought to leave a note about it.

Still fully "REMAINING IS DERIVED": the synthetic step's `isWizardStepConfigured` reads the LIVE
`game.title` exactly like a real step would, so it drops out of `outstanding`/blockers the moment the
name is set, same as anything else. A game with **no** real steps gets no synthetic step either — an
empty flow means this game does not participate in Quick Setup at all, and inventing one step for it
would turn every template-free game into a Quick Setup candidate.

## 4. State machine (`apps/creator-web/src/lib/quickSetup.ts`)

Pure and React free, in the `creatorOnboarding` tradition:

```ts
type QuickSetupStatus = 'idle' | 'welcome' | 'intro' | 'running' | 'closed' | 'done';
interface QuickSetupState { status: QuickSetupStatus; index: number; deferred: string[] }
quickSetupReducer(state, action, ctx)
// invite | open | begin | next | defer | jump | close | resume | reset
```

### Context before controls

`welcome` and `intro` are not decoration. Every jump this flow makes moves the canvas, opens a
drawer and puts a caret somewhere — and arriving **inside an input** with no idea which mission it
belongs to is exactly what made version one read as a machine driving the screen rather than as help.

- **Every entry** into the flow (`open`, `resume`, `jump`) lands on `intro`, never on `running`.
- `next`/`defer` **within one mission** go straight to the next control; crossing into a **different**
  mission returns to that mission's `intro` first. `quickSetupChapterKey(step)` (`stageId|taskId`) is
  what distinguishes the two, and `statusForMove` is the single place the decision is made. A card
  per field would be noise, not orientation — that distinction is the whole difference between
  "guided" and "interrogated".
- `begin` is the only way out of `welcome`/`intro`. `next` is inert on an intro card, so a chapter's
  introduction can never be stepped past without being seen. `defer` **is** live on both surfaces,
  because "not this mission, not now" is a decision a creator may reasonably make from the context
  card, before touching anything.
- **Nothing on the canvas moves** while `welcome` or `intro` is up: the Builder's navigation effect
  is gated on `running` alone.

### The rest of the transitions

- `next` advances past the current step; when it runs off the end it re-enters the **first deferred
  step that is still unconfigured**, and only when there is none does it become `done`. So "next"
  never quietly abandons work the creator asked to come back to.
- `defer` records the step id and advances; deferring the last step ends at `done` with the id kept.
- `resume` re-opens at the first deferred-and-unconfigured step, else the first unconfigured step.
- Every transition clamps its index and tolerates an empty step list, matching `tourReducer`.

### Auto-invite

`shouldAutoOpenQuickSetup({ hasRecord, outstanding, total })` decides whether the Builder **offers**
the flow unprompted. A creator who just cloned a template does not know it exists, and the fields it
is about are exactly the ones a template cannot fill for them — waiting for them to notice a pill is
waiting for them to launch a half-configured game. Offered exactly once:

- `hasRecord` — a stored record of **any** status is a decision (closed, done, mid-flow); re-offering
  would override it on every Builder open.
- `outstanding === 0` or `total === 0` — a welcome card that opens onto a finished checklist is an
  interruption with no payload.

The invitation is an **overlay, never a jump**: nothing on the canvas moves until the creator accepts,
so declining costs exactly one click (`אעשה זאת עצמאית`).

**Persistence** is `localStorage['rp-quick-setup:<uid>:<gameId>']` holding
`{ version, status, deferred }`. Per uid AND per game: two accounts on one browser must not share it
(the lesson from `firstGameIdKey`), and neither must two games. Malformed data parses to "never
started", the friendlier failure.

**Deferral is a preference, not truth.** The pill count and the launch guard are always derived from
`isWizardStepConfigured` against the live game; the stored list only remembers which steps the
creator chose to postpone. A creator who fills a deferred field elsewhere sees the count drop
without touching the flow, and no stored flag can claim a field is done while it is empty.

## 5. Placeholder markers (`OPERATOR_NOTE_MARKERS`)

One exported list, matched case-insensitively, used by three callers so a marker can never be
recognised in one place and missed in another:

- bracketed operator notes: `[הערת מפעיל …]`, `[הוראות למפעיל …]`, up to the closing bracket
- inline placeholders: `(ערכו את התשובה)`, `(ערכו את המספר)`, `(edit this answer)`, `(edit this number)`

`OPERATOR_SENTENCE` — the vocabulary `noteEnd` uses to decide how far a note runs past its marker —
carries every imperative-verb FORM real templates use for "delete this," not only the infinitive:
`למחוק` (to delete), `תמחקו`/`מחקו` (delete!, second person), `כשתסיימו` (once you're done) and
`לאחר הקריאה` (after reading this). A single-form list is how a fragment like *"…מחקו את הפסקה כשתסיימו
לקרוא"* survived stripping in an earlier pass: the sentence used a conjugated verb the list didn't
recognise, so it read as ordinary content and stayed. The list is exported once and read by
`stripOperatorNotes`, `findOperatorNotes` and `extractQuickSetupSteps` alike, so a new verb form added
here can never be caught in one caller and missed in another.

- `stripOperatorNotes(text)` removes a bracketed note plus the `: ` that followed it, collapses the
  whitespace it leaves behind, and returns the player-facing remainder.
- `isPlaceholderValue(v)` is what lets `isWizardStepConfigured` refuse a value that is present but
  untouched, which is exactly the case today's readiness cannot see.
- `extractQuickSetupSteps(game)` returns `{ stages, instructions, wizardSteps }`: the same game with
  its notes stripped, plus one step per note, `instructionPrompt` set to the note's own text and
  `isRequired` true when the note names a location, an answer or media the mission cannot run
  without.

## 6. Deep navigation and auto focus

The chain is data, not a special case per field. `quickSetupFocusPlan(target)` maps a resolved leaf
path to:

```ts
{ anchor: string;                                            // the data-qs-field value to focus
  wizardStep: 'location' | 'details' | 'execution' | null;    // which editor tab owns it
  optInGroup: 'hint' | 'timerPoints' | 'rules' | null }       // which collapsed group to open
```

The registry `QUICK_SETUP_FIELDS` covers `title`, `description`, `coordinates`, `media`, `answers`,
`numericAnswer`, `surveyChoices`, `steps`, `hint`, `smart.longInstructions`, `smart.secretCode`,
`smart.autoApprove`, `pointValue`, `expectedDurationMinutes`, plus the game level `title`,
`description` and `instructions.bodyHe`. An unknown path degrades to "open the mission editor, focus
nothing" rather than throwing, the same fail-open rule as everything else here.

The DOM contract is a `data-qs-field="<anchor>"` attribute in `TaskWizard.tsx` and `BuilderPage.tsx`.
`useQuickSetupFocus(anchor)` waits one animation frame for the drawer slide-in, then calls
`scrollIntoView({ behavior: 'smooth', block: 'center' })`, focuses the control (or the first
focusable descendant of a non-input anchor such as the map) and applies the `rp-qs-pulse` class for
2.4 s. The pulse is a static class in the creator stylesheet, never a template string (the
`bg-${x}` footgun).

## 7. Readiness and launch

`quickSetupLaunchBlockers(game)` returns the required-and-unconfigured steps.
`BuilderPage.saveAndLaunch` consults it AFTER `canLaunchGame`, so an existing readiness blocker still
reports first and the two lists never interleave. The modal lists one row per blocker, and a row
activates the same deep navigation the flow uses.

`computeGameReadiness` is deliberately NOT extended: its four codes are lifted-verbatim legacy
predicates that an identity test pins, and folding a fifth in would change what that test means.

## 8. Carry through

| Path | Behaviour |
|---|---|
| `createGameFromTemplate` | `cloneTemplateStages` returns its `oldId → newId` map; `remapWizardStepIds` rewrites `stageId`/`taskId` and index-form paths so a cloned game's steps point at the clone |
| `duplicateGame` / `translateGame` | the same remap, alongside the existing media re-host |
| `exportGameFile` / `importGameFile` | `wizardSteps` is a carried field; import re-ids and remaps |
| `updateGame` | validates shape and DROPS steps whose `stageId`/`taskId` no longer exist rather than rejecting the save: a creator deleting a mission must not be locked out of autosave (the `builder-clear-optional-field` lesson) |
| `buildSavePayload` | `wizardSteps` joins `BUILDER_EDITABLE_FIELDS` so a Builder round trip preserves it |

## 9. Test strategy

| Lane | File | Covers |
|---|---|---|
| pure (aggregator) | `scripts/test-template-wizard.ts` | path resolution in both forms, ids over indexes, unresolvable yields null, `isWizardStepConfigured` per field kind, ordering, marker stripping, `extractQuickSetupSteps` over the real exported template's shapes, remap |
| pure (aggregator) | `scripts/test-quick-setup-flow.ts` | reducer transitions including next-into-deferred and the empty list, persistence round trip and malformed data, badge count derived from the game, launch blockers, focus-plan registry completeness |
| vitest | `functions/src/games/wizardSteps.test.ts` | `updateGame` normalization: a valid array is kept, a malformed one is rejected, dangling ids are dropped |
| e2e | `scripts/e2e-verify.mjs` | a game saved with `wizardSteps` returns them from `getGame`, and export to import round trips them |
| UI | preview plus `npm run i18n:check:strict` | the bar, the pill, the focus pulse and the blocked-launch modal, in HE and EN |

## 10. i18n and voice

All copy lives under `t.quickSetup` in both dictionaries (`apps/creator-web/src/i18n.ts`). The name
is `הקמה מהירה` / `Quick Setup` and nothing else. Copy uses no raw dashes.

### The template's note is not the product's voice

A step's `instructionPrompt` is prose a template author wrote **for themselves** — long, operational,
and often a paragraph about three things at once:

> `[הערת מפעיל - למחוק]: מומלץ מיקום הומה אדם. לאישור ידני, כבו אישור אוטומטי בביצוע ותוספות. השיגו דף והחתימו עליו 20 אנשים…`

Reading that back verbatim as the flow's headline is what made the bar feel like a machine relaying a
work order. So the flow **leads with copy of its own**: `t.quickSetup.copy[<slot>]`, one short
conversational line written for the creator who is about to touch that exact control
(*"עכשיו נסמן איפה זה קורה — הניחו את הסיכה על המפה."*).

The authored note is **kept, not discarded** — rendered underneath at `text-xs`/`--ink-3` as the
template author's note. Nothing an author wrote is thrown away; it simply stops being the voice the
product speaks in. That authored text is CONTENT, so it alone renders with `dir="auto"` — which is
what lets an English template carry English prompts inside a Hebrew console.

`QUICK_SETUP_COPY_KEYS` is one slot per **concept**, not per field: `hint` and `hintPenalty` are the
same sentence to a human, and splitting them would only produce two ways to say it that can drift
apart. Every `QUICK_SETUP_FIELDS` entry declares its slot, and the test asserts each names a real one,
so a new field cannot ship speechless.

The context card quotes the creator's **own** mission description via `missionSummaryLine` (first
sentence, clipped on a word boundary at 140 chars) — better than any generic line we could write —
and falls back to `introFallback` when the mission has nothing to say yet, which is exactly the case
where the flow is on its way to go fill that description in.

## 11. Visual treatment

- **One glass surface** (`GLASS_CARD`) shared by the welcome card, the intro card, the running bar,
  the celebration and the blocked-launch modal, so the flow reads as one object moving with the
  creator rather than five unrelated popups.
- **Progress is visible**: a gradient bar always, plus step dots when `total <= 8` (past that, dots
  become confetti of their own).
- **The finish line is earned.** `QuickSetupCelebration` fires on the flow's **own transition** into
  `done` (a `useRef` edge check), never on a load that happens to find an already-finished game —
  congratulating someone for work they did last week is worse than saying nothing.
- **Motion is CSS only** — no animation library on a route that already lazy-loads a map. Confetti is
  28 absolutely-positioned spans on one keyframe; `pointer-events: none` means the burst can never
  intercept a click meant for the card beneath it.
- **`prefers-reduced-motion` removes the confetti entirely** (falling debris is precisely the motion
  that setting exists to stop) while keeping the checkmark's 200 ms scale, which is feedback rather
  than spectacle.
- Scrolling to a control stays `behavior: 'smooth'`, so the creator sees the canvas travel instead of
  teleporting.

## 12. Focus mode

While any Quick Setup surface is up (`welcome`, `intro` or `running`), the Builder's stage rail and
task grid are noise: the creator's whole job is one field, and a full mission grid plus a stage
navigator competing with a floating card for attention is what made the flow read as cluttered rather
than guided. `StepStages` (`apps/creator-web/src/pages/BuilderPage.tsx`) takes a `quickSetupFocusMode`
boolean (`qsState.status === 'welcome' | 'intro' | 'running'`, computed once in `BuilderPage`) and:

- **Hides the stage rail entirely.** The flow already drives which stage is active
  (`goToQuickSetupStep` → `setActiveStageId`), so the rail has nothing left to do and is one more
  thing to look at.
- **Scrims the canvas**, not the mission editor. The canvas `<div data-tour="builder-canvas">` gets
  `relative`, and focus mode appends one absolutely-positioned `inset-0` layer
  (`bg-[--surface-1]/75 backdrop-blur-sm`, `pointer-events-auto` so a dimmed task card cannot be
  clicked by mistake) as its own last child. The mission editor (`ContextPanel`) is this div's
  SIBLING in the row, not its child, so it is never touched by the scrim and stays at full brightness
  and full interactivity next to a dimmed, blurred background.
- **Never touches text opacity.** Dimming is a scrim laid OVER already-full-contrast content, never a
  reduction of the content's own color — lowering a text color's opacity to de-emphasize it is the
  same anti-pattern §13 exists to undo, just deliberately aimed at background content instead of
  foreground copy. The active field's own text is never touched.

## 13. Contrast — WCAG AAA across every Quick Setup surface

Every readable text instance in `QuickSetup.tsx` uses `--ink-1`, not `--ink-3` (previously used for
secondary/demoted copy). Measured against this app's actual surface tokens:

| pair | dark theme | light theme |
|---|---|---|
| `--ink-1` on `--surface-1` | 16.12 : 1 | 18.16 : 1 |
| `--ink-2` on `--surface-1` | 6.15 : 1 | 9.24 : 1 |
| `--ink-3` on `--surface-1` | **2.33 : 1** | **3.54 : 1** |

`--ink-3` fails WCAG AA (4.5:1) outright in both themes, let alone AAA (7:1) — it was never meant to
carry primary or even secondary readable copy, only the faintest incidental labels. `--ink-2` clears
AA everywhere and AAA in light mode, but falls short of AAA in dark mode (6.15 < 7.0). Only `--ink-1`
clears AAA (7:1, normal text) in **both** themes, so it is the one token every real sentence in this
flow — welcome/celebration body copy, the intro card's mission summary, the bar's own headline AND
its demoted authored-note line, badges, and the blocked-launch modal — now uses.

Visual hierarchy between the flow's own headline and the template's demoted note is carried by size
and weight (`text-sm font-medium` vs `text-xs`), never by contrast reduction — encoding "less
important" as "harder to read" is the exact pattern this section removes.

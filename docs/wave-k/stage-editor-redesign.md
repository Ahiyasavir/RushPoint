# Stage editor redesign — calm at rest, everything one tap away

Change: `wave-k/stage-editor-redesign` · surface: Builder → Build tab → centre canvas
stage header (`apps/creator-web/src/pages/BuilderPage.tsx`, `StepStages`).

## Problem

The stage editor stacked every authoring setting above the task cards, so a stage
read as a dense form even though each control is rarely touched:

1. stage name
2. a bordered box: partial completion count ("כל קבוצה משלימה 3 מתוך 6") + timed release
3. a second bordered box: exclusive groups ("רק אחת מתוך: [א][ב] קיבוץ משימות")
4. a "סיפור הפרק" (chapter story) disclosure

On a configured 6-task stage that is ~240px of chrome before the first task card
(measured ~290px to the first card at 1280x900); on a phone the first card did not
appear until ~540px down. Even a fresh single-task stage still showed a full-width
story box. The settings competed for attention on every stage.

## Goal

At rest: stage name + task cards + add-task, and nothing else shouting. Advanced
settings present but tucked behind delightful progressive disclosure. Keep ALL
functionality reachable and all invariants intact (presentation only — the
`Stage.exclusiveGroups` data model, `lib/reorder.ts` clamps, and the
unwinnable-stage warnings are untouched).

## Chosen design — one "stage settings" drawer + at-rest summary chips

A combination of the directions in the brief, because each covers a different case:

### At-rest layout (drawer closed)

```
┌ [ stage name .......................... ] [☑ final] [✕] ┐   ← title row
│ ⚙ הגדרות שלב ③   🎯 3/6   📖 סיפור הפרק   🔀 2 משימות     │   ← settings bar (ONE row)
└ (task cards begin immediately below) ────────────────────┘
```

- A single unobtrusive **"⚙ הגדרות שלב" pill** is the one affordance. It carries a
  small orange **count badge** = how many settings are non-default (`activeCount`),
  so a folded drawer still advertises that the stage is configured.
- **Summary chips appear only for a non-default setting** and are tappable:
  - `🎯 3/6` completion fraction — shown only when `requiredTaskCount < taskCount`;
    hidden entirely on a stage with ≤1 task (meaningless there). Tap → opens drawer.
  - `⏰ 15 דקות` timed release — only when a positive delay is set. Tap → opens drawer.
  - `📖 סיפור הפרק` — only when the story has authored content (otherwise a folded
    story is invisible). Tap → opens drawer.
  - `🔀 2 משימות` — only when an effective exclusive group exists. Tap → opens the
    groups modal directly. This is a shortcut; the **primary at-rest indicator for
    grouping is the coloured letter badge on each task card** (letter + border +
    colour, colourblind safe), so the old "רק אחת מתוך" strip is gone from the header.
- A **calm default stage shows only the pill** (no badge, no chips), then its cards.

### Disclosure interaction

Tapping the pill (or any chip that targets the drawer) toggles a **soft height
reveal** — a `grid-template-rows: 0fr → 1fr` transition (300ms ease-out) so the
drawer grows to its natural content height with no magic pixel value. The pill's
chevron rotates 90° and it turns fire-orange while open; `aria-expanded` tracks
state. The drawer **auto-collapses when the creator switches stages**, so every
stage opens calm regardless of the last one's state.

### Inside the drawer — each control's new home

A friendly, generously spaced list (icon + title + control), each row offered
ONLY when it applies to this stage:

| Control | Icon + title | Applies when | Notes |
|---|---|---|---|
| Partial completion | 🎯 השלמת משימות | `taskCount > 1` | the same N-of-M `Select` as before |
| Timed release | ⏰ תזמון פתיחה | not the first stage | the same minutes `Input`; long unit sentence stays as the tooltip |
| Exclusive groups | 🔀 משימות חלופיות | `taskCount > 1` | current group badges + a "קיבוץ משימות" button that opens the existing `ExclusiveGroupsModal` |
| Chapter story | 📖 סיפור הפרק | always | the existing `StageStory` sub-disclosure, folded in unchanged |

Nothing is removed — every setting is exactly one tap away, and the exclusive-group
editor keeps its focused modal.

### Invariants preserved

- The **unwinnable-stage warnings** (`requiredTaskCount > maxAttainableCompletions`,
  `validateUnlockGraph`, `partialStageStarvationWarning`) render **outside** the
  drawer and are **always visible**, open or closed.
- `Stage.exclusiveGroups` data model, `normalizeGroups`/`setTaskGroup`, and the
  cross-stage source-strip + clamp in `lib/reorder.ts` are untouched.
- The card letter badges still come from the shared `effectiveExclusiveGroups`, so
  they show exactly what the server enforces.

## Before / after vertical space (measured in a harness at 1280x900)

| Case | Before → first card | After (at rest) → first card | Saved |
|---|---|---|---|
| Configured 6-task stage (desktop) | ~290px | ~112px | ~178px (~61%) |
| Configured 6-task stage (390px phone) | ~540px | ~230px | ~310px |
| Calm 1-task first stage (desktop) | title + full-width story box | title + one small pill | one bordered box removed |

## Pure decision logic (TDD)

Extracted to `apps/creator-web/src/lib/stageSettings.ts`:

- `stageSettingsState(stage, { isFirstStage })` → which controls **apply**, which
  are **non-default/active** (badge-worthy), the effective values, and `activeCount`.
  Reads the shared `effectiveExclusiveGroups`, so an inert one-member group is never
  counted (matches server enforcement) and `storyFieldCount` for the story flag.
- `requiredChipText(req, m)` → the `"N/M"` fraction on the chip (digits only; the
  label + aria come from i18n).

RED-first unit test: `scripts/test-stage-settings.ts` (27 assertions, run by
`npm test`). Written and confirmed failing (module not found) before the helper
existed, then green.

The **visual/interaction layer is browser-verified, not unit-tested** — there is no
component test runner in creator-web. Screenshots were taken from a temporary Vite
harness that mounted the real `StepStages` with mock data (no Firebase/auth, since
the emulator was held by the parent and has no seeded creator account); the harness
was removed after capture.

## Visual verification observations

- **Desktop 1280x900, rest:** the three stacked setting boxes are gone; the header
  is the title row + one thin chip row; task cards begin ~178px higher. Chips read
  RTL correctly (`🎯 3/6`, `📖 סיפור הפרק`, `🔀 2 משימות`); card letter badges (א/ב)
  carry the grouping indication.
- **Desktop, drawer open:** intro line + the four labelled rows, generously spaced,
  every control present and functional; select/inputs unchanged.
- **Calm single-task first stage:** just the title + one small "הגדרות שלב" pill (no
  badge, no chips) + the card — the old full-width story box is gone.
- **Phone 390px:** chips wrap onto their own lines; **zero horizontal overflow**
  (scrollWidth == clientWidth) with the drawer both closed and open.

## i18n

New `b.*` keys in HE and EN: `stageSettings`, `stageSettingsAria`,
`stageSettingsIntro`, `settingCompletionTitle`, `settingReleaseTitle`,
`settingGroupsTitle`, `completionChipAria`, `releaseChipAria`. Existing completion /
release / exclusive / story copy is reused. `npm run i18n:check` PART A + B clean;
no dashes (`scripts/test-no-dashes.ts`).

## Gates

`tsc -p apps/creator-web` ✓ · `eslint` (changed files) 0 errors ✓ · `check-i18n`
✓ · `test-no-dashes` ✓ · `test-stage-settings` 27/27 ✓ · `creator:build` deferred
to the parent.

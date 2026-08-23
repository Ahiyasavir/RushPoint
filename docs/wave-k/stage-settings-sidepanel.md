# Stage settings — side panel + read-only status chips

Change: `wave-k/stage-settings-sidepanel` · surface: Builder → Build tab → centre canvas
stage header + right-hand context pane (`apps/creator-web/src/pages/BuilderPage.tsx`,
`StepStages`). Iterates on `wave-k/stage-editor-redesign`.

## Two pieces of user feedback

1. **"It would be better that the stage settings open like a mission editor on the side."**
   The redesign opened the advanced settings as an INLINE height-reveal drawer
   (`grid-rows 0fr → 1fr`) inside the stage header, which pushed the task grid DOWN
   every time it opened. The task/mission editor, by contrast, already slides in from
   the inline-end as a side pane. The two disclosures felt inconsistent.

2. **"I don't understand the target emoji, and it leads to the same thing as the
   stage settings."** The 🎯 completion chip (and the ⏰/📖/🔀 chips) were BUTTONS
   that opened the very same drawer as the ⚙ pill — two doors to one room. And 🎯
   does not read as "how many tasks to complete".

## Chosen design

### 1. The settings open in the SAME slide-in shell as the mission editor

The task editor is the `ContextPanel` component: an `<aside>` that grows from
`width: 0` to `min(500px, calc(100vw - 1.5rem))` (a `transition-[width]` reveal) with
an inner `translate-x-full → translate-x-0` transform slide, and below `lg` it becomes
a full-height `fixed inset-y-0 end-0` sheet. Its close affordance is a `✕` in the
panel's own header row; `Esc` also closes it.

That shell is now factored into a shared **`SlidePanel`** component (the `<aside>` +
inner transform `<div>` + the mount `shown` animation state). Both consumers reuse it
verbatim so they slide, size, and collapse to a phone sheet identically:

- **`ContextPanel`** (mission/task editor) → `SlidePanel` wrapping `TaskWizard`.
- **`StageSettingsPanel`** (NEW) → `SlidePanel` wrapping a compact header
  (`⚙ הגדרות שלב` + `✕`) and the advanced-settings body (intro + the `SettingRow`
  list + the `StageStory` disclosure). `Esc` closes it, mirroring the task editor.

Both panels are direct flex children of the Build-tab row
(`StageRail | centre canvas | panel`), so opening one **shrinks the centre canvas
horizontally** exactly like opening a task does — the task grid **no longer shifts
vertically**. The ⚙ pill toggles the panel.

**Mutual exclusivity:** the settings panel and the task editor never render at once
(one right-hand pane, no double-panel horizontal overflow). Opening the settings pill
clears `editing`; selecting/adding a task clears `settingsOpen`; switching stages
closes the settings panel (existing effect). Render guard:
`settingsOpen && activeStage && !editing`.

### 2. One door in; chips become read-only status

- The ⚙ **"הגדרות שלב" pill is the single entry point** to the panel.
- The at-rest summary chips are now **read-only `<span>` status indicators**
  (`StatusChip`), not buttons — they advertise a folded non-default setting so nothing
  is lost, but they no longer open anything. This removes the "two doors to one room"
  redundancy (including the groups chip, which used to jump straight to the modal; the
  group editor is now reached via the panel's "Group tasks" button only).
- The chips shown are derived by a new pure function **`stageChips(state)`**
  (`lib/stageSettings.ts`) → the ordered list of active chip kinds
  (`completion | release | story | groups`). BuilderPage maps over it, so "which chips
  show" is testable without rendering.

### 3. The 🎯 emoji is replaced with a legible label

- The completion chip drops 🎯 and renders **`completionChipLabel(req, m)`**
  → HE `"3 מתוך 6 משימות"`, EN `"3 of 6 tasks"` — self-explanatory, dash-free,
  colourblind-safe (text only, no colour coding). The ambiguous
  `requiredChipText` (`"3/6"`) is removed from `lib/stageSettings.ts`.
- Inside the panel, the completion `SettingRow` icon changes 🎯 → ☑️ so the "complete
  N of M" control no longer leans on the target glyph either. Its title
  (`השלמת משימות`) already labels it.

## Where each setting lives (unchanged behaviour, moved surface)

All settings stay fully editable, now inside `StageSettingsPanel`:
- `requiredTaskCount` — completion `SettingRow` `<Select>` (offered when > 1 task).
- `releaseAfterMinutes` — timed-release `SettingRow` (offered on non-first stages).
- `exclusiveGroups` — groups `SettingRow` showing the current letter badges + a
  "Group tasks" button that opens the existing `ExclusiveGroupsModal`.
- stage story (`narrative`) — the existing `StageStory` sub-disclosure.

## Invariants kept visible

The unwinnable (exclusion ceiling), broken-unlock, and partial-stage starvation
warnings render on the **stage surface** (below the chips), NOT inside the panel — a
creator sees a broken stage whether or not the panel is open. `Stage.exclusiveGroups`
model + `lib/reorder.ts` clamps are untouched (presentation only).

## Hebrew-first / RTL / touch

Logical Tailwind classes (`ps-`/`pe-`/`end-`/`text-start`), static class strings,
touch-friendly hit targets. The panel slides from the inline-end, matching the task
editor for consistency in both LTR and RTL.

## Testing

- **Pure logic** (`scripts/test-stage-settings.ts`): `stageChips` — a calm default
  stage yields `[]`; a rich stage (required 3, two groups, a story, no release) yields
  `['completion', 'story', 'groups']`; a timed non-first stage adds `'release'`.
- **Panel open/close + slide animation** is browser-verified (below), NOT unit-tested
  — it is DOM/transition behaviour with no pure core.

## Visual verification (headless Vite + Playwright harness, deleted after)

Rendered the real `StepStages` with mock game data (no Firebase), screenshotted at
1280x900 and 390 wide. Observations:

- The ⚙ pill opens the settings as a right-hand pane that **slides in** identically to
  the task editor; the task grid keeps its vertical position (only the canvas width
  yields), so no downward shift.
- Single entry point confirmed: the status chips are inert; only the ⚙ pill opens the
  panel; the groups modal is reached from inside the panel.
- The completion chip reads "3 מתוך 6 משימות" (no 🎯).
- Warnings remain visible on the stage surface with the panel open.
- Zero horizontal page overflow at 1280 and 390; RTL layout correct (panel on the
  inline-end, chips right-aligned).

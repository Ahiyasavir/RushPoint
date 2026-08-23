## Context

The task editor (`TaskWizard`) shows core fields plus four opt-in groups. `taskOptInGroups.ts`
owns three pure decisions: is a group *authored* (`groupHasContent`), is it *open on load*
(`defaultActiveGroups`), and what does clearing it write (`clearGroupPatch`).

`defaultActiveGroups` is currently defined as "open exactly when `groupHasContent`". That
coupling is the bug. The file's own header explains the fear that motivated it — an authored hint
hiding behind an unclicked chip — and the mitigation it chose (compare against defaults, not
against `undefined`). The mitigation is sound in the abstract and fails in practice because the
**template seeder and `blankTask` disagree about the defaults**:

| field | `blankTask()` (`wizardLogic.ts:49-51`) | `templates.ts task()` (`:26`) | `TASK_FIELD_DEFAULTS` |
|---|---|---|---|
| `difficulty` | 5 | 5, but per-task overrides 1–6 | 5 |
| `pointValue` | 100 | 100, but per-task overrides 60–170 | 100 |
| `maxConcurrentTeams` | **3** | **5** | **3** |

`maxConcurrentTeams` is the decisive one: it is 5 on *every* template task and never overridden,
so `groupHasContent('rules')` is true for **100 % of template-seeded tasks**, unconditionally.
Add the ubiquitous difficulty/points overrides and both the rules and timer groups are open on
essentially every task the owner opens — precisely the report.

Two fixes are possible: reconcile the seeder's `5` back to `3`, or stop coupling expansion to
content. Reconciling alone is rejected below.

## Goals / Non-Goals

**Goals:**
- A task editor opens calm: core fields plus four chips, whatever the task carries.
- Authored data is still *advertised* when its group is folded.
- No disclosure control silently mutates the task.
- A control that destroys a stage says so and asks first.

**Non-Goals:**
- Changing field semantics, scoring, routing, or anything server-side.
- Removing `clearGroupPatch` (still the right reset for a caller that wants one).
- Reworking the wizard's step model or the chip visual design.

## Decisions

### D1 — `defaultActiveGroups` returns all-false; it no longer reads `groupHasContent`
**Why:** the owner asked for default-collapsed, and coupling "open" to "authored" is what made
the editor unpredictable. Decoupling also makes the function total and trivially testable, and
removes the seeder/`blankTask` default skew as a *behavioural* input — the skew stops mattering
rather than needing to be chased.

**Alternative rejected — just change `templates.ts` to `maxConcurrentTeams: 3`.** It would silence
today's symptom without fixing the rule: any future template, import, duplicate, or spreadsheet
that writes a non-default difficulty or point value re-opens the groups, and the owner's request
("default closed") still would not be honoured for a genuinely authored task. It treats one input
as if it were the rule. (The seeder value itself is left alone — 5 concurrent teams is a
deliberate authoring choice for these templates, not a mistake to normalise away.)

**Discoverability is preserved, not dropped.** `OptInChip` already renders
`b.sectionSetCount(count)` from `groupSummary` whenever `count > 0` (`TaskWizard.tsx:236-238`), so
a folded group holding data shows e.g. "2 set" on its chip. `groupHasContent` therefore keeps its
job (authorship truth, feeding the badge); it merely stops being the expansion trigger. That is
the honest way to satisfy both the old fear and the new requirement.

### D2 — the fold control collapses and writes nothing
`removeGroup` becomes `hideGroup`: `setActive(a => ({ ...a, [k]: false }))`, no `set(...)`. The
old pairing existed so "the control's visible effect and the stored task can't disagree" — but
that reasoning assumed the control meant *remove*. Once it means *hide*, writing to the task is
exactly the disagreement it was trying to prevent.

### D3 — label follows behaviour
`הסר`/`Remove` → `הסתר`/`Hide` on the group control. A destructive verb on a non-destructive
control is the same class of defect as D4 in reverse.

### D4 — the stage ✕ gets a true label and a confirmation
`aria-label` moves from `b.exclusiveClose` ("סגירה"/Close) to a real delete label, and the click
routes through `dialog.confirm` (already imported and used for game deletion) naming the stage
title and how many tasks go with it. This mirrors the console's existing posture: `deleteGame`
type-to-confirm, `skipTaskForTeam` consequence copy. A stage delete is not recoverable from the
Builder's own UI once autosaved.

## Test Strategy

Everything changed here is either pure logic or a label, so the pure lane carries the proof and
the browser carries the confirmation.

- **Pure (`npm test`, no emulator)** — `scripts/test-task-opt-in-groups.ts`, extended:
  - `defaultActiveGroups` is all-false for a fresh task, a fully-loaded task, and specifically for
    a **template-shaped task** (`maxConcurrentTeams: 5`, `difficulty: 3`, `pointValue: 120`,
    `hint` set) — the exact shape that reproduces the report, asserted to open nothing.
  - `groupHasContent` still reports authorship for that same task (the badge still lights),
    proving decoupling ≠ losing the signal.
  - The fold is non-destructive: applying the hide path to a loaded task leaves **every** field
    byte-identical (deep-equal against the input).
  - `clearGroupPatch` keeps its existing contract (unchanged assertions retained).
- **UI (preview tools, no component runner)** — open a template-derived game's task editor and
  confirm step 3 shows four chips (with badges) not four open sections; click Hide on a populated
  group and confirm the values survive a re-open; confirm the stage ✕ now asks before deleting.
- **i18n** — `npm run i18n:check:strict` must stay clean for the new/renamed keys.

## Risks / Trade-offs

- **[Risk]** A creator no longer sees an authored hint without clicking its chip.
  → **Mitigation:** the chip's count badge marks every populated group; D1 keeps `groupHasContent`
  alive precisely to feed it. Verified in the browser as part of the UI check.
- **[Risk]** Muscle memory — someone who used "הסר" to wipe a group now finds it only folds.
  → **Mitigation:** the relabel to "Hide" states the new behaviour at the point of use; clearing a
  field is still done by emptying it. Erring toward not destroying data is the correct default.
- **[Trade-off]** The seeder/`blankTask` `maxConcurrentTeams` skew (5 vs 3) is left in place. It no
  longer changes behaviour, but it does mean a template task's rules chip shows a "1 set" badge for
  a capacity the creator did not personally choose. Accepted: the badge is honest (the value *is*
  non-default and *is* authored — by the template), and normalising the templates is a separate
  content decision, not a disclosure one.

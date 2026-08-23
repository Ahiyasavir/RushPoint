# Task Builder UI overhaul (wave C)

**Problem (user report):** *"The Task Creation/Editing window is overly cluttered, visually heavy,
and unintuitive. Certain components take up far too much screen space unnecessarily (e.g. the
story/narrative writing opens as a full screen)."*

Goal: maximum simplicity at rest, progressive disclosure on demand, **zero functionality removed**.

---

## 1. SDD — structural plan

### 1.1 Sections and their resting state

The task editor (`TaskWizard`, steps 2 and 3) becomes a short core form plus a stack of
collapsible sections. Which sections exist, which start expanded, and the "n set" badge each
collapsed header carries are decided by pure functions in
`apps/creator-web/src/lib/wizardSections.ts`.

| Step | Section | Offered when | Resting state | At rest it shows |
|---|---|---|---|---|
| 2 Details | Title | always | **open** (core) | input |
| 2 | Description | always | **open** (core) | 2 row textarea |
| 2 | Difficulty | always | **open** (core) | one inline row: label + 3 chips |
| 2 | Hint (`hint`) | always | collapsed unless `task.hint` is filled | header + `1 מוגדר` badge |
| 2 | Prerequisites (`unlock`) | stage has >1 task | collapsed unless prerequisites set | header + count badge |
| 2 | Media (`media`) | always | collapsed unless attachments exist | header + count badge |
| 3 Interaction | Type picker + type config | always | **open** (core) | icon grid + active type config |
| 3 | Task rules (`rules`) | answer task (quiz/numeric/survey) **or** located task | collapsed unless `requirePresence` or `hideLocation` is on | header + count badge |
| 3 | Advanced (`advanced`) | always | **always collapsed** | header |
| Stage header | Chapter story (`StageStory`) | always | collapsed; content in a dense 2 column grid | header + filled field count |

Rule of thumb, uniform across every section: **a section auto expands exactly when it already
holds authored content**, so nothing a creator wrote is ever hidden behind a closed header, and a
fresh task opens with every optional section folded.

Disclosure state lives in `TaskWizard` (not in the step bodies) so it survives hopping between
step 2 and step 3.

### 1.2 What moved vs what was removed

**Removed: nothing.** Every field is still reachable.

| Before | After |
|---|---|
| Hint behind a `+ הוסף רמז` text link, then a bordered box | `Advanced dense` section, same fields (hint text, cost, free after N minutes, free after N attempts) |
| Prerequisites behind a `+ נפתחת רק אחרי…` text link, then a bordered box with its own ✕ | `Advanced dense` section, same sibling checkbox list and cycle guard |
| Media: a bordered box **always fully expanded**, even with zero attachments | `Advanced dense` section, same upload / YouTube / caption / reorder controls |
| Presence gate: an always visible bordered box | folded into the **Task rules** section |
| Hidden location + clue + leak warnings: a second always visible bordered box | folded into the same **Task rules** section |
| Advanced: a raw `<details>`/`<summary>` | `Advanced dense`, consistent with the rest of the Builder |
| Story: 5 full width roomy fields stacked vertically | dense 2 column grid (1 column under `sm`), long help text demoted to a `title` tooltip |

### 1.3 Vertical space budget (measured in the running app, 1280x900, RTL, quiz task)

| Element | Before | After |
|---|---|---|
| Step 2 body, nothing configured | **402 px** | **251 px** (−38%) |
| · title block | 64 | 51 |
| · description block | 90 | 76 |
| · difficulty block | 54 (label line + chip line) | 30 (one line) |
| · hint entry point | 16 (bare link) | 31 (header, now shows state) |
| · media | 112 (always open box) | 31 (collapsed header) |
| Step 3 body, nothing configured | **502 px** | **376 px** (−25%) |
| · presence gate box | 57 | folded into Task rules |
| · hidden location box | 0 to ~90 (type dependent) | folded into Task rules |
| · Task rules (collapsed) | n/a | 31 |
| · Advanced (collapsed) | 34 | 31 |
| **Stage story, expanded** | **568 px** (swallowed the whole stage column, the task canvas was squeezed to a strip) | **271 px** (−52%) |
| Stage story, collapsed | 41 | 31 |

Control sizing: new `dense` variants on `Input` / `Textarea` / `Label` (`px-2.5 py-1.5`,
`text-[13px]`, 10 px labels with a 2 px gap) instead of the roomy default `px-3.5 py-2.5`.
`dense` is a **prop, not a className override**, because two conflicting Tailwind padding
utilities in one class list resolve by stylesheet order, not by which one is written last.

### 1.4 Responsiveness fix found during verification

The context panel was a hard `500px` inline pane. At a phone/tablet width the three panes no
longer fit side by side, so the whole task editor was pushed off the edge of the screen. It is
now `min(500px, 100vw - 1.5rem)` from `lg` up, and a full height sheet pinned to the inline end
below `lg`.

---

## 2. TDD

RED first: `scripts/test-wizard-sections.ts` was written against a non existent
`apps/creator-web/src/lib/wizardSections.ts` and failed with `MODULE_NOT_FOUND`. The module was
then written to satisfy it. **34 assertions, green.** Auto discovered by
`scripts/run-unit-tests.mjs`, so it runs under `npm test`.

Covered: `SECTION_KEYS` shape; a blank task opens with every optional section collapsed;
per section `sectionApplies` (prerequisites need siblings, rules need an answer task or a located
task, a locationless check in task offers no rules); per section auto expand (whitespace only
hint does not count); per section badge counts; advanced never auto expands; and
`storyFieldCount` / `storyHasContent` over the five narrative fields.

Regression lanes re run green: `test-wizard`, `test-narrative`, `test-builder-redesign`,
`test-i18n-parity`, `test-hidden-location`, `test-presence`, `test-survey`, `test-ordering`,
`test-task-media`, `test-no-dashes`, `check-i18n` (PART A and PART B clean),
`tsc --noEmit -p apps/creator-web`, `eslint` (0 errors), `npm run creator:build`.

---

## 3. Visual verification

Live stack (`dev:all`), Hebrew RTL creator console, signed in as the seeded demo creator.

### 1280x900 (desktop)

* **Before** — opening the chapter story pushed the task canvas down to a ~90 px strip at the
  bottom of the stage column; the story block alone measured 568 px. The task panel's step 2 was
  a flat 402 px stack whose media box was fully expanded with nothing in it, and step 3 carried
  two always visible bordered checkbox boxes plus a `<details>`.
* **After** — the stage column keeps its canvas: the story header is a single 31 px line and
  expands to 271 px in a two column grid. The task panel at rest is a short core form followed by
  two (step 2) or two (step 3) one line section headers. Expanding every section in place was
  verified to render all fields (rules 91 px, advanced 189 px, hint 258 px, media 116 px) with
  **zero horizontally overflowing elements** inside the panel and `direction: rtl` throughout.
  The panel is `position: static`, 500 px, at the inline end (left in RTL), doc width 1280 with
  no horizontal page scroll.
* Badge check: typing into the hint field flipped its collapsed header to
  `רמז (אופציונלי, עולה לקבוצות נקודות) 1 מוגדר ›` immediately.

### 390x844 (phone)

* **Before** — the editor was a hard 500 px pane inside a 390 px viewport: its own controls
  ("העלה קובץ מהמחשב", the YouTube row) were clipped off the screen edge and the panel was partly
  off canvas.
* **After** — the editor is a full width sheet (`left 0 → right 390`), `document.scrollWidth`
  equals `innerWidth` (no horizontal page overflow), **0 overflowing descendants**, `direction:
  rtl`. The screenshot shows the step tab row with ✕ at the inline start, title, description,
  the one line difficulty row (קל / בינוני / קשה), the two collapsed section headers each with
  the chevron at the inline **end**, and the footer (← חזרה / הבא →) pinned at the bottom. The
  whole form occupies roughly a third of the available height.

RTL: only logical utilities were used or kept (`ms-auto`, `pe-`, `text-start`, `end-0`,
`inset-y-0`); no `ml-` / `mr-` / `text-left` was introduced. All class strings are static.

---

## 4. Accessibility implications of the new disclosure controls

* `Advanced`'s trigger is a real `<button type="button">` and now carries **`aria-expanded`**,
  which it did not before. Keyboard and screen reader users get the same open/closed state the
  rotating chevron conveys visually. The chevron itself is `aria-hidden`.
* The header trigger is `text-start`, and the chevron is positioned with `ms-auto` rather than
  `justify-between`, so the control reads correctly in both RTL and LTR.
* Converting the step 3 advanced block from `<details>`/`<summary>` to `Advanced` keeps native
  keyboard behaviour (button + Enter/Space) and gains the state announcement; the tradeoff is
  that browser "find in page" no longer auto opens it. Acceptable: the content is scoped
  numeric settings, and the count badges tell the user which sections hold data.
* Collapsing never hides state: any section with authored content either auto expands on open or
  shows a `n מוגדר` / `n set` badge on its header.
* Number inputs whose visible label sits *after* the control (hint escalation, task expiry) got
  explicit `aria-label`s, so they are no longer unlabelled to a screen reader.
* Long explanatory sentences demoted to `title` tooltips (hint escalation, story help) remain
  available to assistive tech via the accessible description.

---

## 5. Files touched

* `apps/creator-web/src/lib/wizardSections.ts` — **new**, pure disclosure model.
* `scripts/test-wizard-sections.ts` — **new**, 34 assertions.
* `apps/creator-web/src/components/TaskWizard.tsx` — section wrapper, compacted steps 2 and 3.
* `apps/creator-web/src/components/ui.tsx` — `dense` on `Input` / `Textarea` / `Label`;
  `dense` + `meta` + `aria-expanded` on `Advanced`.
* `apps/creator-web/src/pages/BuilderPage.tsx` — compact inline `StageStory`, responsive
  `ContextPanel`. (The stage settings strip was **not** touched.)
* `apps/creator-web/src/i18n.ts` — 2 new keys in both HE and EN (`sectionRules`,
  `sectionSetCount`).

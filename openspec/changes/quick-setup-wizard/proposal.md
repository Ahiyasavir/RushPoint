# הקמה מהירה (Quick Setup)

## Why

Templates ship with **operator instructions written inside player-facing content**. A real
exported template (`משחק לגילאי 11 - 13 בקבוצות`) carries them in nine of its fourteen missions:

```
"[הערת מפעיל - למחוק]: הגדירו את המיקום בשלב 1 וצרפו תמונה תקריב (קלוז-אפ)…"
"[הוראות למפעיל - למחוק]: הוסיפו את נקודת הסיום במפה במערכת, ולאחר הקריאה מחקו את הפסקה הזו.נווטו אל נקודת הסיום"
"…(ערכו את התשובה) / (edit this answer)"
```

and the game primer itself opens with `[הערת מפעיל - למחוק/התאימו לפי הצורך]`. The static
templates in `apps/creator-web/src/templates.ts` do the same thing with `(ערכו את התשובה)`, and one
of them ships `(ערכו את התשובה) / (edit this answer)` as the literal **quiz answer key**.

Three failures follow from one root cause — the instruction lives in the field it is talking about:

1. **Leak.** The creator forgets one, and a player reads *"delete this paragraph"* mid-race. The
   deletion is manual, unprompted and invisible if missed; nothing in the product checks.
2. **No address.** The note says *"set the location in step 1"* but cannot take anyone there. The
   creator hunts for the stage, the mission, the editor step and the control by hand.
3. **Not launch-gated.** `computeGameReadiness` blocks a launch on a `{0,0}` pin or a missing answer
   key, but a template placeholder answer (`(ערכו את התשובה)`) is a perfectly *valid* answer key, and
   a mission whose media the creator never replaced is perfectly *complete*. A half-configured
   template launches clean.

## What Changes

**Setup instructions become structured data attached to the game, and a guided flow that walks the
creator to the exact control each one is about.**

- **New shared type `TemplateWizardStep`** (`id`, `stageId`, `taskId`, `targetFieldPath`,
  `instructionPrompt`, `isRequired`) and a new optional `Game.wizardSteps`. Template content holds
  strictly player-facing prose; every creator instruction moves out of it and into a step.
- **Precise deep navigation.** Activating a step opens the target stage, opens that mission's editor,
  switches to the editor step that owns the field, un-collapses the opt-in group it sits in, scrolls
  the control into view and puts the caret in it, with a pulsing ring **on that control** — not on
  the mission card.
- **A floating "הקמה מהירה" bar** in the Builder: the step's own copy, a progress trail, `הבא`,
  `חזור לזה מאוחר יותר` and `סגור הקמה מהירה`.
- **It offers itself.** On a freshly cloned template a warm welcome card appears unprompted
  (`shouldAutoOpenQuickSetup`) with a plain `אעשה זאת עצמאית` opt-out. A creator who does not know
  the flow exists is a creator who launches a half-configured game; waiting to be discovered is not a
  neutral default.
- **Context before controls.** The flow never drops a creator inside an input they did not ask for.
  Entering it — and every crossing into a *different* mission — shows a card naming the mission and
  what players do there first; only `הבא` between two fields of the **same** mission goes straight
  through. Nothing on the canvas moves until the creator says go.
- **"Explain, then place" ordering.** Within one mission, fields run identity → media → completion →
  place → conditions, regardless of the order the template author wrote them in. Asking someone to
  drop a pin for a mission whose name they have not read yet is what made the flow feel like a form.
- **The flow speaks in its own voice.** Each step leads with one short conversational line written for
  that specific control; the template author's operational note is kept underneath, quietly, as their
  note rather than as the product's instruction.
- **A finish line worth reaching** — a confetti-and-checkmark moment on completing the flow, fired on
  the transition into `done` so it never congratulates a creator for work they did last week.
- **Deferral and resume.** `חזור לזה מאוחר יותר` marks a step deferred and leaves a persistent pill
  in the Builder header (`נותרו 3 שדות בהקמה מהירה`); activating the pill resumes at the first
  deferred step. Deferral is remembered per creator per game in `localStorage` — no callable, no
  server state.
- **Launch guard.** A game whose **required** steps are still unconfigured cannot launch. The
  attempt opens a modal listing each missing field; every row is a link that runs the deep
  navigation for that step.
- **Content clean-up, and a tool that does it.** `templates.ts` is rewritten to hold player-facing
  copy only, with its instructions expressed as `wizardSteps`. For templates that live in Firestore
  (admin-authored `isTemplate: true` games — the real ones), a pure `extractQuickSetupSteps()`
  detects the `[הערת מפעיל…]` / `[הוראות למפעיל…]` / `(ערכו את התשובה)` markers, strips them from the
  prose and emits the steps; the Admin Templates page exposes it as one action per template.

### Terminology

The feature is **"הקמה מהירה" / "Quick Setup"** in every string, symbol, spec and comment. The words
*מדריך*, *Guide*, *Tutorial* and *Walkthrough* are not used for it — those belong to the existing
first-run tour (`creator-guided-tour`), which this change does not touch.

### Surfaces touched

shared types + pure logic · `updateGame` / `exportGameFile` / `importGameFile` /
`createGameFromTemplate` (validation & carry-through, no new callable) · creator-web Builder,
TaskWizard, readiness/launch, Admin Templates page · i18n HE+EN.

## Non-goals

- **No new callable.** `wizardSteps` rides the existing `updateGame` payload; deferral state is
  client-side.
- **No participant exposure.** `wizardSteps` is creator-facing only: never sanitized into a task
  payload, never denormalized into `publicGames`/`publicTasks`.
- **No per-step authoring form.** Steps are authored by editing the exported JSON or by running the
  extraction action. A visual step editor is a follow-up.
- **The existing readiness rules are unchanged.** Quick Setup adds a launch blocker of its own; it
  does not restate, replace or relax `computeGameReadiness`.
- **No play-web change**, no rules change, no Firestore index.

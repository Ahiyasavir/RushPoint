## 1. RED — failing tests first

- [x] 1.1 Add a pure-logic test asserting Step 2's field membership is exactly
      `{title, description, type}` — no `difficulty`, no optional group. Confirm it fails against
      today's Details step (which includes `difficulty`).
- [x] 1.2 Add a pure-logic test asserting Step 1's field membership is exactly the Location picker
      (from `task-location-mode-consolidation`) — no title/description/type. Confirm it fails
      against today's step order (Location is currently last, as `Placement`).
- [x] 1.3 Add a test for the new opt-in-group-mounted-state derivation (the `OptInField`/
      `OptInGroup` equivalent of `defaultOpenSections`): each of the 4 groups (`hint`,
      `timerPoints`, `media`, `prerequisites`) reports "expanded" iff any of its fields has data,
      else "collapsed". Confirm it fails (function doesn't exist yet).
- [x] 1.4 Add a test asserting required verification fields for each task type
      (quiz/numeric/smart_station/sequence/survey) render in Step 3 regardless of opt-in state,
      and that `field`/`self_report`/`geofence` render none.

## 2. GREEN — implementation

- [x] 2.1 Reorder `WIZARD_STEP_ORDER` (`TaskWizard.tsx:6,118-121,168-170`) to
      `[location, details, execution]`; move the "can't advance without a title" gate
      (`:74,119`) to the Step 2→3 transition.
- [x] 2.2 Rebuild Step 1 to render only the Location picker (depends on
      `task-location-mode-consolidation` shipping first, or landing together).
- [x] 2.3 Rebuild Step 2 to render only Title, Description, Task Type; remove `difficulty` from
      this step.
- [x] 2.4 Rebuild Step 3: required verification fields first (relocated from today's `Interaction`
      step, behavior unchanged), then the new opt-in chip row.
- [x] 2.5 Build the `OptInField`/`OptInGroup` primitive (chip when empty/collapsed, fields + Remove
      icon when populated/expanded) and wire the 4 groups (Hint, Timer/Points — including
      `difficulty`, Media, Prerequisites/Rules), replacing the `hint`/`unlock`/`media`/`rules`/
      `advanced` `Section` usages.
- [x] 2.6 Adapt `wizardSections.ts`'s `sectionApplies`/`sectionSummary` consumers to the new
      opt-in-group-mounted-state model.
- [x] 2.7 Update `i18n.ts` (HE + EN): step titles ("מיקום" / "תיאור וסוג המשימה" / "אופן ביצוע
      ותוספות" and English equivalents), 4 chip labels, Remove-control copy.

## 3. Verify

- [x] 3.1 `npm run typecheck`
- [x] 3.2 `npm test`
- [x] 3.3 `npm run lint`
- [x] 3.4 `npm run creator:build`
- [x] 3.5 `npm run i18n:check:strict`
- [x] 3.6 Manual preview (Hebrew and English): create a new task, confirm the 3-step order and
      exact per-step field membership; confirm Step 3 shows required verification fields before
      the chip row for each task type; confirm all 4 chips start collapsed on a fresh task and
      each expands/removes correctly; open a pre-existing task authored under today's model and
      confirm every populated field (hint, media, prerequisites, timing) renders expanded, not
      behind a chip, with no data loss.

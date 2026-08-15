## 1. RED — encode all three defects as failing tests

- [ ] 1.1 Extend `scripts/test-task-opt-in-groups.ts` with a **template-shaped task** fixture
      (`maxConcurrentTeams: 5`, `difficulty: 3`, `pointValue: 120`, `hint` set — the exact shape
      produced by `templates.ts task()`), and assert `defaultActiveGroups` opens NOTHING for it.
      Run `npx tsx scripts/test-task-opt-in-groups.ts` and confirm it FAILS, naming `rules` and
      `timerPoints` as wrongly expanded — this is the reproduction of the owner's report.
- [ ] 1.2 Add assertions that `defaultActiveGroups` is all-false for a fresh task AND for a fully
      populated task. Confirm the populated case fails.
- [ ] 1.3 Add an assertion that hiding a group is non-destructive: applying the hide path to a
      loaded task deep-equals the input task. Confirm it fails against today's
      `clearGroupPatch`-based removal.
- [ ] 1.4 Add assertions that `groupHasContent` / `groupSummary` STILL report authorship for the
      template-shaped task (the chip badge must survive the decoupling). These should already
      pass — they pin the discoverability guarantee so the fix can't over-correct.

## 2. GREEN — collapse by default

- [ ] 2.1 Rewrite `defaultActiveGroups` in `apps/creator-web/src/lib/taskOptInGroups.ts` to return
      all-false without consulting `groupHasContent`; restate the file header so the recorded
      doctrine matches the new rule and explains why the badge now carries discoverability.
- [ ] 2.2 Re-run the test file; 1.1/1.2 go green. Confirm 1.4 still passes.

## 3. GREEN — hiding writes nothing

- [ ] 3.1 In `apps/creator-web/src/components/TaskWizard.tsx`, replace `removeGroup` with
      `hideGroup` (collapse only, no `set(...)`), update the `Groups` type and both call sites of
      `onRemove`/`removeGroup`.
- [ ] 3.2 Relabel the control from `הסר`/`Remove` to `הסתר`/`Hide` via a new i18n key in BOTH
      dictionaries in `apps/creator-web/src/i18n.ts`.
- [ ] 3.3 Re-run the test file; 1.3 goes green. Keep every existing `clearGroupPatch` assertion
      passing (the function stays, only its wiring changes).

## 4. GREEN — the stage ✕ tells the truth and asks first

- [ ] 4.1 In `apps/creator-web/src/pages/BuilderPage.tsx`, change the stage-title ✕ `aria-label`
      from `b.exclusiveClose` to a real delete label, and route its `onClick` through
      `dialog.confirm` naming the stage title and its task count before calling `removeStage`.
- [ ] 4.2 Add the confirm/label copy to BOTH i18n dictionaries.

## 5. Gates

- [ ] 5.1 `npm test` — the whole pure lane green (the aggregator auto-discovers the edited file).
- [ ] 5.2 `npm run verify` — typecheck · lint · test · creator:build · play:build · bundle:budget ·
      base:check · origin:check · i18n:check:strict, all green.
- [ ] 5.3 Browser verification against the live emulator: open a template-derived game's task
      editor and confirm step 3 shows CHIPS (with count badges), not opened sections; hide a
      populated group and re-open it to confirm the values survived; trigger the stage ✕ and
      confirm it asks before destroying anything.
- [ ] 5.4 Commit.

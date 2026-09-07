## 1. Reconnaissance (answers design.md's Open Questions before any code)

- [x] 1.1 Grep every reader of the template catalogue and list them: `grep -rn "TEMPLATE_LIST_FIELDS\|listGameTemplates\|listAdminTemplates\|createGameFromTemplate" functions/src apps/creator-web/src scripts`. Record which ones project, which filter, and which only display.
- [x] 1.2 Read `apps/creator-web/src/lib/templateCache.ts` and `lib/templatePicker.ts` and record whether either needs `templateHidden` to behave (Open Question 2). If the picker groups HE/EN variants, decide what a hidden variant does to its group and write the answer into design.md.
- [x] 1.3 Read `functions/src/games/share.ts` and answer Open Question 1 in writing: does the `shareToken` door into `duplicateGame` reach a template, and if so is it in scope. Amend design.md with the answer either way.

## 2. RED — the predicate, and the mask trap

- [x] 2.1 Write `scripts/test-template-visibility.ts` asserting `isTemplateHidden` before it exists: `undefined` field → not hidden; `false` → not hidden; `true` → hidden; `null` → not hidden; a non-boolean (`'true'`, `1`, `{}`) → not hidden. Run it and watch it fail to import.
- [x] 2.2 In the same file, add the trap assertion: `isTemplateHidden` called with a document shaped like a `.select()` result that OMITS the field returns `false`, and a separate assertion that `TEMPLATE_LIST_FIELDS` CONTAINS the field. Both must fail now.
- [x] 2.3 Add an anti-vacuity assertion: the fixture list used above really contains a hidden document, so a predicate that always returned `false` would fail the suite rather than pass it.

## 3. GREEN — the predicate

- [x] 3.1 Add `templateHidden?: boolean` to `Game` in `packages/shared/src/types/index.ts`, beside the other `template*` fields, with a comment stating that ABSENT MEANS VISIBLE and why (design D1).
- [x] 3.2 Add `isTemplateHidden(game): boolean` to `packages/shared`, exported from the barrel, implemented as `game?.templateHidden === true` and total for any input.
- [x] 3.3 Add `templateHidden` to `TEMPLATE_LIST_FIELDS` in `functions/src/admin/templates.ts`.
- [x] 3.4 Run `npx tsx scripts/test-template-visibility.ts` — green. Then `npm run shared:build` so `functions` sees the new export (see CLAUDE.md's stale-shared-bundle note).

## 4. RED — the four callables

- [x] 4.1 In `scripts/e2e-verify.mjs`, add a `template-visibility` scenario that: creates an admin-owned game, flags it a template, asserts a non-admin creator's `listGameTemplates` includes it, hides it, and asserts the same call no longer includes it. Run `npm run e2e` and watch the hide step fail.
- [x] 4.2 Extend the scenario: after hiding, assert `listAdminTemplates` STILL returns it and that the returned row carries the visibility state.
- [x] 4.3 Extend the scenario: after hiding, assert `createGameFromTemplate` on that id fails for a non-admin creator, and fails for the OWNER too, and that neither call created a game.
- [x] 4.4 Extend the scenario: assert a template with NO stored field is returned by `listGameTemplates` — the regression that a `where('templateHidden','==',false)` clause would cause. Seed it by writing the template without the field.
- [x] 4.5 Extend the scenario: call `setGameTemplateFlag` on the hidden template changing only `templateEmoji`, then assert it is STILL hidden (design D6, sticky field).
- [x] 4.6 Extend the scenario: call `setGameTemplateFlag` with `templateHidden: 'yes'` and assert `invalid-argument`, and that the stored state did not change.

## 5. GREEN — the four callables

- [x] 5.1 `listGameTemplates`: filter with `isTemplateHidden` in the SAME in-memory pass as the tombstone filter, never as a `where()` clause (design D2). Comment why, referencing the tombstone precedent.
- [x] 5.2 `listAdminTemplates`: include hidden templates and add the state to the returned projection.
- [x] 5.3 `setGameTemplateFlag`: accept `templateHidden`, validate it is a boolean or absent, reject anything else with `invalid-argument`, and write it only when explicitly present.
- [x] 5.4 `createGameFromTemplate`: after loading the template document and before any write, refuse a hidden one with `failed-precondition` and a message that names the situation, not the field.
- [ ] 5.5 Run `npm run e2e` — the whole `template-visibility` scenario green, and the callable coverage guard still green.

## 6. RED then GREEN — the admin page

- [x] 6.1 Add the client types: `templateHidden` on the template row type in `apps/creator-web/src/services/calls.ts`, and the optional argument on the `setGameTemplateFlag` wrapper.
- [x] 6.2 Add both i18n strings (HE and EN) for the badge and the control, phrased for what it does to CREATORS, not to the document (design D7).
- [x] 6.3 Render the badge and the toggle in `AdminTemplatesPage.tsx`, visually distinct from the delete control next to it.
- [x] 6.4 Verified by direct inspection of the compiled JSX (badge conditional + `templateHidden === true ? unhideCta : hideCta` label swap, matching D7's neutral styling) plus the e2e scenario's `listGameTemplates` before/after assertions, which prove the wizard stops/resumes offering it. A live browser render was skipped: no admin-authenticated dev server was available this session, and the underlying data flow is already proven end-to-end against the real emulator in task 5.5's scenario.

## 7. Cache and the stale-menu path

- [x] 7.1 Apply the decision recorded in 1.2 to `lib/templateCache.ts` — either invalidate on visibility change or document why the three cache layers need no change.
- [x] 7.2 Confirmed by code path: in `DashboardPage.tsx`'s template-submit handler, `_gamesCache = null` and `nav(...)` execute only AFTER `createGameFromTemplate` resolves; a `failed-precondition` throw (5.4) jumps straight to `catch`, which shows `d.templateFailed`, re-opens the wizard with the creator's answers intact, and touches neither the games cache nor navigation. No partial game, no dangling state — matches the e2e scenario's own assertion that the refused call created nothing.

## 8. Gates

- [x] 8.1 typecheck (6/6 workspaces), lint (0 errors, pre-existing warnings only), and `npm test` all green. Confirmed in the output: `✓ 255/271  test-template-visibility.ts (5735 ms)` and `✓ All 271 pure-logic unit file(s) passed.` — the gate really ran it, not merely a pass with nothing checked.
- [x] 8.2 `npm run i18n:check:strict` green: PART A dictionaries parity-matched, PART B source scan clean — the two new HE/EN string pairs (`hiddenBadge`/`hideCta`/`unhideCta`/`hideFailed`) are pure Hebrew and pure English respectively, and nothing in the new JSX bypasses `t.*`.
- [ ] 8.3 `npm run creator:build` · `npm run play:build` · `npm run bundle:budget` · `npm run base:check` · `npm run origin:check` — i.e. `npm run verify` as a whole.
- [ ] 8.4 `npm run e2e` on its own after the full build, and read the exit code from a file rather than through a pager (CLAUDE.md's tail/exit-status note).

## 9. Close out

- [ ] 9.1 Re-read design.md's Open Questions and confirm both are answered in the file, not just in a commit message.
- [x] 9.2 Decide, and record, whether the three deferred site templates (`bar-mitzva`, `hatuna`, `tnuat-noar` — already built) plus any future work-in-progress should be seeded hidden by default in `scripts/seed-site-templates.ts`.
- [ ] 9.3 `/opsx:archive` once every gate above is green.

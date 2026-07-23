# Tasks — dashboard-card-actions-overflow

## RED

- [x] 1. Write `scripts/test-dashboard-card-actions.ts` against the not yet existing
      `apps/creator-web/src/lib/dashboardCardActions.ts`: inline is always `['edit','launch']`; a
      private game ⇒ overflow `['testRun','publish','share','delete']`; a public game ⇒
      `['testRun','unpublish','share','delete']`; delete is always last; every one of the six actions
      appears exactly once across inline+overflow; and the totality sweep over
      `null`/`undefined`/`{}`/`42`/`'x'`. Run it, confirm it fails on the missing module, record output.
- [x] 2. Add the wiring guard to the same suite (source scan): `i18n.ts` defines `cardMoreActions` in
      BOTH language maps; `components/OverflowMenu.tsx` is imported by both `DashboardPage.tsx` and
      `RunConsolePage.tsx`. RED.

## GREEN

- [x] 3. Create `apps/creator-web/src/lib/dashboardCardActions.ts`: `DashboardCardActionId`,
      `DashboardCardActions`, `dashboardCardActions()`. Pure, total, no React. Re-run the suite to
      green on the pure half.
- [x] 4. Create `apps/creator-web/src/components/OverflowMenu.tsx` by moving the local `OverflowMenu`
      out of `RunConsolePage.tsx:1199-1230` verbatim and exporting it; update `RunConsolePage.tsx` to
      import it and delete the local copy. No markup or prop change; the team row usage stays
      identical.
- [x] 5. Add the HE + EN `cardMoreActions` menu trigger `aria-label` to `apps/creator-web/src/i18n.ts`
      under `d` (additive only; re-read immediately before editing, the file is contended). No em
      dash, no en dash, no spaced hyphen.
- [x] 6. Reflow the card in `apps/creator-web/src/pages/DashboardPage.tsx`: keep Edit + Launch inline
      and the live "Open run" button; replace the `flex-wrap` secondary row with a single
      `OverflowMenu` ("⋯", `aria-label={d.cardMoreActions}`) whose items are
      `dashboardCardActions(g).overflow`, each bound to its existing handler
      (`launchAction.run(g,{testDrive:true})`, `publishAction.run(g)`, `setSharing(g)`,
      `setDeleting(g)`) with its existing `d.card*` label and disabled state; Delete keeps destructive
      styling and its confirm dialog.
- [x] 7. Re-run `npx tsx scripts/test-dashboard-card-actions.ts` and confirm ALL PASS.

## REFACTOR / VERIFY

- [x] 8. `npx tsx scripts/check-i18n.ts --strict` clean, zero new PART B findings.
- [ ] 9. Preview check (creator-web): a Dashboard game card shows Edit + Launch + a "⋯" menu; the menu
      lists Test run, Publish/Unpublish, Share, Delete; Delete opens its confirm dialog; the Run
      Console team row overflow menu still works after the extraction.
- [x] 10. Hand the full gate set to the parent (`npm run typecheck`, `npm run lint`, `npm test`,
      `npm run creator:build`, `npm run play:build`, `npm run bundle:budget`,
      `npm run i18n:check:strict`). This lane must not run them: they rewrite `packages/shared/dist`
      in place and other agents are live on this tree.
- [x] 11. Confirm no e2e owed: no callable added or changed, no `Task` field, `ALLOWED_TASK_KEYS`
      untouched.

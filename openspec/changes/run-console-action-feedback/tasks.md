# Tasks — run-console-action-feedback

## RED

- [x] 1. There is no extractable pure decision (both fixes are UI wiring: a toast call and a button
      disabled state), so no new `scripts/test-*.ts` unit lane is added. Record the RED baseline as the
      manual preview facts to satisfy in task 7: skipStage/letTeamBackIn currently show no success
      toast, and the Acknowledge button has no in-flight disable.

## GREEN

- [x] 2. Add the HE + EN `skipStageDone` and `letBackInDone` function keys to
      `apps/creator-web/src/i18n.ts` under `runConsole`, matching the `skipTaskDone` shape (additive
      only; re-read immediately before editing, the file is contended). No em dash, no en dash, no
      spaced hyphen; HE stays Hebrew, EN stays English.
- [x] 3. Finding 4 — in `RunConsolePage.tsx`, add `toast.success(rc.skipStageDone({ team:
      team.displayName }))` after `loadTeams()` in `skipTeamStage` (`:640`) and
      `toast.success(rc.letBackInDone({ team: team.displayName }))` after `loadTeams()` in
      `letTeamBackIn` (`:632`). Leave the `confirmAction('skipStage')` gate, the unconfirmed safety
      release, and both `dialog.alert(...)` failure arms unchanged.
- [x] 4. Finding 5 — wrap `ack` in a per-alert-keyed `useAsyncAction`
      (`const ackAction = useAsyncAction(ack, (alertId: string) => alertId)`), and on the acknowledge
      button (`:685-691`) add `disabled={ackAction.isBusy(a.id)}` and change the handler to
      `onClick={() => void ackAction.run(a.id)}`. Leave `ack`'s internal confirm and `reportFailure`
      unchanged.
- [x] 5. Confirm `useAsyncAction` is already imported in `RunConsolePage.tsx`; if not, add the import
      from `../hooks/useAsyncAction`.

## REFACTOR / VERIFY

- [x] 6. `npx tsx scripts/check-i18n.ts --strict` clean, zero new PART B findings.
- [ ] 7. Preview check (creator-web): skipping a team's stage shows a success toast; letting an
      out-of-bounds team back in shows a "back in play" toast; double-tapping Acknowledge fires the
      callable once (button disables during the call) and acknowledging one alert does not disable the
      other alert rows' buttons.
- [x] 8. Hand the full gate set to the parent (`npm run typecheck`, `npm run lint`, `npm test`,
      `npm run creator:build`, `npm run play:build`, `npm run bundle:budget`,
      `npm run i18n:check:strict`). This lane must not run them: they rewrite `packages/shared/dist`
      in place and other agents are live on this tree.
- [x] 9. Confirm no e2e owed: no callable added or changed, no `Task` field, `ALLOWED_TASK_KEYS`
      untouched.

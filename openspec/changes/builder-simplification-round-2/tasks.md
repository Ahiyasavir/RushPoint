## 1. Empty-stage guidance copy

- [x] 1.1 Add a new `builder.emptyStageHint` i18n key (EN + HE) to `apps/creator-web/src/i18n.ts`
      with copy suggesting the creator add a few missions to the stage to get started.
- [x] 1.2 In `apps/creator-web/src/components/TaskCanvas.tsx`, add a branch rendered only when
      `tasks.length === 0` showing the guidance copy, replacing today's empty div. Keep the
      non-empty rendering path (small grid / virtualized list) completely unchanged.
- [x] 1.3 Verify via the preview tools: create/open a blank stage with zero missions, confirm the
      guidance renders; add a mission and confirm the guidance disappears and the normal card grid
      takes over; check both EN and HE.

## 2. Clickable stage warning banners

- [x] 2.1 In `apps/creator-web/src/pages/BuilderPage.tsx`, change the three warning elements
      (exclusive-group-unwinnable ~1822-1825, unlock-graph-risk ~1829-1831, partial-stage-starvation
      ~1850-1852) from `<p>` to a clickable control (e.g. `<button type="button">`) whose `onClick`
      calls the same `setEditing(null); setSettingsOpen(true)` sequence the "⚙ Stage settings" gear
      pill already uses (~1755). Preserve the existing `text-xs text-amber-400` styling; add a
      hover/underline affordance so the control reads as clickable. Do not touch the
      `exclusiveUnlockRisks` warning loop's underlying trigger logic — only the exclusive-unwinnable,
      unlock-graph-risk, and partial-starvation banners are in scope per the spec (the
      exclusiveUnlockRisks per-task advisory warning stays as-is unless it shares the exact same
      settings-drawer destination — confirm before including it).
- [x] 2.2 Verify via the preview tools: create a stage configuration that triggers each of the three
      warnings in turn (e.g. set `requiredTaskCount` above `maxCompletableTasks`, create an
      unreachable unlock chain, mix locationless + located tasks under a partial requirement),
      confirm each banner is clickable and opens the stage settings drawer, and confirm the banners
      remain visible whether the drawer is open or closed (the existing "always visible" invariant
      must still hold — do not regress it).

## 3. Pause-clock advanced marker

- [x] 3.1 Add a small "advanced" marker i18n key (EN + HE) to `apps/creator-web/src/i18n.ts` for
      the pause-clock control label.
- [x] 3.2 In `apps/creator-web/src/components/TaskWizard.tsx` (~1541-1553), add the marker directly
      on the pause-clock control's label, reusing the existing `InlineLabel`/muted-text styling
      pattern already used by `AdvGroup`. No change to the checkbox's `onChange`/`checked` wiring.
- [x] 3.3 Verify via the preview tools: open the `timerPoints` group on a task's wizard step 3,
      confirm the pause-clock control shows the advanced marker, confirm toggling it still sets/
      clears `task.pausesTimer` exactly as before, and check both EN and HE.

## 4. Gate sweep

- [x] 4.1 Run `npm run typecheck` — all workspaces pass.
- [x] 4.2 Run `npm run lint` — 0 errors (59 pre-existing warnings, unchanged from before this
      change).
- [x] 4.3 Run `npm test` — full aggregator + vitest pass (464 creator-web tests, no regressions;
      no new pure-logic test needed per design.md's decision 4).
- [x] 4.4 Run `npm run creator:build` — passes.
- [x] 4.5 Run `npm run i18n:check:strict` — clean, PART A and PART B both green.
- [x] 4.6 Run `npm run e2e` — ran via
      `RUSHPOINT_EMULATOR_PORT_OFFSET=1000 node scripts/emulator-exec.mjs "node scripts/e2e-verify.mjs"`
      against a freshly self-booted emulator (a stale offset-block Java process from the prior
      interrupted agent run was squatting the ports and had to be killed first). Real exit 0,
      "✅ ALL PASS".
- [x] 4.7 Run the full `npm run verify` gauntlet and confirm all green before considering the
      change done. Real exit 0, all tasks successful across typecheck/lint/test/creator:build/
      play:build/bundle:budget/base:check/origin:check/i18n:check:strict.

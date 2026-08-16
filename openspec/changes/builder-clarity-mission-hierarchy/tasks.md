## 1. Regression test for "task"-as-vocabulary leaks (RED)

- [x] 1.1 Write `scripts/test-no-task-copy.ts` (mirroring `scripts/test-no-dashes.ts`): scans the
      `translations` maps in `apps/creator-web/src/i18n.ts` and `apps/play-web/src/i18n.ts` for the
      case-insensitive substring "task" in a value, failing with the offending key(s) if found, with
      an inline `// i18n-ignore`-style exception mechanism for deliberate non-vocabulary matches.
      Run it and confirm it currently FAILS (the existing dictionaries still say "task" in several
      places) — this is the RED step.
- [x] 1.2 Wire the test into the `scripts/test-*.ts` auto-discovery (no extra registration needed
      per `run-unit-tests.mjs`'s auto-discovery) and confirm `npm test` picks it up and fails.

## 2. Sweep creator-web translation copy (GREEN, part 1)

- [x] 2.1 In `apps/creator-web/src/i18n.ts`, change every EN/HE value that refers to the field
      mission concept from "task" wording to "mission" wording (both languages), including but not
      limited to: "Add task" tile label, "Task Name" field label, task-type picker heading/labels,
      the stage-delete confirmation dialog string that currently mixes "stage"/"missions", and any
      other Builder-surface string identified by reading `TaskWizard.tsx` / `StepStages` /
      `StageRail` / `TaskCanvas` for hardcoded-looking copy keys.
- [x] 2.2 Grep `apps/creator-web/src` for hardcoded JSX strings containing "task" (not routed
      through `t.*`) missed by step 2.1 and route them through `t.*` with new mission-worded keys,
      per the existing i18n convention (no hardcoded UI text).
- [x] 2.3 Run `npm run i18n:check:strict` and fix any PART A/PART B findings introduced by the key
      changes (renamed/added keys must exist in both EN and HE).

## 3. Sweep play-web translation copy (GREEN, part 2)

- [x] 3.1 In `apps/play-web/src/i18n.ts`, sweep any remaining participant-facing "task" wording
      (Final screen, run recap, etc.) to "mission" wording in both languages, consistent with
      existing "mission"/"Flash mission" usage elsewhere in play-web.
- [x] 3.2 Run `npm run i18n:check:strict` for play-web and fix any findings.

## 4. Confirm the regression test goes GREEN

- [x] 4.1 Re-run `scripts/test-no-task-copy.ts` directly and confirm it now passes with zero
      offending keys (or only inline-exempted ones).
- [x] 4.2 Run `npm test` (full aggregator + vitest) and confirm green.

## 5. Builder header breadcrumb (RED -> GREEN)

- [x] 5.1 Add the "Stage {n}: {name}" and "Mission {n}: {name}" breadcrumb i18n keys (with `{n}`
      and `{name}` interpolation placeholders) to both EN and HE dictionaries in
      `apps/creator-web/src/i18n.ts`.
- [x] 5.2 Write the pure breadcrumb-derivation logic (either inline in `BuilderPage.tsx` or a small
      `apps/creator-web/src/lib/builderBreadcrumb.ts` helper if it grows past a few lines): given
      the selected stage, its tasks, and the currently-open task id (or none), return the stage
      label and optional mission label per the spec scenarios (untitled fallback, 1-based mission
      index within its stage).
- [x] 5.3 If extracted to `lib/builderBreadcrumb.ts`, add a co-located test
      (`lib/builderBreadcrumb.test.ts` or `scripts/test-builder-breadcrumb.ts`) covering: stage-only
      when wizard closed, stage+mission when wizard open, untitled-stage fallback, untitled-mission
      fallback, correct 1-based mission index. Confirm it fails before the helper exists (RED), then
      passes after (GREEN).
- [x] 5.4 Render the breadcrumb in the Builder header (`BuilderPage.tsx`), updating live off
      existing selected-stage state and the wizard's open-task/title state (no new Firestore reads).
- [x] 5.5 Verify via the preview tools: open the Builder, confirm the breadcrumb shows stage-only
      with the wizard closed, confirm it adds the mission segment when a mission tile is opened, and
      confirm it updates live as the mission name is typed on step 2. Check both LTR (EN) and RTL
      (HE) rendering, and narrow/mobile width for overflow/truncation.

## 6. Final gate sweep

- [x] 6.1 Run `npm run typecheck` — all workspaces pass.
- [x] 6.2 Run `npm run lint` — 0 errors.
- [x] 6.3 Run `npm test` — full aggregator + vitest pass (including the new
      `test-no-task-copy.ts` and any new breadcrumb test).
- [x] 6.4 Run `npm run creator:build` and `npm run play:build` — both pass.
- [x] 6.5 Run `npm run i18n:check:strict` — clean, zero new PART B warnings, PART A green.
- [x] 6.6 Run `npm run e2e` — unaffected callables still green (this change makes no callable
      changes, so this is a regression check only). Ran via
      `RUSHPOINT_EMULATOR_PORT_OFFSET=1000 node scripts/emulator-exec.mjs "node scripts/e2e-verify.mjs"`
      to run beside another session's live default-port dev stack; a stale offset-block Java
      process from a prior run was squatting the offset ports and had to be killed first.
      Real exit 0, "✅ ALL PASS".
- [x] 6.7 Run the full `npm run verify` gauntlet and confirm all green before considering the
      change done. Real exit 0, all 4 tasks successful.

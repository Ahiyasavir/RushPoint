# Tasks: play-pending-states-speak

P1 (PlayScreen) and P2 (TaskRunner) are independent files and can land separately. Do P1 first; P2's
implement step must land **after** the in-flight nav-link edit to `TaskRunner.tsx` (see design.md).

## P1 — first screen after Join speaks

- [x] 1. (RED / define expectation) Add the three HE+EN dictionary keys `play.loadingGame`,
      `play.syncingProgress`, `play.almostReady` to `apps/play-web/src/i18n.ts` (both language
      blocks). Run `npm run i18n:check:strict` — it must be clean (parity + real-language + no
      em-dash). This is the failing-first gate: the keys must exist before the component can
      reference them.
- [x] 2. (GREEN) In `apps/play-web/src/screens/PlayScreen.tsx`: add
      `import { Working } from '../components/Working';` and replace the bare ring at line 348
      (`<div className="w-8 h-8 rounded-full …animate-spin" />`) with
      `<Working messages={[t.play.loadingGame, t.play.syncingProgress, t.play.almostReady]} />`.
      Leave the `err` branch and the centering wrapper unchanged.
- [ ] 3. (REFACTOR / verify) Manually throttle the network and tap Join: the first screen shows
      rotating branded lines + an advancing bar, not a wordless ring. Confirm reduced-motion shows a
      static first line (behavior owned by `Working`). Re-run `npm run i18n:check:strict`.

## P2 — quick-submit task actions give pending feedback

> Land this AFTER the concurrent nav-link edit to `TaskRunner.tsx` is merged (different region, same
> file — avoid a clash). Touch only the submit handlers + entry-component submit buttons.

- [ ] 4. (RED / define expectation) If including the optional progress-copy layer, add the HE+EN key
      `task.checking` (`בודקים…` / `Checking…`) to `apps/play-web/src/i18n.ts` and run
      `npm run i18n:check:strict` clean. (Skip this task if shipping only the button-loading layer,
      which needs no new copy.)
- [x] 5. (GREEN — required layer) In `apps/play-web/src/components/TaskRunner.tsx`, pass
      `loading={busy}` to the fast-submit buttons that currently lack it: field check-in (line ~869),
      the station-code submit inside `CodeEntry` (line ~1079, thread the existing `busy` prop to the
      button's `loading`), quiz-text (~1122), survey (~1153) and numeric (~1205) submit buttons.
      Keep every `disabled=` guard exactly as-is. Use `busy`, not `frozen` (a read-only viewer is not
      "loading").
- [ ] 6. (GREEN — optional layer, only if task 4 done) Add a brief
      `showProgress(t.task.checking)` at the top of `verify`, the `field`/`submitCheckIn` path, and
      `answer`, mirroring the photo path's `showProgress(t.task.uploadingPhoto)`. The existing
      success/error writers already overwrite it on completion.
- [ ] 7. (REFACTOR / verify) On a throttled link, tap a station-code / check-in / quiz submit: the
      button shows an in-flight indicator for the whole round-trip and (if the optional layer is in)
      a brief "Checking…" line, instead of a silently greyed button. Run `npm run i18n:check:strict`
      and `npm test` (play-a11y scan + i18n dictionary) clean.

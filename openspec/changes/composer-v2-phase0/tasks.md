## 1. The clock starts on arrival (shared)
- [ ] 1.1 RED: `scripts/test-task-time-limit.ts` asserts `timeLimitClockStart`: gated mission
  returns `arrivedAt`; gated and not arrived returns null; ungated located mission returns
  `startedAt`; locationless returns `startedAt`; `gate` undefined infers from `arrivedAt`; garbage
  input never throws.
- [ ] 1.2 GREEN: implement it in `packages/shared/src/taskTimeLimit.ts`, export from the barrel.

## 2. The server reads the rule
- [ ] 2.1 RED: a source-scan test (`scripts/test-time-limit-from-arrival.ts`) asserts the sweep,
  the remaining-time projection and `assertWithinTimeLimit` all go through `timeLimitClockStart`,
  and both resume paths move `arrivedAt`.
- [ ] 2.2 GREEN: wire `sweepExpiredInFlight`, `activeTaskTimeLeftMs`, `assertWithinTimeLimit`;
  shift `arrivedAt` in the hold resume and `resumeFromFlash`.
- [ ] 2.3 e2e: extend the time-limit scenario in `scripts/e2e-verify.mjs`: a located mission with a
  short limit is not swept before arrival, and counts from the arrival.

## 3. Regenerate on the card
- [ ] 3.1 RED: `scripts/test-regenerate-card-button.ts` (source scan, no component runner): the card
  renders a regenerate button outside the menu when `onRegenerate` is set; it has an accessible
  name from `t.*`; the spin respects reduced motion; the Builder's card path toasts with an undo.
- [ ] 3.2 GREEN: `toast` action button; `TaskCard` button + spin; Builder toast with undo.
- [ ] 3.3 i18n: new strings in both dictionaries; `npm run i18n:check:strict` clean.

## 4. Gates
- [ ] 4.1 typecheck, unit lane, i18n strict, creator and play builds; e2e for the time-limit
  scenario; check the card in the browser preview at desktop and 375px.

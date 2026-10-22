# Design

## D1. One shared rule for when the clock starts
`timeLimitClockStart(task, rec, gate)` in `packages/shared/src/taskTimeLimit.ts`:
- the mission is arrival-gated (`arrivalGateApplies(task, { arrivalGate: gate })`): return
  `rec.arrivedAt`, or `null` (not started) when the team has not arrived;
- otherwise: `rec.startedAt`.

`gate` is `run.arrivalGate`. Two server paths do not hold the run document (the submission
guards `assertWithinTimeLimit`, called from `functions/src/index.ts` too). They pass `undefined`,
which reads as "gated exactly when the record carries an arrival": a gated mission cannot be
submitted before arrival (it is sealed), and an old ungated run never latches `arrivedAt` on a
located mission, so the inference is exact on every path that reaches a submission.

`null` from the rule flows into the existing `timeLimitRemainingMs`/`isTimeLimitUp`, which already
treat "no start stamp" as "no countdown, never up". So the phone shows no countdown while the team
walks, and the sweep leaves the mission alone.

## D2. Pauses move both stamps
`resumedStartedAt` is applied to `arrivedAt` too, in the hold resume (`runs/index.ts`) and the flash
return (`resumeFromFlash`, `index.ts`). Arrival is a latch (`!= null`) everywhere else, so moving its
value changes no other reader.

## D3. Stored-document purity
Per CLAUDE.md, anything that affects time is a pure function of the stored team document plus the
run's own `arrivalGate` flag, which is fixed at launch. No template re-read decides a clock.

## D4. Regenerate on the card
`TaskCard` renders a `TAP_CLUSTER` icon button (`dice`) beside the overflow menu whenever
`onRegenerate` is given. The Builder keeps a `regenNonce` per task id; the card plays a CSS keyframe
spin keyed on it, disabled under `prefers-reduced-motion`. After the swap, `toast.info` with an
action `{ label: בטל, onClick: undo }` (the Builder's history undo, so it restores the exact prior
mission). The menu item stays, for keyboard users who live in the menu.

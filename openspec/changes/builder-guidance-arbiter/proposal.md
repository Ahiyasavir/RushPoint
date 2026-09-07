## Why

Five independent guidance surfaces run inside one Builder screen, and only **2 of the 10 pairs**
yield to each other — each pair wired ad hoc, by a different mechanism. Pressing the global nav's
"?" help button while הקמה מהירה is mid-step puts two spotlight overlays on screen at once,
dimming each other's scrim and pointing at different controls, which is the failure mode the
existing yields were each added to prevent. Stage A of the creator mobile overhaul fixed only the
"don't fire two wizards back to back" half of this; the general case was deferred and is the last
unblocked item of the plan (stage D). It matters most on a phone, where an overlay covers the
whole screen rather than a corner of it.

## What Changes

- A creator sees **at most one** guidance surface at any moment, on any screen width. Which one is
  decided by a single declared priority order rather than by whichever component mounted first.
- Pressing the "?" help button while הקמה מהירה or the first-open spotlight is running **defers**
  the tour rather than drawing over them: the running surface finishes or is dismissed first, and
  the request is not silently dropped.
- The first-open spotlight stops deciding its fate once, at a 700 ms settle, and stops being able
  to be overtaken by a tour that auto-starts 1.3 s later.
- The desktop "your game is ready" nudge and the first-launch confirm dialog join the same
  arbitration instead of appearing regardless of what else is on screen.
- **REMOVED**: the `isCreatorTourRunning()` module-global that `BuilderSpotlight` imports from
  `CreatorTour` — a cross-component read of render-time mutable state, and the reason the
  spotlight's yield is a snapshot rather than a rule.
- No change to what any surface SAYS, when a creator first qualifies for it, or to any
  `localStorage` "seen" record. Copy, triggers and persistence are untouched; only the question
  "may this one be on screen right now" moves.

## Capabilities

### New Capabilities
- `builder-guidance-arbitration`: exactly one Builder guidance surface is visible at a time,
  chosen by a declared priority order; a surface that loses is deferred or suppressed by an
  explicit, total rule rather than by component mount order.

### Modified Capabilities
<!-- None. No existing spec covers creator-web's onboarding/guidance surfaces; the behavior of
     every other capability is unchanged. -->

## Impact

- **Surface touched: `creator-web` only.** No callable, no shared type, no Firestore path, no
  rules change, no participant-facing change. `npm run e2e` is a regression check only.
- New pure module `apps/creator-web/src/lib/builderGuidance.ts` + `scripts/test-builder-guidance.ts`
  (auto-discovered by the unit-test aggregator).
- Edited: `pages/BuilderPage.tsx` (the five render sites), `components/BuilderSpotlight.tsx`,
  `components/CreatorTour.tsx` (drops the module global, gains a deferred-request path),
  `App.tsx` (the "?" button's call site).
- i18n: at most one new string (the deferred-tour acknowledgement), which must be added to BOTH
  dictionaries and add zero new PART B findings.

## Non-goals

- Not merging the surfaces into one component, and not changing which creator qualifies for
  which. `BuilderSpotlight` stays the scratch creator's two-step explainer, `CreatorTour` stays
  the full product tour, הקמה מהירה stays the per-field flow.
- Not touching play-web, which has no comparable stack.
- Not queueing surfaces to replay automatically after the winner finishes, beyond the one explicit
  deferred-tour case. A surface that loses its moment keeps its existing trigger.
- Not stage C (the mobile Builder as one vertical list), which stays gated on a real-device check
  of stage B.

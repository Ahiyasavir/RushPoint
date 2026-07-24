# Proposal — run-console-action-feedback

## Why

The Run Console's stated doctrine (the `useCallFailureToast` comment at `RunConsolePage.tsx:83-96`
and the `creator-no-silent-failures` change) is that a live-ops action must never look like a no-op.
Almost every action already honours it — `adjustScore` toasts (`:621`), `skipTeamTask` toasts
(`:653`), `startAll` (`:369-372`), `refreshStandings` (`:409`), `revealStandings` (`:443`). Two small
gaps remain against that same doctrine:

1. **`skipStage` and `letTeamBackIn` confirm nothing on success (CLARITY).** `skipTeamStage`
   (`:636-642`) skips a team's **whole stage** — a confirmed, cautionary action — but on success only
   reloads the table with no toast. `letTeamBackIn` (`:631-634`) is the safety release from the
   out-of-bounds latch, and likewise gives no explicit "team is back in play" confirmation; the
   operator has to notice the amber badge disappear. On a busy phone a table reload is easy to miss,
   so the operator cannot tell the action landed and may repeat it. Their sibling `skipTeamTask`
   already toasts `rc.skipTaskDone` (`:653`); these two are the exception.

2. **The alert "Acknowledge" button has no in-flight guard (POLISH).** `ack` (`:414-423`, button at
   `:685-691`) does not set a busy state and the button is not disabled while `acknowledgeAlert` is in
   flight, so an anxious double-tap on a raised SOS fires the callable twice. It is harmless
   server-side (the second call is a no-op — the row already left the `acknowledged == false` query),
   and the row only disappears on the next snapshot, so between tap and snapshot the live button
   invites the second tap. It is the one live-ops control with no double-fire protection, while the
   photo queue and most others use `useAsyncAction`.

## What Changes

Close both gaps by reusing patterns the console already has.

- **Success toasts** on `skipTeamStage` and `letTeamBackIn`, mirroring `skipTeamTask`'s
  `toast.success(rc.skipTaskDone(...))`. `skipTeamStage` gets a "team's stage skipped" toast;
  `letTeamBackIn` gets a "team is back in play" toast. The confirm dialog on skipStage and the
  immediate, unconfirmed nature of the safety release both stay exactly as classified in
  `runConsoleActions.ts`.
- **An in-flight guard** on the alert acknowledge control, consistent with the per-row guard the photo
  review queue uses (`useAsyncAction` keyed per row): the button is disabled for the duration of its
  own call so a double-tap cannot double-fire.

## What does NOT change

- **No behavior change to the underlying actions.** `skipStage`, `clearTeamOutOfBounds` and
  `acknowledgeAlert` are called exactly as today; only user feedback is added.
- **The confirm dialogs are unchanged.** skipStage still confirms via `confirmAction('skipStage')`;
  the acknowledge confirm (`confirmAction('acknowledgeAlert')`) is unchanged; the safety release stays
  unconfirmed.
- **Failure handling is unchanged.** The existing `dialog.alert(rc.skipFailed)` / `rc.letBackInFailed`
  / `reportFailure(e, 'acknowledgeAlert')` paths stay.
- **Layout is data.** These are handler + one control-state change; `runConsoleLayout.ts` and
  `runConsoleActions.ts` severity/consequence contracts are untouched.
- **No backend, no callable, no shared types, no rules, no play-web.**

## Non-goals

- No new confirm dialogs, no change to which actions confirm.
- No change to the alerts listener, the audible cue or the title flash.
- No change to `functions/`, `packages/shared`, `firestore.rules`, or play-web.

## Impact

- Affected specs: `run-console-action-feedback` (new)
- Affected code: `apps/creator-web/src/pages/RunConsolePage.tsx` (two success toasts + one in-flight
  guard on the acknowledge control), `apps/creator-web/src/i18n.ts` (additive: two new `runConsole`
  strings, HE + EN)
- Surfaces touched: **creator-web only**. No shared types, no callable, no rules.

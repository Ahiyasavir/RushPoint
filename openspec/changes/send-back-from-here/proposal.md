## Why

Ahiya, 2026-10-06 (issue 32 in docs/ISSUES-2026-10-05.md): "When I have 'send to…', I want to be
able to send the team back too, not only forward. And then choose whether they redo only the
mission I sent them to, or all the missions after it as if they had not completed them."

Today "send to a mission" (RoutePicker) only goes forward, and "send the team back" is a separate
button whose mission target always means "only this mission": that record reopens, everything the
team did after it stays done.

## What Changes

- `planTeamRewind` takes `scope` on a mission target:
  - `only` (the default, today's behaviour): the mission reopens; nothing else changes.
  - `fromHere`: the mission reopens AND every mission the team finished after it: in its stage, those
    completed after it (by `completedAt`; an unknown time stays done, never guessed), and in every
    later stage, everything completed or skipped by the organizers. Their points come off and are
    earned again; the answer log is kept; authored losses (exclusive group, expiry) stay closed.
- `returnTeamTo` accepts `scope`; the dry run lists every reopened mission and the points.
- Console "send to a mission": a mission the team has DONE is selectable. Choosing it offers
  "only this mission" or "from this mission on", then the existing preview and confirm.

## Impact

- `packages/shared/src/teamRewind.ts`, `functions/src/runs/index.ts` (`returnTeamTo`),
  creator-web `RoutePicker.tsx`, `RunConsolePage.tsx`, `services/calls.ts`, i18n.
- Tests: `scripts/test-team-rewind.ts`, `scripts/e2e-verify.mjs` (send team back).
- Not in this change: the staff app's send-back panel keeps "only this mission".

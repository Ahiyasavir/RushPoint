## Why

A photo task is the only task type in RushPoint whose completion depends on a **human being free**.
Every other type is graded by the server the moment it is submitted. A photo submission with
`smart.autoApprove !== true` writes `taskSubmissions[taskId].status = 'pending'` and stops there:
`completeTaskForTeam` never runs, so the task is not scored, the station slot is not released, and
`requestNextTask` has nothing to route the team to. The team is standing still until an organizer
taps a button.

The attention lane just made this visible from the other side. `apps/creator-web/src/lib/teamAttention.ts`
lists `awaitingReview` as one of the reasons a team shows up as stuck, and the reason is deliberately
worded as an *explanation* ("they are idle because you have not reviewed their photo") rather than an
accusation. That reason firing is the organizer being the bottleneck.

At 10 to 20 teams this is not a rare event, it is the steady state. Every team hits every photo task,
so the queue arrival rate is roughly (teams x photo tasks) over the length of the run, while the
service rate is one person who is also walking around, answering questions and holding a phone.

The audit of the existing panel (`PhotoReviewConsole` in `apps/creator-web/src/pages/RunConsolePage.tsx`)
found the mechanics already in decent shape and the **situational awareness** missing:

1. **Ordering is already correct and already shared.** `buildSubmissionQueues` in
   `packages/shared/src/photoQueue.ts` sorts pending rows oldest first, sorts missing timestamps last,
   and breaks ties on `teamId:taskId` so the order is total and stable. Both review consoles use it.
   Nothing to fix.
2. **The pending count is already visible while the panel is closed.** `runConsoleLayout.ts`
   puts `pendingPhotos` on the folded `moderation` group summary. Nothing to fix.
3. **Team and task are already shown**, with `dir="auto"` on the team name and a resolved task title
   rather than a raw id. Nothing to fix.
4. **Approving takes one tap.** Rejecting takes a tap, a prompt and a confirm, which is correct: a
   rejection needs a reason.
5. **The organizer cannot see how long anyone has waited.** The row prints
   `submitted at 20:41`, a wall-clock time. To learn that this team has been blocked for fourteen
   minutes, the organizer has to read a timestamp, read their own watch, and subtract, per row, on a
   phone, while walking. In practice nobody does that, so the FIFO order is correct but its *urgency*
   is invisible. A queue that is sorted right and reads flat is triaged as though it were flat.
6. **A finished team sits in the same queue as a blocked one.** A submission from a team that has
   already crossed the finish line is not blocking anybody, but it is ordered purely on age, so an
   old submission from a finished team outranks a fresh one from a team standing in the street.
7. **There is no keyboard path.** A run is very often hosted from a laptop at a table. Every decision
   is a mouse trip to a specific card.
8. **A failed review leaves no per-row trace.** The catch fires a single generic
   `toast.error('Review failed')` that names neither the team nor the task and then disappears. The
   row correctly stays in the queue, but it looks exactly like a row nobody has touched yet, so the
   organizer both believes they handled it and has no way to find which one did not stick. That is
   the worst shape of this bug: a team is still blocked and the person responsible has been told
   nothing durable.
9. **`autoApprove` already exists and is already exposed** as a labeled checkbox in the photo section
   of `TaskWizard.tsx` ("Auto approve (no staff review needed)"). It is therefore **not** an
   undiscoverable escape hatch. What it does not say is the **consequence of leaving it off**, which
   is the whole queue. A creator building a 12-team game has no way to know, at build time, that this
   one unticked box is what will have them refereeing photos all evening.

## What Changes

**A pure queue-view function owns wait time, priority and decision legality.**
- New `apps/creator-web/src/lib/photoReviewQueue.ts`: `buildReviewQueueView(rows, { nowMs, finishedTeamIds, failures })`
  returns render-ready items carrying `waitMs`, `waitMinutes`, a `tier` (`fresh` / `waiting` / `overdue`),
  `teamFinished` and a per-item `failure` message.
- It is **total**: no clock read, no I/O, no throw. Missing, empty, unparsable, `NaN`, non-finite and
  future timestamps all resolve to "wait unknown", which sorts last and never claims urgency.
- It **de-duplicates by `teamId:taskId`** and drops any row that is no longer pending, so an
  already-reviewed submission arriving twice in a snapshot can never re-enter the actionable queue.
- It orders **teams that are still playing before teams that have finished**, then oldest first,
  then unknown-wait, then by key. Total and stable, so rows never swap under a finger mid-tap.
- `decideReview(status, action)` is the transition legality gate, layered on the shared
  `photoQueue` table: approving an approved row, rejecting an approved row, and rejecting a rejected
  row all return `send: false` with a machine-readable reason instead of firing a pointless callable.

**The panel surfaces what the function computes.**
- Each pending card shows how long that submission has been waiting, in minutes, with an escalating
  tier, in addition to the existing wall-clock time.
- A submission from a team that has already finished is tagged as such and sorted behind the teams
  who are still blocked.
- A failed review pins a **per-row, persistent** error on the card, naming the team, with a retry
  affordance. It clears on the next successful review of that row.
- Keyboard: `J` / `K` move a roving focus through the pending queue, `A` approves the focused row and
  `R` rejects it. The shortcuts are announced in the panel and are scoped to the queue, so they can
  never fire from elsewhere on the page.

**The builder states the consequence of not auto-approving.**
- One hint line under the existing `autoApprove` checkbox: leaving it off means every team's
  submission waits for a person during the run.

## Impact

- `apps/creator-web/src/lib/photoReviewQueue.ts` (new, pure)
- `apps/creator-web/src/lib/__tests__/photoReviewQueue.test.ts` (new, vitest)
- `apps/creator-web/src/pages/RunConsolePage.tsx` (`PhotoReviewConsole` only, additive)
- `apps/creator-web/src/components/TaskWizard.tsx` (one hint line)
- `apps/creator-web/src/i18n.ts` (HE + EN)

No backend change. No authz change: review stays `assertStaffOrOwner` and the server stays the sole
authority on scoring and status. No new auto-approval: nothing is approved that a creator did not
explicitly configure or a human did not explicitly tap.

## Explicitly out of scope

- **Any bulk approve.** See design.md, D5. A run-wide "approve all" is refused outright; no per-task
  or per-team batch is added either, and the argument for why is recorded rather than the feature.
- Re-ordering the queue: it is already oldest first, in shared code, with tests.
- Any console layout redesign.

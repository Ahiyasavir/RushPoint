## Context

The review queue is the one place in a live RushPoint run where throughput is bounded by a human.
This change does not try to remove the human. It tries to make the human's next decision obvious in
under a second, and to make a failed decision impossible to mistake for a completed one.

The audit found the *correctness* of the queue already solved by earlier lanes (shared FIFO ordering,
folded-group pending badge, team and task labels, per-row in-flight guard, no optimistic removal).
What is missing is everything that turns a correct list into a triage surface.

## Goals

- The organizer can tell, without arithmetic, who has been waiting longest and whether that is bad.
- A team who is still standing in the street outranks a team who already finished.
- A decision costs one keystroke on a laptop and one tap on a phone.
- A review that failed is visible on the row it failed on, until it succeeds.

## Non-goals

- Reducing the number of submissions (that is the builder-side `autoApprove` hint, and it is one line).
- Any change to what approving means on the server.
- Any change to the panel's position, its group, or the console layout.

## Decisions

### D1. The whole verdict is one pure, total function

`buildReviewQueueView(rows, opts)` in `apps/creator-web/src/lib/photoReviewQueue.ts`.

It takes the rows the shared `buildSubmissionQueues` already produced, an injected `nowMs`, the set
of finished team ids, and the current per-row failure map. It reads no clock and performs no I/O, for
the same reason `teamAttention.ts` does not: this renders inside the organizer's only live view of the
field, mid event, and a throw there blanks the console. Every unusable input has a defined, quiet
answer rather than an exception.

It is generic over the row type so it can consume `SubmissionRow` from `@rushpoint/shared` without
this module depending on the shape of the media fields it does not care about.

### D2. Wait time is a bucketed tier, not a precise duration

`waitMinutes` is floored whole minutes; the tier is:

| tier | condition | meaning |
|---|---|---|
| `fresh` | wait under 4 minutes, or wait unknown | just arrived, or no usable timestamp |
| `waiting` | 4 to 10 minutes | normal, but noticed |
| `overdue` | over 10 minutes | this team has stopped playing |

The thresholds are set against the game's own physics, not against a service-desk SLA. A photo task
is submitted from a stop the team walked to; the next leg cannot start until the review lands. Four
minutes is roughly a leg of walking, so under it the team has not actually lost time. Ten minutes is
long enough that the team is visibly standing around, which is the exact complaint this change exists
to answer.

Crucially, **wait-unknown is `fresh`, not `overdue`**. A missing timestamp is an absence of evidence.
Rendering it as the most urgent thing on screen would let one malformed doc dominate the triage
surface permanently, which is the failure mode `teamAttention.ts` calls a flagged table: an organizer
who sees everything red stops reading red.

### D3. Priority is "who is blocked", not "who is oldest"

Ordering, in order of precedence:

1. teams still playing before teams that have finished;
2. longer wait before shorter wait;
3. known wait before unknown wait;
4. `teamId:taskId` ascending.

Step 1 is the only behavioural departure from the shared FIFO, and it is the honest one: a finished
team is not blocked on anything. Their submission still needs reviewing (it still scores, and their
photo still belongs in the recap), but it must never sit in front of a team who cannot move.

Steps 3 and 4 make the comparator **total**: for any two items exactly one of `<`, `=`, `>` holds, and
equality only when the keys are equal, which cannot happen after de-duplication. That is what makes
the order stable across snapshots. An unstable comparator here is not cosmetic: rows re-order under
the organizer's finger between the tap-down and the tap-up, and they approve the wrong photo.

### D4. De-duplication and non-pending filtering happen in the view, not the render

A Firestore snapshot is a projection of a document that is being written concurrently. The same
`teamId:taskId` can legitimately appear twice across a re-render boundary, and a row can arrive
already approved. Both are handled once, in the pure function: first key wins, non-pending rows are
dropped.

This is the idempotence property the test suite pins. It matters because the render path already has
a per-row in-flight guard keyed on exactly this key: two items with one key would share one guard and
one of them would be silently un-clickable.

### D5. No bulk approve. Not run-wide, and not per-task either.

This was considered and refused, and the refusal is the design decision.

A run-wide "approve all" is trivially wrong: it converts a review queue into an auto-approve toggle
that the creator never opted into, retroactively, mid run. Every photo it approves is scored and,
because `reviewStationSubmission` writes an approved photo into the live feed, **published to a
surface other participants can see**. At a youth event that means unreviewed photographs of minors
being pushed to a shared screen by a button whose entire purpose was to skip looking at them. There is
no version of that which is acceptable, and there is no undo: the server has no score clawback path
(see the `canReject` comment in `photoQueue.ts`), so an over-broad approval cannot be walked back.

The tempting weaker forms do not survive either:

- **Per-task batch** ("approve all 14 submissions for the selfie task"): every one of those 14 is a
  different photograph of different children. The task being the same is exactly the thing that does
  not make the images equivalent.
- **Per-team batch** ("approve everything from team 4"): smaller blast radius, but the same defect,
  and it does not even help. A team's submissions arrive one per task, spread over the run; they are
  almost never queued together, so the batch would usually be a batch of one.

The real throughput lever is not doing more decisions per tap, it is spending fewer taps per decision
and making the right decision obvious. That is D2, D3 and D6. If a creator genuinely does not want to
review, the correct control already exists, is honest about what it does, and is chosen **before** the
run: `smart.autoApprove`. Which is why this change spends one line making that consequence explicit
at build time instead of adding a mid-run bypass.

### D6. Keyboard: roving focus, scoped listener, no global hotkeys

`J` / `K` move focus, `A` approves the focused row, `R` rejects it. The handler is attached to the
queue container, not to `document`, so a creator typing a team name into an announcement box on the
same page can never approve a photo by typing the letter "a". `moveFocus(items, currentKey, delta)` is
pure and is unit tested for the empty queue, a stale focus key, and both ends of the list, because the
queue mutates under the focus as items are approved out of it.

Approve is a single keystroke and reject is not: reject still opens the reason prompt. Asymmetry is
correct here. Approving is the common, safe, reversible-by-adjustment action; rejecting sends a team
back to redo work and should cost a sentence.

### D7. Failures are per row and durable

The existing `toast.error(rc.photoReviewFailed)` stays (it is the immediate signal) and is joined by a
per-row failure entry keyed on `teamId:taskId`, rendered on the card itself with the team's name and a
retry control. It is cleared when that row's review succeeds, and it is passed *into* the pure view so
the failure survives re-renders and snapshot churn.

The row itself already stays in the queue on failure, because there is no optimistic removal. That was
already right. What was missing was any way to tell the failed row apart from the untouched ones.

### D8. Nothing is auto-approved that a creator did not configure

The builder hint is copy only. It does not change a default, does not pre-tick the box, and does not
suggest a value. It states what leaving the box unticked means during the run.

## Test Strategy

**Lane: pure logic, vitest, `apps/creator-web/src/lib/__tests__/photoReviewQueue.test.ts`.** No
emulator, no React, no network. RED first: the test file is written and run against a non-existent
module, and the failure is recorded, before any implementation exists.

Cases pinned:

| case | asserts |
|---|---|
| empty queue | returns `[]`, does not throw, `moveFocus` returns `null` |
| single item | one item, correct key, wait computed, tier from the elapsed time |
| ties on timestamp | two identical `submittedAt` values order by key, deterministically, both directions of input order |
| missing timestamp | `waitMs === null`, tier `fresh`, sorts after every known-wait item |
| `NaN` / unparsable / empty / future timestamp | never throws, never produces a negative wait, never produces `overdue` |
| team already finished | still present and reviewable, tagged `teamFinished`, ordered behind every unfinished team even when much older |
| already-reviewed item appearing twice | de-duplicated to one item, and a non-pending status is excluded entirely |
| ordering stability | the same input in a shuffled order yields an identical key sequence; re-running on the output is a fixed point |
| decision legality | `decideReview` is idempotent for every (status, action) pair and refuses reject-after-approve |
| focus movement | stale key, both ends, empty list, single item |
| failure map | record and clear are immutable and keyed per row |

**Not covered here, by design:** rendering. The creator app has no component test runner. The panel
change is verified by the build gates plus the existing `e2e-ui/photo-review.creator.spec.ts` render
smoke.

**e2e assertions this change would add** (reported, not written, because `scripts/e2e-verify.mjs` is
owned elsewhere this session):

1. In the photo scenario, after two teams submit to the same task with a controlled delay between
   them, assert `reviewStationSubmission` on the newer submission does not affect the older one's
   pending status, and that the older one is still pending afterwards. This pins that nothing in the
   client ordering work leaked into a server assumption.
2. Assert `reviewStationSubmission` with `approved: true` on an **already approved** submission
   returns without a second `completeTaskForTeam` score and without a second feed item, which is the
   server-side half of the idempotence the client now refuses to send.
3. Assert a submission from a team that has already been finalized can still be reviewed and does not
   throw, since the client now deliberately keeps such rows in the queue rather than hiding them.

## Risks

- **File contention.** `RunConsolePage.tsx` is being edited by an active live-task-pause lane. The
  mitigation is that all logic lands in a new file, and the panel diff is confined to the body of
  `PhotoReviewConsole`, which that lane does not touch (it owns `TaskAvailabilityConsole`). The file
  is re-read immediately before every edit.
- **Threshold disagreement.** The 4 and 10 minute tiers are judgement calls. They are exported
  constants, referenced by name in the tests, so changing them is a one-line change with the test
  suite as the contract rather than a hunt through JSX.

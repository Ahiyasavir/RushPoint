## Why

From the 2026-09-10 run: *"Photo missions can be skipped or cheated. There is no
verification mechanism or organizer approval on photo upload missions (like the barter
mission). Participants could upload a meaningless photo — a picture of their hand — and
carry on through the game."*

That outcome is not one bug. It is three layers, each individually reasonable, that
compose into "nothing can be done about it":

1. **Photo missions default to auto-approve.** `apps/creator-web/src/taskShorthands.ts`
   builds every bank photo mission with `smart.autoApprove: true`, and the bank's own
   rule 14 states the reasoning plainly: *"A bank mission is `autoApprove`: nothing
   adjudicates it mid-play."* Its rule on feedback counts the scale: **61 of the bank's
   103 missions are photo or video uploads set to auto-approve.**
2. **The alternative blocks the team.** With review on, `submitStationPhoto` writes
   `pending` and stops — `photoReviewQueue.ts` says exactly what that means: *"the task
   is not scored, the station slot is not released, and routing has nothing to hand the
   team. They are standing still until an organizer taps a button."* For one organizer
   running five teams, that is not a usable setting, which is why everything is
   auto-approve.
3. **An approval is permanent.** `canReject` returns false once a row is approved, and
   the transition table records why: *"the server has no score clawback path, so
   'rejecting' an approved task would flip a status string while the points silently
   stay. Use the manual adjustTeamScore instead."*

So the organizer watches a photo of somebody's hand score full points, and the only tool
left is a manual score adjustment — which, until `live-ops-feedback-loop`, was recorded
in the audit trail as the literal string `manual`.

**Layer 3 is the one worth fixing.** Layers 1 and 2 are a genuine product trade-off
between "nobody is blocked" and "somebody checks". Layer 3 is what turns that trade-off
into a trap: it makes auto-approve mean *unreviewable*, when it should only mean
*unblocking*.

## What Changes

- **An approved submission can be reversed.** An organizer or run-scoped staff member
  can reject a submission that was already approved, including one approved
  automatically.
- **Reversing it takes the points back.** The score the submission earned is removed
  from the team, so the status and the scoreboard cannot disagree — which is precisely
  the objection that kept this refused until now.
- **It is audited like any other privileged act**, naming who reversed it and why, so a
  reversal is never the untraceable thing a manual adjustment used to be.
- **The team is not sent backwards.** Reversing an approval removes the award and marks
  the submission rejected. It does NOT un-complete the mission, re-route the team, or
  disturb a run already in progress — putting a team back on a mission they have walked
  away from is a different and riskier act, and `forceAssignTask` already exists for an
  organizer who genuinely wants that.

Together with the run-wide auto-approve switch, an organizer can now run the combination
that was previously impossible: **nobody is ever blocked, and everything is still
checked** — just checked afterwards.

**BREAKING**: none for stored data. A behaviour change: `approved + reject` stops being
refused and starts doing something.

## Capabilities

### New Capabilities
- `approval-reversal`: whether an approved media submission can be undone, and what
  happens to the points when it is.

### Modified Capabilities
- `photo-review-throughput`: the review transition table gains the reject-after-approve
  edge it has always documented as impossible.

## Impact

- **Surfaces**: `packages/shared` (the transition table and a new pure clawback
  verdict), `functions` (`reviewStationSubmission` gains the reversal path and its audit
  record), `apps/creator-web` and `apps/play-web` (the review queue and the media gallery
  stop disabling reject on an approved row).
- **No NEW callable** — `reviewStationSubmission` already exists and is already
  privileged and audited, so the callable-coverage guard is unchanged. Its behaviour on
  one previously-refused input changes.
- **Touches scoring**, so `npm run e2e` must cover it: a reversal must move the team's
  score by exactly what the approval awarded, and must be idempotent.
- **i18n**: the review controls gain reversal copy in both languages.
- **Deployment**: server by VPS rebuild, consoles by `deploy:hosting`. The consoles are
  safe to ship first — the control simply stays refused until the server knows how.

## Non-goals

- **Judging whether a photo is any good.** This makes a wrong approval reversible; it
  does not decide what "wrong" means. Quality scoring is the separate `creative-judging`
  problem, and the task bank already names it as a known gap.
- **Changing what photo missions default to.** Whether the bank should stop
  auto-approving is a content decision across 61 missions, not a code change.
- **Automatic image checking.** No classifier, no similarity test, no EXIF forensics.
- **Reversing anything other than a media submission.** Answers, codes and check-ins
  have their own paths and their own reasons.
- **Un-finishing a finished run.**

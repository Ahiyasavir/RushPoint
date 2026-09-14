## Why

The 2026-09-10 production run of "פעולת פתיחה חבב 1#" (run `ijI9JMITSf8C9heN1Cwp`,
5 teams, 37 minutes, 15 media submissions) needed the organizer to intervene by hand
throughout. Player feedback was 4–5/5 overall and 5/5 on bonding — the content was
good; the console under it made one person do three jobs at once.

Three specific gaps, each of which **already has its solution written somewhere else
in this codebase**. That is what makes them worth doing together: none is a new
capability, each is a surface that never received one the platform already has.

1. **A submission entering the review queue is silent.** `RunConsolePage` plays
   `playAlert()` for a new SOS (`RunConsolePage.tsx:210`), with a ref-baselined
   seen-id set so a fresh mount does not replay history. The photo/video review queue
   — the thing the organizer is actually blocked on, and the thing players complained
   about (*"שהמנחה יאשר מהר יותר את המשימות"*) — reads from a listener 150 lines
   further down and cues nothing. `StaffConsole` in play-web has no sound module wired
   at all. So an organizer learns a team is waiting by happening to look.

2. **Every manual score adjustment is recorded as `'manual'`.** The literal is
   hardcoded at `RunConsolePage.tsx:919`. `apps/play-web/src/lib/scoreReasons.ts`
   already implements the whole feature — sign-aware preset lists, a free-text escape
   hatch, language-neutral ids so the audit trail is readable in either language — and
   the server has always accepted and published `reason`
   (`functions/src/index.ts`). It was built for the staff console and never reached
   the organizer's own. In this run **88% of the winning score was not gameplay**
   (500 flat completion bonus + 573 manual versus 300 earned), and the manual awards
   fully reversed the standings: team 💕 finished fastest and placed 4th. The audit
   trail for the decisions that chose the winner says `manual`, eleven times.

3. **Skipping one mission pays nothing, while skipping a whole stage pays
   `skipAward`.** `skipTaskForTeam` writes `earnedScore = 0`
   (`functions/src/runs/index.ts:1635`) with a comment arguing that one mission is not
   a stage being taken away and that `adjustTeamScore` is the compensation route. In
   the field that argument inverted: the organizer computed the fair value (40) in his
   head, mid-run, and paid it out as a manual bonus — which is precisely the
   untraceable manual adjustment defect #2 is about. The workaround IS the bug.

## What Changes

- **The review queue announces itself.** A submission arriving in the pending queue
  plays the same alert cue an SOS already does, in the creator's Run Console and in
  the staff console. The cue is baselined on first paint, so opening the console over
  a queue of twelve does not fire twelve times, and a refresh is silent.
- **A manual score adjustment records WHY.** The organizer's console offers the same
  reason picker the staff console has — presets appropriate to the sign of the delta,
  plus free text — and sends it. A reason stays optional: a marshal fixing a score
  mid-event is never blocked by an empty text box.
- **Skipping one mission pays the same consolation `skipStage` pays.** `skipAward` is
  applied to the single-task skip, so the organizer no longer has to compute it by
  hand or launder it through a manual bonus.

**BREAKING**: none for stored data. **Scoring behaviour changes for future runs**:
a task skipped by `skipTaskForTeam` will earn `skipAward` instead of 0. Finished runs
cannot move — `earnedScore` is stamped per task record at the moment of the skip and
`buildRankings` sums stored records, never re-derives them.

## Capabilities

### New Capabilities
- `manual-score-attribution`: what an organizer's manual score adjustment records
  about itself, and how that reaches the audit trail.
- `skip-single-task`: what a single-mission skip pays. Added rather than modified
  because the original `skip-single-task` change was archived without folding a living
  spec — there is no `openspec/specs/skip-single-task/` to modify. This change
  establishes it, and states the consolation rule as part of doing so.

### Modified Capabilities
- `audio-haptic-feedback`: gains the review-queue arrival cue, alongside the existing
  SOS cue, and extends it to the creator console and the staff console.

## Impact

- **Surfaces**: `apps/creator-web` (Run Console — one listener gains a cue, the score
  adjustment flow gains a picker), `apps/play-web` (staff console — the same cue),
  `packages/shared` (`scoreReasons` moves here so the two consoles cannot drift),
  `functions/src/runs/index.ts` (one line of scoring in `skipTaskForTeam`).
- **No new callable, and no callable signature changes.** `adjustTeamScore` already
  takes `reason`; `skipTaskForTeam` already exists. So no new `services/calls.ts`
  wrapper and no movement in the callable-coverage guard.
- **No Firestore rule, index, or env var changes. Nothing new is stored.**
- **i18n**: the reason labels already exist in play-web's dictionary and must be added
  to creator-web's, in both languages. `npm run i18n:check:strict` is mandatory.
- **Deployment**: the two UI halves ship by `deploy:hosting`; the `skipAward` line is
  in the callables bundle and ships by **VPS redeploy**. They are independent — the
  UI is safe to ship first.

## Non-goals

- **Any other scoring change.** The sigmoid range, `COMPLETION_BONUS`, the Z-score on
  the live board and `effectiveEstimatedMinutes` all belong to `scoring-legibility`
  and are deliberately untouched here.
- **Late joiners and the run-level auto-approve toggle** (`late-joiner-autostart`).
- **A structured judging mechanism for creative missions** (`creative-judging`). This
  change makes a manual award *attributable*; it does not make it *unnecessary*.
- **Push or email notification** when a submission arrives. In-page cue only.
- **A download action in the review queue** — filed by `media-serving-correctness`.
- **Changing what `skipStage` pays**, or adding a consolation to any other path.

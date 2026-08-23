## Context

`StaffConsole.tsx` (`apps/play-web/src/screens/StaffConsole.tsx`) is a single-file mobile
dashboard: SOS alerts, photo/audio/video review, a manual bonus/deduction list, team↔HQ chat, live
photo-feed moderation, and an announcement composer. It talks to the backend only through
`apps/play-web/src/services/calls.ts` wrappers over `functions/src/index.ts` / `functions/src/runs/index.ts`
callables, and reads Firestore directly (read-only, rules-scoped to one run) via `onSnapshot`.

The desktop `RunConsolePage.tsx` (`apps/creator-web/src/pages/RunConsolePage.tsx`) already has: an
arbitrary-amount score-adjustment prompt (`dialog.prompt` → `adjustTeamScore`), a live team-location
map (`components/LiveTeamMap.tsx`, MapLibre, lazy), and buttons for `clearTeamOutOfBounds` and
`skipTaskForTeam`/`skipStage`. None of that reaches the phone. A per-team **hold** does not exist
on either surface — the closest existing things are `Run.taskStatusOverrides` (pauses one TASK for
the whole run, not one team) and `RunTeam.outOfBounds` (system-detected, not staff-initiated).

## Goals / Non-Goals

**Goals:**
- Bring StaffConsole to parity with RunConsolePage for team-scoped field actions, sized for a
  phone.
- Add the one genuinely new capability — per-team hold — with the same server-authoritative,
  fail-open, audited rigor as every other write path in `functions/src/runs/index.ts`.
- Keep play-web's bundle budget intact; the map must not load MapLibre into the entry chunk.

**Non-Goals:**
- No offline queueing — every new action is online-required, same as the rest of StaffConsole.
- No change to how `adjustTeamScore`, `clearTeamOutOfBounds`, or `skipTaskForTeam` work
  server-side — they're reused as-is; only new client call sites are added.
- No new staff permission tiers beyond what's decided in Decision 5 below.

## Decisions

### 1. Where hold state lives: on the `RunTeam` doc, not the `Run` doc

Mirrors `outOfBounds`/`outOfBoundsAt`/`outOfBoundsOverrideUntil` (`packages/shared/src/types/index.ts`,
`RunTeam`) rather than `Run.taskStatusOverrides`. The CLAUDE.md rule ("a run-scoped operational
override belongs on the RUN document, not the game template") is about Run-vs-template drift; a
hold is inherently per-TEAM, so it belongs where every other per-team operational flag already
lives — the team doc, server-write-only, unaffected by template edits or duplication.

New fields on `RunTeam`:
```ts
held?: boolean;              // true while on hold
heldAt?: string;              // ISO — when the CURRENT hold started; undefined when not held
heldReason?: string;          // short staff-entered free text (optional), never required
heldBy?: string;               // staffName claim, for the audit trail / participant copy
heldMs?: number;               // ACCUMULATED total across all past holds this run, stamped on each resume
```
`heldMs` accumulates the same way `RunTaskRecord.excludedMs` is summed by `teamExcludedMs` — but at
team level, not per-task, since a hold isn't tied to any one task.

### 2. New callable: `setTeamHold`, not two separate `holdTeam`/`resumeTeam` callables

One callable, `setTeamHold({ ...ctx, teamId, held: boolean, reason?: string })`, toggles both
directions — matching the existing `setRunTaskStatus` shape (one callable, an enum/boolean payload)
rather than `pushAnnouncement`/`deactivateAnnouncement`'s two-callable pattern. Reason: hold/resume
is a single conceptual toggle with symmetric authorization (same permission both ways), unlike
announcements where push and deactivate have different semantics. On `held: false`, the server
stamps `heldMs += (now - heldAt)` and clears `heldAt`/`heldReason`; on `held: true` it sets
`heldAt = now` and refuses (`failed-precondition`) if already held (idempotent no-op, not an
error, mirroring other toggle guards in this file).

### 3. Clock exclusion: extend `pausedClock.ts`, don't duplicate its logic

`teamExcludedMs` currently sums only `RunTaskRecord.excludedMs`. Add a new exported helper in
`packages/shared/src/pausedClock.ts`:
```ts
export function teamHeldExclusionMs(team: { heldMs?: number }): number
```
returning `Math.max(0, team.heldMs ?? 0)` (same non-negative/finite guard style as the rest of the
file), and have `buildRankings` (`functions/src/runs/index.ts`) add this to the existing
`teamExcludedMs(stages)` total before computing `adjustedElapsedMs`/`adjustedElapsedSeconds`. This
keeps ONE subtraction site (`buildRankings`) shared by `finalizeRun` and `refreshLeaderboard`, so
live/final parity is preserved exactly like the existing pause-clock-tasks guarantee. A team held
DURING an open task is not double-counted: the task's own `excludedMs` is stamped only from
`startedAt→completedAt` at completion and a hold does not alter those stamps — a held team simply
cannot complete a task while held (Decision 4), so no task record closes mid-hold.

### 4. Guard placement: one shared precondition check, called from every progress-advancing callable

Add `assertTeamNotHeld(team)` (throws `functions.https.HttpsError('failed-precondition', ...)`
with a stable code the client maps to copy, same pattern as every other guard in
`functions/src/runs/index.ts`) and call it at the top of: `requestNextTask`, `submitTaskAnswer`,
`submitSequenceStep`, `verifyStationCode`, `reportArrival`, `checkOutTask`, `requestTaskHint`
(all in `functions/src/runs/index.ts` / `functions/src/index.ts` per the table in CLAUDE.md).
`getMyTeamState` is NOT guarded — a held team must still be able to READ their status (so the
participant UI can show "you're on hold"), only WRITE paths refuse. This is the same read/write
asymmetry `taskStatusOverrides` already uses (routing resolves it, but "the completion path never
reads it" for an in-flight claim — by contrast a hold blocks the write outright, since unlike a
paused task a hold has no team already mid-action to grandfather).

### 5. Authorization: reuse the existing staff permission set, add one new value

`StaffPermission` (referenced in `StaffInvite.permissions`) gets a new member,
`'manage_teams'` (covers hold/resume, custom score amount, clear-out-of-bounds, skip-task — the
four "can materially change a team's outcome" actions). Existing invites minted before this change
carry no `manage_teams` grant; the organizer must re-issue or the sign-in flow's default grant set
(wherever `inviteStaff` seeds `permissions` today) is updated to include it for NEW invites. This
is deliberately coarse (one flag, not four) — RunConsolePage already trusts any authenticated
staffer with these actions today (they're ungated there), so a single new permission is a net
tightening, not a new restriction. **Open question**: should this be a hard 403 or a soft
UI-hide-only gate for existing invites, to avoid locking out marshals whose PIN was issued before
deploy? Resolved in tasks.md as a decision the first task must make explicit (default: soft-gate —
hide the controls if the token lacks the permission, but don't newly break `adjustTeamScore`/
`clearTeamOutOfBounds`/`skipTaskForTeam` for invites that already call them today).

### 6. Search: pure client-side filter, no new query

`teams` is already a full live snapshot (`StaffDashboard`'s `onSnapshot` on the whole `teams`
subcollection) — a run's team count is bounded by `maxParticipants`, never large enough to need
server-side search. A new `useState<string>` filters the existing sorted `teams` array by
`displayName` (case/diacritic-insensitive `includes`), `dir="auto"` input to match the rest of the
Hebrew-first UI. No backend change.

### 7. Custom score amount: an inline numeric field, not `window.prompt()`

`RunConsolePage` uses `dialog.prompt` (a themed modal) for this on desktop; StaffConsole has no
`dialog.prompt` usage today and phone browsers render native `prompt()` inconsistently (some PWA
installs suppress it entirely). Add a small inline expand: tapping a new "…"/custom button reveals
a `type="number" inputMode="numeric"` field with a Confirm button inline in the team card — no
modal, so it survives a scroll/keyboard-open reflow better on a small screen. Reuses the existing
`adjustAction`/`adjustAck` plumbing (same call, `delta` is just no longer restricted to ±5/±10).

### 8. Live map: lazy component, reuse `LiveTeamMap`'s data contract but not its code

`LiveTeamMap.tsx` lives in `apps/creator-web` and creator-web/play-web deliberately do not share
React components (`packages/shared` is framework-free — see CLAUDE.md navigation notes on why
route-lazy wrappers are duplicated rather than shared). A new `apps/play-web/src/components/StaffTeamMap.tsx`
is added, mounted via `lazyWithRetry` (the existing self-healing lazy pattern already used for
`FeedPanel` in this same file) and reading the same `teamLocations` collection
(`FIRESTORE_PATHS`-derived path) `LiveTeamMap` reads, at phone scale (single-column, tap-a-pin →
bottom sheet with team name + "open in Maps" deep link, reusing the SOS alert's existing
`https://www.google.com/maps/dir/?api=1&destination=...` pattern instead of inventing a new one).
Behind the SAME collapsed-by-default `<Collapsible>` pattern the chat/feed sections already use, so
it costs nothing until a marshal opens it.

### 9. Quick actions (out-of-bounds clear, skip task): inline per-team buttons, no new callable

Both `clearTeamOutOfBounds` and `skipTaskForTeam` already exist and are called from
`RunConsolePage.tsx` today — StaffConsole only needs new call sites in `services/calls.ts`
(if not already exported there) and two new buttons in the team card, gated the same way as
Decision 5. `clearTeamOutOfBounds` shows only when `team.outOfBounds` is true (read from the
existing live snapshot); `skipTaskForTeam` needs the team's current active task id
(`team.activeTaskId`, already mirrored on the team doc per its own doc-comment) — no new read.

### 10. Participant-facing hold notice

The participant app needs to show "you're on hold" instead of silently refusing every action.
Cheapest correct approach: `getMyTeamState`'s existing response already carries the raw `RunTeam`
fields the client is allowed to see (need to confirm `held`/`heldReason` aren't in a
server-secret-strip list — they aren't answer-key-shaped, so no sanitizer change expected). Add a
`held` check in `apps/play-web/src/screens/PlayScreen.tsx` (or wherever the existing "run paused" /
"waiting" state is rendered — TBD in tasks.md after re-reading that screen) that shows a
`t.play.teamHeld` banner with `heldReason` if present, mirroring the fail-open pattern in
`lib/stuckGuards.ts`: absent/stale `held` reads as `false`, never blocks rendering.

### 11. Score-adjustment reason: no backend change, only a UI field + preset list

`adjustTeamScore` (`functions/src/index.ts:1452`) already accepts an optional `reason`, already
sanitizes it (`optionalString(reason, 'reason', MAX_MESSAGE_LEN)`), already writes it into the
`auditLogs` record, and already threads it into the team-facing score notice
(`formatScoreNotice`). StaffConsole's `adjust()` currently hardcodes `reason: 'staff'`
(`apps/play-web/src/screens/StaffConsole.tsx:303`) — the ENTIRE gap is client-side. Add a small
preset list (a plain string array in `apps/play-web/src/lib/` — mirrors how other small fixed
vocabularies live in this codebase, e.g. `t.staff.alertType`) covering common categories
("Creativity Bonus", "Team Spirit", "Late Penalty", "Rule Violation", …, "Other") with "Other"
revealing a free-text field. The 44px preset buttons chain onto the same custom-amount UI from
Decision 7 rather than becoming a second modal.

### 12. Staff↔admin channel: reuse the chat message shape, not a new subsystem

New sibling type in `packages/shared/src/chat.ts`, `StaffChannelMessage`, structurally identical
to `ChatMessage` but with `from: 'staff' | 'admin'` instead of `'team' | 'hq'`. A parallel type
rather than widening `ChatMessage.from`'s union: `chatMessageSide` and every existing call site is
typed against exactly `'team' | 'hq'`, and widening that union would force every one of those call
sites to newly handle values that can never appear there — a silent-footgun risk for zero benefit,
versus one small duplicated interface (this codebase already accepts this trade-off elsewhere: see
CLAUDE.md's note on `lib/lazyWithRetry.ts` being "behaviourally matched and deliberately
duplicated rather than shared" between the two apps). The existing pure helpers
(`sanitizeChatText`, `appendCapped`, `chatSeenMarker`, `countUnreadChatMessages`,
`serializeChatSeen`/`parseChatSeen`) are untyped enough on their `from` field's actual runtime
values to be reused as-is for the new message shape via a matching `staffChannelMessageSide`
one-line pure function (mirrors `chatMessageSide` exactly, swapping the two role strings).

**Storage**: one singleton doc per run — `users/{ownerUid}/games/{gameId}/runs/{runId}/staffChannel/thread`
— not a collection, since there is exactly one shared thread (not one per team). Add the path to
`FIRESTORE_PATHS`.

**Callable**: one `sendStaffChannelMessage({ ownerUid, gameId, runId, text })`, reused by BOTH
apps. The server — never the client — decides the sender role: `assertStaffOrOwner` (the same
guard `adjustTeamScore` already uses) authorizes the call, and `from` is stamped `'admin'` when
`context.auth.uid === ownerUid`, else `'staff'`. `senderName` is taken from the staff custom
token's `staffName` claim (owner falls back to their profile display name) — same attribution
pattern `sendTeamChatMessage` already establishes for the team-chat audit trail.

**Reads**: `firestore.rules` grants read on the `staffChannel/thread` doc to (a) the owner
(`request.auth.uid == ownerUid`) and (b) any token carrying this run's staff claims (mirror
whatever predicate the existing team-chat/alerts rules already use for staff scoping — confirm
exact rule function name when implementing). No client write rule at all (server-only, like every
other run-scoped doc).

**UI**: a new `<Collapsible>` section in `StaffConsole.tsx` (same visual pattern as the existing
`StaffChatSection`, but ONE thread instead of per-team threads — no team picker needed) and a new
section in `RunConsolePage.tsx` for the admin side. Unread badge reuses `countUnreadChatMessages` +
a new `staffChannelSeenStorageKey(runId)` (no teamId component, since it's run-scoped not
team-scoped).

### 13. Force-assign: reuses `assignTask`'s atomic claim, does not replace it

New callable `forceAssignTask({ ...ctx, teamId, taskId, override?: boolean })`. Design constraints,
in order of what it must never violate:

- **Station capacity is never bypassable.** `Task.maxConcurrentTeams` is a real-world constraint
  (only so much room at a station) and the concurrent-claim invariant is explicitly guarded by the
  e2e suite's "station-contention" scenario (CLAUDE.md). `forceAssignTask` reuses the SAME
  transactional check-then-increment shape `assignTask` already uses
  (`functions/src/routing/assignNextTask.ts:362-409`) — it targets the staff-chosen task instead of
  running `priorityScore` selection over candidates, but the capacity check inside that same
  transaction is untouched. A full station refuses a force-assign exactly like it refuses a normal
  assignment.
- **Stage scope is fixed to the team's current active stage.** The chosen `taskId` must belong to
  `gameStage.tasks` for the team's currently-`active` `RunStageRecord` (same stage lookup
  `assignNextInActiveStage` already performs). Rejects with `invalid-argument` for a task in a
  locked future stage, an already-completed stage, or another team's game structure entirely.
  This is what keeps stage-sequencing invariants (required-task-count, exclusive groups, the
  final-stage trigger) intact — none of that logic is stage-order-aware in a way that tolerates an
  out-of-sequence claim.
- **`override` controls ONLY the unlock-gate and the scheduled-release/expiry gates** — the "soft"
  eligibility rules `isUnlocked`/`isReleased`/`isExpired` gate on, which is exactly what "bypass
  sequential blockers" in the proposal is asking for (e.g. a task gated behind a teammate's
  unfinished task, or a task that hasn't scheduled-released yet but the marshal wants it opened
  early for this one team). Default `false` — staff can already reach every eligible task without
  it; `override: true` is the deliberate escape hatch, and it is logged distinctly in the audit
  trail (`actionType: 'forceAssignOverride'` vs `'forceAssign'`) so an organizer reviewing the log
  can see exactly when a sequencing rule was deliberately bypassed for one team.
- **If the team already holds a different in-flight task in the same stage**, `forceAssignTask`
  first releases it (reusing the same release path `skipTaskForTeam` uses internally, marking the
  displaced task `skipped`/`earnedScore: 0` and adjusting `requiredTaskCount` exactly like
  `planTaskSkip` already does — see `packages/shared/src/taskSkip.ts`) before claiming the new one,
  so a team is never left occupying two station slots. This means force-assign onto a task the
  team is ALREADY holding is a no-op refusal (`failed-precondition`), not a double-claim.

**Audit + notice**: writes an `auditLogs` record (privileged action, added to the declared list
per `scripts/lib/callableHardening.mjs`) and — mirroring `adjustTeamScore`'s existing best-effort
pattern — a team-targeted announcement so the participant app can surface "you've been sent to
{task}" instead of the task simply appearing with no explanation.

## Risks / Trade-offs

- **[Risk] A held team's in-flight client request races the hold** (team taps "submit" the instant
  before staff holds them) → **Mitigation**: server-side `assertTeamNotHeld` is authoritative; the
  worst case is one rejected call the client already handles via `describeCallFailure`
  (`rejected`/`failed-precondition`, non-retryable, clear copy) — no data corruption, matches how
  every other precondition race in this codebase resolves.
- **[Risk] Existing staff invites lack `manage_teams` and marshals mid-event suddenly lose access**
  → **Mitigation**: Decision 5's soft-gate default — never regress `adjustTeamScore`/
  `clearTeamOutOfBounds`/`skipTaskForTeam`, which are already callable by any signed-in staffer
  today; only the NEW hold action is gated, and only once the organizer opts in by re-issuing.
- **[Risk] `heldMs` accumulation double-counts if `setTeamHold(held:false)` is called twice
  (double-tap)** → **Mitigation**: guard identical to the existing double-toggle guards in this
  file — reject the second `held:false` with `failed-precondition` when `team.held` is already
  false, same shape as `setRunTaskStatus`'s existing idempotency handling; client already has
  `useAsyncAction` in-flight guards (`wave-b/async-action-guard`) so a same-render double-tap never
  reaches the server twice anyway.
- **[Risk] Map bundle regression** → **Mitigation**: `npm run bundle:budget` gate, and Decision 8's
  explicit lazy-mount via `lazyWithRetry` mirrors the one existing lazy pattern in this exact file.
- **[Trade-off] One coarse `manage_teams` permission instead of four granular ones** — simpler to
  reason about and to grant, at the cost of not letting an organizer give a marshal "score
  adjustment only" without hold power. Acceptable: RunConsolePage doesn't offer that granularity
  either.
- **[Risk] `override: true` on `forceAssignTask` deliberately breaks a sequencing rule the game
  designer authored on purpose** (an unlock gate exists to enforce an intended order) →
  **Mitigation**: off by default, distinctly audit-logged (`forceAssignOverride`), and still cannot
  touch station capacity or cross-stage boundaries — the blast radius is exactly "this one team,
  this one gate, this one instant," never a systemic bypass.
- **[Risk] A force-assign races a team's own in-flight `requestNextTask` poll** (team's phone polls
  for its next task the instant staff force-assigns a different one) → **Mitigation**: both go
  through the same run-doc transaction (`withLockRetry`/`db.runTransaction` in
  `assignNextTask.ts`), so they serialize; the loser of the race sees a normal transaction retry,
  not a corrupted double-assignment — identical to how two teams racing the same station today
  cannot both win it.
- **[Risk] The staff-channel doc grows unbounded over a long event** → **Mitigation**: reuses
  `appendCapped`/`CHAT_MAX_MESSAGES` unchanged (100-message cap), identical to every existing chat
  thread in this codebase.
- **[Risk] A marshal's urgent staff-channel message is missed because the organizer's laptop is
  turned away** → **Mitigation**: explicitly a non-goal (Non-goals: "not a ticketing/approval
  workflow"); this channel is coordination, not paging — an SOS-severity issue still goes through
  the existing `triggerSOS`/alerts path, which already has an audio cue
  (`apps/play-web/src/lib/sound.ts` `feedback('alert')`) and is unaffected by this change.

## Migration Plan

1. Ship `packages/shared` type + `pausedClock.ts` additions first (pure, additive, no runtime
   behavior change until a callable writes the new fields) — TDD: extend
   `functions/src/__property__/invariants.property.test.ts` or add a co-located
   `pausedClock.test.ts` case for `teamHeldExclusionMs`.
2. Ship the `setTeamHold` callable + guard insertion in `functions/src/runs/index.ts`, re-exported
   in `functions/src/index.ts`. TDD: new `scripts/e2e-verify.mjs` scenario (hold → every guarded
   callable rejects → resume → same callable succeeds → `heldMs` reflected in `getRunSummary`/
   leaderboard duration) — this ALSO satisfies the e2e "callable coverage guard" CLAUDE.md
   describes (a new callable ships RED until it has a scenario).
3. Ship `apps/play-web/src/services/calls.ts` wrappers, then the StaffConsole UI pieces
   (search → custom amount → quick actions → hold controls → map), each independently
   preview-verified + `npm run i18n:check:strict` (new Hebrew/English copy for hold state,
   custom-amount label, map, quick actions).
4. Ship the participant-facing hold banner (depends on step 2's field existing in
   `getMyTeamState`'s response).
5. Ship the score-adjustment reason UI (Decision 11) — pure client change, no server dependency,
   can land any time after/independent of the hold work.
6. Ship the staff↔admin channel (Decision 12): shared type + `FIRESTORE_PATHS` entry first, then
   the `sendStaffChannelMessage` callable + rules, then the StaffConsole section, then the
   RunConsolePage section — the two UI halves can ship in either order since each is independently
   useless without the other, but both must land before this sub-feature is "done."
7. Ship force-assign (Decision 13) last among the backend work — it's the highest-risk piece
   (touches the routing/station-claim path directly) and benefits from every other guard
   (hold-check, permission gate) already being in place and tested.
8. Rollback: every new field is additive/optional; reverting any callable and UI commits is safe
   at any point because no existing read path assumes the new fields exist (all guarded with `??`
   fallbacks per this codebase's existing "absent reads as default" convention). The one exception
   requiring care: `forceAssignTask`'s station-counter increment must be released
   (`releaseTask`) if a deploy is rolled back mid-use — no different from any other in-flight
   station claim during a rollback, and not a new failure mode this change introduces.

## Open Questions

- Exact copy/UX for `manage_teams` permission gating (hard 403 vs hide-only) — default proposed in
  Decision 5, needs organizer-facing confirmation in tasks.md before implementation.
- Whether `inviteStaff`'s default permission set should include `manage_teams` for ALL new invites
  going forward, or require the organizer to opt in per-invite — affects the desktop invite UI too
  (`RunConsolePage.tsx` staff invite flow), which is otherwise out of scope for this change.
- Where exactly the participant-facing "on hold" banner slots into `PlayScreen.tsx`'s existing
  state machine (waiting/routing/active-task/finished) — needs a read of that file before tasks.md
  finalizes the exact insertion point.
- Exact predicate name in the current `firestore.rules` for "this token carries this run's staff
  claims" — needs to be located and reused verbatim for the new `staffChannel/thread` read rule
  rather than re-derived.
- Whether the preset score-reason categories (Decision 11) should be creator-configurable per game
  or a fixed platform-wide list — default assumed is a fixed list for v1; making it configurable
  would touch the Builder and is treated as future scope unless the organizer explicitly wants it
  now.
- Whether `forceAssignTask`'s `override: true` path should itself require the coarse `manage_teams`
  permission or a stricter one — default assumed is the same `manage_teams` gate as everything
  else in this change (Decision 5), flagged here in case the organizer wants override specifically
  reserved to a smaller trust tier.

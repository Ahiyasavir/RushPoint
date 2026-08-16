## 1. Shared types + clock-exclusion math (team-hold foundation)

- [ ] 1.1 Add `held?`, `heldAt?`, `heldReason?`, `heldBy?`, `heldMs?` to `RunTeam`
      (`packages/shared/src/types/index.ts`), following the exact doc-comment style of the
      neighboring `outOfBounds`/`outOfBoundsAt`/`outOfBoundsOverrideUntil` fields.
- [ ] 1.2 Add `StaffPermission` member `'manage_teams'` to whatever union/const backs it today
      (locate via the existing `StaffInvite.permissions` type) — additive only.
- [ ] 1.3 Write a failing test in `packages/shared/src/pausedClock.test.ts` (or the existing test
      location for this file) for a new `teamHeldExclusionMs(team)` helper: returns 0 for
      `heldMs` absent/undefined, returns the value for a positive finite `heldMs`, clamps
      negative/non-finite input to 0 — mirroring `taskExcludedMs`'s guard style. Confirm it fails
      (function doesn't exist yet).
- [ ] 1.4 Implement `teamHeldExclusionMs` in `packages/shared/src/pausedClock.ts` to make 1.3 pass.
- [ ] 1.5 Refactor check: confirm `teamExcludedMs` is untouched (still task-only) and
      `teamHeldExclusionMs` is a separate, independently testable export — no shared mutable
      state between them.

## 2. `setTeamHold` callable

- [ ] 2.1 Write a failing `scripts/e2e-verify.mjs` scenario: launch a run, join a team, start it,
      call the (not-yet-existing) `setTeamHold` wrapper with `held: true` as an authorized
      staffer, assert the call currently 404s/throws (callable doesn't exist). Confirm RED.
- [ ] 2.2 Add `setTeamHold` in `functions/src/runs/index.ts`: validates ctx + `teamId` + `held`
      (+ optional `reason`), loads the team doc, and:
      - `held: true` on an unheld team → stamp `held/heldAt/heldReason/heldBy`; on an already-held
        team → `failed-precondition` (no write).
      - `held: false` on a held team → `heldMs += (now - heldAt)`, clear `held/heldAt/heldReason`;
        on a not-held team → `failed-precondition` (no write).
      - Writes an `auditLogs` record (this callable is privileged per
        `scripts/lib/callableHardening.mjs`'s declared-list convention — add it to that list).
- [ ] 2.3 Re-export `setTeamHold` from `functions/src/index.ts`.
- [ ] 2.4 Extend the e2e scenario from 2.1: hold succeeds, double-hold refuses, resume succeeds,
      double-resume refuses, `heldMs` visible afterward via `getRunSummary`/team read. Confirm
      GREEN.
- [ ] 2.5 Run `node scripts/test-callable-hardening.ts` to confirm the new callable's auth marker
      and audit-log declaration are recognized.

## 3. Guard every progress-advancing callable

- [ ] 3.1 Write a failing e2e scenario: hold a team, then attempt
      `requestNextTask`/`submitTaskAnswer`/`submitSequenceStep`/`verifyStationCode`/
      `reportArrival`/`checkOutTask`/`requestTaskHint` for that team — assert each currently
      SUCCEEDS today (proving the gap), i.e. the assertion should currently fail in the "refused"
      direction. Confirm RED for the right reason.
- [ ] 3.2 Add `assertTeamNotHeld(team)` (throws `failed-precondition` with a stable error code) in
      `functions/src/runs/index.ts` and call it at the top of each of the seven callables listed
      in 3.1, before any state read that assumes the team can act.
- [ ] 3.3 Confirm `getMyTeamState` is explicitly NOT guarded — add an e2e assertion that a held
      team can still read its own state and the response reflects `held`/`heldReason`.
- [ ] 3.4 Re-run the scenario from 3.1: all seven now refuse while held, `getMyTeamState` still
      succeeds. Confirm GREEN.
- [ ] 3.5 Refactor check: confirm the seven call sites read identically (same guard call, same
      position relative to existing guards) — no bespoke per-callable hold-check logic.

## 4. Clock exclusion in scoring

- [ ] 4.1 Write a failing e2e (or, if reachable without the emulator, a `buildRankings`-level
      vitest) assertion: a team held for a known duration mid-run has that duration reflected in
      its adjusted elapsed time on both `refreshLeaderboard` and `finalizeRun` output. Confirm RED.
- [ ] 4.2 In `functions/src/runs/index.ts`'s `buildRankings`, add
      `teamHeldExclusionMs(team)` to the existing `teamExcludedMs(stages)` total before computing
      adjusted elapsed time.
- [ ] 4.3 Confirm 4.1 GREEN, and confirm live (`refreshLeaderboard`) and final (`finalizeRun`)
      report the same adjusted duration for the same team (live/final parity).
- [ ] 4.4 Write/extend a test covering run finalization while a team is still actively held: the
      open hold interval up to finalization time is accounted for and the team is not left
      reporting as held afterward (per the team-hold spec's "hold cannot outlive the run"
      requirement).

## 5. `apps/play-web` service wrappers

- [ ] 5.1 Add typed wrappers in `apps/play-web/src/services/calls.ts` for `setTeamHold`, and for
      `clearTeamOutOfBounds`/`skipTaskForTeam` if not already present there (they exist in
      creator-web's `calls.ts` today — confirm whether play-web already has them before adding).
- [ ] 5.2 Confirm `npm run typecheck` passes for the new/changed wrappers.

## 6. StaffConsole: search

- [ ] 6.1 Add a `dir="auto"` search `Input` above the teams list in `StaffDashboard`
      (`apps/play-web/src/screens/StaffConsole.tsx`), filtering the existing sorted `teams` array
      by case-insensitive `displayName` substring match, as local `useState` — no backend change.
- [ ] 6.2 Add Hebrew + English copy for the search placeholder in `apps/play-web/src/i18n.ts`.
- [ ] 6.3 Preview-verify: type a filter, confirm only matching teams render; clear it, confirm
      full list returns.

## 7. StaffConsole: custom score amount

- [ ] 7.1 Add an inline "custom amount" expand per team row (numeric `inputMode`, Confirm button)
      next to the existing ±5/±10 buttons, reusing `adjustAction`/`adjust()` with the entered
      integer as `delta`. Confirm disabled/no-call on empty or non-integer input.
- [ ] 7.2 Add Hebrew + English copy (label, placeholder, confirm button) in `i18n.ts`.
- [ ] 7.3 Preview-verify: enter a custom amount (e.g. 27), confirm the team's live score updates
      and the existing `adjustAck` confirmation text shows the right delta.

## 8. StaffConsole: out-of-bounds clear + skip-task quick actions

- [ ] 8.1 Add a per-team "clear out-of-bounds" button, shown only when that team's live snapshot
      has `outOfBounds: true`, calling the 5.1 wrapper with an `useAsyncAction` guard matching the
      existing pattern in this file.
- [ ] 8.2 Add a per-team "skip task" button using `team.activeTaskId` from the live snapshot,
      calling the `skipTaskForTeam` wrapper, same in-flight-guard pattern.
- [ ] 8.3 Add Hebrew + English copy for both buttons and their confirmations in `i18n.ts`.
- [ ] 8.4 Preview-verify both actions against a real run: flag a team out of bounds (or seed one),
      confirm the clear button appears and works; confirm skip-task advances/skips the team's
      stage as `skipTaskForTeam`'s existing behavior dictates.

## 9. StaffConsole: hold / resume controls

- [ ] 9.1 Add a per-team hold/resume toggle button (reflecting `team.held` from the live
      snapshot), calling the 5.1 `setTeamHold` wrapper with an optional reason prompt, guarded via
      `useAsyncAction` like every other action in this file.
- [ ] 9.2 Gate the button's visibility/enablement on the `manage_teams` permission per design.md
      Decision 5's soft-gate default (hide, don't hard-403, for invites lacking the permission).
- [ ] 9.3 Add Hebrew + English copy (button label, held-state indicator, reason prompt) in
      `i18n.ts`.
- [ ] 9.4 Preview-verify: hold a team, confirm the seven guarded callables now visibly refuse from
      the participant side (see task 10), resume, confirm normal play resumes.

## 10. Participant-facing "on hold" notice

- [ ] 10.1 Read the current waiting/active-task state machine in the relevant play-web screen
      (confirm exact file — `PlayScreen.tsx` or equivalent) to find the right insertion point.
- [ ] 10.2 Add a `held` check that renders a `t.play.teamHeld` banner (with `heldReason` if
      present) instead of the normal task UI, fail-open on absent/stale data per
      `lib/stuckGuards.ts`'s existing convention.
- [ ] 10.3 Add Hebrew + English copy for the banner in `i18n.ts`.
- [ ] 10.4 Preview-verify end-to-end: staff holds a team in one tab, the team's own tab shows the
      banner within one snapshot refresh; staff resumes, banner clears and play resumes.

## 11. StaffConsole: live team-location map

- [ ] 11.1 Create `apps/play-web/src/components/StaffTeamMap.tsx`, reading the same
      `teamLocations` collection `LiveTeamMap.tsx` reads (via `FIRESTORE_PATHS`), rendering one pin
      per team with a recent location and a tap target that opens the existing
      `google.com/maps/dir` deep link pattern already used for SOS alerts.
- [ ] 11.2 Mount it via `lazyWithRetry` (matching the existing `FeedPanel` pattern in
      `StaffConsole.tsx`) inside a new `<Collapsible>` section, collapsed by default.
- [ ] 11.3 Add Hebrew + English copy for the section header/empty state in `i18n.ts`.
- [ ] 11.4 Run `npm run play:build && npm run bundle:budget` and confirm the map's mapping library
      is absent from the entry chunk (matches the existing budget assertion style).
- [ ] 11.5 Preview-verify: expand the section with at least one team reporting a location, confirm
      its pin renders and its directions link opens correctly.

## 12. StaffConsole: score-adjustment reason

- [ ] 12.1 Add a small preset-reason list (plain string array, e.g. in
      `apps/play-web/src/lib/scoreReasons.ts`) covering common categories plus an "Other" free-text
      option, following the fixed-vocabulary pattern already used for `t.staff.alertType`.
- [ ] 12.2 Wire the reason picker into the custom-amount control from task group 7 (Decision 11):
      selecting a preset or typing free text sets the `reason` passed to `adjustTeamScore`,
      replacing the hardcoded `reason: 'staff'` in `adjust()`. Confirm a blank reason still submits
      successfully (optional, never required — per spec).
- [ ] 12.3 Add Hebrew + English copy for every preset category and the "Other" free-text label in
      `i18n.ts`.
- [ ] 12.4 Write/extend an e2e assertion: an `adjustTeamScore` call carrying a specific reason
      produces an `auditLogs` entry containing that exact reason (confirms the already-existing
      server behavior end-to-end from the new client path, not just trusting it was already
      covered).
- [ ] 12.5 Preview-verify: pick a preset reason, confirm the adjustment succeeds and (if reachable
      in the preview) the audit log / score notice reflects it.

## 13. Staff↔admin channel: shared types + storage

- [ ] 13.1 Add `StaffChannelMessage` (mirroring `ChatMessage`'s shape with
      `from: 'staff' | 'admin'`) and a `staffChannelMessageSide` pure helper to
      `packages/shared/src/chat.ts`, plus a `staffChannelSeenStorageKey(runId)` helper (no teamId
      component).
- [ ] 13.2 Write a failing test for `staffChannelMessageSide` (mirrors whatever test coverage
      `chatMessageSide` already has) before implementing it. Confirm RED, then GREEN.
- [ ] 13.3 Add the new doc path to `FIRESTORE_PATHS` (`runStaffChannelDoc(ownerUid, gameId, runId)`
      or equivalent), pointing at the singleton `staffChannel/thread` doc under the run.
- [ ] 13.4 Locate the existing staff-claims read predicate in `firestore.rules` (used by the
      alerts/team-chat rules today) and add a rule granting read on the new doc to the owner and to
      any token carrying this run's staff claims, with no client write permission at all.
- [ ] 13.5 Run `npm run test:rules` and confirm the new rule behaves as intended (owner reads OK,
      scoped staff reads OK, unrelated user refused, direct client write refused).

## 14. Staff↔admin channel: `sendStaffChannelMessage` callable

- [ ] 14.1 Write a failing e2e scenario: an authorized staffer sends a channel message, the owner
      reads it; the owner replies, the staffer reads it; an unrelated/unauthorized caller is
      refused. Confirm RED (callable doesn't exist yet).
- [ ] 14.2 Implement `sendStaffChannelMessage` in `functions/src/runs/index.ts` (or `index.ts`,
      matching where `sendTeamChatMessage` lives): `assertStaffOrOwner` guard, sanitize text via
      the existing `sanitizeChatText`, stamp `from` server-side from `context.auth.uid === ownerUid`,
      resolve `senderName` from the staff token's `staffName` claim or the owner's profile,
      `appendCapped` onto the singleton doc.
- [ ] 14.3 Re-export from `functions/src/index.ts`.
- [ ] 14.4 Confirm the e2e scenario from 14.1 is GREEN.

## 15. Staff↔admin channel: UI (both apps)

- [ ] 15.1 Add typed wrapper `sendStaffChannelMessage` to `apps/play-web/src/services/calls.ts`
      and `apps/creator-web/src/services/calls.ts`.
- [ ] 15.2 Add a new `<Collapsible>` section to `StaffConsole.tsx` mirroring `StaffChatSection`'s
      structure but for the single shared thread (no team picker), with an unread badge via
      `countUnreadChatMessages` + the new seen-storage key.
- [ ] 15.3 Add an equivalent section to `RunConsolePage.tsx` for the admin side.
- [ ] 15.4 Add Hebrew + English copy for the channel's header, empty state, and composer in both
      apps' `i18n.ts` files.
- [ ] 15.5 Preview-verify end-to-end: open both a staff session and an admin session against the
      same run, send from each side, confirm the other sees it and the unread indicator behaves
      correctly.

## 16. Force-assign: callable

- [ ] 16.1 Write a failing e2e scenario: force-assign a team to an eligible unassigned task in its
      current stage — assert it currently 404s/throws (callable doesn't exist). Confirm RED.
- [ ] 16.2 Implement `forceAssignTask` in `functions/src/runs/index.ts` per design.md Decision 13:
      validate the target task belongs to the team's current active stage; reuse `assignTask`'s
      transactional claim shape (never bypass the capacity check); if the team holds a different
      in-flight task in the stage, release it first (reusing `skipTaskForTeam`'s internal release
      logic / `planTaskSkip`); refuse a same-task no-op force-assign.
- [ ] 16.3 Add the `override` flag: when true, bypass `isUnlocked`/`isReleased`/`isExpired` for the
      chosen task ONLY (never the capacity check); log distinctly as `forceAssignOverride`.
- [ ] 16.4 Write the audit-log entry (privileged action — add to `scripts/lib/callableHardening.mjs`'s
      declared list) and the best-effort team-targeted notice (mirroring `adjustTeamScore`'s
      pattern), consumed by the participant notice in task group 18.
- [ ] 16.5 Re-export from `functions/src/index.ts`.
- [ ] 16.6 Extend the e2e scenario from 16.1: eligible force-assign succeeds; a full-station target
      is refused; a task outside the current active stage is refused; force-assigning the team's
      own current task is refused; displacing an in-flight task releases its slot; an `override`
      force-assign succeeds against a locked/not-yet-released/expired task but is STILL refused
      against a full station. Confirm GREEN for all.
- [ ] 16.7 Run `node scripts/test-callable-hardening.ts` to confirm the new callable's auth marker
      and audit-log declaration are recognized.

## 17. Force-assign: StaffConsole UI

- [ ] 17.1 Add a per-team "send to task" control (task picker scoped to the team's current active
      stage's tasks, sourced from data already available to the console or a small new read),
      gated on the `manage_teams` permission like the hold controls, with an `useAsyncAction` guard
      matching the rest of the file.
- [ ] 17.2 Surface the `override` option distinctly (e.g. a secondary confirm step or a visibly
      separate toggle) so it can never be tapped by accident — matches design.md's intent that
      override be a deliberate, visible action.
- [ ] 17.3 Add Hebrew + English copy for the control, its confirmation, and the override warning in
      `i18n.ts`.
- [ ] 17.4 Preview-verify: force-assign a team to a specific eligible task, confirm it takes effect;
      attempt an assignment against a full station and confirm it is refused with clear copy.

## 18. Force-assign: participant notice

- [ ] 18.1 Add a notice/toast in the participant app (mirroring however `kind: 'score'`
      announcements are already rendered) for a `kind: 'forceAssign'` notice, shown when a team's
      task changes because staff redirected them.
- [ ] 18.2 Add Hebrew + English copy for the notice in `apps/play-web/src/i18n.ts`.
- [ ] 18.3 Preview-verify: force-assign a live team from a staff session, confirm the notice
      appears on the participant side.

## 19. Full gate + i18n

- [ ] 19.1 Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run creator:build`,
      `npm run play:build`, `npm run bundle:budget`, `npm run base:check`, `npm run origin:check`
      and confirm all green.
- [ ] 19.2 Run `npm run i18n:check:strict` and confirm zero PART A errors and zero NEW PART B
      findings from this change's UI additions (StaffConsole, RunConsolePage, and any new
      participant-facing copy).
- [ ] 19.3 Run `npm run e2e` and confirm the full scenario suite (including every scenario added in
      task groups 2–4, 12, 14, and 16) passes, and that the e2e callable-coverage guard recognizes
      `setTeamHold`, `sendStaffChannelMessage`, and `forceAssignTask` as invoked (not landing on the
      `EXEMPT` list).
- [ ] 19.4 Run `npm run test:rules` again after all changes land, to confirm the new staff-channel
      rule still behaves correctly alongside every other rule.
- [ ] 19.5 Manual phone-width preview pass (resize to mobile) over every new control in
      `StaffConsole.tsx`: search, custom amount + reason, out-of-bounds clear, skip task,
      hold/resume, live map, staff↔admin channel, force-assign — confirm 44px-minimum tap targets
      and no layout overflow.

## Why

The mobile staff console (`?staff`, `apps/play-web/src/screens/StaffConsole.tsx`) is the ONLY
device marshals hold in the field, but it lags far behind the desktop Run Console
(`apps/creator-web/src/pages/RunConsolePage.tsx`) that the organizer uses from a laptop. A marshal
standing at a station cannot award more than a hardcoded ±10, cannot find one team in a long
scrolling list, cannot see where any team physically is beyond a single SOS pin, and has no way to
put a team on hold during a dispute or injury — that last one doesn't exist ANYWHERE in the
product yet, desktop included. Every one of these gaps currently forces a marshal to radio the
organizer's laptop instead of acting on the spot, which is exactly the failure mode a live event
cannot absorb.

## What Changes

- Manual score adjustment gains a "custom amount" affordance in StaffConsole (a numeric-keypad
  entry, not a fixed ±5/±10 button and not a browser `prompt()`) that calls the existing
  `adjustTeamScore` callable with an arbitrary delta — the callable already accepts any delta
  today; only the client is capped.
- The teams list (bonus/deduction section) gains a live, RTL-aware search/filter input so a
  marshal can type a few letters and jump to one team instead of scrolling.
- StaffConsole gains a lazy-loaded live map showing every active team's last-known
  `teamLocations` pin (mirroring `apps/creator-web/src/components/LiveTeamMap.tsx`), tappable per
  team to open turn-by-turn directions — replacing today's single per-alert Google Maps link as
  the only location signal a marshal has.
- **New capability, BREAKING nothing (additive only): a per-team hold.** Staff can put an
  individual team on hold (injury, dispute, staff-requested pause) and release them. While held,
  the team's race clock stops accruing (excluded from scoring exactly like an existing
  clock-pausing task), and every progress-advancing callable
  (`requestNextTask`/`submitTaskAnswer`/`submitSequenceStep`/`verifyStationCode`/`reportArrival`/
  `checkOutTask`/`requestTaskHint`) refuses with a clear, participant-visible reason instead of
  silently no-op'ing. This is new server-side state and enforcement, not a UI-only change.
- StaffConsole gains quick per-team actions for two callables that already exist but are
  desktop-only today: clearing a team's out-of-bounds flag (`clearTeamOutOfBounds`) and skipping a
  team's stuck task (`skipTaskForTeam`).
- All new controls follow this codebase's existing mobile-safety doctrine: 44px-minimum tap
  targets, fail-open on any client-side read/connectivity flag, and the new map stays behind a
  lazy import so it cannot regress the `bundle:budget` gate.
- **New capability: a lightweight staff↔admin channel.** One shared thread per run between the
  field staff (any marshal) and the run's owner, reusing the existing team↔HQ chat's proven
  message shape/read-tracking (`packages/shared/src/chat.ts`) rather than inventing new plumbing.
  Lets a marshal report an issue or request an exception approval without leaving the app, and
  lets the organizer answer from either the desktop Run Console or their own phone.
- **New capability: direct task assignment ("force assign").** Staff can pick a SPECIFIC task
  within a team's current active stage and send that team to it directly, instead of only ever
  waiting for the smart-routing pick. Reuses the existing atomic station-claim machinery
  (`assignTask`/`releaseTask` in `functions/src/routing/assignNextTask.ts`) so the station-capacity
  invariant this codebase's e2e suite already guards cannot be silently broken — see design.md for
  exactly which gates a force-assign may and may not bypass.
- Custom score adjustments (from the "What Changes" item above) gain a **reason**: free text or a
  small set of preset categories (e.g. "Creativity Bonus", "Late Penalty"), carried through to the
  existing `adjustTeamScore` callable's `reason` parameter and therefore into the existing
  `auditLogs` record it already writes — the audit-log write path already exists and already
  accepts a reason; only the StaffConsole UI is missing the field (it hardcodes `reason: 'staff'`
  today).

## Non-goals

- No redesign of the existing SOS/photo-review/chat/announcement/feed sections — they are
  untouched.
- No change to the desktop Run Console's own UI (it already has search-free team access, its own
  score-adjustment prompt, and its own map — this change brings the mobile console up to parity,
  it does not change the desktop one), beyond whatever the shared `team-hold` capability requires
  it to surface (see design.md).
- No "stop the whole run" control — that's the existing organizer-only run lifecycle, out of
  scope.
- No offline queueing of staff actions taken while the device itself is offline — every action
  here is online-required like the rest of StaffConsole; "durable on the phone" in this change
  means resilient to normal field conditions (rejoins, backgrounding, flaky signal), not full
  offline-first.
- The staff↔admin channel is a single flat thread per run (like the existing team↔HQ chat), not a
  per-marshal DM system or a ticketing/approval workflow with states — it's for quick coordination,
  not a formal request queue.
- Force-assign targets a task inside the team's own CURRENT active stage only. It does not let
  staff jump a team into a locked future stage, back into an already-completed stage, or onto a
  task belonging to a different team's stage structure — see design.md for exactly why.
- No new admin-side desktop UI redesign — the admin's half of the staff↔admin channel is added to
  the existing `RunConsolePage.tsx` as a new section, not a rebuild of that page.

## Capabilities

### New Capabilities
- `team-hold`: server-side per-team hold/resume — new callable(s), new `Run`-scoped state, clock
  exclusion, and refusal behavior across every progress-advancing callable while a team is held.
- `staff-console-team-tools`: the mobile staff console's team-management surface — search/filter,
  custom-amount score adjustment, and the two quick actions (clear out-of-bounds, skip task) newly
  exposed on mobile.
- `staff-console-live-map`: a lazy-loaded, phone-sized live map of all teams' locations inside
  StaffConsole.
- `staff-admin-channel`: a shared, run-scoped messaging thread between field staff and the run's
  owner, surfaced on both StaffConsole (play-web) and RunConsolePage (creator-web).
- `force-task-assignment`: staff-directed assignment of a team onto a specific task within its
  current active stage, bypassing the smart-routing pick while preserving station-capacity
  integrity.

### Modified Capabilities
- `staff-authentication`: no requirement change — listed only because the new hold/quick-action
  callables extend the existing `staffSignIn`-minted token's authorized action set; if design.md
  determines a new staff `permissions` flag is needed, this becomes a real delta.

## Impact

- **Backend**: `functions/src/runs/index.ts` (new hold/resume callable(s), guard checks added to
  the progress-advancing callables listed above, new `sendStaffChannelMessage` callable, new
  `forceAssignTask` callable reusing `assignTask`/`releaseTask`), `functions/src/index.ts`
  (re-exports), `packages/shared/src/types/index.ts` (new `Run`-scoped hold state),
  `packages/shared/src/chat.ts` (new staff-channel message type, sibling to `ChatMessage`),
  `packages/shared/src/pausedClock.ts` (extending the exclusion helper to cover a hold interval
  alongside a clock-pausing task), `functions/src/index.ts`'s `adjustTeamScore` (unchanged
  server-side — it already accepts `reason`; only its callers gain a real field to fill).
- **play-web**: `apps/play-web/src/screens/StaffConsole.tsx` (search, custom amount + reason,
  quick actions, hold/resume controls, staff-channel section, force-assign controls),
  `apps/play-web/src/services/calls.ts` (new typed wrappers), a new lazy map component, and
  whatever participant-facing surface needs to show "your team is on hold" (likely
  `apps/play-web/src/components/TaskRunner.tsx` or the top-level play screen — design.md decides
  exactly where).
- **creator-web**: a new staff-channel section in `RunConsolePage.tsx` (the admin's side of the
  channel), and optionally surfacing hold state on the desktop team rows too, so an organizer
  watching the laptop isn't blind to a marshal-initiated hold (design.md decides scope).
- **Firestore rules**: a new rule for the staff-channel doc (staff-of-this-run + the owner may
  read; no client writes — mirror the existing team-chat rule shape), otherwise no change expected
  (all other new state is server-write-only via the existing Run/team-doc pattern) — design.md must
  confirm exact placement against the current `firestore.rules`.
- **Bundle budget**: the new live map must stay lazy-loaded in play-web; `npm run bundle:budget`
  gates this.

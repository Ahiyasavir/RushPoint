## Why

A run's phone count is currently unbounded across teams: `joinRun` caps the number of
**teams** (billing `maxParticipants`), and `joinTeamAsDevice` caps phones **per team**
(`MAX_TEAM_DEVICES`), but nothing caps the **total phones in a single run**. A Pro run (up
to 50 teams × 3 phones) could hold 150 live phones. Ahead of real-user simulations we want a
temporary, hard safety ceiling so an unbounded number of phones can't destabilize a run.

## What Changes

- Introduce a global per-run device ceiling `MAX_RUN_DEVICES = 16` (in
  `functions/src/runs/teamDevices.ts`, beside `MAX_TEAM_DEVICES`).
- Add a pure decision helper `canAddRunDevice(currentDeviceCount)` →
  `{ ok: true } | { ok: false, reason: 'run-full' }`.
- Enforce the ceiling **additively to the existing billing participant cap** in BOTH join
  paths, inside their existing Firestore transactions:
  - `joinRun` — the founding phone of a new team.
  - `joinTeamAsDevice` — an attached teammate phone.
  When the run already holds 16 phones, the join is rejected with
  `HttpsError('resource-exhausted', …, { cap, used })`.
- Maintain a monotonic `run.deviceCount` counter (incremented on every phone join). There is
  **no detach/leave path**, so it never decrements. Legacy runs missing the field fall back to
  `run.participantCount` (a lower bound: founders only).
- Add `deviceCount?: number` to the `Run` type in `packages/shared/src/types/index.ts`.
- Define the ceiling + `canAddRunDevice` + `isRunDeviceCapActive()` in `@rushpoint/shared`
  (`runCapacity.ts`) as the **single knob**: raising it is a one-line edit; setting it to
  `Infinity` disables enforcement AND hides the creator warning. The backend re-exports it.
- **Creator warning:** the run console's join/share card shows a bilingual note stating the
  per-run phone limit (reads the same shared constant; hidden when the cap is removed).

This modifies the behavior of two existing callables (`joinRun`, `joinTeamAsDevice`) — no new
callable, no client-write. Surfaces touched: **shared types + shared constant** + **two
callables** + **creator-web** (one warning note, HE/EN). The join rejection reuses the existing
resource-exhausted error.

## Capabilities

### New Capabilities
- `run-device-cap`: A hard global ceiling on the total number of phones (devices) that may
  join a single run, enforced transactionally at both join entry points, layered on top of the
  existing per-team and billing caps.

### Modified Capabilities
<!-- The billing participant cap (run-billing) and per-team device cap (shared-team-devices)
     are unchanged in their own right; this change adds a NEW additive ceiling rather than
     altering their requirements, so it is captured as a new capability. -->

## Impact

- `functions/src/runs/teamDevices.ts` — new constant + pure helper.
- `functions/src/runs/index.ts` — enforcement + `deviceCount` maintenance in the `joinRun` and
  `joinTeamAsDevice` transactions.
- `packages/shared/src/types/index.ts` — new optional `Run.deviceCount` field.
- Tests: `functions/src/runs/teamDevices.test.ts` (pure boundary), `scripts/e2e-verify.mjs`
  (17th phone rejected).
- **Non-goals**: no detach/leave callable; no per-run configurability of the ceiling (it is a
  fixed temporary constant); no change to the billing `maxParticipants` cap or to
  `MAX_TEAM_DEVICES`; no UI copy naming the limit.

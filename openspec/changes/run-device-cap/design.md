## Context

Two caps already govern who can join a run, at two different granularities:

- **Billing participant cap** — `joinRun` increments `run.participantCount` (one per **team**)
  and rejects once it reaches `run.maxParticipants` (free 5 / credit 15–50 / Pro 50), inside a
  Firestore transaction on the run doc so concurrent joins can't overshoot.
- **Per-team device cap** — `joinTeamAsDevice` attaches an extra phone to an existing team and
  rejects once that team holds `MAX_TEAM_DEVICES` (3) phones (`canAttachDevice`).

Neither bounds the **total phones in a run**. This change adds that third, global ceiling. It is
a temporary safety valve ahead of real-user simulations, deliberately small (16) and additive.

## Goals / Non-Goals

**Goals:**
- A hard ceiling of 16 phones per run, enforced at both join entry points.
- Transaction-safe (no overshoot under concurrent joins), matching the existing `participantCount`
  pattern.
- A pure, unit-testable decision helper so the boundary is covered without the emulator.
- Zero drift: the counter is correct without a reconciliation job.

**Non-Goals:**
- No detach/leave/kick path (out of scope; the counter is intentionally monotonic).
- No per-run/plan configurability — one fixed constant "for now".
- No change to `maxParticipants` or `MAX_TEAM_DEVICES` semantics.
- No UI copy that names the number.

## Decisions

### D1 — Track a monotonic `run.deviceCount` counter rather than counting live

Each phone join increments `run.deviceCount` by one inside the join transaction. The alternative
— counting `Σ deviceUids.length` across all team docs at join time — would require reading every
team doc inside `joinTeamAsDevice`'s transaction (it currently reads only the target team),
adding cost and contention. Since **no detach path exists**, a monotonic counter can never drift
below the true total, so the cheap counter is exactly correct. Legacy runs missing the field read
`run.participantCount` as the seed (a safe lower bound — founders only — that then becomes exact
as `deviceCount` is written on the next join).

### D2 — A pure `canAddRunDevice(currentDeviceCount)` helper in `teamDevices.ts`

Mirrors the existing `canAttachDevice` shape (`{ ok } | { ok:false, reason }`). Keeping the
decision pure means the 15-ok / 16-full boundary is a fast vitest case with no emulator, and the
two callables share one source of truth for the ceiling. Reason value: `'run-full'`.

### D3 — Enforce inside the existing transactions, additively

`joinRun` already runs a transaction that reads the fresh run doc and checks the billing cap;
the device-ceiling check slots in beside it (`used = r.deviceCount ?? r.participantCount`), and
the same `t.update(runRef, …)` that writes `participantCount` also writes `deviceCount`.
`joinTeamAsDevice` already transacts on the team; it additionally reads the run doc in the same
transaction to check + increment `deviceCount`. Both throw `resource-exhausted` with `{ cap, used }`
so the client surfaces the same "run is full" family of errors it already handles.

### D4 — Rejection error shape reuses `resource-exhausted`

The billing cap already throws `HttpsError('resource-exhausted', msg, { cap, used })`; the global
ceiling reuses that code and detail shape so no new client handling or i18n string is required.

## Risks / Trade-offs

- **[Counter drift if a detach path is ever added]** → Documented as a non-goal; if a leave/kick
  callable is introduced later, it must decrement `deviceCount` (or the cap switches to live
  counting). Called out in the spec and here so the constraint is discoverable.
- **[Legacy-run undercount on first join]** → Seeding from `participantCount` ignores already-
  attached extra devices on a pre-existing multi-device team, so the very first post-deploy join
  could admit a phone slightly over the true total. Acceptable: the window is one join, the drift
  is bounded by `MAX_TEAM_DEVICES-1`, and it self-corrects as `deviceCount` takes over. Simulations
  (fresh runs) are unaffected.
- **[16 too low for a large real event]** → Intentional temporary ceiling; raising it is a
  one-line constant change. Simulations run at ≤9 teams, well under 16.

## Migration Plan

Pure additive deploy — a new optional field and two in-transaction checks. No backfill needed
(the `?? participantCount` fallback handles in-flight runs). Rollback = revert the constant/checks;
the orphaned `deviceCount` field is harmless.

## Open Questions

None.

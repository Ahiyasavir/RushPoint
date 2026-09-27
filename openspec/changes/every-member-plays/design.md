## Context

`functions/src/runs/teamDevices.ts` holds the whole device model:

```ts
export const MAX_TEAM_DEVICES = 3;

export function canAttachDevice(team, uid): AttachDecision {
  if (team.status === 'finished') return { ok: false, reason: 'finished' };
  const uids = attachedDeviceUids(team);
  if (uids.includes(uid))            return { ok: false, reason: 'duplicate' };
  if (uids.length >= MAX_TEAM_DEVICES) return { ok: false, reason: 'full' };
  return { ok: true };
}

export function assertController(team, uid) {
  if (resolveDeviceRole(team, uid) !== 'controller') throw ... 'not-controller' ...
}
```

Every mutating participant callable passes `{ requireController: true }`, so
`assertController` is the single choke point that makes a teammate a spectator.

`RunTeam` already carries both numbers the requirement needs — `memberCount` (set at
join from `memberNames.length || 1` in team mode) and `deviceUids` — and nothing compares
them.

## Goals / Non-Goals

**Goals:** everyone can attach; the gap is visible; a game can require full attendance; a
mission can require several people to act.

**Non-Goals:** proving a human is present, changing who may submit, per-person mission
content, bank content decisions, reworking the join flow. See `proposal.md`.

## Decisions

### D1 — The device ceiling follows the team, and the run ceiling stays the authority

`MAX_TEAM_DEVICES` becomes `teamDeviceAllowance(team)`:

```
max(MAX_TEAM_DEVICES, min(memberCount, TEAM_DEVICE_HARD_CAP))
```

- `max(MAX_TEAM_DEVICES, …)` so **no team loses capacity it has today**, including a
  solo player who wants a second handset.
- `min(…, TEAM_DEVICE_HARD_CAP)` so a team that typed `999` into a headcount field
  cannot write itself an unbounded budget. The cap is a property of what a run can
  afford, not of what a team claims.
- `canAddRunDevice` / `MAX_RUN_DEVICES` (150) is untouched and still decides last. A
  generous per-team allowance inside a fixed run ceiling reallocates phones between
  teams; it does not create new ones.

### D2 — Read cost is the constraint that decides the numbers, so it is answered here

Every attached phone polls `getMyTeamState` on its own timer — `PlayScreen` runs a 60s
refresh and a 3s in-flight poll. So the device ceiling multiplies the product's
most-called participant read, and CLAUDE.md treats the Spark daily ceiling as a hard
design constraint, not a nice-to-have.

**This is why the run-wide ceiling is the one that matters and is NOT being raised.**
`MAX_RUN_DEVICES = 150` already bounds the worst case, and it bounds it in the only unit
that maps to reads: total phones in the run. Raising a team's share of that 150 changes
how the phones are distributed, not how many there are. A 20-team run with 6 phones each
is 120 devices — the same read load as 40 teams of 3, which the platform already permits.

`TEAM_DEVICE_HARD_CAP` therefore exists to stop one team eating the run's whole budget,
not to limit reads on its own.

### D3 — The comparison is total and never invents a shortfall

`teamAttendance(team)` returns `{ declared, attached, missing }` where `missing` is
**null** when the headcount is unknown — not 0 and not "all of them".

This matters because `memberCount` is only meaningful when the game actually collects
member names. In individual mode it is always 1; in team mode without a names field it
is 1 as well. Reporting "5 people missing" for a game that never asked how many people
there are would be a confident lie, and a gate built on it would block teams for a
question they were never asked.

So: **unknown is a first-class answer**, and the gate in D4 treats it as "do not block".

### D4 — The attendance requirement is opt-in and fails OPEN

`Game.requireAllMembersOnline`, off by default, held at the same place guardian consent
is held — a held team is a state the console already renders and the player app already
explains (`holdNotice.ts`), so this reuses a path rather than inventing a second kind of
waiting.

It does not apply when the headcount is unknown (D3). A team is never blocked on the
basis of a number the platform cannot read.

### D5 — A contribution is additive, and never a second way to complete

`Task.requiredContributors` (a number) plus a per-team map
`RunTeam.taskContributions: { [taskId]: string[] }` of distinct device uids.

A new callable `contributeToTask` is the **only** mutation a non-controller device may
make. It does not complete the task, does not score, and does not move the team; it
records that this person did their part. The controller still submits.

Keeping the two acts separate is what stops this becoming a second completion path with
its own scoring, idempotence and station-slot edge cases — the completion path stays
exactly one function.

### D6 — A requirement larger than the team is reduced, never impossible

`effectiveContributorRequirement(task, team)` returns
`min(requiredContributors, attachedDevices)`.

A mission authored for four contributors, played by a team of two, must not be
unwinnable. This mirrors `planTaskSkip` lowering a stage's `requiredTaskCount` to what is
still attainable — the same rule, applied to people instead of missions.

### D7 — Honest about what this is worth

One participant can carry three phones and tap all of them. This raises the cost of
non-participation and makes it **visible**, which is what the organizer actually lacked.
It is not proof of presence, and the proposal says so in its non-goals rather than
letting the feature imply a guarantee it cannot keep.

## Test Strategy

**Pure — `npm test`, `scripts/test-team-participation.ts`:**

- `teamAttendance`: the six-people-one-phone case; a full team; more devices than
  declared; **unknown headcount yielding null rather than a number**; legacy docs with no
  `deviceUids`; totality.
- `teamDeviceAllowance`: a large team gets one each; a small or unknown team keeps
  today's 3; the hard cap bounds an absurd headcount; the result is never below today's
  ceiling.
- `contributorsSatisfied` / `effectiveContributorRequirement`: distinct devices only; the
  same device twice counts once; a requirement larger than the team is reduced; no
  requirement means no contribution needed; totality.
- A seeded sweep asserting the allowance is never below the current constant and never
  above the hard cap, and that a satisfied requirement is always satisfiable.

**e2e — `npm run e2e`:** a new callable means a new scenario or the coverage guard fails
the run. Assertions: a non-controller device may contribute and may still not submit; two
distinct devices satisfy a two-contributor mission; one device twice does not; the
controller can then complete; a fourth device can attach to a team of six.

**UI:** preview verification plus `i18n:check:strict`, and every new game field added to
`BUILDER_EDITABLE_FIELDS` with `scripts/test-game-presentation.ts` green.

## Risks / Trade-offs

- **[Raising the device ceiling raises reads]** → answered in D2: the run-wide ceiling,
  which is the one that maps to read load, does not move.
- **[A team is blocked by a headcount they mistyped]** → the gate is opt-in, fails open on
  unknown, and holds rather than refuses, so an organizer can release them the same way
  they release a consent hold.
- **[`contributeToTask` becomes a second completion path]** → D5: it records a name and
  nothing else. The completion path stays one function.
- **[A mission becomes unwinnable for a small team]** → D6.
- **[This does not stop a determined cheat]** → D7, stated rather than implied away.

## Migration Plan

Land in two shippable halves. **A**: the allowance, the attendance arithmetic and the
visibility — server by VPS rebuild, apps by `deploy:hosting`; useful on its own and
risk-free, because nothing is gated yet. **B**: the requirement and the contribution
callable, which need the e2e scenario and the play-web action.

**Rollback:** revert. Every field is optional and off by default; a run in flight keeps
whatever it was launched with.

## Open Questions

1. **Should a contribution be tied to the mission's own interaction** — each person takes
   a photo, each answers — rather than a generic "I did my part"? Richer, and a much
   larger change: it needs a per-task-type contribution UI and a per-type notion of what
   a partial contribution even is.
2. **Should the organizer be able to see WHO contributed**, not just how many? The data
   supports it (`devices[].name`); whether the console should show it is a question about
   how much surveillance of children is appropriate, and it deserves a deliberate answer
   rather than a default.

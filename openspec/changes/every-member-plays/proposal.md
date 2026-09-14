## Why

From the 2026-09-10 run: *"Lack of engagement from all team members. Right now it is
enough for one participant to watch the video or do the mission for the team to advance,
which leads to some members being inactive. There needs to be a mechanism that requires
all participants to join from their own devices and do part of the mission."*

This is not a defect. **One person acting is the design**, stated in the code:

> *"Shared team devices: one phone per attached participant; **exactly one
> (`controllerUid`) may submit**."* — `packages/shared/src/types/index.ts`

Every participant callable that changes anything runs through
`resolveCallerTeam(..., { requireController: true })` → `assertController`, which rejects
any device that is not the controller with `not-controller`. So a teammate on their own
phone is, by construction, a **spectator**. The observed behaviour is the architecture
working as specified.

Three facts make the requested mechanism impossible today, in increasing order of how
much they matter:

1. **A team cannot even get everyone onto a phone.** `MAX_TEAM_DEVICES = 3`
   (`functions/src/runs/teamDevices.ts`). `canAttachDevice` refuses the fourth with
   `'full'`. A family of five, or the six-person teams this run had, physically cannot
   all attach — the requirement is unsatisfiable before anyone even tries.
2. **The platform already knows the gap and never looks at it.** `RunTeam.memberCount`
   is how many people the team said they are; `deviceUids.length` is how many phones
   turned up. Nothing anywhere compares them. A team of six sharing one phone is
   indistinguishable, to every screen in the product, from a solo player.
3. **Only the controller can act.** Even with six phones attached, five of them can
   submit nothing.

So the organizer had no way to know that most of a team was standing around, and no
lever to change it if they had.

## What Changes

- **A team can put everybody on their own phone.** The per-team device ceiling stops
  being a fixed 3 and follows the team's own declared size, within a bound the run can
  afford.
- **The gap between people and phones becomes visible** — to the team, who are told how
  many of them are still not connected, and to the organizer, who can see which teams
  are really one phone in a trench coat.
- **A game may require it.** Off by default: a creator can say that every declared member
  must be on their own device before the team plays.
- **A mission may require more than one person to act.** A mission can ask that a number
  of distinct devices each contribute before it completes, so "do part of the mission"
  is enforced rather than hoped for.

**BREAKING**: none by default. Every setting is opt-in, and a team that does not use
them behaves exactly as it does today.

## Capabilities

### New Capabilities
- `team-participation`: how many of a team's people are actually present and acting,
  and what the platform does about the difference.

### Modified Capabilities
- `shared-team-devices`: the per-team device ceiling becomes a function of the team
  rather than a constant, and a non-controller device gains one thing it may do.

## Impact

- **Surfaces**: `packages/shared` (the participation arithmetic and the contribution
  rule), `functions` (the device cap, a contribution callable, the completion gate),
  `apps/play-web` (the "who is still missing" prompt and the per-device contribute
  action), `apps/creator-web` (the Builder settings and the console's view of it).
- **A NEW callable** for a non-controller device to record its contribution — so it needs
  a typed wrapper in `services/calls.ts` and its own `e2e-verify.mjs` scenario, or the
  callable-coverage guard fails it. That is the intended process.
- **Read cost is the real constraint and is not hand-waved.** Every attached phone polls
  `getMyTeamState` on its own timer, so raising the device ceiling multiplies the
  product's most-called read by the number of extra phones. CLAUDE.md treats the Spark
  daily ceiling as a hard design constraint, and a change that triples the device count
  has to answer for it. The design does.
- **`BUILDER_EDITABLE_FIELDS`** must gain every new game field, or the control will look
  alive and never save.
- **Deployment**: server by VPS rebuild, both apps by `deploy:hosting`.

## Non-goals

- **Proving a human is present.** A phone is not a person: one participant can carry
  three handsets and tap all of them. This raises the effort and makes non-participation
  visible; it does not make cheating impossible, and pretending otherwise would be worse
  than saying so.
- **Changing who may submit a mission.** The controller model stays. A contribution is a
  distinct, additive act — not a second way to complete a task.
- **Splitting a mission into per-person sub-tasks with different content.** Each
  contributor does the same mission; the requirement is that they each do it.
- **Anything about the mission bank's content.** Whether specific missions should require
  contributions is an authoring decision across 103 missions.
- **Reworking team formation, invites, or the join flow** beyond showing who is missing.

## Context

`startTeams` launches the teams that exist when it runs and leaves **no trace on the
run document**. Nothing asks the question again, and nothing downstream can tell
"joined before the start" from "joined after it and was stranded". In run
`ijI9JMITSf8C9heN1Cwp` one team sat 27 minutes, pressed SOS to be noticed, and
finished zero missions.

The console did not flag them either. `buildRunSignals` already had a `notStarted`
signal — but it is `info` and means "you have not pressed start yet", which is a
different and unalarming situation about the same counter.

Separately, every media submission in that run had to be approved by hand.
`Task.smart.autoApprove` exists and the server honours it, but it is **per task**:
there was no way to say "this run, approve everything".

## Goals / Non-Goals

**Goals**

- A stranded late joiner is always surfaced, whatever the settings say.
- A run may start late joiners itself, opt-in, never bypassing guardian consent.
- A run may approve all media, opt-in, without editing a single task.

**Non-Goals** — see `proposal.md` § Non-goals. In particular, auto-starting a team
that joins BEFORE the run starts is not in scope: that is what the start button is
for.

## Decisions

### D1 — The run learns when play began

`startTeams` stamps `Run.teamsStartedAt`, **once**. A second press must not move it:
the question it answers is "has play begun", not "when was the last batch launched" —
moving it would un-strand every team already waiting, silently.

Written best-effort after the batch commits, so a stamp failure cannot fail a start
that already happened.

**Alternative rejected — derive it by querying for any launched team.** That is a
collection read on every console poll, on a product whose read budget CLAUDE.md calls
a hard design constraint.

### D2 — Two decisions, deliberately separate

`packages/shared/src/lateJoiner.ts`:

| Function | Question | Reads the setting? |
|---|---|---|
| `lateJoinerVerdict` | May this team start ITSELF? | yes |
| `pendingLateJoiners` | Who is stranded and needs a human told? | **no** |

The second not reading the setting is the whole point. The organizer who never turned
auto start on is exactly the organizer whose team sat 27 minutes; a safety net that
only listed teams the platform had already rescued would be silent in the only case
that matters.

`lateJoinerVerdict` checks **consent before the setting**, so `blockedBy` names the
real obstacle: an organizer whose game needs guardian consent must not be told a
setting held the team, because turning it on would change nothing and they would have
no way to discover that.

Both are total. The first fails toward NOT starting — a malformed run must never hand
a team a mission the organizer did not release.

### D3 — `joinRun` reuses the test-drive self-start, it does not grow a parallel path

`joinRun` already has a `selfStart` branch (test drive) that sets `status`, seeds
`stages[0].startedAt`, sets `launched` and assigns the first task best-effort. The
late-joiner door ORs into that same flag rather than adding a second launch path, so
the consent stop and the assignment fallback are the same sentence rather than two
that can drift.

### D4 — The media flag lives on the RUN, copied at launch

`Game.autoApproveAllMedia` is the authoring choice; `launchRun` copies it onto
`Run.autoApproveAllMedia`, and `submitStationPhoto` reads the run. This is the
`Run.taskStatusOverrides` rule from CLAUDE.md: an operational override on the template
is replayed by later runs, copied by duplicate/export/publish, and rewritten by the
Builder.

Read through `cachedGetDoc` and **only when the task did not already decide** — the
flag is stamped at launch and cannot change mid-run, so re-reading it per submission
would be waste on a path the same document calls read-cost sensitive.

**Known limitation, stated rather than hidden:** because it is captured at launch, an
organizer drowning *mid-run* cannot flip it. That needs a callable, which needs its
own e2e scenario and moves the coverage guard — deliberately out of scope here. Filed
as Open Question 1.

### D5 — A third signal, not a louder second one

`lateJoinerStranded` is `warn` and **suppresses** `notStarted`. They are the same
teams in the same counter; showing both would put a calm sentence next to an urgent
one about the same people, on the screen a host reads under time pressure.

### D6 — `listRunTeams` projects `joinedAt`, consciously

The console cannot compute any of this without knowing when a team joined. The row
shape is allowlisted in `scripts/e2e-verify.mjs` precisely so an addition has to be
classified rather than waved through: `joinedAt` is a timestamp the organizer already
sees, not a position, not an answer key, not a guardian record.

## Test Strategy

**Pure — `npm test`:** `scripts/test-late-joiner.ts` (59 assertions) covers the
default-off behaviour, the literal-`true` rule, consent outranking the setting in both
argument orders, a run that has not started, the grace window, totality on both
functions, and that the strip ignores the setting. `runConsole.test.ts` gains the
signal's severity, its count, and that it suppresses `notStarted` while a
before-the-start wait still raises `notStarted`.

**e2e — `npm run e2e`:** the `listRunTeams` row allowlist gains `joinedAt` and must
stay green; the whole suite must stay green because `joinRun` changed.

**UI:** Builder controls verified via preview + `i18n:check:strict`, and
`BUILDER_EDITABLE_FIELDS` + `scripts/test-game-presentation.ts` (a field missing from
that list never saves AND never registers as a change).

## Risks / Trade-offs

- **[Auto start could start a team the organizer did not want playing]** → off by
  default, literal `true` only, and consent is upstream. The safety net is the
  always-on half.
- **[A second `startTeams` press moving the stamp would silently un-strand everyone]**
  → stamped once, asserted by the code path and described in the type.
- **[`joinedAt` on a legacy team document is absent]** → `pendingLateJoiners` still
  LISTS such a team with an unknown wait. "I cannot tell how long they have been
  stuck" is a reason to surface them, not to hide them.
- **[Two deploy targets]** → the server halves ride the VPS rebuild, the Builder and
  console halves ride `deploy:hosting`. The console strip is safe alone and is the
  half that mattered in the field.

## Migration Plan

1. Land; `npm run verify` and `npm run e2e` green.
2. Ship the console half first (`deploy:hosting`) — it is pure read-side and needs no
   server change to be useful the moment `teamsStartedAt` starts being written.
3. Ship the API (VPS rebuild). Until then `teamsStartedAt` is absent, which the pure
   code reads as "play has not begun" — so the strip is simply quiet, never wrong.

**Rollback:** revert. Both flags default to today's behaviour and nothing stored
changes shape.

## Open Questions

1. **Should auto-approve be flippable mid-run?** The field case is an organizer
   drowning at minute 20, and launch-time capture does not serve them. Needs a
   callable plus an e2e scenario; deliberately not built here.
2. **Should a stranded team be startable from the signal itself?** The chip currently
   routes to the start panel. A one-tap "start them" on the chip is the obvious next
   step and is a console change, not a server one.

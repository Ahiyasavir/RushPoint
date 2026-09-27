## Why

In the 2026-09-10 production run of "פעולת פתיחה חבב 1#" (`ijI9JMITSf8C9heN1Cwp`)
team גלעד joined after the organizer had pressed "start all teams". They sat for
**27 minutes** with nothing on screen, had to press **SOS** to be noticed at all, and
finished the run having completed **zero** missions.

Nothing was broken. `startTeams` is a point-in-time action: it launches the teams that
exist when it runs. A team that joins afterwards keeps `launched: false` forever,
because nothing ever asks the question again. The console does not flag them either —
an unlaunched team is not "at risk", it is simply not playing, so no triage rule fires.
The only signal the platform produced was the one the players generated themselves,
using the distress button.

A second gap from the same run, same shape — the organizer was the bottleneck for work
the platform could have done: **every media submission had to be approved by hand.**
Per-task `smart.autoApprove` already exists and the server already honours it
(`packages/shared/src/types/index.ts`, `Task.smart`), but there is no way to say "for
this run, approve everything" — so an organizer running a creative-content game
becomes a full-time review queue, which is exactly what the players asked to be faster
(*"שהמנחה יאשר מהר יותר את המשימות"*).

## What Changes

- **A team that joins after the run has started is surfaced, always.** The Run Console
  raises them as an attention item with the same weight as an SOS: named, counted, and
  cued. This is the safety net and it is not optional.
- **A run may launch late joiners automatically.** A new game-level setting, **off by
  default**, makes `joinRun` launch a team immediately when the run is already under
  way. Off, behaviour is byte-for-byte what it is today.
- **Auto-start never bypasses guardian consent.** A team awaiting consent is held by
  the existing consent gate exactly as it is when an organizer presses start; the new
  path joins that gate rather than going around it.
- **A run may auto-approve all media.** A run-level flag makes every media submission
  in that run approve on arrival, without editing any task. Off by default.

**BREAKING**: none. Both flags default to today's behaviour, and neither changes any
stored shape for a run that does not set them.

## Capabilities

### New Capabilities
- `late-joiner-visibility`: what the platform does about a team that joins a run
  already in progress.
- `run-level-media-approval`: how an organizer can approve media for a whole run
  without editing the game.

## Impact

- **Surfaces**: `packages/shared` (two new optional fields + the pure "is this team a
  late joiner?" verdict), `functions/src/runs/index.ts` (`joinRun` launch path,
  `submitStationPhoto` approval path), `apps/creator-web` (Run Console attention
  strip, the Builder setting), `apps/play-web` (nothing — a launched team simply gets
  a mission).
- **No new callable.** `joinRun` and `submitStationPhoto` already exist; the settings
  ride `updateGame` and `launchRun`. So no new `services/calls.ts` wrapper and the
  callable-coverage guard is unchanged.
- **`Game.autoStartLateJoiners` must be added to `BUILDER_EDITABLE_FIELDS`** — CLAUDE.md
  records that a Builder control whose field is missing from that list never saves AND
  never registers as a change, because the save payload IS the dirty check.
  `scripts/test-game-presentation.ts` enforces it.
- **The auto-approve flag lives on the RUN, never on the template.** Writing
  `smart.autoApprove` across every task would be written into the game the Builder
  rewrites and later runs replay — the exact trap `Run.taskStatusOverrides` exists to
  avoid.
- **i18n**: two new settings plus the console's late-joiner copy, in both languages.
  `npm run i18n:check:strict` mandatory.
- **Deployment**: server halves ship by VPS rebuild; the Builder and console halves by
  `deploy:hosting`. The console's late-joiner strip is safe to ship alone and is the
  half that mattered in the field.

## Non-goals

- **Auto-starting a team that joins BEFORE the run starts.** That is what the start
  button is for, and taking it away removes the organizer's "everyone ready?" moment.
- **Any change to guardian consent** beyond keeping it upstream of the new path.
- **Notifying the late joiner** ("you were started"). The team simply receives a
  mission, which is the notification.
- **Auto-approving anything other than media** — no answer, code, or geofence check
  is affected.
- **A per-team or per-task approval override at run level.** One flag, whole run.
- **Anything in `scoring-legibility`.**

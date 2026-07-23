## Context

The featured demo must be reachable with ZERO setup and must showcase the platform. Two existing
seams make this possible without any new backend surface:

1. **`startInstantPlay`** (`functions/src/runs/index.ts`) already mints a fresh, free, anonymous,
   self-guided solo run of any `publicGames` game that has `allowInstantPlay: true` and does NOT set
   `requiresGuardianConsent`. No organizer, no credit, no access code.
2. The play-web **`?game=<gameId>`** route (`lib/playRoute.ts`, resolved only when there is no
   active session) opens **GamePromoScreen**, whose "Play now" button calls `startInstantPlay` and
   drops the visitor into the normal Play flow.

So the whole feature is: (a) author a great game that satisfies the instant-play + staffless +
locationless contract, (b) seed it published, (c) point the demo button at its `?game=` URL.

## Goals / Non-Goals

- Goals: a delightful, winnable, bilingual, staffless, play-from-anywhere showcase; a pure test
  that makes the contract un-regressable; reuse of existing seams only.
- Non-goals: new callables, schema, routes, or UI components; deleting the old demo.

## Decisions

### D1 — Reuse `?game=` + `startInstantPlay`, do not add a direct-launch route
The demo button targets `?game=demo-instant-spy`. This shows a one-screen promo (title, "playable
anywhere" badge, stage/task/time stats, how-to primer) and a single "Play now" tap that calls
`startInstantPlay`. A bespoke one-tap-launch route was rejected: it would add a play-web route +
App wiring for no benefit, and the promo screen is a better first impression (it frames the game
before the player commits). The promo route already refuses when a session exists, so a returning
player is never yanked out of a run.

### D2 — Content contract (what makes it staffless + anywhere)
Every task is `locationless: true` + `triggerMode: 'locationless'` (so `normalizeTriggerMode`,
`describeGameRequirements` and routing all agree it needs no GPS). No `field`/`geofence`/
`smart_station` task types (each would gate on GPS or a code/human). The one photo task sets
`smart.autoApprove: true` with no `photoReviewRequired` and no code, so it scores instantly with no
review queue. The game sets `allowInstantPlay: true` and never `requiresGuardianConsent`.

### D3 — Winnability
Every stage is validated with `requiredTaskCountProblem` (shared with the server's save/import
validation). The demo keeps `requiredTaskCount` unset on every stage (= complete all tasks) and
uses no exclusive groups, so `maxCompletableTasks` always equals the task count and no stage can
dead-end. The test asserts `requiredTaskCountProblem(stage) === null` for all stages.

### D4 — Bilingual, matching the data model
`Game`/`Task` carry single-language content rendered with `dir="auto"`; the model's bilingual
channels are `instructions` (body EN + bodyHe HE) and per-stage `narrative` beats. The flagship
uses both, and additionally writes each task title/description with Hebrew first then English so a
stranger in either language can play. Typed-answer tasks accept HE and EN answers. Content is
dash-free per the product copy standard.

### D5 — Seeding + reboot survival
Defined once in `scripts/lib/spy-academy-game-def.mjs` (game template + publicGames card +
publicTasks entries + a stand-by live run/join code) and seeded idempotently on every emulator boot
via `ensureSpyAcademy` in `scripts/seed-local.mjs`, exactly like Sansana/QA (the supervisor restarts
the emulator non-gracefully, so anything not re-seeded on boot is lost). `publicTaskLocation`
returns `undefined` for every locationless task, so no coarse/exact point is written and the
privacy write-path contract (`test-public-task-seed`) is respected by construction.

## Risks / Trade-offs

- The promo screen adds one tap before play. Accepted: it is a better first impression and avoids
  new routing surface.
- Seeding a fourth game slightly grows boot time. Negligible, and idempotent.

## Migration

None. The old `demo-game-oldcity` remains seeded for existing tests/e2e; only the demo button's
target changes.

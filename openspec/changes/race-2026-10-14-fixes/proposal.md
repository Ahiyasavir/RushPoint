## Why

The 14.10.2026 race post-mortem (`investigations/2026-10-14-race-to-zion`, CONCLUSIONS §4) ranked
ten fix packages; only package 1 (self-healing entry) was built. Packages 2, 3 and 4 were the ones
the post-mortem said must exist before the next event (22.10). Every defect below was re-checked on
21.10 against the code production actually runs (`origin/topographic-maps`, API `2e8e659`), not
against the investigation's text. Two were already fixed by package 1 (D02, D05). One did not hold:
D69 (English server notices in a Hebrew app). Those notices carry `messageHe`, and the phone shows it
in Hebrew. The rest held.

## What Changes

**Package 3, no team stuck in silence** (also `pause-never-strands`, which covers D10 and D11)
- D49: after a GPS arrival was accepted, the check-in asked for the same proof again (108 of 117
  "too far" refusals at the start came after arrival). An accepted arrival now counts as the
  check-in's proximity, by GPS or by an organizer's let-in.
- D50: an organizer let-in at a `requirePresence` quiz now lets the team answer. A GPS arrival
  does not waive this gate.
- D16: a team the organizer sent to a mission in another stage could not report arrival or answer
  ("this stage is not active yet"). An operator-routed mission with the `otherStage` waiver passes
  the stage guard.
- D14: restoring a removed team now assigns it a mission.
- D15: any phone of a team may ask for the next mission. Answers stay on the controller.
- D44: a check-in with no GPS fix is sent anyway, so the server can accept an organizer's let-in.
  The phone warns only when the server refuses.

**Package 2, one clear "today's run"**
- D06/D09: both launch buttons ask first when the game already has a live run (fetched fresh,
  test runs excluded), offer to open it, and launch a second run only on a second deliberate yes.
  If the list cannot be read, the launch goes ahead.
- D07: "playing now" counts from the run's last activity (`updatedAt`, written during play), not
  only from launch.
- D08: the run bar and the game card lead to the run with players, then the one played most
  recently.

**Package 4, honest text for players**
- D27: a preset score reason reaches the phone as its label in the notice's language, not as the
  raw key ("reasonCreativity").
- D70: `renameTeam`, which only the owner can call and which is audited, plus a "rename" action in
  the console.

## Impact

`functions/src/runs/index.ts`, `functions/src/index.ts`, `functions/src/obs/audit.ts`,
`packages/shared/src/{announcements,types/index}.ts`, `apps/play-web/src/components/TaskRunner.tsx`,
`apps/creator-web/src/{lib/liveRunGuard,lib/runHistoryBadge,lib/creatorNav,hooks/liveRunsPolling,
lib/runConsoleActions}.ts`, Builder, Dashboard, Run Console, i18n, `scripts/e2e-verify.mjs`,
`scripts/lib/callableHardening.mjs`. One new callable: `renameTeam`. No data migration.

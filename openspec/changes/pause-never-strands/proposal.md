## Why

Race to Zion, 14.10.2026 (run ODeoR2j6MHotoC8dO5I1): only 2 of 30 teams reached the vineyard
stage ("תהליך היין", where "מכתב לישעיהו הנביא" lives), plus one more that the organizer routed there
by hand at 11:37. The vineyard is stage 3. It opens only after stage 1 (all 5 missions, no
`requiredTaskCount`) and stage 2 (2 of 4).

Between 10:32 and 10:41 the organizer paused three stage 1 missions (נקודת הזינוק, קומו ונעלה,
סימון הדרך) because the physical stations were folding. Each pause was refused by the server
(`stageUnwinnable`), the console asked "להשהות בכל זאת?", and the second click sent `force: true`.
A pause touches no team, so every team that still needed one of those missions could never finish
stage 1 again: 16 teams, including teams that were playing. His broadcasts at 10:32 and 10:57 show
the intent: "if you did not finish it, move on".

Ahiya, 2026-10-21: choosing PAUSE must still work out. The product may not ask the organizer to pick
the "right" button under pressure; a pause must never strand a team. Investigation:
`investigations/2026-10-14-race-to-zion` REPORT §3.6, DEFECTS D10.

## What Changes

- A pause is **never refused** any more, including one the stage cannot spare; `force` is gone.
  `stageUnwinnable` is still returned, as information.
- **Routing heals the stranded case.** When a team asks for its next mission and nothing in its
  active stage can be handed out (not because a station is full), and the stage still holds missions
  that are paused right now, those missions are set aside for THAT team, exactly like a closure:
  0 points, what waited for them opens, the team's requirement shrinks by the smallest winnable
  amount. The team then gets its next mission or its next stage. The record carries
  `setAsideWhilePaused: true` (not `closedByOrganizer`).
- A team that still has other work keeps the paused mission pending, so a resume in time gives it
  back. A team standing on the paused mission keeps it and scores it (unchanged).
- The console's "pause anyway" dialog is gone; after such a pause it says that teams that run out of
  missions will skip it and move on.

## Capabilities

### Modified Capabilities
- `live-task-availability`

## Impact

- `functions/src/runs/index.ts` (`setAsidePausedTasks`, `applyTaskClosure` kind, the heal in
  `assignNextInActiveStage`), `functions/src/index.ts` (`setRunTaskStatus`),
  `packages/shared/src/types/index.ts` (`RunTaskRecord.setAsideWhilePaused`),
  `apps/creator-web` (console note, i18n, wrapper type), `scripts/e2e-verify.mjs`.
- No migration. Teams already stranded by an old forced pause are healed on their next poll.

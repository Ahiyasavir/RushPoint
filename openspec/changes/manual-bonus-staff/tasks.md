## 1. play-web typed wrapper
- [x] 1.1 Add `adjustTeamScore` wrapper to `apps/play-web/src/services/calls.ts`
  (`Ctx & { teamId; delta; reason? }` → `{ ok; newBonusPenalty }`).

## 2. Staff Console UI
- [x] 2.1 Collect `{id, displayName, score}` team rows inside the EXISTING `.../teams`
  snapshot in `StaffConsole.tsx` (no extra listener); sort by score desc.
- [x] 2.2 Add a "Team scores" panel with −10/−5/+5/+10 quick-adjust buttons per team,
  calling `adjustTeamScore({...ctx, teamId, delta, reason:'staff'})`; aria-labels on buttons.
- [x] 2.3 Add `t.staff.*` keys (teamsScores, noTeams, scoreLabel, bonus, deduct, adjustFailed)
  EN + HE.

## 3. Tests / gates
- [ ] 3.1 Extend `scripts/e2e-verify.mjs` — a staff token can `adjustTeamScore` and a positive
  delta raises the team's final rank (batch gate).
- [x] 3.2 `npm run typecheck` (green).
- [x] 3.3 `npm run i18n:check` (clean).
- [ ] 3.4 `npm run play:build` + preview smoke (batch gate).

## 1. RED
- [ ] 1.1 `scripts/test-team-rewind.ts`: `fromHere` reopens later completions in the stage and the
  later stages (points off, ledger per mission), keeps earlier ones and authored losses, and `only`
  is unchanged.
- [ ] 1.2 `scripts/e2e-verify.mjs`: `returnTeamTo({ scope: 'fromHere' })` reopens the later mission.

## 2. GREEN
- [ ] 2.1 planner scope. 2.2 server scope. 2.3 console picker choice + preview.

## 3. Verify
- [ ] 3.1 Browser: send a team back from the "send to" picker both ways.
- [ ] 3.2 Gates: `npm run verify`, `npm run e2e`.

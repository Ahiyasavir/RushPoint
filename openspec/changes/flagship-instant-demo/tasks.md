## 1. Pin the contract (RED)

- [x] 1.1 Write `scripts/test-flagship-demo.ts` asserting the flagship game's invariants: every
      task `locationless` + `triggerMode 'locationless'`; `describeGameRequirements === 'anywhere'`;
      no `field`/`geofence`/`smart_station` type; every photo task `autoApprove` and not
      review-gated; `allowInstantPlay: true`; not `requiresGuardianConsent`; every stage winnable
      (`requiredTaskCountProblem === null`); answer keys present per type; bilingual content;
      dash-free; `publicTaskLocation` omitted for every task. Run it RED (module missing).

## 2. Build the game (GREEN)

- [x] 2.1 Create `scripts/lib/spy-academy-game-def.mjs`: the "אקדמיית הסוכנים" game (3 stages, 8
      tasks) with `buildStages`, `buildFlagshipGame`, `GAME_META`, `INSTRUCTIONS`, exported ids, and
      an idempotent `seedSpyAcademy` (game template + publicGames `allowInstantPlay:true` +
      publicTasks + stand-by live run/code).
- [x] 2.2 Run `scripts/test-flagship-demo.ts` GREEN.

## 3. Feature it

- [x] 3.1 Seed it every boot: import + `ensureSpyAcademy` in `scripts/seed-local.mjs`.
- [x] 3.2 Repoint the creator landing demo button: `AuthGate.tsx` `DEMO_URL` →
      `${PLAY_URL}/?game=demo-instant-spy` (opens the promo → "Play now" → `startInstantPlay`).

## 4. Gates (parent-run)

- [ ] 4.1 `npm run typecheck`, `npm test`, `npm run creator:build`, `npm run i18n:check:strict`.
- [ ] 4.2 `npm run e2e` (instant-play a public game) + a browser playthrough of the demo button.

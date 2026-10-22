## 1. RED
- [x] 1.1 `functions/src/runs/teamDevices.test.ts`: MAX_RUN_DEVICES is 250 (fails at 150)
- [x] 1.2 `scripts/lib/hotPathReads.mjs` + `scripts/test-hot-path-reads.ts`: resolveCallerTeam must
      use the cached runDeviceMember lookup; negative control for the query-only shape
- [x] 1.3 `scripts/test-race-capacity.ts`: TTL > participant poll; joinTeamAsDevice has no
      `tx.get(runRef)`, uses `FieldValue.increment(1)`, still enforces `canAddRunDevice`

## 2. GREEN
- [x] 2.1 resolveCallerTeam cached viewer lookup with deviceUids confirmation + query fallback
- [x] 2.2 `functions/src/firebase.ts` ttlMs 120_000
- [x] 2.3 joinTeamAsDevice lock-free run counter
- [x] 2.4 `packages/shared/src/runCapacity.ts` MAX_RUN_DEVICES = 250

## 3. Gates
- [x] 3.1 npm run verify (EXIT=0)
- [x] 3.2 npm run e2e (emulator, offset lane) — ALL PASS, 139 callables covered
- [ ] 3.3 deploy API to the VPS, smoke check

## 4. Same-day follow-up (project moved to Blaze)
- [x] 4.1 MAX_RUN_DEVICES / FREE_MODE_MAX_PARTICIPANTS 250 -> 500: a 420-phone VPS load test joined
      only 63/70 teams at 250; 35 teams x the 8-phone team allowance is 280
- [x] 4.2 scripts/load-vps.mjs: multi-phone load against an isolated emulator backend on the VPS

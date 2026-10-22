# Tasks: entry-hardening-2026-10-21

## 1. RED
- [x] 1.1 `scripts/test-join-code.ts`: rate-limited join → slowDown; auth codes → connection /
      networkBusy; Hebrew-keyboard codes; the team code field maps too. Confirmed failing.
- [x] 1.2 `scripts/e2e-verify.mjs`: the rate-limit refusal carries `reason: 'rateLimited'`.

## 2. GREEN
- [x] 2.1 `rateLimitStore.ts` marks the refusal.
- [x] 2.2 `joinErrorKey` + copy (HE/EN) + join, attach, rejoin and staff screens.
- [x] 2.3 Hebrew keyboard map in `normalizeJoinCodeInput`; team code and staff code fields use it.
- [x] 2.4 `rejoin-replaces-lost-phone` (2169231) applied.

## 3. Verify
- [x] 3.1 `verify:auth-loss` in WebKit (iPhone 15) + Chromium: 74/74.
- [x] 3.2 `browser-auth-loss-stress.mjs`: 160/160 phones got in (10 per engine × path × moment). Control on the 14.10 code (c61ed51): 11/16 failed with "בעיית חיבור" and NO-TOKEN, so the test catches the bug.
- [x] 3.3 `npm run verify` (all but origin:check: no .env in a worktree) + full `npm run e2e` (141 callables).
- [ ] 3.4 Real iPhone, cleared site data, team QR scanned, after deploy (IPHONE-TESTS.md 0a).

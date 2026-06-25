# Tasks — TV Leaderboard (RED → GREEN → REFACTOR)

- [ ] **1.** Add `TV_ROUTE_PARAM = 'tv'` to `packages/shared/src/index.ts`.
- [ ] **2. GREEN (UI):** new `apps/play-web/src/screens/TvLeaderboard.tsx` — calls
  `getPublicLeaderboard`, auto-refreshes every 15 s, shows rank/name/score/time; detects top-team
  change → fires animation. Add `?tv=<accessCode>` branch in `App.tsx`.
  Verify via preview tools: standings render, animation class fires on leader change.
- [ ] **3. GREEN (UI):** creator RunConsole — add "📺 TV Screen" button that opens/copies
  `?tv=<accessCode>`. Verify via preview.
- [ ] **4. Gate:** `npm run typecheck` · `npm run lint` · `npm run creator:build`.
  (No new callable → no e2e extension needed.)

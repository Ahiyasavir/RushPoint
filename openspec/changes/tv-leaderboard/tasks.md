# Tasks — TV Leaderboard (RED → GREEN → REFACTOR)

- [x] **1.** Add `TV_ROUTE_PARAM = 'tv'` to `packages/shared/src/index.ts`. Done in a dedicated
  `tv.ts` (also adds the pure `detectLeaderChange`, covered by `scripts/test-tv.ts`).
- [x] **2. GREEN (UI):** new `apps/play-web/src/screens/TvLeaderboard.tsx` — calls
  `getPublicLeaderboard`, auto-refreshes every 12 s (≤ 15 s), shows rank/name/score/time; detects
  top-team change via `detectLeaderChange` → fires the "Now in the lead!" highlight. `?tv=<accessCode>`
  branch added in `App.tsx`; published gate enforced (not-available state).
- [ ] **3. DEFERRED → frontend agent:** creator RunConsole "📺 TV Screen" button. Left to the agent
  who owns creator-web (RunConsole label needs a creator-web `t.*` key — their i18n domain). The
  play-web `?tv=` surface is fully functional; the button is just a convenience launcher.
- [x] **4. Gate:** `npm run typecheck` · `npm run lint` · `npm test` · `npm run creator:build` ·
  play build — all green. (No new callable → no e2e extension needed.)

## 1. RED — Failing i18n parity + no-leakage test

- [ ] 1.1 Create `scripts/test-i18n-parity.ts` importing `translations` from
  `apps/play-web/src/i18n.ts` (does not exist yet) and `apps/creator-web/src/i18n.ts`. Assert:
  - recursive key sets of `HE` and `EN` are identical for BOTH apps
  - every string leaf in each `HE` map, minus the whitelist (`RushPoint`/`Pro`/`QR`/`SOS`/`Google`/
    `₪`/emoji), has no `[A-Za-z]{2,}` run
- [ ] 1.2 Run `npm test`; confirm it fails with "Cannot find module …/play-web/src/i18n" (RED).

## 2. GREEN — play-web i18n layer

- [ ] 2.1 Create `apps/play-web/src/i18n.ts`: `Lang`, `HE` (Hebrew, source of truth, `dir:'rtl'`),
  `EN: typeof HE` (`dir:'ltr'`), `translations`, namespaced by screen (`common/join/play/final/
  promo/staff/board/liveOps/connection`). Cover every string identified in task 3.
- [ ] 2.2 Create `apps/play-web/src/i18nContext.tsx`: a context provider + `useT()` returning
  `{ t, lang, setLang, dir }`. Persist via `store.ts` `loadLang()`/`saveLang()` (default `'he'`).
- [ ] 2.3 Run `npm test`; confirm `test-i18n-parity.ts` passes (GREEN).

## 3. GREEN — swap hardcoded literals to `t.*`

- [ ] 3.1 Wrap the app in the i18n provider in `apps/play-web/src/App.tsx`; set root `dir` from `t`.
- [ ] 3.2 Swap literals in screens: `JoinScreen`, `PlayScreen`, `FinalScreen`, `GamePromoScreen`,
  `StaffConsole`, `PublicLeaderboardScreen` (chrome only; keep `dir="auto"` on game title/description).
- [ ] 3.3 Swap literals in components: `TaskRunner`, `LiveOps`, `ConnectionBanner`, `NavMap`.
- [ ] 3.4 Add a language toggle control (small `he/en` switch) reachable from Join + Staff.

## 4. Verify

- [ ] 4.1 `npm run typecheck` — 0 errors (the `EN: typeof HE` lock catches any missing key).
- [ ] 4.2 `npm test` — parity test green.
- [ ] 4.3 `npm run creator:build` and the play-web build — pass.
- [ ] 4.4 Preview play-web in HE: snapshot Join + Final + Staff; confirm zero English chrome; toggle
  to EN and confirm `dir` flips and English renders.

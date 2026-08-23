## 1. Copy first

- [x] 1.1 Add `promo.loadError` and `promo.loadErrorSub` to BOTH dictionaries in
      `apps/play-web/src/i18n.ts` (Hebrew in Hebrew, English in English; no em-dashes).
- [x] 1.2 Run `npm run i18n:check:strict` and confirm PART A is clean and no NEW PART B warning
      appears.

## 2. Distinguish error from not-found

- [x] 2.1 In `GamePromoScreen.tsx`, add `const [loadError, setLoadError] = useState(false)` and a
      `reloadKey` counter added to the loader effect's dependency array.
- [x] 2.2 In the loader: on success clear `loadError` and set `game` as today; on rejection call
      `setLoadError(true)` WITHOUT setting `game` to `null`.
- [x] 2.3 Add the render precedence: loading spinner (`game === undefined && !loadError`) → NEW error
      card (`loadError`) → existing not-found card (`game === null`) → found content.

## 3. Retry

- [x] 3.1 Render the error card: warning glyph, `t.promo.loadError` title, `t.promo.loadErrorSub`
      line, and a retry `Button` labeled `t.common.tryAgain` that runs
      `setLoadError(false); setGame(undefined); setReloadKey((k) => k + 1)`.
- [x] 3.2 Confirm the not-found card (`t.promo.notFound` / `t.promo.notPublic` / `t.promo.enterCode`)
      and the found-game render are unchanged.

## 4. Gates

- [x] 4.1 `npm run typecheck` — green.
- [x] 4.2 `npm run lint` — 0 errors.
- [x] 4.3 `npm run i18n:check:strict` — clean, zero new PART B warnings.
- [x] 4.4 `npm run play:build` and `npm run creator:build` — green.
- [x] 4.5 Flag the manual browser check (not a gate here): offline load shows retry; retry after
      restoring the network loads the game; a non-existent id still shows not-found.

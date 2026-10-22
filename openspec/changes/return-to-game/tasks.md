## 1. RED

- [x] 1.1 Write `scripts/test-return-to-game.ts` (see design, test strategy) and see it fail for the right reason (the helper and the copy do not exist).

## 2. GREEN

- [x] 2.1 `apps/play-web/src/lib/webSearch.ts`: `webSearchHref(lang)`.
- [x] 2.2 play-web `i18n.ts`: `play.webSearch`, `play.returnTipTitle`, `play.returnTipBody` in Hebrew and English.
- [x] 2.3 `PlayScreen.tsx`: the menu item (new tab), the waiting-screen tip.
- [x] 2.4 creator-web `i18n.ts` + `HostSheetPage.tsx`: the join sign line.

## 3. Verify

- [x] 3.1 `npm run verify` (incl. i18n strict) green, captured to a file.
- [x] 3.2 Preview at 375 px: the waiting screen with the tip and the open menu with the search item (browser-auth-loss.mjs screenshots, WebKit iPhone + Chromium Pixel). The join sign line was not rendered in a browser: it is one paragraph on a print page that needs a signed-in creator.
- [ ] 3.3 Deploy only after Ahiya approves.

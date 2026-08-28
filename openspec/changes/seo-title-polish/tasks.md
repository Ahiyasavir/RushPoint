## 1. RED

- [x] 1.1 Add PART F to `scripts/test-no-dashes.ts`: a colon rule over the `<title>`,
  `og:title` and `twitter:title` VALUES of both apps' `index.html`, the manifest `name` and
  `short_name`, and the `title` field of every entry in `LANDING_PAGES`. Parse key and
  value separately so the colon in `og:title` the PROPERTY NAME is never reported. Add the
  reach assertion in the same shape as PARTS C, D and E.
- [x] 1.2 Run `npx tsx scripts/test-no-dashes.ts` and confirm PART F fails, naming all
  eleven offending titles.

## 2. GREEN

- [x] 2.1 Rewrite `<title>`, `og:title` and `twitter:title` in
  `apps/play-web/index.html` and `apps/creator-web/index.html`: outcome first, brand after
  a comma.
- [x] 2.2 Rewrite the nine colon carrying titles in `scripts/lib/landingPages.ts` (six
  Hebrew, three English). Leave the three that are already correct alone.
- [x] 2.3 `npm run seo:build` to regenerate the committed pages under
  `apps/play-web/public/{he,en}/`. Never hand edit them.
- [x] 2.4 Re-run `npx tsx scripts/test-no-dashes.ts` and confirm every part passes with a
  non-zero PART F field count.

## 3. Verify

- [x] 3.1 `npx tsx scripts/test-landing-pages.ts` — the committed output equals what the
  registry produces now.
- [x] 3.2 `npx tsx scripts/test-i18n-parity.ts` — Hebrew titles are still Hebrew, English
  still English.
- [x] 3.3 `npm run verify` — all gates green.

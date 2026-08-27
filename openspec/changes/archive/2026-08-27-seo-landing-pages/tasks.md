## 1. RED: the registry and the derived URL shape

- [x] 1.1 Write `scripts/test-landing-pages.ts` covering only the registry contract: every subject exists in both `he` and `en`, subjects pair one to one, slugs are Latin (no percent encoding, no Hebrew codepoint), titles are unique across all pages, descriptions are unique across all pages. Import from `scripts/lib/landingPages.ts`, which does not exist yet. Run it, confirm it fails on the missing module.
- [x] 1.2 Add `scripts/lib/landingPages.ts` with the page registry only: six subjects (home, birthday, mitzvah, wedding, team building, youth group) times two languages, each carrying slug, language, title, description and copy blocks. Hebrew copy is authored natively, not translated from the English. Run 1.1, confirm green.
- [x] 1.3 Extend the test with the canonical URL shape: `landingPageUrl` returns an absolute `https://rush-point.com/<lang>/<slug>/` with a trailing slash, the language home is `https://rush-point.com/<lang>/`, and no two pages produce the same URL. Confirm it fails, then implement `landingPageUrl`, confirm green.

## 2. RED: the alternate set

- [x] 2.1 Extend the test: `alternatesFor(page)` yields exactly three entries, one self referencing entry tagged with the page's own language, one for the counterpart page, and exactly one tagged `x-default`; every `hreflang` value is one of `he-IL`, `en`, `x-default`; every href is absolute; the `x-default` href is the English page of that subject. Confirm it fails.
- [x] 2.2 Implement `alternatesFor` deriving the counterpart by swapping the language prefix, never by lookup table. Confirm green.
- [x] 2.3 Extend the test with symmetry across the whole set: for every page A and every alternate B that A names, B's alternate set names A. Confirm it passes, and confirm it is a real check by temporarily breaking one derivation and seeing it fail.

## 3. RED: rendering a page

- [x] 3.1 Extend the test: `renderLandingPage` output declares `lang` and `dir` agreeing with the page language (`he`/`rtl`, `en`/`ltr`), carries a non empty title and description, a self referencing canonical, `og:url` equal to that canonical, the full Open Graph and Twitter sets, and a JSON LD block that parses to an object with `@context` and `@type`. Confirm it fails.
- [x] 3.2 Implement `renderLandingPage` producing a complete self contained document with an inline `<style>` block. Confirm green.
- [x] 3.3 Extend the test with the inertness guarantees: the rendered output references no hashed asset filename, no app entry module, and no external stylesheet or font host, and its headline, body copy and call to action are all present in the markup with no script execution. Confirm it fails where it should, then adjust the renderer until green.
- [x] 3.4 Extend the test with the link requirements: every page contains at least one absolute link into the application, and at least one link to another landing page. Implement the call to action and the counterpart link plus sibling links. Confirm green.

## 4. RED: language correctness

- [x] 4.1 Extend the test to check copy with the shared leak predicate, importing `hasEnglishWord` and `hasHebrew` from `scripts/lib/i18nLeak.ts` rather than writing a new regex: no `he` page's visible copy contains English words, no `en` page's copy contains Hebrew. Run it and fix any copy the predicate flags.
- [x] 4.2 Confirm the check has real reach: assert it scanned a non zero, expected minimum number of copy fields, so a future registry reshape cannot make it silently scan nothing.

## 5. RED: the sitemap and the files on disk

- [x] 5.1 Extend the test: `sitemapXml(pages)` produces well formed XML whose `<loc>` set equals the landing page URL set exactly, asserted as a set equality in both directions so a stale entry fails as loudly as a missing one. Confirm it fails, implement `sitemapXml`, confirm green.
- [x] 5.2 Extend the test with the disk contract: for every page, a file exists at `apps/play-web/public/<lang>/<slug>/index.html`, and its bytes equal what the generator produces now. Confirm it fails, since nothing has been written yet.
- [x] 5.3 Add `scripts/build-landing-pages.ts`, the only piece that writes: render the registry and write each page plus the regenerated `apps/play-web/public/sitemap.xml`. Wire it as an npm script. Run it, then confirm 5.2 is green.
- [x] 5.4 Extend the test to assert every alternate href across all pages resolves to a page that exists on disk, and that no landing page path is disallowed by `apps/play-web/public/robots.txt`. Fix `robots.txt` if needed. Confirm green.

## 6. The no dash standard grows

- [x] 6.1 Add a failing case first: temporarily place a dash separator in one registry title, confirm `npm test` does NOT catch it today, which is the gap PART D closes.
- [x] 6.2 Add PART D to `scripts/test-no-dashes.ts` scanning the landing page registry copy and the rendered prose metadata. Confirm it now catches the planted dash, then remove the planted dash and confirm green.
- [x] 6.3 Add the reach assertion to PART D, mirroring PART C: the scan must report having reached at least the expected number of fields, so a registry reshape cannot make it pass over zero.

## 7. Linking the app outward

- [x] 7.1 Add the landing page links to the creator console footer (`AppFooter`), routing every new label through `t.*` with entries added to both the Hebrew and English dictionaries. No hardcoded strings.
- [x] 7.2 Run `npm run i18n:check:strict` and confirm it is clean with zero new PART B findings.

## 8. Gates

- [x] 8.1 Run `npm run verify` and confirm all nine gates are green: typecheck, lint, test, creator:build, play:build, bundle:budget, base:check, origin:check, i18n:check:strict.
- [x] 8.2 Confirm the new pages are actually present in the built output at `apps/play-web/dist/<lang>/<slug>/index.html`, so `public/` copying really shipped them, and confirm `apps/play-web/dist/sitemap.xml` carries the new URLs.
- [x] 8.3 Serve the built output and verify with the preview tools that a landing page renders its full content, that the call to action and the counterpart language link both work, and that the page carries no console errors.
- [x] 8.4 Run `npm run e2e` and confirm it stays green, verifying that a change adding no callable left the callable coverage guard untouched.
- [x] 8.5 Write the operator checklist for the off site work this change deliberately excludes: Search Console sitemap submission for both origins, the Israeli directory citations (Zap, Dooly) and the global map anchors (Foursquare, OpenStreetMap), and the Google Business Profile eligibility question, which turns on whether the business makes in person contact with customers.

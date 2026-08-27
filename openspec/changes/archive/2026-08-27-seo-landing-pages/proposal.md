## Why

RushPoint ranks for almost nothing in organic search. Both origins are app shells: a
crawler reaching `rush-point.com` finds a join-code box, and `creator.rush-point.com`
finds a sign in screen. The technical layer is already sound (real `robots.txt`,
`sitemap.xml`, canonical tags, Open Graph, JSON-LD, a real `favicon.ico`), so the gap is
not tags, it is that **there is no indexable content to rank**. A creator searching
"משחק שדה לבר מצווה" or "scavenger hunt app for team building" has no RushPoint page that
answers the query, and the brand name itself collides with an unrelated Roblox shooter
that dominates the term.

The product already knows exactly which intents matter: `OCCASION_IDS` in
`apps/creator-web/src/lib/occasions.ts` lists the five event types the composer is tuned
for. Each is a commercial search intent with real product capability behind it, so these
pages describe what RushPoint genuinely does rather than inventing marketing claims.

## What Changes

- **A set of crawlable static landing pages** ships at the participant origin, one per
  occasion (birthday, mitzvah, wedding, team building, youth group) plus a marketing
  home, in **both Hebrew and English**, reachable at language-prefixed paths.
- **Hebrew is authored natively, not translated.** 78% of Israeli search is Hebrew, and
  the Hebrew page is the primary commercial surface, not a mirror of the English one.
- **Each page is complete HTML with no JavaScript requirement.** A crawler (and a human
  with JS disabled) sees the full text, headings, and call to action in the initial
  response. Pages carry unique title and meta description, a self referencing canonical,
  **symmetric `hreflang` annotations (`he-IL`, `en`, `x-default`) written into the static
  markup**, Open Graph and Twitter tags, and JSON LD.
- **`robots.txt` and `sitemap.xml` in both apps learn about the new URLs** so the pages
  are advertised rather than merely reachable.
- **The no dash copy standard grows to cover the new surface.** `scripts/test-no-dashes.ts`
  PART C scans `index.html` and the manifest today; landing page copy is the copy with the
  widest reach of all, so it joins that scan.
- **A cross link exists in both directions**: each landing page links into the app, and
  the app's logged out landing surface links back out to the relevant pages, so the new
  pages accumulate internal links instead of sitting orphaned.

### Non-goals

- **No server side rendering, and no static site generator.** Firebase Hosting serves a
  real file in `public/` before the `"source": "**"` SPA rewrite reaches it, which is the
  same mechanism that fixed `robots.txt` and `favicon.ico`. That makes a build pipeline
  change unnecessary, so this change adds none.
- **No language prefixed routing inside the React apps.** The SPA keeps its current
  client side language toggle untouched. Only the new static pages are language
  addressed.
- **No new callable, no Firestore read or write, no auth.** These pages are inert files.
- **No per game or per run pages.** `?game=` teasers and `?board=` leaderboards stay as
  they are: they are event scoped and would go stale in the index.
- **No Google Business Profile or directory listing work.** That is an account level
  activity requiring business identity details, tracked separately as an operator
  checklist rather than as code.
- **No change to the dark creator theme or the Warm Trail play theme.** Landing pages
  carry their own self contained styling and import nothing from either app.

## Capabilities

### New Capabilities
- `seo-landing-pages`: Crawlable, JavaScript free, bilingual marketing pages served ahead
  of the SPA rewrite, each carrying a complete and mutually consistent set of indexing
  signals (title, description, canonical, symmetric hreflang, social tags, structured
  data), advertised by `robots.txt` and `sitemap.xml`, and linked to and from the app.

### Modified Capabilities
- `ui-text-standards`: The no dash requirement currently reaches translation maps, visible
  JSX, `index.html` and the manifest. It SHALL also reach landing page copy, so the pages
  Google prints cannot regress the standard.

## Impact

**Surfaces touched:** `apps/play-web/public/**` (new static pages, `robots.txt`,
`sitemap.xml`), `apps/creator-web/public/**` (`robots.txt`, `sitemap.xml` only),
`apps/creator-web/src/components/AuthGate.tsx` (outbound links from the logged out
landing surface), `scripts/test-no-dashes.ts` and a new pure test script.

**No backend surface is touched:** no callable is added or changed, so `services/calls.ts`
and `scripts/e2e-verify.mjs` are untouched and the callable coverage guard is unaffected.
No shared type changes. No `firestore.rules` or `storage.rules` changes.

**Build and gate contract:** files live in `public/`, which Vite copies verbatim into the
out directory, so the `dist` versus `dist-playtest` split and `npm run base:check` are
unaffected. The pages reference no hashed asset and no app bundle, so
`npm run bundle:budget` is unaffected. Because the pages are static HTML outside the React
tree and route no text through `t.*`, they are outside the `t.*` dictionary model that
`npm run i18n:check:strict` enforces, and the checker must be told so explicitly rather
than left to discover them as a wall of PART B findings.

**Risk:** the main hazard is an inconsistent indexing signal set, for example an hreflang
cluster that is not symmetric, a canonical pointing at the wrong language, or a sitemap
entry for a file that does not exist. All of these are silent in a browser and only
visible in Search Console weeks later, so they are covered by a pure test rather than by
review.

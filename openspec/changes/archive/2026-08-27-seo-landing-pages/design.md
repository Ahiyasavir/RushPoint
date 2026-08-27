## Context

Both RushPoint origins are React SPAs built by Vite and served by Firebase Hosting with a
`"rewrites": [{ "source": "**", "destination": "/index.html" }]` catch all. The technical
SEO layer is already in place and was hard won: `apps/*/index.html` carries canonical tags,
Open Graph, Twitter cards, JSON LD and a canonical host redirect, and `robots.txt`,
`sitemap.xml` and `favicon.ico` exist as **real files** precisely because the catch all
rewrite was answering those paths with `text/html`.

That last detail is the load bearing fact for this change. Firebase Hosting resolves
static content **before** it reaches the rewrite table, so a real file in `public/` is
served as itself. The codebase already documents this in
`apps/play-web/index.html`: a static file in `public/` wins over the rewrite. Landing pages
can therefore be plain files, and none of the SSR or SSG machinery the general SPA advice
calls for is needed here.

Constraints the design has to respect:

- **The build artifact contract.** `--mode playtest` writes `dist-playtest` and the gate
  writes `dist`; `npm run base:check` asserts each built `index.html` declares the asset
  base matching the directory it is served from. Anything touching the build config risks
  that contract.
- **`npm run bundle:budget`** measures the play web entry chunk and asserts the heavy deps
  stay lazy.
- **`scripts/check-i18n.ts` scans only `apps/*/src` for `.ts` and `.tsx`.** Files under
  `public/` are invisible to it, in both directions: they cannot raise PART B findings, and
  they cannot be language checked either.
- **`scripts/test-no-dashes.ts` PART C** scans `apps/*/index.html` and the manifests for a
  fixed set of prose metadata keys, and asserts it actually reached at least fourteen
  fields so a markup reshuffle cannot silently make every regex miss.
- **`scripts/run-unit-tests.mjs` auto discovers every `scripts/test-*.ts`**, so a new pure
  suite is in the gate the moment the file exists.

## Goals / Non-Goals

**Goals:**

- Publish indexable, JavaScript free, bilingual landing pages for the five event occasions
  the product is actually tuned for, plus a marketing home.
- Make every indexing signal correct **by construction and by test**, not by review: an
  asymmetric hreflang cluster or a sitemap entry pointing at a missing file is invisible in
  a browser and surfaces only in Search Console weeks later.
- Add no build step, no dependency, and no runtime code.

**Non-Goals:**

- No server side rendering and no static site generator.
- No language prefixed routing inside either React app.
- No callable, no Firestore access, no auth, no rules change.
- No per game or per run marketing pages.

## Decisions

### 1. The pages live on the participant origin, not the creator console

Landing pages ship under `apps/play-web/public/`, so they serve from
`https://rush-point.com/...`.

*Why:* it is the apex domain and the brand address, it already answers `Allow: /` in
`robots.txt`, and external links will point at the brand rather than at a subdomain. The
creator console's `robots.txt` deliberately allows only `/$`, `/privacy` and `/terms`
because everything else is behind authentication, and threading marketing pages through
that allow list would weaken a rule that is currently crisp.

*Consequence, and it is a real one:* the audience for these pages is creators, and the call
to action therefore points cross origin to `creator.rush-point.com`. That is a deliberate
trade: brand authority on the apex, one extra hop for the visitor.

*Alternative rejected:* hosting on the creator console. It puts marketing behind the
subdomain that carries the least brand recognition and forces the crawl rules to grow
exceptions.

*Alternative rejected:* hosting on both. Duplicate content across two origins is the exact
problem canonical tags exist to clean up after, and creating it deliberately is
indefensible.

### 2. URLs are directory indexes, so `firebase.json` is not touched at all

A page for subject `s` in language `l` lives at `apps/play-web/public/<l>/<s>/index.html`
and serves at `https://rush-point.com/<l>/<s>/`. The language home is
`public/<l>/index.html` at `https://rush-point.com/<l>/`.

*Why:* Firebase Hosting resolves a directory path to its `index.html` as part of static
content resolution, which runs before rewrites. So this works with **zero** hosting
configuration change.

*Alternative rejected:* flat `*.html` files plus `"cleanUrls": true`. It gets the same
pretty URLs but changes a site wide hosting behaviour (it also starts 301 redirecting any
`.html` path) to buy nothing. A config change that alters how every path on the origin is
resolved is not worth a cosmetic difference, especially on an origin where players join
live games.

*Consequence:* canonical URLs carry a trailing slash, and every self reference, alternate
href and sitemap entry must use that exact form. A trailing slash mismatch is a duplicate
URL, so the canonical form is defined once in the pure layer and never hand written.

### 3. Slugs are Latin in both languages

Hebrew pages use Latin slugs, identical to their English counterparts, differing only in
the language prefix: `/he/bar-mitzva/` pairs with `/en/bar-mitzva/`.

*Why:* percent encoded Hebrew in a path is fragile. Hebrew has two valid Unicode
encodings, composed and decomposed, and an inconsistency between them breaks URL matching
silently. Latin slugs sidestep the entire class. Identical slugs across languages also
make the hreflang pairing **structural**: the counterpart of a page is derived by swapping
the prefix, so symmetry cannot be got wrong by hand.

Slugs contain hyphens, which the no dash copy standard explicitly exempts: file paths and
URLs are not prose.

### 4. The pages are generated from a pure module, and the output is committed

Three pieces:

- `scripts/lib/landingPages.ts` (pure, no filesystem): the page registry (subject,
  language, slug, title, description, copy blocks) plus the pure functions that derive
  everything positional from it. `landingPageUrl`, `alternatesFor`, `renderLandingPage`,
  `sitemapXml`, `landingPageFiles`.
- `scripts/build-landing-pages.ts`: the only piece that writes. Renders the registry
  through the pure layer and writes the files into `apps/play-web/public/`, plus the
  regenerated `sitemap.xml`.
- `scripts/test-landing-pages.ts`: the gate.

*Why generate rather than hand write:* twelve documents each carrying a title, a
description, a canonical, three alternates, six Open Graph tags, three Twitter tags and a
JSON LD block is roughly two hundred interdependent values. Hand maintained, the second
edit desynchronises something, and the failure is silent. Generated, the relationships are
computed: an alternate set is derived from the registry, so it is symmetric because it
cannot be anything else.

*Why commit the output rather than generate during the build:* generating at build time
would mean the gate build and the playtest build both produce it, which is exactly the
class of shared write that already caused the `dist` versus `dist-playtest` incident. A
committed file is reviewable in a diff, is served identically by every build, and needs no
build wiring. **The cost is drift**, so the test asserts the committed files are byte
identical to what the generator produces now. A stale commit fails `npm test` rather than
shipping quietly.

### 5. `x-default` points at the English page

Each page declares three alternates: itself, its counterpart, and `x-default`. The
`x-default` entry targets the **English** page of the same subject.

*Why:* `he-IL` is a language plus region target, appropriate for the primary market.
`x-default` is the fallback for everyone the targeted annotations do not match, which is
by definition an international audience, and English is the unmarked choice for them.
Pointing `x-default` at Hebrew would serve Hebrew to a visitor in any country whose
language is neither, which is worse for them and worse for the page.

*Note on what hreflang does not do:* it steers search results only. It does not redirect
anyone. The pages therefore each carry a plain visible link to their counterpart, because
a visitor who lands on the wrong language needs a way across that does not depend on
Google.

### 6. Language correctness is checked by the shared leak predicate, reused not reimplemented

`scripts/test-landing-pages.ts` imports `hasEnglishWord` and `hasHebrew` from
`scripts/lib/i18nLeak.ts`, the single predicate already shared by `check-i18n.ts` and
`test-i18n-parity.ts`.

*Why:* the repo has one rule for what counts as a language leak, in one file, on purpose. A
landing page checker with its own regex would be a second rule that drifts from the first,
and the whole reason `i18nLeak.ts` was extracted was to stop exactly that.

The `check-i18n.ts` scan directories are **not** widened to `public/`. Its model is that
user facing text is routed through `t.*`, and a static document cannot import the module
graph, so every landing page string would be a PART B finding by construction. The right
answer is that this surface is governed by its own suite, which the design records here so
the exemption is a decision rather than an oversight.

### 7. No dash coverage extends by scanning the generated registry, not the files

`scripts/test-no-dashes.ts` grows a PART D that scans the landing page **registry** copy
plus the rendered metadata.

*Why the registry rather than the HTML:* the registry is where a human types, so an error
message can name the offending field directly instead of a line in generated markup. PART C
keeps its existing shape for `index.html`, where hand written HTML genuinely is the source.
PART D also carries the same reach assertion PART C has, for the same reason: a gate that
silently scans zero fields is indistinguishable from a gate that passes.

### 8. Styling is inline and self contained

Each page carries a small `<style>` block in its head. No external stylesheet, no font from
a CDN, no image beyond the existing `og.jpg`.

*Why:* the page must render fully from one request with no JavaScript, and it must not
reference a hashed asset, because a hashed asset name changes on every rebuild and a
committed static file cannot track it. Self contained also means these pages cannot break
when either app's styling changes.

### 9. Outbound links from the app are confined to the existing footer

The creator console links out to the landing pages from `AppFooter`, the component that
already renders the legal links.

*Why:* the requirement is that the pages are not orphaned. Reusing the footer, which is
already a list of links with an established i18n pattern, adds the smallest possible amount
of new UI, and each new label is a normal dictionary entry in both languages. Any richer
in app surface would be marketing work on an authenticated console that search engines
never see.

## Risks / Trade-offs

- **Committed generated files go stale** → the test regenerates in memory and compares
  against disk, so a registry edit without a regenerate fails `npm test` naming the drifted
  file.
- **A sitemap entry outlives its page, or a page is missing from the sitemap** → both
  directions are asserted as a set equality, not a subset check, so a stale entry fails just
  as loudly as a missing one.
- **An hreflang cluster becomes asymmetric** → alternates are derived, never authored, and
  the test additionally verifies symmetry and that every alternate target resolves to a page
  that exists on disk.
- **A future contributor adds a page to the registry and forgets a language** → the pairing
  is asserted, so an unpaired subject fails.
- **These pages could be mistaken for a place to put app UI** → they are inert files that
  import nothing; the test asserts no page references an app bundle or a hashed asset, which
  also stops anyone quietly turning one into a third entry point.
- **Cross origin call to action costs a hop** → accepted, and it is the direct consequence
  of decision 1. The link is prominent and absolute, and it carries the visitor to the
  console's logged out landing page, which is itself indexable.
- **Search results take weeks to move** → real, and unavoidable. This change makes the pages
  correct and crawlable; it does not make them rank. Ranking follows from the content being
  genuinely useful and from the external links tracked separately as operator work.

## Migration Plan

Additive and reversible. The pages are new paths that nothing currently serves, so there is
no cutover: before the deploy those paths 404 through the SPA rewrite, after it they serve
files. `sitemap.xml` is rewritten in place, and the only in app change is a footer link
list.

Rollback is deleting the new files and restoring the previous `sitemap.xml`. Nothing else
in either app depends on them, and no data is written anywhere.

After deploying, submit the updated sitemap in Search Console for the participant origin so
the new URLs are discovered without waiting for a natural recrawl.

## Open Questions

- **Search Console verification status for both origins is unknown**, and cannot be checked
  from the repository. If the participant origin is not verified, the sitemap cannot be
  submitted and discovery falls back to natural crawling. This is operator work, not code.
- **The English pages target no specific region.** If the product later markets into a
  specific English speaking market, `en` would become `en-US` or similar and the annotation
  set grows. Left as plain `en` deliberately: an unnecessary region target narrows reach.

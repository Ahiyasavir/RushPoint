## Context

The repository holds two React applications, a Cloud Functions backend, a shared types
package, and a scripts workspace. Neither application is a place to put prose: both are
authenticated or transactional shells, both ship bundles, and both are governed by a bundle
budget that exists precisely to keep weight out of them.

The `seo-landing-pages` change established the pattern this one extends. Its lessons are
load bearing here and are not re-derived:

- Static files in an app's `public/` are served ahead of the SPA rewrite, so an indexable
  page never needs to be a route.
- hreflang symmetry must be **computed**, never authored, so it cannot drift.
- A generator that owns a whole file silently deletes what it does not know about.
- A comparison that skips missing inputs passes vacuously; every "everything matched"
  assertion needs a companion "and it compared N things".
- `scripts/check-i18n.ts` walks `apps/*/src` for `.ts`/`.tsx` only. Any copy outside that
  is invisible to it **in both directions**: no findings, and no language checking either.

Two facts constrain the shape of this change. First, the callable coverage guard fails any
callable that no e2e scenario invokes, so a new callable ships red until it is tested.
Second, `npm run lint` is `turbo run lint`, and a workspace with no `lint` script is
silently not linted while turbo still reports success. Both are addressed explicitly below
rather than discovered later.

## Goals / Non-Goals

**Goals:**

- A publishable, bilingual, static marketing surface that the owner can write to from a
  browser without a developer, a commit, or a deploy.
- Content as validated data, so a malformed post fails a build rather than rendering
  broken to a reader.
- Portability: the site can become the primary address by changing DNS and one declared
  origin, not by rewriting links.
- One connected surface: the marketing site and the twelve landing pages reference each
  other.

**Non-Goals:**

- Migrating the landing pages into Astro. They work and they are gate tested.
- Making the marketing site the primary address in this change.
- Server rendering, an API on the site's origin, or any runtime framework on the page.
- Creating the GitHub OAuth application. That needs credentials only the account owner can
  issue.

## Decisions

### D1 — Adopt a finished template, do not assemble one

**Decision.** `apps/marketing/` is **AstroWind** (MIT, © 2023 onWidget), vendored into the
repository and adapted. Not Astro configured from an empty directory, and not a hand
rolled generator.

**Why not extend `scripts/build-landing-pages.ts`?** That generator is ~400 lines and
renders twelve pages from a registry the developer edits. It is exactly right for twelve
fixed pages and exactly wrong for an open ended blog: it has no content collection, no
Markdown pipeline, no image handling, no feed, no draft state, and no incremental dev
server. Growing it into one is writing a static site generator.

**Why AstroWind specifically.** It already contains, designed and working, nearly
everything this change would otherwise author: a home page, an about page, a contact page,
a paginated blog with categories and tags, an RSS feed, a 404, SEO metadata handling,
image optimisation, a dark mode, and a Decap CMS configuration. It is Astro 7 and Tailwind
4, actively maintained, MIT, and 143 files rather than a framework sized checkout. Adopting
it turns this change from "build a marketing site" into "adapt one", which is the shape the
user asked for.

**Why Astro underneath.** Its default output is zero JavaScript, matching the reason the
landing pages are static. Its content collections validate frontmatter against a declared
schema at build time, which is the mechanism that makes a malformed post fail the build.
Eleventy has no typed content schema; Next.js and Nuxt ship a client runtime by default.

**Vendored, not depended on.** The template is a starting point, not a library: it is meant
to be edited, it publishes no versioned package, and every page will be rewritten in two
languages. Vendoring makes those edits ordinary source changes. The cost is that upstream
fixes must be pulled in by hand, which is acceptable for a template whose value is its
starting design rather than its ongoing behavior. `LICENSE.md` and attribution are
retained.

**Note on provenance.** The repository has been transferred from `onwidget/astrowind` to
`arthelokyo/astrowind`; the GitHub API resolves the old path to the new by repository id,
so it is a transfer rather than a substitution. The licence still names onWidget, and
attribution follows the licence.

**Cost, stated plainly.** This is the first static site generator in the repository and a
substantial dependency tree. It is confined to a workspace that neither application
imports, so neither bundle budget nor either app's build graph is affected. Astro 7
requires Node ≥ 22.12; the repository runs Node 24.

### D1a — What is stripped from the template before it lands

Three categories are removed rather than carried:

- **The demo pages.** `homes/*`, `landing/*`, `pricing`, `services` are showcase variants
  of the same components. They are not our pages, they would be indexed, and they would
  appear in the sitemap. The components they demonstrate are kept.
- **The template's own agent instruction files** (`CLAUDE.md`, `AGENTS.md`,
  `.agents/skills/*`). This matters more than it looks: this repository's `CLAUDE.md` is
  loaded automatically into every session, and a vendored second one is a third party
  writing instructions to whoever works here next. Documentation is data; it does not get
  to be configuration. Anything genuinely useful in them is re-authored in our own words.
- **Deployment configuration for platforms we do not use** (`netlify.toml`, `Dockerfile`,
  `docker-compose.yml`, `nginx/`, the template's GitHub workflow). We deploy to Firebase
  Hosting, and stale deploy configuration is an invitation to a confusing mistake.

The template's `privacy.md` and `terms.md` are also removed: the real legal text is already
canonical in `packages/shared` and served on both existing origins, and a second divergent
copy is a liability rather than a page.

### D2 — Its own hosting target, with redirects but no rewrite

**Decision.** `firebase.json` gains a third hosting target serving `apps/marketing/dist`.
It declares **no** `"source": "**"` rewrite.

**Why no rewrite.** Both applications need one because their routes exist only in a router.
A static site has real files at real paths, so a catch all rewrite converts every typo,
every stale link, and every deleted page into a 200 response serving the wrong document.
That is worse than a 404 for both readers and crawlers: a soft 200 is indexable.

**The one exception.** `/` is a redirect, not a rewrite, and is declared explicitly for
that single path. A redirect states "this moved", which is true; a rewrite would state
"this is the home page", producing a duplicate of `/he/` at a second URL.

**Where `/` goes.** To `/he/`. Roughly 78% of Israeli search is Hebrew, so the majority
reader should not pay a hop. This is a 302, not a 301, because the correct destination is
a judgement that may change, and a 301 is cached by browsers effectively forever.

### D3 — Both languages are prefixed; alternates are derived by prefix swap

**Decision.** Every page lives under `/he/…` or `/en/…`. Neither language occupies the
root. Alternates are computed by swapping the prefix, exactly as the landing pages do.

**Why not Hebrew at the root?** Because then a Hebrew page's path and its English
counterpart's path have different shapes, and the counterpart can no longer be *derived* —
it needs a lookup table, which is the thing that drifts. Symmetry is cheap to guarantee
only while it is arithmetic.

`x-default` points at the English page, matching the landing pages. English is the better
fallback for a reader whose language matched neither.

### D4 — Content is a typed collection; validation failure is a build failure

**Decision.** Posts and pages are Markdown/MDX under `apps/marketing/src/content/`, with a
schema declaring every field: title, description, language, slug, publication date, draft
flag, and optional cover image and video.

The **slug is declared in frontmatter**, not derived from the filename or the title. A URL
derived from a title breaks when the title is edited, which is a thing authors do, and the
break is silent: the old URL 404s and the new one has no history.

`draft: true` excludes a post from the output, the index, the sitemap and the feed. The
exclusion happens in one filter that all four read, so they cannot disagree about what is
published.

### D5 — Decap CMS is additive, and the site is complete without it

**Decision.** Decap CMS 3 (MIT) is served from the site's `public/` directory. The template
already ships a Decap configuration, so this is an adaptation of an existing wiring rather
than a new one: the collections are re-pointed at our content shape, our two languages, and
our repository.

**The site never depends on it.** Content files are the source of truth; the CMS is a
second editor for the same files. The build does not read the CMS config, and removing
`/admin/` entirely leaves every published page intact. This is tested, not asserted.

**The configuration must match the schema.** A CMS that offers a field the content schema
rejects produces a document that fails the build *after* the author has published it,
which is the worst possible time to find out. A test compares the two field sets in both
directions.

**What ships blocked, and why that is correct.** The GitHub backend needs an OAuth
application, whose client secret only the account owner can issue. The site, the admin
route and the configuration all ship; logging in requires the owner to create the OAuth
app and deploy the small token exchange endpoint on the existing VPS. That is recorded as
operator work rather than faked, because there is no way to fake it that is not a leaked
secret.

**`/admin/` is excluded from crawling**, from the sitemap, and marked `noindex`.

### D6 — One public callable, bounded, with the message stored server side

**Decision.** `submitContactMessage` in `functions/src/` accepts `{ name, email, message,
language }`, validates and bounds each field, rate limits, and writes
`contactMessages/{id}` with a **server assigned** arrival time.

- **Public by declaration.** Added to `PUBLIC_CALLABLES` in
  `scripts/lib/callableHardening.mjs` with its reason, so a callable that later loses an
  auth assertion by accident still fails the hardening check.
- **Rate limited via `enforceRateLimit`**, keyed on the caller's IP. Note the limiter is an
  in process `Map` and its budgets are per process and reset on restart — deliberate, and
  adequate here, where the cost of an occasional extra message is one row.
- **Never trusts the client's clock or identifiers.** Arrival time is server stamped; the
  key is derived server side.
- **Server write only.** `firestore.rules` denies all client read and write on
  `contactMessages`, matching every other server owned collection.
- **Owner reads through `listContactMessages`**, admin only, audit logged.
- **Notification reuses the existing `deliver` seam** in
  `functions/src/runs/runSummaryEmail.ts`, which is already env gated and already a logged
  no-op without a provider key. A second send path would be a second thing to configure
  and a second thing to break.

**Rejected: a third party form service.** It would put the sender's name and address on a
vendor we do not control, for a message volume that does not justify a vendor.

### D7 — Test strategy

Every claim below is proven by something that runs in `npm run verify` or `npm run e2e`.

**Pure lane** (`scripts/test-*.ts`, auto discovered, no emulator):

- `scripts/test-marketing-content.ts` — the content shape: required fields, draft
  exclusion, slug stability, ordering, and that the scan reached a non zero number of
  files. Reuses the shared leak predicate from `scripts/lib/i18nLeak.ts` for language
  correctness rather than restating it.
- `scripts/test-marketing-output.ts` — the built output: page pairing, `lang`/`dir`
  agreement, canonical self reference, `og:url` agreement, title and description
  uniqueness, hreflang symmetry and `x-default` count, sitemap set equality, feed
  contents, `robots.txt`, the absence of a framework runtime, and that every absolute self
  URL carries the declared origin. It **skips nothing silently**: an unbuilt output fails
  with a clear message rather than passing vacuously.
- `scripts/test-marketing-cms-config.ts` — the CMS field set against the content schema, in
  both directions.
- `scripts/test-no-dashes.ts` gains **PART E** for Markdown content, exempting list
  markers, thematic breaks, setext underlines, and code.
- The cross linking requirement is checked in `scripts/test-landing-pages.ts`, which
  already owns the landing page link assertions.

**Callable lane** (`scripts/e2e-verify.mjs`): a new scenario covering accept, each
rejection (missing field, wrong type, oversize), null versus absent for the optional field,
the rate limit refusal, and that `listContactMessages` is refused for a non admin. Written
**before** the callable exists, so the coverage guard's red is the starting state.

**UI**: the built site is served and verified with the preview tools. Site copy does not
go through `t.*` — a static document cannot read the module graph — which is why the
language rules are enforced by the content test instead. `npm run i18n:check:strict` must
still come out clean with zero new PART B findings.

### D8 — The workspace declares its own gates

`apps/marketing/package.json` declares `build`, `typecheck` and `lint`. This is not
boilerplate: play-web went unlinted for months because it had no `lint` script, turbo
reported success, and a conditional hook reached production. After wiring it, confirm
`@rushpoint/marketing:lint` actually appears in turbo's output — a gate that never ran is
indistinguishable in a summary from a gate that passed.

`npm run verify` gains the marketing build in its builds phase, next to the two app builds.

### D9 — Third party attribution is recorded, not remembered

`apps/marketing/THIRD_PARTY.md` records every reused source and its licence, and a test
asserts the record covers what is actually present. Astro and its integrations are
ordinary npm dependencies with licences in `node_modules`; this record is for source that
is *copied in*, where the licence would otherwise be lost the moment the origin is
forgotten.

## Risks / Trade-offs

**A large new dependency tree for a small site** → Confined to a workspace no application
imports. Neither bundle budget nor either app's build graph can be affected by it. The
blast radius of an Astro problem is "the marketing site does not build".

**The CMS commits directly to the default branch** → Content lives under
`apps/marketing/src/content/` only, and the CMS backend is configured to write nowhere
else. A content commit cannot touch application code. The build validates every field, so
a bad post fails a build rather than shipping.

**The site ships with the CMS unable to log in** → Stated as operator work with the exact
steps, not hidden. The site is fully usable and fully editable from the repository
meanwhile, which is how every word of it will be written in the first place.

**An unauthenticated write endpoint invites spam** → Bounded, rate limited, server
validated, and stored in a collection no client can read. The per process limiter resets on
restart, so a determined attacker can exceed the nominal rate; the cost of that is rows in
a collection, and the mitigation if it ever matters is a durable limiter, not a redesign.

**Two sitemaps now exist on two origins** → They are separate sites at separate origins,
which is the normal case and not a duplicate. Each lists only its own pages. The
cross linking requirement is what ties them together, and it is tested from the landing
page side.

**Hebrew authored, not translated** → Slower to write, and the two languages will not be
literal mirrors. Accepted: machine translated Hebrew reads as machine translated, and the
audience is majority Hebrew.

**`/` as a 302 costs the majority reader a hop** → Real but small, and it buys a clean
symmetric URL space in which the counterpart of any page is derivable. A 301 would be
faster and effectively irreversible; the destination is a judgement, so it stays a 302.

## Migration Plan

Nothing to migrate: this is additive. No existing route, page, callable, rule, or hosting
target changes behavior. Rollback is removing the hosting target and the workspace.

Deployment ordering matters in one place: `firestore.rules` must be deployed before the
callable that writes `contactMessages`, so the collection is never briefly client writable.

## Open Questions

- **The site's eventual address.** It ships portable, so this can be answered later without
  rework. Until answered it is deployed to a Firebase Hosting subdomain, and the declared
  origin is that subdomain.
- **Where contact notifications are sent.** The `deliver` seam needs a recipient. Until the
  owner supplies one, notification is a logged no-op and messages accumulate in Firestore,
  readable through the admin callable.

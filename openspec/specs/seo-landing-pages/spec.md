# seo-landing-pages Specification

## Purpose
Static, pre-rendered bilingual landing pages served from an app's public/ directory,
carrying their own indexing signals so organic search can reach the product without the
SPA shell standing in the way.

## Requirements

### Requirement: Landing pages are served as static files ahead of the SPA rewrite

Each landing page SHALL be a complete HTML document stored under an app's `public/`
directory, so Firebase Hosting serves the real file rather than resolving the path through
the `"source": "**"` rewrite to `index.html`.

A landing page SHALL render its full content, headings, and call to action from the initial
HTML response, without executing any JavaScript. A landing page SHALL NOT import an app
bundle, a hashed asset, or a module from either React app.

#### Scenario: A landing page path resolves to its own document

- **WHEN** the built output directory of an app is inspected for a landing page path
- **THEN** a real HTML file exists at that path, distinct from `index.html`

#### Scenario: Content survives with scripting disabled

- **WHEN** a landing page document is parsed without executing scripts
- **THEN** its headline, body copy, and call to action link are all present in the markup

#### Scenario: No app bundle is referenced

- **WHEN** a landing page document is scanned for script and stylesheet references
- **THEN** it references no hashed asset filename and no app entry module

### Requirement: Every landing page exists in both Hebrew and English

Landing pages SHALL be published as language pairs. For every page in one language there
SHALL exist a counterpart in the other language covering the same subject.

A Hebrew page SHALL declare `lang="he"` and `dir="rtl"`. An English page SHALL declare
`lang="en"` and `dir="ltr"`. A page's visible copy SHALL be written in the language it
declares: a Hebrew page SHALL NOT leak English copy, and an English page SHALL NOT leak
Hebrew copy, judged by the shared leak predicate that already governs the translation
dictionaries.

#### Scenario: Pages are paired

- **WHEN** the set of published landing pages is enumerated
- **THEN** every page has exactly one counterpart of the other language for the same subject

#### Scenario: Declared language matches declared direction

- **WHEN** a landing page declares `lang="he"`
- **THEN** it declares `dir="rtl"`, and an `en` page declares `dir="ltr"`

#### Scenario: Copy does not leak the other language

- **WHEN** the visible copy of each landing page is checked with the shared leak predicate
- **THEN** no Hebrew page contains English copy and no English page contains Hebrew copy

### Requirement: Every landing page carries a complete and self consistent signal set

Each landing page SHALL declare a non empty `<title>`, a non empty
`<meta name="description">`, a `<link rel="canonical">`, Open Graph tags
(`og:type`, `og:title`, `og:description`, `og:url`, `og:image`, `og:locale`), Twitter card
tags, and a JSON LD block that parses as valid JSON.

A page's canonical URL SHALL equal that page's own absolute URL, and its `og:url` SHALL
equal its canonical URL. Titles SHALL be unique across all landing pages, and descriptions
SHALL be unique across all landing pages, so that no two pages compete as duplicates.

#### Scenario: Required tags are present

- **WHEN** a landing page is scanned for indexing tags
- **THEN** title, description, canonical, the Open Graph set, the Twitter set, and a JSON LD block are all present

#### Scenario: Canonical is self referencing and agrees with og:url

- **WHEN** a landing page's canonical href is compared to its own absolute URL and to its `og:url`
- **THEN** all three are identical

#### Scenario: JSON LD parses

- **WHEN** each landing page's JSON LD block is parsed
- **THEN** parsing succeeds and yields an object declaring a `@context` and a `@type`

#### Scenario: Titles and descriptions are unique

- **WHEN** titles are collected across all landing pages, and descriptions likewise
- **THEN** no title is repeated and no description is repeated

### Requirement: hreflang annotations are static, self referencing, and symmetric

Each landing page SHALL declare `<link rel="alternate" hreflang="...">` annotations in its
static markup, never injected by JavaScript.

Each page's annotation set SHALL include a self referencing entry for its own language, an
entry for its counterpart page, and an `x-default` entry. Annotations SHALL be symmetric:
if page A names page B as an alternate, page B SHALL name page A as an alternate. Every
`hreflang` value SHALL be one of `he-IL`, `en`, or `x-default`, and every alternate `href`
SHALL be an absolute URL that corresponds to a published landing page.

#### Scenario: Annotations are in the static markup

- **WHEN** a landing page document is parsed without executing scripts
- **THEN** its `hreflang` link elements are present in the parsed markup

#### Scenario: Self reference is present

- **WHEN** a landing page's alternate set is examined
- **THEN** it contains an entry whose href is the page's own absolute URL, tagged with the page's own language

#### Scenario: Annotations are symmetric

- **WHEN** page A declares page B as an alternate
- **THEN** page B declares page A as an alternate

#### Scenario: x-default is declared

- **WHEN** a landing page's alternate set is examined
- **THEN** exactly one entry carries `hreflang="x-default"`

#### Scenario: Every alternate target exists

- **WHEN** each alternate href across all landing pages is resolved against the published set
- **THEN** every href corresponds to a landing page that exists

### Requirement: Landing pages are advertised by robots.txt and sitemap.xml

The `sitemap.xml` of the app serving the landing pages SHALL list every landing page URL,
alongside the app's declared static routes, and SHALL list no other URL. The generator owns
the whole file, so the static routes it must preserve SHALL be declared explicitly rather
than inferred: a generator that emitted landing pages alone would silently delete the
already published routes on its first run. The `robots.txt` of that app SHALL NOT disallow
any landing page path.

#### Scenario: Sitemap lists exactly the published pages

- **WHEN** the sitemap URL set is compared with the published landing page set plus the declared static routes
- **THEN** the two sets are equal, with no missing entry and no stale entry

#### Scenario: Pre existing static routes survive generation

- **WHEN** the sitemap is regenerated from scratch
- **THEN** every declared static route is still listed

#### Scenario: Crawling is not blocked

- **WHEN** each landing page path is evaluated against the app's `robots.txt` rules
- **THEN** no landing page path is disallowed

### Requirement: Landing pages are linked, not orphaned

Every landing page SHALL contain at least one link into the application, so a visitor who
arrives from search can act. Every landing page SHALL contain at least one link to another
landing page, so the set is internally connected rather than a collection of dead ends.

The application SHALL link outward to landing pages from a surface reachable without
authentication, so the pages accumulate internal links.

Every landing page SHALL additionally link to the marketing site, and the marketing site
SHALL link back to at least one landing page. Without this the two sets are two islands:
each internally connected, neither reachable from the other, and neither passing any
signal to the other. The link SHALL be to a page that exists in the same language as the
landing page carrying it, so a Hebrew reader is not handed an English destination.

#### Scenario: Each page offers a way into the product

- **WHEN** a landing page's links are enumerated
- **THEN** at least one link targets the application

#### Scenario: Each page links onward to a sibling

- **WHEN** a landing page's links are enumerated
- **THEN** at least one link targets another landing page

#### Scenario: The app links out to the pages

- **WHEN** the unauthenticated landing surface of the creator console is inspected
- **THEN** it links to at least one landing page

#### Scenario: Each page links to the marketing site in its own language

- **WHEN** a landing page's links are enumerated
- **THEN** at least one link targets a marketing site page declaring the same language as the landing page

#### Scenario: The marketing site links back

- **WHEN** the marketing site's links are enumerated
- **THEN** at least one targets a landing page

### Requirement: Landing pages are outside the t.* dictionary model

Landing page copy lives in static HTML and SHALL NOT be routed through the `t.*`
translation maps, because a static document cannot read the module graph. The i18n checker
SHALL be told about this surface explicitly, so landing pages neither raise hardcoded
string findings nor silently escape the language correctness rules.

#### Scenario: Landing pages raise no hardcoded string findings

- **WHEN** `npm run i18n:check:strict` runs after the landing pages are added
- **THEN** it reports no new findings attributable to landing page files

#### Scenario: Language correctness still applies

- **WHEN** landing page copy is checked for language correctness
- **THEN** the shared leak predicate is applied to it, exactly as it is to dictionary values

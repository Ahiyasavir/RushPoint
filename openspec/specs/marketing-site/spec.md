# marketing-site Specification

## Purpose
The public marketing site: a bilingual, statically built set of pages describing what the
product is, who it is for, and how to start, plus a blog that can grow. It is separate from
the two applications, carries its own indexing signals, and is authorable without a
developer.

## Requirements

### Requirement: The site is static output with no runtime framework on the page

The marketing site SHALL be built to static HTML files ahead of any request. A page SHALL
render its headings, body copy, navigation, and links from the initial HTML response,
without executing JavaScript.

A page SHALL NOT ship a client side rendering runtime or a hydration bundle for content
that does not change after load. Where a page does need script, that script SHALL be
confined to that page and SHALL NOT be a prerequisite for reading the page's content.

#### Scenario: Content survives with scripting disabled

- **WHEN** a built marketing page is parsed without executing scripts
- **THEN** its headings, body copy, navigation, and links are all present in the markup

#### Scenario: No framework runtime is shipped for static content

- **WHEN** the built output of the home, story, blog index, and blog post pages is scanned for script references
- **THEN** none of them references a client side framework runtime or hydration bundle

### Requirement: The site is portable to a different address without rework

The site SHALL derive every internal link, asset reference, canonical URL, alternate URL,
and sitemap entry from a single declared site origin. No page SHALL hardcode a host, and no
internal link SHALL assume the site is mounted at a subpath.

Changing the declared origin SHALL be sufficient to move the site to a different address:
the built output SHALL then be internally consistent at the new address with no source
change beyond that declaration.

#### Scenario: One declaration governs every absolute URL

- **WHEN** the built output is scanned for absolute URLs pointing at our own site
- **THEN** every one of them begins with the declared site origin

#### Scenario: Changing the origin moves the whole site

- **WHEN** the declared origin is changed and the site is rebuilt
- **THEN** every canonical, alternate, and sitemap URL reflects the new origin, and no stale origin remains anywhere in the output

#### Scenario: Internal links do not assume a subpath

- **WHEN** internal links in the built output are examined
- **THEN** each is either root relative or absolute under the declared origin, and none is relative to a mount point

### Requirement: The site serves real files at real paths, with no catch all rewrite

The site's hosting configuration SHALL NOT rewrite unmatched paths to a single document.
A request for a path that has no page SHALL fail as a not found, rather than returning a
page with a success status.

#### Scenario: A missing path is not disguised as a page

- **WHEN** the site's hosting configuration is inspected
- **THEN** it declares no rewrite that sends unmatched paths to an index document

#### Scenario: Every published path exists as a file

- **WHEN** every path listed in the site's sitemap is resolved against the built output
- **THEN** a real file exists for each one

### Requirement: Every standing page exists in both Hebrew and English

The site's STANDING pages (home, story, contact, and the blog index) SHALL be published as
language pairs. For every standing page in one language there SHALL exist a counterpart in
the other language covering the same subject.

Blog posts SHALL NOT be required to have a counterpart. A post declares one language and
appears only in that language's index and feed. This is deliberate: requiring a
counterpart for every post would either block publishing until a translation exists, or
produce the machine translated Hebrew this design rejects. A post therefore carries a self
referencing canonical and no counterpart annotation, which is the accurate statement that
no equivalent exists, rather than a claim pointing at a page that says something else.

A post whose author DOES write both languages SHALL be able to declare the pairing, and
the two SHALL then annotate each other exactly as standing pages do.

A Hebrew page SHALL declare `lang="he"` and `dir="rtl"`. An English page SHALL declare
`lang="en"` and `dir="ltr"`. A page's visible copy SHALL be written in the language it
declares, judged by the shared leak predicate that already governs the translation
dictionaries and the landing pages: a Hebrew page SHALL NOT leak English copy, and an
English page SHALL NOT leak Hebrew copy.

Hebrew copy SHALL be authored, not machine translated from English.

#### Scenario: Standing pages are paired

- **WHEN** the set of published standing pages is enumerated
- **THEN** every standing page has exactly one counterpart of the other language for the same subject

#### Scenario: An unpaired post is publishable

- **WHEN** a post is published in one language with no counterpart
- **THEN** the build succeeds, the post appears in that language's index and feed only, and it declares no counterpart annotation

#### Scenario: A paired post annotates its counterpart

- **WHEN** two posts declare each other as the same subject in different languages
- **THEN** each names the other as an alternate, symmetrically

#### Scenario: Declared language matches declared direction

- **WHEN** a page declares `lang="he"`
- **THEN** it declares `dir="rtl"`, and an `en` page declares `dir="ltr"`

#### Scenario: Copy does not leak the other language

- **WHEN** the visible copy of each page is checked with the shared leak predicate
- **THEN** no Hebrew page contains English copy and no English page contains Hebrew copy

### Requirement: The language switch reaches the same page, not a home page

A page offering a language switch SHALL link to that page's own counterpart in the other
language, and SHALL derive it from the same alternate set the page publishes to crawlers.

A reader and a crawler must not be told different things about where the other version of
a page lives. Deriving both from one source makes the two answers the same by
construction, rather than by two pieces of code happening to agree.

A page with no counterpart SHALL fall back to the other language's home page, which is the
accurate answer, rather than linking to a page that does not exist.

#### Scenario: The switch lands on the counterpart

- **WHEN** a reader on a standing page in one language follows the language switch
- **THEN** they arrive at the same subject in the other language, not at its home page

#### Scenario: The switch agrees with the published alternates

- **WHEN** a page's language switch target is compared with the counterpart it declares to crawlers
- **THEN** the two are the same URL

#### Scenario: A page with no counterpart says so honestly

- **WHEN** a reader on an unpaired post follows the language switch
- **THEN** they arrive at the other language's home page rather than at a URL with no page behind it

### Requirement: The site is visually the same product as the applications

The site SHALL use the product's own accent colours, text scale, page surface and
typefaces, taken from the applications' own configuration rather than restated.

The neutral and accent SCALES SHALL be redefined, not only the semantic tokens that
reference them. A vendored template writes palette names directly in component class
strings, so repointing tokens alone leaves every direct use on the template's palette,
which typically shows up as one colour mode looking like a different product than the
other.

The agreement SHALL be asserted mechanically against the applications' configuration, so
that changing the brand in one place and not the other fails rather than quietly shipping
two products.

#### Scenario: The brand is the applications' brand

- **WHEN** the site's declared accent, text and surface colours are compared with the applications' own
- **THEN** they are the same values

#### Scenario: A one sided brand change fails

- **WHEN** the site's primary accent is changed to something the applications do not use
- **THEN** the comparison fails and names the token

#### Scenario: A direct palette use is on brand too

- **WHEN** a colour is written by name rather than through a semantic token
- **THEN** it resolves to the product's palette rather than the template's

### Requirement: A published post carries structured data a crawler can use

A blog post SHALL publish structured data naming its headline, its publication date, its
language and the page it describes.

Any URL in that structured data SHALL be absolute and resolvable. An authoring time
reference SHALL be resolved to the built asset before publication: structured data is
emitted verbatim and read by nobody, so an unresolved path is a broken reference that no
reader and no test notices.

#### Scenario: A post declares itself

- **WHEN** a published post's structured data is parsed
- **THEN** it names the post's own URL, its language, its headline and its publication date

#### Scenario: An image reference is resolvable

- **WHEN** a post's structured data names an image
- **THEN** the value is an absolute URL to the built asset, not an authoring path

### Requirement: Every page carries a complete and self consistent signal set

Each page SHALL declare a non empty `<title>`, a non empty `<meta name="description">`, a
`<link rel="canonical">`, Open Graph tags (`og:type`, `og:title`, `og:description`,
`og:url`, `og:image`, `og:locale`), Twitter card tags, and a JSON LD block that parses as
valid JSON.

A page's canonical URL SHALL equal that page's own absolute URL, and its `og:url` SHALL
equal its canonical URL. Titles SHALL be unique across all pages, and descriptions SHALL
be unique across all pages.

Each page SHALL declare `hreflang` annotations in its static markup, never injected by
JavaScript, comprising a self referencing entry, an entry for its counterpart, and exactly
one `x-default` entry. Annotations SHALL be symmetric: if page A names page B as an
alternate, page B SHALL name page A as an alternate.

#### Scenario: Required tags are present

- **WHEN** a page is scanned for indexing tags
- **THEN** title, description, canonical, the Open Graph set, the Twitter set, and a JSON LD block are all present

#### Scenario: Canonical is self referencing and agrees with og:url

- **WHEN** a page's canonical href is compared to its own absolute URL and to its `og:url`
- **THEN** all three are identical

#### Scenario: JSON LD parses

- **WHEN** each page's JSON LD block is parsed
- **THEN** parsing succeeds and yields an object declaring a `@context` and a `@type`

#### Scenario: Titles and descriptions are unique

- **WHEN** titles are collected across all pages, and descriptions likewise
- **THEN** no title is repeated and no description is repeated

#### Scenario: Alternates are symmetric and complete

- **WHEN** page A declares page B as an alternate
- **THEN** page B declares page A as an alternate, and each page's alternate set contains its own URL and exactly one `x-default`

### Requirement: Content is data with a declared shape, and a malformed post fails the build

Pages and posts SHALL be content files with typed frontmatter validated at build time. A
content file whose frontmatter is missing a required field, or carries a field of the
wrong type, SHALL fail the build.

A build SHALL NOT emit a page for a content file it could not validate, and SHALL NOT
substitute a default in place of a missing required field.

#### Scenario: A malformed post stops the build

- **WHEN** a post is given frontmatter missing a required field
- **THEN** the build fails and names the offending file

#### Scenario: A wrongly typed field stops the build

- **WHEN** a post declares a field with a value of the wrong type
- **THEN** the build fails and names the offending file and field

### Requirement: Drafts are not published

A post SHALL be publishable as a draft. A draft SHALL NOT appear in the built output, in
the blog index, in the sitemap, or in any feed.

#### Scenario: A draft is absent from the output

- **WHEN** a post marked as a draft is built
- **THEN** no page is emitted for it, and it appears in neither the index nor the sitemap nor the feed

### Requirement: Posts are ordered and dated, and their URLs do not change

The blog index SHALL list published posts most recent first, by their declared publication
date.

A post's URL SHALL be derived from its declared slug alone, never from its date, its
title, or its position in the index, so that editing a title or correcting a date does not
break an already published link.

#### Scenario: Newest first

- **WHEN** the blog index is rendered from posts with differing publication dates
- **THEN** the posts appear in descending date order

#### Scenario: A title edit does not move the post

- **WHEN** a published post's title is changed and the site is rebuilt
- **THEN** the post's URL is unchanged

### Requirement: The site advertises itself to crawlers

The site SHALL publish a `sitemap.xml` listing every published page, and no URL that does
not correspond to a published page. It SHALL publish a `robots.txt` that disallows no
published page path and that advertises the sitemap. It SHALL publish a feed of its posts.

Both `sitemap.xml` and the feed SHALL be generated from the same published page set that
produced the pages, never maintained by hand.

#### Scenario: The sitemap matches the published set

- **WHEN** the sitemap URL set is compared with the published page set
- **THEN** the two sets are equal, with no missing entry and no stale entry

#### Scenario: Crawling is not blocked

- **WHEN** each published path is evaluated against the site's `robots.txt` rules
- **THEN** no published path is disallowed, and the sitemap is advertised

#### Scenario: The feed lists published posts

- **WHEN** the feed is compared with the published post set
- **THEN** it lists every published post and no draft

### Requirement: The site is connected to the product and to the landing pages

Every page SHALL offer at least one link into the product, so a visitor who arrives from
search can act.

The site SHALL link to the occasion landing pages, and the occasion landing pages SHALL
link back to the site, so the two sets form one connected surface rather than two
disconnected islands.

#### Scenario: Each page offers a way into the product

- **WHEN** a page's links are enumerated
- **THEN** at least one link targets the application

#### Scenario: The two page sets reference each other

- **WHEN** the site's links and the landing pages' links are enumerated together
- **THEN** the site links to at least one landing page, and at least one landing page links back to the site

### Requirement: The authoring UI is additive and is never the source of truth

Content SHALL be readable, editable, buildable, and deployable from the repository alone,
with the authoring UI absent or unreachable.

The authoring UI SHALL write the same content files, in the same location and the same
shape, that a developer would write by hand. It SHALL NOT introduce a second store, a
second format, or a field the build does not understand.

The authoring UI's configuration SHALL declare every field the content shape requires, so
that a document created through the UI passes the same build time validation as one
written by hand.

#### Scenario: The site builds without the authoring UI

- **WHEN** the site is built with the authoring UI's assets removed
- **THEN** the build succeeds and every published page is emitted

#### Scenario: The UI's fields match the content shape

- **WHEN** the authoring UI's declared fields are compared with the content shape's required fields
- **THEN** every required field is present in the UI, and the UI declares no field the content shape rejects

#### Scenario: The admin surface is not indexed

- **WHEN** the admin route is evaluated against the site's `robots.txt` rules and its own markup
- **THEN** it is disallowed from crawling and marked not indexable, and it is absent from the sitemap

### Requirement: Reused third party code retains its licence and attribution

Where the site reuses third party source, that source SHALL be permissively licensed, and
its licence text and attribution SHALL be retained in the repository.

The site SHALL record which third party sources it reuses and under which licence, so the
answer does not depend on recalling where a file came from.

#### Scenario: Reused source is accounted for

- **WHEN** the site's third party attribution record is compared with the reused sources present in the workspace
- **THEN** every reused source is listed with its licence, and every listed licence text is present

### Requirement: Reused third party code does not keep its branding

The site SHALL NOT publish a reused source's name, author, promotional artwork or
promotional links, whatever its licence permits. Retaining a licence and retaining a brand
are separate obligations, and satisfying the first does not satisfy the second.

In particular the image a share of any page renders SHALL be the product's own, because it
is the first thing a reader sees of the site and the last thing anyone thinks to check.

The absence SHALL be asserted mechanically rather than reviewed, because a template's own
branding is indistinguishable from a finished site to whoever is looking at it.

#### Scenario: The template's branding is gone

- **WHEN** the site's source is scanned for the reused template's name, its author, and its promotional links
- **THEN** none is present, and the record states what was replaced

#### Scenario: The share image belongs to the product

- **WHEN** the default social sharing image is resolved
- **THEN** it is the product's own image, not one supplied by the template

### Requirement: A page reads in the language it declares

Every published page SHALL be free of text in a language other than the one it declares,
judged on its RENDERED output rather than on its source.

The judgement SHALL use the repository's single shared language leak predicate, so that
what counts as a leak has one definition rather than one per checker.

Output rather than source is the substance of this requirement, not an implementation
note. A source scan can only read the files it thinks to read, so a literal hardcoded
inside a component, or a default on a property nobody passed, is invisible to it while
being perfectly visible to a reader.

A brand name, a language's own name in the language switch, and a formatted date SHALL NOT
count as leaks.

#### Scenario: A page in one language contains no text from the other

- **WHEN** the visible text of a published page is read from the built output
- **THEN** none of it is in a language other than the one the page declares

#### Scenario: A hardcoded string bypassing the copy modules is still caught

- **WHEN** text in the wrong language is written directly into a component rather than into the copy modules
- **THEN** the page fails the check and the offending text is quoted

### Requirement: Every page is reachable and readable without a mouse

Every published page SHALL offer a link that skips the navigation, in the page's own
language, and the target of that link SHALL be focusable.

A skip link whose target cannot receive focus moves the viewport and leaves focus in the
navigation, which is indistinguishable to the user from the link not working, and is not
detectable by checking that the link exists.

Every published page SHALL declare exactly one top level heading and exactly one main
landmark, SHALL give every image an alt attribute, and SHALL write every accessible name
in the page's own language. An accessible name in the wrong language is read aloud in the
wrong language and is invisible on screen, so no visual review finds it.

#### Scenario: The skip link moves focus, not just the viewport

- **WHEN** a keyboard user activates the skip link
- **THEN** focus moves to the main content

#### Scenario: A page states what it is, once

- **WHEN** a published page's headings and landmarks are counted
- **THEN** there is exactly one top level heading and exactly one main landmark

#### Scenario: Accessible names match the page's language

- **WHEN** a page's accessible names are read
- **THEN** each is in the language the page declares

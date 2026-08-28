# ui-text-standards Specification

## Purpose
TBD - created by archiving change ui-no-dashes. Update Purpose after archive.
## Requirements
### Requirement: User-facing copy contains no dash/hyphen separators
All user-facing strings shipped by the apps SHALL NOT use an em-dash (`—`), en-dash (`–`), or
spaced hyphen (` - `) as a separator (this covers translation-map leaf values, visible JSX
text, page metadata in `index.html` and the web manifest, the copy and metadata of
static landing pages served from an app's `public/` directory, and **the frontmatter and body
of marketing site content files**). Sentences
SHALL be joined with commas, periods, or line breaks instead. Code comments, file paths, CLI flags,
CSS, and class names are exempt.

Landing page copy is included because it is the copy with the widest reach of all: like
`<title>` and `<meta name="description">`, it is text Google prints directly, and it lives
in neither the translation dictionaries nor component source, so the existing scans would
not otherwise reach it.

Marketing site content is included for the same reason and one more: it is Markdown, so it
is reached by no scan that walks `.ts` and `.tsx`, and it is written by whoever is
authoring, including through a browser UI that offers no hint that the rule exists. A rule
enforced only where developers type is not enforced where most of the copy will come from.

Within a Markdown body, a dash SHALL be exempt where it is Markdown syntax rather than
copy: a list marker, a thematic break, or a setext heading underline. Fenced code and
inline code spans are exempt on the same grounds as code comments.

#### Scenario: Translation maps are dash-free
- **WHEN** every string leaf in both apps' `translations` maps is scanned
- **THEN** no value contains `—`, `–`, or ` - `

#### Scenario: Landing page copy is dash-free
- **WHEN** the visible copy and metadata of every static landing page is scanned
- **THEN** no title, description, heading, or body string contains `—`, `–`, or ` - `

#### Scenario: Marketing content is dash-free
- **WHEN** the frontmatter and body of every marketing site content file is scanned
- **THEN** no title, description, heading, or body text contains `—`, `–`, or ` - `

#### Scenario: Markdown syntax is not mistaken for a separator
- **WHEN** a content file uses a hyphen as a list marker, a thematic break, a setext heading underline, or inside code
- **THEN** the scan does not report it

#### Scenario: The marketing scan actually reached the content
- **WHEN** the marketing content scan completes
- **THEN** it reports the number of fields it examined, and that number is greater than zero

#### Scenario: Regression is caught by the test lane
- **WHEN** a developer or author adds a translation value, landing page string, or marketing content string containing a dash separator
- **THEN** `npm test` fails via `scripts/test-no-dashes.ts`, naming the offending key or file

### Requirement: Shipped page titles contain no colon separator

A shipped page TITLE SHALL NOT use a colon as a separator. This covers the `<title>`
element, the `og:title` and `twitter:title` metadata values, the web manifest's `name` and
`short_name`, and the `title` field of every static landing page. Where a title needs a
qualifier or the brand name, the parts SHALL be joined with a comma, matching the title
template already declared for the marketing site.

The rule is deliberately narrower than the dash rule that governs all user-facing copy. A
colon inside a sentence is ordinary punctuation and SHALL remain permitted in descriptions,
headings, and body copy. A title is a name, and a colon inside a name reads as a label,
consumes the characters at the start of the line where a search result is judged, and
pushes the words a reader is looking for to the right of the brand.

The colon inside a metadata KEY (`og:title`), a URL scheme, a time, or a code SHALL NOT be
reported: only the human-readable title VALUE is scanned.

#### Scenario: Application page titles are colon free

- **WHEN** the `<title>`, `og:title`, and `twitter:title` values of each application's `index.html` are scanned
- **THEN** none of them contains a colon

#### Scenario: Landing page titles are colon free

- **WHEN** the `title` field of every static landing page is scanned
- **THEN** none of them contains a colon

#### Scenario: A colon in a description is not reported

- **WHEN** a page description or a body paragraph contains a colon inside a sentence
- **THEN** the scan does not report it

#### Scenario: A metadata key is not mistaken for a title

- **WHEN** the scan reads a `<meta property="og:title" content="...">` tag
- **THEN** it examines the content value only, and the colon in the property name is not reported

#### Scenario: The title scan actually reached the titles

- **WHEN** the title scan completes
- **THEN** it reports the number of title fields it examined, and that number is greater than zero


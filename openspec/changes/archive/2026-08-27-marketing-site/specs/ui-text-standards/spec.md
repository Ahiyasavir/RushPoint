# ui-text-standards Specification (delta)

## MODIFIED Requirements

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

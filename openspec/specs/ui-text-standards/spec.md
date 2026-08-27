# ui-text-standards Specification

## Purpose
TBD - created by archiving change ui-no-dashes. Update Purpose after archive.
## Requirements
### Requirement: User-facing copy contains no dash/hyphen separators
All user-facing strings shipped by the apps SHALL NOT use an em-dash (`—`), en-dash (`–`), or
spaced hyphen (` - `) as a separator (this covers translation-map leaf values, visible JSX
text, page metadata in `index.html` and the web manifest, and **the copy and metadata of
static landing pages served from an app's `public/` directory**). Sentences
SHALL be joined with commas, periods, or line breaks instead. Code comments, file paths, CLI flags,
CSS, and class names are exempt.

Landing page copy is included because it is the copy with the widest reach of all: like
`<title>` and `<meta name="description">`, it is text Google prints directly, and it lives
in neither the translation dictionaries nor component source, so the existing scans would
not otherwise reach it.

#### Scenario: Translation maps are dash-free
- **WHEN** every string leaf in both apps' `translations` maps is scanned
- **THEN** no value contains `—`, `–`, or ` - `

#### Scenario: Landing page copy is dash-free
- **WHEN** the visible copy and metadata of every static landing page is scanned
- **THEN** no title, description, heading, or body string contains `—`, `–`, or ` - `

#### Scenario: Regression is caught by the test lane
- **WHEN** a developer adds a translation value or landing page string containing a dash separator
- **THEN** `npm test` fails via `scripts/test-no-dashes.ts`, naming the offending key or file

## ADDED Requirements

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

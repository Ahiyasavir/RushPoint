# ui-text-standards Specification

## Purpose
TBD - created by archiving change ui-no-dashes. Update Purpose after archive.
## Requirements
### Requirement: User-facing copy contains no dash/hyphen separators
All user-facing strings shipped by the apps SHALL NOT use an em-dash (`—`), en-dash (`–`), or
spaced hyphen (` - `) as a separator (this covers translation-map leaf values and visible JSX
text). Sentences
SHALL be joined with commas, periods, or line breaks instead. Code comments, file paths, CLI flags,
CSS, and class names are exempt.

#### Scenario: Translation maps are dash-free
- **WHEN** every string leaf in both apps' `translations` maps is scanned
- **THEN** no value contains `—`, `–`, or ` - `

#### Scenario: Regression is caught by the test lane
- **WHEN** a developer adds a translation value containing a dash separator
- **THEN** `npm test` fails via `scripts/test-no-dashes.ts`, naming the offending key


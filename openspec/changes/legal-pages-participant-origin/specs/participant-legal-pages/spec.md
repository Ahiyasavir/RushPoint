## ADDED Requirements

### Requirement: The participant origin serves the legal documents

The participant application SHALL render the Terms of Service at the path `/terms` and the Privacy
Policy at the path `/privacy` on its own origin, without navigating the visitor to any other
application.

Path matching SHALL ignore a trailing slash, SHALL ignore letter case, and SHALL ignore any query
string or fragment. Any other path SHALL resolve exactly as it does without this capability, so an
unknown path continues to render the participant experience.

#### Scenario: Terms path renders the Terms document

- **WHEN** the participant origin is opened at `/terms`
- **THEN** the Terms of Service document is rendered by the participant application

#### Scenario: Privacy path renders the Privacy document

- **WHEN** the participant origin is opened at `/privacy`
- **THEN** the Privacy Policy document is rendered by the participant application

#### Scenario: Path spelling variants resolve to the same document

- **WHEN** the path is `/terms/`, `/TERMS`, or `/terms?utm=x`
- **THEN** the Terms of Service document is rendered

#### Scenario: An unknown path is unchanged

- **WHEN** the path is `/`, or any path that is not a legal document path
- **THEN** the resolved view is identical to the view resolved from the same query string and stored
  session before this capability existed

### Requirement: Reading a legal document never disturbs a run

Resolving a legal document path SHALL NOT clear, replace or otherwise modify a stored participant
session, and SHALL take precedence over a stored session, a stored staff session, and any query
parameter present on the same URL.

#### Scenario: A player mid-run can read the terms

- **WHEN** a device with a stored player session opens `/terms`
- **THEN** the Terms document is rendered and the stored session is left intact

#### Scenario: The document wins over a query-param route

- **WHEN** `/privacy` is opened with a join code or staff parameter also present in the query string
- **THEN** the Privacy document is rendered

### Requirement: A single source of legal text serves both applications

The Terms of Service and Privacy Policy text SHALL exist exactly once in the repository, in a shared
package consumed by both the creator application and the participant application. Neither
application SHALL hold its own copy of the document bodies.

Both applications SHALL parse the document markup through the same shared, pure tokenizer, which
SHALL escape HTML-significant characters in the source text before any emphasis markup is
substituted.

#### Scenario: Both applications render the same text

- **WHEN** the same document and language are rendered by the creator application and by the
  participant application
- **THEN** both render the text from the same shared source

#### Scenario: Policy text cannot inject markup

- **WHEN** a document line contains HTML-significant characters alongside emphasis markup
- **THEN** the characters are escaped first and only the tokenizer's own emphasis markup is emitted

### Requirement: Legal documents are language-aware

The participant application SHALL render the document in the application's active language, with
Hebrew as the default, and SHALL offer a control to read the document in the other language. All
interface chrome added for these pages SHALL be provided by the translation dictionaries in both
Hebrew and English.

#### Scenario: Hebrew by default

- **WHEN** a participant with the default language opens `/privacy`
- **THEN** the Hebrew Privacy Policy is rendered

#### Scenario: The other language is one action away

- **WHEN** the visitor selects the other language on a legal page
- **THEN** the same document is rendered in that language

### Requirement: Legal documents stay out of the participant first load

The legal document text SHALL be loaded on demand and SHALL NOT be part of the participant
application's entry chunk. The enforced participant bundle budget SHALL remain satisfied and SHALL
NOT be raised to accommodate this capability.

#### Scenario: The entry chunk does not carry the documents

- **WHEN** the participant application is built for production
- **THEN** the document text is in an on-demand chunk and the entry-chunk budget check passes at its
  existing limits

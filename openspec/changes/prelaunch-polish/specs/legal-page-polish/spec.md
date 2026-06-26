## ADDED Requirements

### Requirement: LegalPage back button and heading are language-aware
The back button label in `LegalPage.tsx` SHALL render `"← חזרה"` when `activeLang === 'he'`
and `"← Back"` when `activeLang === 'en'`. This applies to the `nav(-1)` back button in the
non-standalone mode. No other navigation elements are in scope.

#### Scenario: English mode — back button shows English
- **WHEN** `activeLang` is `'en'`
- **THEN** the back button renders `"← Back"`
- **THEN** the text `"← חזרה"` is NOT present on the page

#### Scenario: Hebrew mode — back button shows Hebrew
- **WHEN** `activeLang` is `'he'`
- **THEN** the back button renders `"← חזרה"`


### Requirement: LegalPage Section 7 (data retention) rendered without table syntax
The privacy-policy Section 7 content (both HE and EN bodies in `LegalPage.tsx`) SHALL NOT
contain a Markdown table header row (`| … | … |`). The data retention periods SHALL be
presented using a plain dash-list format consistent with the rest of the document.
The `renderMarkdown` function's output for Section 7 SHALL contain no `|` pipe characters
in rendered text.

#### Scenario: Hebrew privacy policy — no pipe character in rendered Section 7
- **WHEN** the HE privacy policy body is passed through `renderMarkdown`
- **THEN** none of the rendered React elements contain the literal `|` character in their
  text content

#### Scenario: English privacy policy — no pipe character in rendered Section 7
- **WHEN** the EN privacy policy body is passed through `renderMarkdown`
- **THEN** none of the rendered React elements contain the literal `|` character in their
  text content


### Requirement: LegalPage renderMarkdown escapes HTML before injection
The markdown rendering in `LegalPage.tsx` SHALL escape the characters `&`, `<`, `>`, and `"`
in each raw line BEFORE applying the `**bold**` → `<strong>` substitution and before passing
the result to `dangerouslySetInnerHTML`. The escape + bold logic SHALL live in a pure,
importable module (`apps/creator-web/src/pages/legalMarkdown.ts`) exporting `escapeHtml` and
`renderInline`, so it can be unit-tested without React. The `<strong>` tags produced by the
bold substitution SHALL NOT be escaped.

#### Scenario: Line with < and > characters — rendered as escaped text, not HTML tags
- **WHEN** `renderInline('if (a < b)')` is called
- **THEN** the result contains `if (a &lt; b)` — NOT a raw HTML tag

#### Scenario: Bold text — strong tags rendered correctly, not double-escaped
- **WHEN** `renderInline('**important**')` is called
- **THEN** the result is `<strong>important</strong>`
- **THEN** the result does NOT contain `&lt;strong&gt;`

#### Scenario: Ampersand in text — escaped to &amp;
- **WHEN** `renderInline('terms & conditions')` is called
- **THEN** the result contains `terms &amp; conditions`

#### Scenario: escapeHtml pure unit test passes
- **WHEN** `scripts/test-legal-page-polish.ts` is run via `npm test`
- **THEN** `escapeHtml('<script>&"test"</script>')` returns `'&lt;script&gt;&amp;&quot;test&quot;&lt;/script&gt;'`
- **THEN** `escapeHtml('no special chars')` returns `'no special chars'` unchanged
- **THEN** `npm test` exits 0

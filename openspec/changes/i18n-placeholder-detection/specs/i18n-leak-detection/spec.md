## ADDED Requirements

### Requirement: Placeholder tokens are structure, not copy

The language-leak detector SHALL treat a `{placeholder}` token in a translation string as
structure rather than user-facing copy, because the token is substituted at runtime and its name is
never rendered to a user. The letters of a placeholder's name SHALL NOT contribute to the decision
of which language a string is written in.

Recognition SHALL be limited to the canonical placeholder form used by the dictionaries — an
opening brace, one or more ASCII letters, digits or underscores, and a closing brace, with no
intervening whitespace. Any other brace-delimited text SHALL be treated as ordinary copy, so that
an unrecognised form fails loudly rather than being silently exempted.

This treatment SHALL be independent of the placeholder name's length, so that a single-letter and a
multi-letter placeholder are accepted for the same stated reason.

#### Scenario: Hebrew copy with multi-letter placeholders is accepted

- **WHEN** a Hebrew leaf contains only Hebrew words plus multi-letter placeholders such as
  `{launched}`, `{held}`, `{max}` or `{team}`
- **THEN** the detector reports no English leak

#### Scenario: A single-letter placeholder is accepted for the same reason

- **WHEN** a Hebrew leaf contains a single-letter placeholder such as `{n}`
- **THEN** the detector reports no English leak

#### Scenario: A non-canonical brace form is not exempted

- **WHEN** a Hebrew leaf contains brace-delimited Latin text that is not the canonical form — for
  example whitespace inside the braces, a hyphen in the name, or an unbalanced brace
- **THEN** that text is treated as ordinary copy and the detector reports an English leak

### Requirement: Placeholder handling never blinds the detector

Exempting placeholders SHALL NOT weaken detection of genuine language leaks. Latin words that are
not part of a placeholder token SHALL continue to be reported, including when they appear in the
same string as a placeholder, and including when the same word is also used as a placeholder name
elsewhere in that string.

#### Scenario: Real English in Hebrew copy is still reported

- **WHEN** a Hebrew leaf contains an English word such as `updated`
- **THEN** the detector reports an English leak

#### Scenario: English alongside a placeholder is still reported

- **WHEN** a Hebrew leaf contains both an English word and a placeholder token
- **THEN** the detector reports an English leak

#### Scenario: A word is exempt only inside its braces

- **WHEN** a string contains a placeholder and the same word again outside any braces
- **THEN** the detector reports an English leak for the unbraced occurrence

### Requirement: Hebrew leaking into English copy is detected independently

The detector SHALL report any Hebrew letter appearing in an English leaf, outside a small whitelist
of terms that are legitimately Hebrew in English copy (a language's own name in the language
toggle). Placeholder handling SHALL apply only to the English-word test and SHALL NOT affect this
check, so Hebrew text is reported whether or not it sits inside braces. Unlike the English-word
test, this check SHALL have no minimum length: a single Hebrew letter is a leak.

#### Scenario: Hebrew inside English copy is reported

- **WHEN** an English leaf contains a Hebrew word
- **THEN** the detector reports a Hebrew leak

#### Scenario: English copy carrying placeholders is accepted

- **WHEN** an English leaf contains only English words and placeholder tokens
- **THEN** the detector reports no Hebrew leak

#### Scenario: Hebrew inside braces is still reported

- **WHEN** an English leaf contains Hebrew text enclosed in braces
- **THEN** the detector reports a Hebrew leak

#### Scenario: The whitelisted language name is accepted alone

- **WHEN** an English leaf consists of the whitelisted language-name term
- **THEN** the detector reports no Hebrew leak

### Requirement: Existing exemptions are preserved

The detector SHALL continue to exempt brand names, units and acronyms on its Latin whitelist, and
tokens containing a digit such as sample join codes, when they appear inside Hebrew copy. Removing
the digit from such a token SHALL make it ordinary English copy again.

#### Scenario: A sample join code in Hebrew copy is accepted

- **WHEN** a Hebrew leaf contains a digit-bearing token such as `FOX42` or `ABC123`
- **THEN** the detector reports no English leak

#### Scenario: The same token without a digit is reported

- **WHEN** a Hebrew leaf contains the same token with its digits removed
- **THEN** the detector reports an English leak

#### Scenario: Whitelisted brand terms in Hebrew copy are accepted

- **WHEN** a Hebrew leaf contains a whitelisted brand, unit or acronym
- **THEN** the detector reports no English leak

### Requirement: The leak rule is defined once

The English-leak and Hebrew-leak predicates, together with their whitelists, SHALL have a single
shared definition that every checker applying the rule imports. No checker SHALL carry its own copy
of the predicate, its regexes, or its whitelists.

The shared definition SHALL be directly unit-testable — importable without executing a checker's
top-level work — and its tests SHALL assert on strings and verdicts rather than restating the rule.

#### Scenario: Both checkers share one definition

- **WHEN** the i18n gate and the parity checker evaluate the same string
- **THEN** they reach the same verdict, because both apply the one shared predicate

#### Scenario: A reintroduced copy is caught

- **WHEN** a checker reintroduces its own definition of the placeholder rule, the Latin-word rule,
  or the whitelist
- **THEN** the test suite fails

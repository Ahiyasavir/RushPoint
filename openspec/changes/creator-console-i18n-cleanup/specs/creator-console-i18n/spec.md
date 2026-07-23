## ADDED Requirements

### Requirement: Console screens never hardcode user-visible copy

The creator console SHALL resolve every user-visible string on its run, dashboard, wallet and
runs-overview screens — and in the shared UI kit those screens compose — from the translation
dictionaries at render time, so that it changes with the selected language.

A screen MAY carry a literal string only when that string is deliberately not translatable — a brand
name, sample or mock data, or a developer-facing debug label — and each such literal SHALL be marked
as a sanctioned exemption carrying a stated reason.

#### Scenario: A console screen contains no untranslated copy

- **WHEN** the hardcoded-string scan runs over the run-console, dashboard, wallet and runs-overview
  screens and the shared UI kit
- **THEN** it reports no hardcoded user-visible string in any of them

#### Scenario: A deliberate literal is exempted with a reason

- **WHEN** a screen renders a brand mark that must stay identical in every language
- **THEN** that line is marked as a sanctioned exemption and states why, and the scan does not report it

#### Scenario: A new hardcoded string is introduced

- **WHEN** a change adds a user-visible literal to one of these screens without routing it through the
  dictionaries and without a sanctioned exemption
- **THEN** the hardcoded-string scan reports it, naming the file and line

### Requirement: The two dictionaries are structurally identical

The Hebrew and English creator-console dictionaries SHALL expose the same set of keys, and each key
SHALL resolve to the same kind of entry — a fixed message in both languages, or a message built from
arguments in both languages.

No entry in either language SHALL resolve to empty or whitespace-only text.

Violations SHALL be reported as test failures naming the offending keys, not as advisory output.

#### Scenario: A key exists in only one language

- **WHEN** a key is present in one dictionary and absent from the other
- **THEN** the check fails and names that key and the language it is missing from

#### Scenario: A key changes kind between languages

- **WHEN** a key resolves to a fixed message in one language and to an argument-built message in the other
- **THEN** the check fails and names that key with the kind it has in each language

#### Scenario: An entry resolves to nothing

- **WHEN** an entry resolves to an empty or whitespace-only message in either language
- **THEN** the check fails and names that key

### Requirement: Each language's copy is genuinely in that language

Every message the Hebrew dictionary produces SHALL be Hebrew, and every message the English
dictionary produces SHALL be English.

This SHALL hold for messages built from arguments as well as fixed ones: an argument-built entry is
evaluated and its produced message is judged by the same rule, so a Hebrew entry that formats an
English sentence is caught.

An argument-built entry SHALL produce a message without failing when called with plausible
arguments; an entry that fails instead is a defect, because it is a crash in that language's UI.

A small, stated set of terms MAY appear in the other script — brand names, units, acronyms, and a
language's own name in the language toggle. That set SHALL remain load-bearing: at least one Hebrew
message must actually rely on it, so it cannot decay into an unchecked exemption.

#### Scenario: English text in a Hebrew message

- **WHEN** a Hebrew entry produces a message containing an English word outside the stated set
- **THEN** the check fails and names that key and the offending message

#### Scenario: Hebrew text in an English message

- **WHEN** an English entry produces a message containing Hebrew letters outside the stated set
- **THEN** the check fails and names that key and the offending message

#### Scenario: An argument-built Hebrew entry produces English

- **WHEN** a Hebrew entry that builds its message from arguments produces an English sentence
- **THEN** the check evaluates it, sees the English, and fails — it is not skipped for being argument-built

#### Scenario: An argument-built entry fails when called

- **WHEN** an entry that builds its message from arguments fails on plausible arguments
- **THEN** the check fails and names that key

#### Scenario: The exemption set is exercised

- **WHEN** no Hebrew message relies on any term in the stated set
- **THEN** the check fails, because the set is no longer load-bearing and must be narrowed

### Requirement: The console speaks the current brand vocabulary

The Hebrew creator-console copy SHALL describe the product with the current brand vocabulary — a
field game — and SHALL NOT reintroduce the retired pre-rebrand wording for it.

The retired wording is banned only as the complete brand phrase; the individual everyday words it was
built from remain available for ordinary copy.

#### Scenario: Retired brand wording is reintroduced

- **WHEN** a Hebrew entry describes the product using the retired brand phrase
- **THEN** the check fails and names that key

#### Scenario: An everyday word from the retired phrase is used normally

- **WHEN** Hebrew copy uses one of those words in its ordinary sense, such as a sample story title
- **THEN** the check passes, because only the complete retired brand phrase is banned

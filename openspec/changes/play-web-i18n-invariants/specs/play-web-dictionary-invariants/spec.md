## ADDED Requirements

### Requirement: The participant dictionaries are structurally identical

The Hebrew and English participant dictionaries SHALL expose the same set of keys, and each key SHALL
resolve to the same kind of entry — a fixed message in both languages, or a message built from
arguments in both languages.

An entry that builds its message from arguments SHALL accept the same number of arguments in both
languages, so one language cannot render a message with a part of it missing.

No entry in either language SHALL resolve to empty or whitespace-only text.

Violations SHALL be reported as failures of the automated test lane, naming the offending keys, not
as advisory output.

#### Scenario: A key exists in only one language

- **WHEN** a key is present in one dictionary and absent from the other
- **THEN** the check fails and names that key and the language it is missing from

#### Scenario: A key changes kind between languages

- **WHEN** a key resolves to a fixed message in one language and to an argument-built message in the other
- **THEN** the check fails and names that key with the kind it has in each language

#### Scenario: An argument-built entry takes different arguments in each language

- **WHEN** an entry accepts arguments in one language and accepts none, or fewer, in the other
- **THEN** the check fails and names that key with the count it declares in each language

#### Scenario: An entry resolves to nothing

- **WHEN** an entry resolves to an empty or whitespace-only message in either language
- **THEN** the check fails and names that key

### Requirement: Argument-built participant messages are evaluated, not skipped

Every entry that builds its message from arguments SHALL be called with plausible arguments and
judged by the message it produces, in both languages. No entry may be exempt from the language,
emptiness or interpolation rules merely because its message is built at runtime.

An argument-built entry SHALL produce a message without failing when called with plausible arguments;
an entry that fails instead is a defect, because it is a crash in that language's participant UI.

The check SHALL confirm that the number of argument-built entries it evaluated equals the number that
exist, so that coverage cannot silently shrink back.

#### Scenario: An argument-built entry produces the wrong language

- **WHEN** a Hebrew entry that builds its message from arguments produces an English sentence
- **THEN** the check evaluates it, sees the English, and fails — it is not skipped for being argument-built

#### Scenario: An argument-built entry fails when called

- **WHEN** an entry that builds its message from arguments fails on plausible arguments
- **THEN** the check fails and names that key

#### Scenario: Coverage of argument-built entries regresses

- **WHEN** the evaluation stops reaching some argument-built entries
- **THEN** the check fails, because the number evaluated no longer matches the number that exist

### Requirement: Each participant language is genuinely that language

Every message the Hebrew participant dictionary produces SHALL be Hebrew, and every message the
English participant dictionary produces SHALL be English. This SHALL hold for messages built from
arguments as well as fixed ones.

A small, stated set of terms MAY appear in the other script — brand names, units, acronyms, sample
access codes, and a language's own name in the language toggle. That set SHALL remain load-bearing:
at least one Hebrew message must actually rely on it, so it cannot decay into an unchecked exemption.

#### Scenario: English text in a Hebrew message

- **WHEN** a Hebrew entry produces a message containing an English word outside the stated set
- **THEN** the check fails and names that key and the offending message

#### Scenario: Hebrew text in an English message

- **WHEN** an English entry produces a message containing Hebrew letters outside the stated set
- **THEN** the check fails and names that key and the offending message

#### Scenario: A brand term or sample code inside Hebrew copy

- **WHEN** Hebrew copy contains a brand name, an acronym, or a sample access code
- **THEN** the check passes, because those are within the stated set

#### Scenario: The exemption set is exercised

- **WHEN** no Hebrew message relies on any term in the stated set
- **THEN** the check fails, because the set is no longer load-bearing and must be narrowed

### Requirement: Participant messages never render a broken value

No message the participant app produces SHALL contain an unfilled placeholder, an absent value, a
non-numeric number, or a stringified object, in either language.

An entry that accepts arguments SHALL demonstrably use them: rendering the same entry with two
clearly different arguments SHALL produce two different messages.

#### Scenario: A placeholder is never filled in

- **WHEN** an entry produces a message still containing its own placeholder syntax
- **THEN** the check fails and names that key and the message

#### Scenario: An absent or non-numeric value reaches the message

- **WHEN** an entry produces a message containing an absent value, a non-numeric number, or a
  stringified object
- **THEN** the check fails and names that key and the message

#### Scenario: An entry ignores the argument it declares

- **WHEN** an entry declares an argument but produces the same message regardless of what it is given
- **THEN** the check fails and names that key

#### Scenario: A correctly built message

- **WHEN** an entry substitutes its argument into the message
- **THEN** the check passes for that entry

### Requirement: The participant app speaks the current brand vocabulary

The participant copy SHALL describe the product with the current brand vocabulary — a field game —
and SHALL NOT reintroduce the retired pre-rebrand wording for it, in either language.

The retired wording is banned only as the complete brand phrase; the individual everyday words it was
built from remain available for ordinary copy.

#### Scenario: Retired brand wording is reintroduced in Hebrew

- **WHEN** a Hebrew entry describes the product using the retired Hebrew brand phrase
- **THEN** the check fails and names that key

#### Scenario: Retired brand wording is reintroduced in English

- **WHEN** an English entry describes the product using the retired English brand phrase
- **THEN** the check fails and names that key

#### Scenario: An everyday word from the retired phrase is used normally

- **WHEN** participant copy uses one of those words in its ordinary sense
- **THEN** the check passes, because only the complete retired brand phrase is banned

### Requirement: The dictionary checks are proven able to fail

Each dictionary rule SHALL be accompanied by a case that feeds it a deliberately defective sample and
requires it to report the defect, and by cases that require it NOT to report legitimate copy.

These cases SHALL use samples constructed inside the check itself. The shipped dictionaries SHALL NOT
be altered in order to demonstrate that a rule works.

#### Scenario: A rule stops working

- **WHEN** a rule is weakened so that it would no longer notice its defect
- **THEN** its paired case fails, even while the shipped dictionaries are clean

#### Scenario: Legitimate copy is not reported

- **WHEN** a rule is shown a brand term, a sample access code, the language-toggle label, or a
  correctly built message
- **THEN** it reports nothing

#### Scenario: Demonstrating a failure never edits shipped copy

- **WHEN** the checks run
- **THEN** the shipped dictionaries are untouched, because every defective sample is constructed
  inside the check

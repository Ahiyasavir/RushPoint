# play-web-i18n Specification

## Purpose
TBD - created by archiving change play-web-i18n-hebrew. Update Purpose after archive.
## Requirements
### Requirement: play-web renders all chrome in the active language
The participant app SHALL render 100% of its UI chrome (labels, buttons, hints, errors, empty
states) in the active language. The default language SHALL be Hebrew, with English available via a
toggle. User-authored content (game title, description, task text) is exempt and SHALL use `dir="auto"`.

#### Scenario: Hebrew is the default
- **WHEN** a participant opens play-web with no stored language preference
- **THEN** all chrome renders in Hebrew and the document direction is `rtl`

#### Scenario: No English leakage in Hebrew mode
- **WHEN** the active language is Hebrew
- **THEN** no chrome string renders Latin-script English (excluding the brand/units whitelist:
  `RushPoint`, `Pro`, `QR`, `SOS`, `Google`, `₪`, and emoji)

#### Scenario: English toggle flips language and direction
- **WHEN** a participant switches the language to English
- **THEN** all chrome renders in English and the document direction is `ltr`

---

### Requirement: Translation maps have identical key sets
The `HE` and `EN` translation maps SHALL expose an identical recursive key set so that no key is ever
missing in one language (which would force an untranslated fallback). The `EN` map SHALL be typed as
`typeof HE` so a missing key is a compile-time error.

#### Scenario: Key parity holds
- **WHEN** the recursive key set of `HE` is compared to that of `EN`
- **THEN** the two sets are identical with no additions or omissions

#### Scenario: Missing key is a typecheck failure
- **WHEN** a key present in `HE` is omitted from `EN`
- **THEN** `npm run typecheck` fails on the `EN: typeof HE` annotation


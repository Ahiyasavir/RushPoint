## ADDED Requirements

### Requirement: Transaction dates never render "Invalid Date"
The Wallet transaction history SHALL render each transaction's date through a pure, total formatter
that returns a safe empty fallback for any timestamp that does not parse to a valid date, so a
missing or non-ISO `createdAt` never shows the literal string "Invalid Date" beside a charge. A valid
timestamp SHALL render exactly as the localized date it does today.

The formatter SHALL be total: `null`, `undefined`, a non-parseable string, and a value producing a
`NaN` time SHALL all yield the empty fallback without throwing.

#### Scenario: A malformed timestamp renders blank, not "Invalid Date"
- **WHEN** a transaction row's `createdAt` is missing or is not a parseable date
- **THEN** the date position renders empty
- **AND** the literal string "Invalid Date" is never shown
- **AND** the row's label and amount still render normally

#### Scenario: A valid timestamp renders the localized date unchanged
- **WHEN** a transaction's `createdAt` is a valid ISO timestamp
- **THEN** the row shows the same localized date it renders today

## ADDED Requirements

### Requirement: Hebrew sentences address the reader in the plural

Every Hebrew string of four words or more in either app SHALL address the reader in the plural
or impersonally, and SHALL NOT use a masculine-singular imperative or a singular second-person
form, except where the matching word is declared to be other grammar.

#### Scenario: A confirmation hint
- **WHEN** a creator is asked to type a game's name to confirm a deletion
- **THEN** the hint reads in the plural ("הקלידו את שם המשחק כדי לאשר")

#### Scenario: An authentication error
- **WHEN** sign-in fails for a network reason
- **THEN** the message asks the reader in the plural to check the connection

### Requirement: Short labels keep their form

Hebrew labels under four words SHALL NOT be required to change.

#### Scenario: A save button
- **WHEN** a button reads "שמור"
- **THEN** the gate does not flag it

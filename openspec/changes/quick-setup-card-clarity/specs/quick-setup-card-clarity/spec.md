## ADDED Requirements

### Requirement: The step card leads with the action

Each Quick Setup step card SHALL show, as its title, a single sentence that states what to do (or
the question to answer), and that sentence SHALL be the first sentence of the step's copy line.

#### Scenario: Placing a mission's pin
- **WHEN** the step asks for a mission's coordinates
- **THEN** the card's title is "הניחו סיכה על המפה." and nothing about the mission precedes it

### Requirement: One supporting line, no repetition

Below the title the card SHALL show at most one supporting line: the template's short note when the
step has one, otherwise the remainder of the copy line. The mission's description and a long
template note SHALL be available only behind a "פרטים" disclosure that is collapsed on every step
and absent when there is nothing behind it.

#### Scenario: A template with a short note
- **WHEN** the step carries a short template note
- **THEN** that note is the supporting line and the remainder of the copy line is not shown

### Requirement: One progress indicator and a short action row

The card SHALL show exactly one progress indicator, and its action row SHALL hold "הבא", "הקודם"
(when there is a previous step) and a short "אחר כך" link; the close control SHALL sit in the
header row.

#### Scenario: Second of two steps
- **WHEN** the creator is on step 2 of 2
- **THEN** the header reads "2 מתוך 2" with one indicator, and the actions are "הבא", "הקודם", "אחר כך"

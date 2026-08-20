## ADDED Requirements

### Requirement: A short spotlight explains the Builder on first open

The first time a creator opens the Builder, a short contextual spotlight SHALL run,
explaining the two pieces of vocabulary the Builder is built on — what a stage is and what a
mission is — by pointing at those elements where they actually appear on screen.

The spotlight SHALL be at most three steps. It MUST anchor on the Builder's existing
`data-tour` targets rather than introducing a parallel overlay system, and MUST NOT
auto-navigate the creator away from the Builder.

#### Scenario: The spotlight runs on the first Builder open

- **WHEN** a creator opens the Builder for the first time
- **THEN** a spotlight of at most three steps runs
- **AND** each step highlights a Builder element that is present on screen

#### Scenario: The spotlight does not run again

- **WHEN** a creator who has already seen or dismissed the spotlight opens the Builder again
- **THEN** the spotlight does not run

#### Scenario: The creator can leave at any point

- **WHEN** the creator dismisses the spotlight mid-way
- **THEN** it closes immediately, is recorded as seen, and the Builder is fully usable

### Requirement: The spotlight is separate from the full product tour

The Builder spotlight SHALL be distinct from the existing multi-step `CreatorTour`. It MUST
NOT replace it, MUST NOT re-use its seen-record, and the two MUST NOT run at the same time.

Because the full tour owns the first-signup moment, the spotlight SHALL yield: if the full
tour is running or is about to run, the spotlight does not start.

#### Scenario: The two never overlap

- **WHEN** the full product tour is running
- **THEN** the Builder spotlight does not start

#### Scenario: Dismissing one does not dismiss the other

- **WHEN** a creator dismisses the Builder spotlight
- **THEN** the full product tour's own seen-record is unchanged, and it can still be started
  from the header

### Requirement: The spotlight degrades safely

The spotlight SHALL skip any step whose target element is not mounted, rather than
highlighting empty space — a narrow viewport, a collapsed panel or a game with no missions
yet all produce missing anchors. It MUST never block interaction with the Builder underneath
if it cannot anchor at all.

Storage failures MUST NOT throw: if the seen-record cannot be written, the Builder still
works.

#### Scenario: A missing anchor skips its step

- **WHEN** a step's target element is not on screen
- **THEN** that step is skipped and the spotlight continues with the next one

#### Scenario: Unwritable storage does not break the Builder

- **WHEN** the seen-record cannot be persisted
- **THEN** nothing throws and the Builder remains fully usable

### Requirement: The spotlight is usable at phone width

The spotlight SHALL be verified at a 390px-wide viewport. Its card MUST remain fully on
screen, MUST NOT cover the element it is describing, and its dismiss control MUST remain
tappable.

#### Scenario: The spotlight fits a 390px viewport

- **WHEN** the spotlight renders at 390px wide
- **THEN** its card is fully visible, does not obscure the highlighted element, and its
  dismiss control is tappable

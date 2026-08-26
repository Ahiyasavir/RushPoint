# Smart Game Composer

The smart-build creation path: a questionnaire in the New Game wizard whose answers are
turned, by pure local computation, into a complete and launch-valid game assembled from a
tagged mission bank.

Vocabulary used throughout this spec:

- **bank entry** — one tagged, individually-buildable mission in the bank, identified by a
  stable `key`.
- **bank tag** — an id from the canonical bank tag registry. A closed vocabulary, separate
  from the free-text gallery tags on `Task.tags`.
- **blueprint** — a hand-authored stage shape: how many stages, their relative mission
  counts, and their difficulty arc.
- **slot** — one mission position in the composed game, filled by exactly one bank entry.
- **recency memory** — the bank keys this creator was given in their recent generations.

## ADDED Requirements

### Requirement: Third creation path in the New Game fork

The New Game wizard SHALL offer a third path, "smart build", alongside the existing blank
and template paths. The name screen that precedes the fork SHALL be unchanged, and the
blank and template paths SHALL keep their exact current behavior.

#### Scenario: The fork offers three paths

- **WHEN** the creator reaches the path step of the New Game wizard
- **THEN** three choices are offered: blank, story-with-plot, and smart build

#### Scenario: Choosing smart build opens the questionnaire

- **WHEN** the creator chooses the smart-build path
- **THEN** the wizard advances to the smart-build questionnaire step
- **AND** no game has been created yet

#### Scenario: Existing paths are untouched

- **WHEN** the creator chooses the blank path or the template path
- **THEN** the resulting wizard state, creation plan and created game are identical to
  what they were before this change

#### Scenario: Going back from the questionnaire returns to the fork

- **WHEN** the creator is on the smart-build questionnaire and goes back past its first
  question
- **THEN** the wizard returns to the path step with no path selected
- **AND** no game has been created

### Requirement: Nothing is created until the questionnaire is finished

The wizard SHALL NOT produce a creation plan for any state other than a finished one. A
cancelled or half-finished smart build SHALL leave no game behind.

#### Scenario: Half-finished smart build creates nothing

- **WHEN** the smart-build questionnaire is in any state before its final step
- **THEN** the creation plan is null

#### Scenario: Cancelled smart build creates nothing

- **WHEN** the creator cancels the wizard at any point in the smart-build path
- **THEN** the creation plan is null

#### Scenario: Finished smart build yields a smart-build plan

- **WHEN** the creator completes the final question of the smart-build questionnaire
- **THEN** the creation plan is a smart-build plan carrying the resolved title and the
  full set of composer answers

### Requirement: Smart-build questionnaire

The questionnaire SHALL collect audience, setting, group size, duration, age band and
difficulty preference, and MAY collect preferred activity kinds. Every question SHALL have
a default, so no unanswered question can dead-end the flow. The questionnaire SHALL be
rendered by a generic stepped shell that reports progress as a step number out of a total
and supports moving back and forward.

#### Scenario: Every question has a usable default

- **WHEN** the creator advances through the questionnaire without answering a question
- **THEN** that question's default answer is used
- **AND** composition proceeds normally

#### Scenario: Progress is reported

- **WHEN** the creator is on any question of the questionnaire
- **THEN** the shell reports the current step's position and the total number of steps

#### Scenario: Answers survive going back and forward

- **WHEN** the creator answers a question, moves back, then moves forward again
- **THEN** the previously given answer is still selected

#### Scenario: An unrecognised action leaves the questionnaire usable

- **WHEN** the questionnaire reducer receives an unrecognised action or a malformed state
- **THEN** it returns a usable state rather than throwing

### Requirement: Canonical bank tag registry

There SHALL be exactly one canonical registry of bank tags, each carrying a Hebrew and an
English label. Tags SHALL be stored and filtered as a flat list of equal ids; no code
SHALL depend on a tag's grouping. Introducing a new tag SHALL require only a new registry
entry plus tagging of entries — no change to any type or interface.

#### Scenario: Every tag has both labels

- **WHEN** the registry is read
- **THEN** every tag id has a non-empty Hebrew label and a non-empty English label

#### Scenario: Tag ids are the only vocabulary

- **WHEN** any bank entry declares its tags
- **THEN** every declared tag is an id present in the registry

#### Scenario: Bank tags are separate from gallery tags

- **WHEN** a composed game's gallery tags are derived
- **THEN** the free-text gallery tag vocabulary is unaffected by the bank tag registry,
  and no raw bank tag id is written into `Task.tags`

### Requirement: Tagged mission bank

There SHALL be a bundled bank of individually-buildable missions. Each entry SHALL carry a
stable key that is never reused, a builder that returns a fresh mission with a fresh id on
every call, at least one tag, and MAY carry a minimum-age floor and its own Quick Setup
declaration. The bank SHALL hold enough tagged openers and finales that bookend selection
always has a real choice.

#### Scenario: Keys are unique and stable

- **WHEN** the bank is read
- **THEN** every entry key is unique across the bank

#### Scenario: Building twice yields distinct ids

- **WHEN** an entry's builder is called twice
- **THEN** the two missions carry different ids
- **AND** are otherwise equal in their authored content

#### Scenario: Bookend pools are not forced picks

- **WHEN** the bank is read
- **THEN** at least four entries are tagged as openers and at least four as finales

#### Scenario: Every entry is classifiable

- **WHEN** the bank is read
- **THEN** every entry carries at least one audience tag and at least one tag describing
  where it can be played

#### Scenario: Declared setup points at a real field

- **WHEN** an entry declares a Quick Setup step
- **THEN** that step's field names a settable field on the mission the entry builds

### Requirement: Composition produces a complete game

Given a bank and a set of answers, the composer SHALL return a complete result: stages,
a description, gallery tags, Quick Setup steps, a scoring preset, a game mode and an
estimated duration. The composer SHALL be pure — no network, no storage, no clock, no
React — and SHALL be total: malformed or out-of-range answers SHALL yield a usable game
rather than a throw.

#### Scenario: A complete result is returned

- **WHEN** the composer runs with valid answers
- **THEN** the result carries non-empty stages, a non-empty description, gallery tags, a
  scoring preset, a mode and a positive estimated duration

#### Scenario: Out-of-range answers do not throw

- **WHEN** the composer is given a negative, zero, absent, non-finite or absurdly large
  duration or group size
- **THEN** it returns a usable game built from clamped values rather than throwing

#### Scenario: An empty or unusable bank does not throw

- **WHEN** the composer is given an empty bank, or a bank whose entries all fail a hard
  filter
- **THEN** it returns without throwing, and returns no partially-built or invalid game

#### Scenario: Composition performs no I/O

- **WHEN** the composer runs
- **THEN** it reads no storage, makes no network call and reads no ambient clock; all
  variability enters through its injected randomness argument and its recency argument

### Requirement: Mission budget and pacing follow the requested duration

The number of missions SHALL be derived from the requested duration and clamped to a sane
range. Missions SHALL be distributed across the chosen blueprint's stages in that
blueprint's relative proportions, with every stage receiving at least one mission. After
the real missions are known, each stage's required-mission count SHALL be fitted toward
the requested duration using the platform's existing duration-fitting rule.

#### Scenario: A longer game gets more missions

- **WHEN** two compositions differ only in requested duration
- **THEN** the longer one is composed of at least as many missions as the shorter one

#### Scenario: The mission count stays in range

- **WHEN** the requested duration is at either extreme
- **THEN** the composed mission count is clamped to the supported range

#### Scenario: No empty stage

- **WHEN** any game is composed
- **THEN** every stage holds at least one mission

#### Scenario: Required counts are fitted, not guessed

- **WHEN** the composer sets each stage's required-mission count
- **THEN** it uses the platform's existing duration-fitting rule applied to the real
  chosen missions, not to an estimate made before they were chosen

### Requirement: Structural variety across generations

The stage shape SHALL be drawn from a set of hand-authored blueprints rather than a single
formula. Only blueprints that can hold the mission budget SHALL be eligible, and the
choice among eligible blueprints SHALL be random.

#### Scenario: Only blueprints that fit are eligible

- **WHEN** the mission budget is smaller than a blueprint's stage count
- **THEN** that blueprint is not eligible for selection

#### Scenario: Identical answers can produce different shapes

- **WHEN** the same answers are composed repeatedly with different randomness
- **THEN** more than one distinct stage shape is produced across those runs

#### Scenario: A blueprint's arc is respected

- **WHEN** a blueprint is chosen
- **THEN** the composed stages follow its relative mission proportions and its difficulty
  arc, subject to the at-least-one-mission-per-stage floor

### Requirement: Fit-scored slot selection

Each slot SHALL be filled by scoring candidate entries against the creator's answers —
audience, setting, the stage's difficulty target, age fit and any preferred activity
kinds — and then sampling at random among the entries scoring near the best. An entry
already used in the game SHALL NOT be reused. An entry that hard-conflicts with the stated
setting SHALL NOT be selected. Age fit SHALL be a soft penalty, never a hard filter.

#### Scenario: Better-fitting entries are preferred

- **WHEN** two candidate entries differ only in how well they match the answers
- **THEN** the better-matching entry scores higher

#### Scenario: No mission appears twice

- **WHEN** any game is composed
- **THEN** no bank entry is used for more than one slot

#### Scenario: A hard conflict is excluded

- **WHEN** an entry can only be played at a location and the creator stated there is no
  venue
- **THEN** that entry is never selected

#### Scenario: Age fit does not empty the pool

- **WHEN** every remaining candidate is above the stated age band
- **THEN** selection still returns an entry rather than leaving the slot empty

#### Scenario: Selection is a band, not a single best

- **WHEN** several entries score near the best for a slot
- **THEN** which of them is chosen depends on the injected randomness

### Requirement: Purposeful bookends

The first mission of the first stage SHALL be drawn only from entries tagged as openers,
and the last mission of the final stage only from entries tagged as finales. Both SHALL be
selected by the same fit-scoring and sampling rules as every other slot, applied to the
tag-filtered pool.

#### Scenario: The game opens with an opener

- **WHEN** any game is composed
- **THEN** its first mission is an entry tagged as an opener

#### Scenario: The game closes with a finale

- **WHEN** any game is composed
- **THEN** the last mission of its final stage is an entry tagged as a finale

#### Scenario: Bookends are fitted, not filler

- **WHEN** two compositions differ only in audience or setting
- **THEN** the opener and finale chosen may differ accordingly, because both were
  fit-scored against those answers

#### Scenario: A game long enough to have both bookends has two distinct ones

- **WHEN** a composed game holds more than one mission
- **THEN** its opener and its finale are two different bank entries

### Requirement: Content variety across a creator's own generations

Composition SHALL be biased away from the bank entries this creator was given in their
recent generations. The bias SHALL decay so an entry becomes freely available again after
a few generations, and SHALL never prevent a slot from being filled.

#### Scenario: A recent mission is deprioritised

- **WHEN** an entry appears in the recency memory
- **THEN** its score for a slot is lower than it would be without that memory

#### Scenario: The bias decays

- **WHEN** an entry has not been used for several generations
- **THEN** its penalty has decayed to approximately nothing

#### Scenario: Recency never empties a slot

- **WHEN** every eligible candidate for a slot is in the recency memory
- **THEN** a mission is still chosen for that slot

#### Scenario: Consecutive generations differ

- **WHEN** the same answers are composed twice, with the first run's picks recorded as
  recency memory for the second
- **THEN** the second game's mission set differs meaningfully from the first's

### Requirement: Recency memory is per creator and never breaks composition

The recency memory SHALL be stored locally, scoped to the signed-in creator, and bounded
in size. Reading or writing it SHALL be isolated from the composer, which SHALL receive
only a value. A missing, unreadable, malformed or unwritable store SHALL degrade to an
empty memory rather than an error.

#### Scenario: Memory is scoped per creator

- **WHEN** two different creators generate games on the same device
- **THEN** neither creator's recency memory affects the other's composition

#### Scenario: Memory is bounded

- **WHEN** many generations are recorded
- **THEN** the stored memory holds at most the configured number of most-recent keys

#### Scenario: A broken store degrades quietly

- **WHEN** local storage is unavailable, throws, or holds malformed content
- **THEN** reading yields an empty memory, writing is a no-op, and composition still
  succeeds

#### Scenario: The composer never touches storage

- **WHEN** the composer runs
- **THEN** it uses only the recency value it was passed

### Requirement: Composition is reproducible

Given the same bank, answers, randomness sequence and recency memory, the composer SHALL
produce the same game, apart from the freshly minted ids that every mission gets.

#### Scenario: The same seed reproduces the same game

- **WHEN** the composer is run twice with an identical seeded randomness sequence and
  identical inputs
- **THEN** the two results are identical in structure, chosen entries, stage shape,
  description and tags

#### Scenario: A different seed produces a different game

- **WHEN** the composer is run with a different randomness sequence and otherwise
  identical inputs
- **THEN** the resulting games differ in stage shape, in chosen missions, or in both

#### Scenario: Ids are always fresh

- **WHEN** the composer is run twice with an identical seed
- **THEN** no stage id and no mission id is repeated between the two results

### Requirement: A composed game is launch-valid by construction

Every composed game SHALL satisfy the same structural validation the server applies when a
game is saved. It SHALL contain exactly one final stage, SHALL NOT emit mutually-exclusive
groups, unlock dependencies or availability windows, and SHALL NOT set a required-mission
count a stage cannot satisfy.

#### Scenario: The server's validators accept it

- **WHEN** any game is composed, across the full range of answers, blueprints and seeds
- **THEN** the platform's structural, required-count, unlock-graph and availability-window
  validators all report no problem

#### Scenario: Exactly one final stage

- **WHEN** any game is composed
- **THEN** exactly one stage is marked final, and it is the last one

#### Scenario: Required counts are satisfiable

- **WHEN** any game is composed
- **THEN** no stage's required-mission count exceeds the number of missions that stage can
  actually yield

#### Scenario: Advanced structures are not emitted

- **WHEN** any game is composed
- **THEN** no stage carries mutually-exclusive groups, and no mission carries unlock
  dependencies or an availability window

### Requirement: A composed game's Quick Setup always completes

Every Quick Setup step the composer emits SHALL point at a real, settable field on the
game it was emitted with. A creator SHALL be able to open Quick Setup on any composed game
and complete every required step to a working finish, with no broken references and no
dead ends.

#### Scenario: Every step resolves

- **WHEN** any game is composed
- **THEN** every emitted Quick Setup step resolves, through the platform's own step
  resolver, to a real target on that game

#### Scenario: Steps come from the chosen missions

- **WHEN** a bank entry declaring setup is chosen for a slot
- **THEN** its setup becomes a Quick Setup step bound to the id of the mission that was
  just minted for that slot

#### Scenario: Unchosen entries contribute nothing

- **WHEN** a bank entry declaring setup is not chosen
- **THEN** no Quick Setup step referring to it is emitted

#### Scenario: No steps is a valid outcome

- **WHEN** no chosen entry declares any setup
- **THEN** the composed game carries an empty Quick Setup step list and remains valid

### Requirement: Composed description and tags describe the actual game

The composer SHALL produce a description that names activity kinds actually present in the
composed game, bounded to the platform's description length limit, and gallery tags
derived from the answers plus the activity kinds actually used, normalised through the
platform's existing tag rules.

#### Scenario: The description reflects the result

- **WHEN** a game is composed
- **THEN** any activity kind named in its description is present among its chosen missions

#### Scenario: The description is bounded

- **WHEN** a game is composed
- **THEN** its description does not exceed the platform's description length limit

#### Scenario: Tags are normalised and bounded

- **WHEN** a game is composed
- **THEN** its gallery tags pass the platform's tag normalisation and do not exceed the
  maximum tag count

#### Scenario: Copy is injected, not embedded

- **WHEN** the composer builds a description or tags
- **THEN** every human-readable word comes from copy passed into it, so the same composer
  produces Hebrew for a Hebrew creator and English for an English one

### Requirement: A composed game is committed through the existing save path

A finished smart build SHALL be committed using the existing game-creation and
game-update callables, in that order, with the full composed result. It SHALL add no new
callable, no new Firestore collection and no rules change. The creator SHALL be taken into
the Builder for the new game, and the generation SHALL be recorded in the recency memory.

#### Scenario: Two existing calls, in order

- **WHEN** a smart-build plan is committed
- **THEN** the game is created first, then updated with the composed stages, scoring
  preset, description, tags and Quick Setup steps

#### Scenario: The creator lands in the Builder

- **WHEN** the commit succeeds
- **THEN** the creator is navigated to the Builder for the newly created game

#### Scenario: A failed commit surfaces normally

- **WHEN** either call fails
- **THEN** the failure is surfaced through the console's existing error handling, and the
  creator is not silently left on a blank screen

#### Scenario: Composition happens before any network call

- **WHEN** a smart-build plan is committed
- **THEN** the complete composed result exists before the first call is made, so a
  composition problem can never leave a half-built game on the server

### Requirement: All smart-build copy is translatable

Every string the smart-build path shows a creator SHALL come from the console's
translation dictionaries in both Hebrew and English. No string SHALL be hardcoded in a
component or in the composer.

#### Scenario: Both dictionaries are complete

- **WHEN** the translation dictionaries are checked
- **THEN** every smart-build key exists in Hebrew and in English, with the Hebrew value in
  Hebrew and the English value in English

#### Scenario: No hardcoded UI strings

- **WHEN** the smart-build components are checked
- **THEN** they introduce no new hardcoded user-facing string

#### Scenario: Tag labels are shown, not ids

- **WHEN** a bank tag is displayed to the creator
- **THEN** its registry label for the creator's current language is shown, never its id

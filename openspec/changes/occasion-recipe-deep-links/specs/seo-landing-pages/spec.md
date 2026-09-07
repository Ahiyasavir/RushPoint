## ADDED Requirements

### Requirement: An occasion page offers concrete starting points, not only prose

Carrying starting points is OPTIONAL per subject: a subject with none renders exactly as it did
before this change, generic call to action included. This is what lets effort be scoped to a
declared focus without a gate treating an un-prioritised occasion as broken.

Where an occasion landing page DOES carry starting points, it SHALL present them as its primary
action, placed before its body prose rather than after it.

Each starting point SHALL name a specific game a visitor could run, in that visitor's own terms
(for example a race to tidy the house, or a couples trivia night), and SHALL link directly to
building that game rather than to a generic entry point.

Every identifier a landing page names SHALL exist in the recipe registry, so a page cannot advertise
a starting point that does not resolve.

The generic call to action SHALL remain on the page, after the offered starting points, for a
visitor whose case none of them matches.

#### Scenario: A subject with no starting points is unaffected

- **WHEN** a subject that declares no recipes is rendered
- **THEN** it renders exactly as it did before this change, with its generic call to action present
  and nothing missing

#### Scenario: The starting points come before the prose

- **WHEN** an occasion page that DOES carry starting points is read in either language
- **THEN** its named starting points appear before its first body section

#### Scenario: Every advertised recipe resolves

- **WHEN** the recipe identifiers named across all landing pages are compared against the recipe
  registry
- **THEN** every one of them is present in the registry

#### Scenario: Each starting point links to that specific game

- **WHEN** a starting point's link is inspected
- **THEN** it carries that recipe's identifier and points at the creator console, not at a generic
  page

#### Scenario: The generic action survives

- **WHEN** an occasion page is read
- **THEN** the general call to action is still present, positioned after the starting points

## ADDED Requirements

### Requirement: Every homepage occasion door has a landing page

The landing page registry SHALL generate a page for every occasion offered as a door on the
marketing homepage, so that no door on the homepage points at a page that does not exist and no
door is reachable only by first visiting the homepage.

At minimum the registry SHALL carry subjects covering activities at home and education, in addition
to the occasion subjects it already generates.

Each new subject SHALL be authored, not derived: its title, description, headline, intro, body
sections and call to action label SHALL be written in the page's own language rather than
translated from the other, and SHALL be unique across the whole registry.

#### Scenario: The registry covers every door

- **WHEN** the slugs used by the homepage occasion strip are compared against the registry's slug
  set
- **THEN** every one of them is present, in both languages

#### Scenario: The new pages carry the full apparatus

- **WHEN** the generated output for the new subjects is inspected
- **THEN** each has its own title, description, canonical URL, hreflang pair and sitemap entry,
  derived by the same mechanism as every existing subject

#### Scenario: The new pages are not duplicates

- **WHEN** `scripts/test-landing-pages.ts` runs
- **THEN** the new titles and descriptions are unique across the registry and the page count is the
  subject count multiplied by the language count

### Requirement: Landing page copy does not contradict indoor and location free play

Landing page copy SHALL NOT frame the product as outdoor only on a page whose subject is not
inherently outdoor. Specifically, the general landing page SHALL NOT lead with going outside, and
the birthday page SHALL NOT frame the occasion as leaving the living room, because indoor and
location free play are supported and are offered as a door on the homepage.

Copy on a subject whose real setting is outdoors MAY describe that setting. The rule governs
accidental narrowing, not accurate description.

#### Scenario: The general page is not outdoor only

- **WHEN** the general landing page's headline, title, description and intro are read in either
  language
- **THEN** none of them states or implies that play happens outdoors only

#### Scenario: The birthday page admits an indoor birthday

- **WHEN** the birthday landing page is read in either language
- **THEN** it does not frame the occasion as leaving the living room, and its copy holds for a
  birthday played inside a home

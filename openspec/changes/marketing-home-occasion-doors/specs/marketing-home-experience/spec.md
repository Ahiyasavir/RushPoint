## ADDED Requirements

### Requirement: The hero headline is anchored to a format the visitor already knows

The homepage hero headline SHALL borrow a reference the visitor already holds rather than describe
the product's mechanism, so that a cold visitor forms a picture from the first line without reading
an explanation.

The anchor SHALL be chosen per language rather than translated. The Hebrew homepage SHALL anchor to
`מירוץ למיליון`; the English homepage SHALL anchor to `Amazing Race`. These two strings are NOT
translations of one another and the language parity checks SHALL treat the pair as correct.

The hero subhead SHALL state the value as the removal of difficulty in general terms, and SHALL NOT
name a specific product feature as always present. A subhead that claims automatic scoring, absence
of staff, or self running operation is forbidden, because each is false for at least one supported
use case.

The headline and subhead SHALL be read from `home.he.json` and `home.en.json` and SHALL NOT be
literals in a component.

#### Scenario: Each language carries its own anchor

- **WHEN** `home.he.json` and `home.en.json` headlines are read
- **THEN** the Hebrew headline contains `מירוץ למיליון`, the English headline contains
  `Amazing Race`, and neither is a literal translation of the other

#### Scenario: The subhead makes no feature claim

- **WHEN** the hero subhead of either language is read
- **THEN** it contains no claim of automatic scoring, of running without staff, or of running by
  itself

#### Scenario: The anchor survives the language purity gate

- **WHEN** `npm run i18n:check:strict` runs after this change
- **THEN** it reports no error for the hero headline or subhead in either language, and PART B gains
  no new finding

### Requirement: An occasion strip lets a visitor self select without gating the page

The homepage SHALL render an occasion strip directly after the hero and before the section that
currently follows the hero. The strip SHALL offer exactly four occasions, and each SHALL carry both
a short title and a line of examples ending in a catch all clause, so that a visitor whose own
occasion is not named still reads themselves as included.

The four occasions SHALL be birthday celebration, group bonding, activities at home, and education.

The strip SHALL be additive and SHALL NOT gate the page. Specifically: no selection SHALL be
required to reach any other homepage section, selecting nothing SHALL leave every existing section
present in its existing order, and the strip SHALL NOT be rendered as a modal, an interstitial, an
overlay, or a redirect.

Each occasion SHALL be a link to an occasion landing page that is generated, indexable, and
reachable by its own URL, so that a door can be shared, linked to from outside the site, and found
in search independently of the homepage. All four SHALL behave the same way: no card may scroll
while another navigates.

Each door's target SHALL be identified by a slug that is a member of the landing page registry's
slug set, so a door cannot point at a page that is not generated.

Every string in the strip SHALL be read from the per language content files and SHALL NOT be a
literal in a component.

#### Scenario: The strip sits between the hero and the following section

- **WHEN** the built homepage section order is read
- **THEN** the occasion strip appears after the hero and before the section that preceded this
  change's first content section, and every previously existing section is still present in its
  previous relative order

#### Scenario: Four doors, each with a catch all

- **WHEN** the occasion strip content is read in either language
- **THEN** it contains exactly four occasions, and each one's examples line ends with a clause that
  admits cases the list does not name

#### Scenario: Ignoring the strip costs the visitor nothing

- **WHEN** the homepage is rendered and no occasion is selected
- **THEN** every homepage section below the strip is present and reachable by scrolling, and no
  overlay, dialog, or interstitial is blocking them

#### Scenario: Every door resolves to a generated page

- **WHEN** each door's slug is compared against the landing page registry
- **THEN** every one of the four is a slug the registry generates a page for, in both languages

#### Scenario: A door can be reached without the homepage

- **WHEN** a door's landing page URL is opened directly
- **THEN** it serves a page with its own title, description, canonical and hreflang pair, and it
  appears in the sitemap

#### Scenario: The strip's copy lives in the content files

- **WHEN** the homepage components are scanned for hard coded prose
- **THEN** every occasion title, examples line, and panel string is read from `home.<lang>.json` and
  none is a literal in a component

## MODIFIED Requirements

### Requirement: The homepage carries explicit conversion elements

The homepage SHALL present all of the following, with every string sourced from the
per-language content files (`src/data/pages/home.he.json` and `home.en.json`):

- A **friction-reduction** line placed directly above the playable mission section,
  stating that there is no signup and no payment and that a live trial takes seconds.
- A **curiosity-gap** prompt in or beside the hero map, framing the shown task as a
  challenge to the visitor's own team.
- **Outcome-framed** primary and secondary calls to action in the hero: the button text
  SHALL describe the result the visitor gets, not a generic verb.
- A **social-proof** strip in the hero copy column framed on engagement depth rather than
  a raw user or customer count.
- **Difficulty-removal** phrasing in the hero subhead, stating in general terms that the work the
  visitor expects this to take is removed. It SHALL NOT contrast passive phone use with active
  field engagement, because that framing presumes an outdoor game and the product supports indoor
  and location free play equally.
- A **participant door**: a link to the participant app, both in the site header and as a
  line beneath the hero CTAs, so a visitor who came to play rather than to build reaches
  the code entry without reading the page.
- An **occasion strip** directly below the hero, letting a visitor self select the occasion that
  brought them without being required to.

None of these strings SHALL be hard-coded in a component.

The playable demo missions SHALL be solvable without outside reference: any cipher or code
mission SHALL carry, in its own prompt, every part of the key a visitor needs to decode
it, and SHALL decode to a real word in the page's language.

#### Scenario: Every conversion string is in the content files

- **WHEN** the homepage components are scanned for hard-coded prose
- **THEN** the friction line, curiosity prompt, CTA labels, social-proof strip, subhead,
  participant-door labels, and occasion strip strings are all read from `home.<lang>.json` and none
  is a literal in the component

#### Scenario: Both languages carry every conversion string

- **WHEN** `home.he.json` and `home.en.json` are compared
- **THEN** they have identical key sets, and each conversion field is present in both

#### Scenario: The CTA text is outcome-framed

- **WHEN** the hero call-to-action labels are read
- **THEN** each names an outcome the visitor obtains rather than a bare action verb

#### Scenario: The subhead removes difficulty without presuming a venue

- **WHEN** the hero subhead is read in either language
- **THEN** it states that the expected difficulty is removed, and it names neither the outdoors nor
  a screen habit as the thing being contrasted

#### Scenario: A participant can reach the code entry in one step

- **WHEN** the homepage is rendered
- **THEN** a link to the participant app is present in the header, and a second one under
  the hero CTAs, each pointing at the participant origin

#### Scenario: The cipher mission is self-contained

- **WHEN** the demo cipher mission's prompt is read
- **THEN** it contains the key for every symbol in the puzzle, and the puzzle decodes to a
  real word in the page's language

## RENAMED Requirements

- FROM: `### Requirement: The explainer video is presented as a poster card that opens a player`
- TO: `### Requirement: The explainer video plays inline, muted, on its own`

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
- **Value-contrast** phrasing in the hero subhead contrasting passive phone use with
  active field engagement.
- A **participant door**: a link to the participant app, both in the site header and as a
  line beneath the hero CTAs, so a visitor who came to play rather than to build reaches
  the code entry without reading the page.

None of these strings SHALL be hard-coded in a component.

The playable demo missions SHALL be solvable without outside reference: any cipher or code
mission SHALL carry, in its own prompt, every part of the key a visitor needs to decode
it, and SHALL decode to a real word in the page's language.

#### Scenario: Every conversion string is in the content files

- **WHEN** the homepage components are scanned for hard-coded prose
- **THEN** the friction line, curiosity prompt, CTA labels, social-proof strip, subhead,
  and participant-door labels are all read from `home.<lang>.json` and none is a literal
  in the component

#### Scenario: Both languages carry every conversion string

- **WHEN** `home.he.json` and `home.en.json` are compared
- **THEN** they have identical key sets, and each conversion field is present in both

#### Scenario: The CTA text is outcome-framed

- **WHEN** the hero call-to-action labels are read
- **THEN** each names an outcome the visitor obtains rather than a bare action verb

#### Scenario: A participant can reach the code entry in one step

- **WHEN** the homepage is rendered
- **THEN** a link to the participant app is present in the header, and a second one under
  the hero CTAs, each pointing at the participant origin

#### Scenario: The cipher mission is self-contained

- **WHEN** the demo cipher mission's prompt is read
- **THEN** it contains the key for every symbol in the puzzle, and the puzzle decodes to a
  real word in the page's language

### Requirement: The explainer video plays inline, muted, on its own

The homepage's explainer video SHALL be presented inline, not in a modal or dialog. It
SHALL be shown at the source file's own aspect ratio, not cropped into a differently
shaped frame.

It SHALL begin playing **muted** once it is scrolled into view, and SHALL pause when it
leaves the viewport. Playback SHALL be driven by viewport visibility rather than the
`autoplay` attribute, so a video that is never seen is never decoded. It SHALL NOT loop,
and SHALL NOT play with sound until the visitor asks for sound.

There SHALL be an explicit, clearly labelled control to turn the sound on, distinct from
the small native mute toggle. Its label SHALL come from the site's control-label source,
not the content files.

Under `prefers-reduced-motion: reduce` the video SHALL NOT autostart; the control SHALL
instead read as "play" and start playback when pressed.

The gallery's use of `Media.astro` SHALL be unchanged.

#### Scenario: It starts by itself, muted, only on screen

- **WHEN** the video scrolls into view with motion allowed
- **THEN** it begins playing muted, and **WHEN** it scrolls out of view it pauses

#### Scenario: No modal

- **WHEN** the homepage is inspected
- **THEN** the video is a plain inline element and there is no `<dialog>` around it

#### Scenario: Sound is opt-in

- **WHEN** the page loads and the video plays
- **THEN** it is muted, and a labelled control to turn on sound is shown over it

#### Scenario: Reduced motion does not autostart it

- **WHEN** the homepage is rendered with `prefers-reduced-motion: reduce`
- **THEN** the video is not playing, and the control reads as a play control

#### Scenario: The gallery is unaffected

- **WHEN** the gallery section is rendered
- **THEN** it still uses `Media.astro` with its existing behaviour

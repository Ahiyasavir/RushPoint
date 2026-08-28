# marketing-home-experience Specification

## Purpose
TBD - created by archiving change marketing-home-cro-redesign. Update Purpose after archive.
## Requirements
### Requirement: The homepage opens with a field-map hero, not centred text alone

The marketing homepage (`apps/marketing/src/pages/[lang]/index.astro`) SHALL render a
dedicated hero component that is not the generic `Hero.astro`. The hero SHALL present, on
a wide viewport, two columns: a copy column and a visual column. On a narrow viewport the
two SHALL stack with the copy first. The layout SHALL mirror correctly for a
right-to-left language, using logical properties rather than physical `left`/`right`.

The generic `Hero.astro` SHALL remain unchanged and SHALL continue to be used by every
other page that uses it today.

The hero's largest text SHALL be present in the initial HTML response and SHALL NOT depend
on JavaScript to appear.

#### Scenario: The homepage hero is the field hero

- **WHEN** the built homepage is parsed
- **THEN** it contains the field-map hero markup, and the hero's headline and call to
  action text are present without executing scripts

#### Scenario: Other pages are untouched

- **WHEN** the built output of the story, blog index, and blog post pages is compared to
  before this change
- **THEN** their hero markup is unchanged

#### Scenario: The hero mirrors for Hebrew

- **WHEN** the Hebrew homepage hero is inspected
- **THEN** the copy column leads in reading order and no physical-direction utility class
  is used for the two-column split

### Requirement: The hero carries a self-drawing field-map animation with a static fallback

The hero's visual column SHALL contain a phone-framed, inline-SVG map showing a route line
drawn between at least three location pins, with a visible score badge. The route line and
the pins MAY animate: the route drawing itself in, the pins pulsing in sequence.

All motion SHALL be defined so that under `prefers-reduced-motion: reduce` the map renders
its finished state, with the full route line and all pins shown and no animation running.

The animation SHALL be pure SVG and CSS. It SHALL NOT load an image, video, font, or script
file, and it SHALL NOT be the reason the page makes an additional network request.

#### Scenario: Reduced motion shows the finished map

- **WHEN** the hero is rendered with `prefers-reduced-motion: reduce`
- **THEN** the full route line and every pin are visible and no CSS animation is active on
  the map

#### Scenario: The map costs no extra request

- **WHEN** the homepage's network requests are listed on load
- **THEN** none of them is caused by the hero map, which is inline in the document

#### Scenario: An optional real clip can replace the animation

- **WHEN** the homepage content file sets an optional hero clip field
- **THEN** the hero renders that clip in the phone frame instead of the SVG animation, and
  **WHEN** the field is absent the SVG animation is shown, with no code change required to
  switch between them

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

### Requirement: The playable mission comes before the feature list

On the homepage the `TryMission` section SHALL appear after the hero and before the
`Features` section. It SHALL be wrapped in a container with a distinct background from the
sections adjacent to it.

#### Scenario: Section order

- **WHEN** the built homepage section order is read
- **THEN** `TryMission` appears after the hero and before `Features`

### Requirement: The visual rhythm pass stays within the existing theme system

Section backgrounds on the homepage SHALL alternate between the page surface and a warm
tint. Any new colour SHALL be a token in `apps/marketing/src/assets/styles/tailwind.css`
derived from the existing warm neutral ramp, and SHALL have a defined value in both light
and dark mode. No template colour (the AstroWind blue, purple, navy, or `lavender`) SHALL
be introduced. The `slate`, `gray`, and `blue` scale redefinitions already in
`tailwind.css` SHALL remain.

Any new keyframe animation added for this pass SHALL be gated so that it does not run under
`prefers-reduced-motion: reduce`.

#### Scenario: The theme drift test still passes

- **WHEN** `scripts/test-marketing-theme.ts` runs after this change
- **THEN** it passes, including the checks that the `slate`/`gray`/`blue` scales are still
  redefined and that no template colour is present

#### Scenario: New tint has a dark-mode value

- **WHEN** the new section-tint token is inspected
- **THEN** it resolves to a defined colour under both light and dark mode

#### Scenario: New animations respect reduced motion

- **WHEN** the homepage is rendered with `prefers-reduced-motion: reduce`
- **THEN** none of the animations added by this change are running

### Requirement: The homepage copy contains no dash separators

Copy added or changed by this change SHALL comply with the existing user-facing-copy dash rule, in both `home.he.json` and `home.en.json` and in any new component. It SHALL NOT use a hyphen-minus, hyphen, en dash, em dash, horizontal bar, or Hebrew maqaf as a separator; sentences SHALL be joined with a comma, a period, or a line break instead.

#### Scenario: The no-dashes gate passes

- **WHEN** `scripts/test-no-dashes.ts` runs after this change
- **THEN** PART E (marketing site content) passes with the homepage content included in
  its field count

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


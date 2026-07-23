## ADDED Requirements

### Requirement: The promo screen distinguishes a load error from a missing game

`GamePromoScreen` SHALL distinguish a failure to LOAD the public game (a rejected fetch) from a
successful load that finds NO game (the document does not exist or is not public). A load failure
SHALL NOT be rendered as the "game not found" state.

On a load failure the screen SHALL render a distinct, localized error state offering a RETRY control
that re-runs the load. On a successful load that finds no game, the screen SHALL render the existing
localized not-found state with its "enter a code" affordance. On a successful load that finds a game,
the screen SHALL render the game unchanged.

All copy SHALL be localized (Hebrew default), routed through the `promo` dictionary, with no hardcoded
UI string.

#### Scenario: A fetch error offers a retry

- **WHEN** loading the public game rejects (e.g. a network failure)
- **THEN** a localized error message is shown with a retry control
- **THEN** the "game not found" copy is NOT shown

#### Scenario: Retry re-runs the load

- **WHEN** the participant taps the retry control after a load error
- **THEN** the screen returns to its loading state and fetches the public game again

#### Scenario: A genuinely missing game still shows not-found

- **WHEN** the public game document does not exist or is not public
- **THEN** the existing localized not-found state and its "enter a code" affordance are shown

#### Scenario: A found game renders unchanged

- **WHEN** the public game loads successfully
- **THEN** the game promo content is rendered exactly as before

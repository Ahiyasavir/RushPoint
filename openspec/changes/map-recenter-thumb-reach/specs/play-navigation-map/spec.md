## ADDED Requirements

### Requirement: The map recenter control sits in a thumb-reachable bottom corner

The participant navigation map's recenter ("focus back on me") control SHALL be anchored to a
thumb-reachable **bottom** corner of the map rather than a top corner, because a one-handed
walking participant taps it frequently and the thumb rests near the bottom of the screen.

The control SHALL be positioned on a **logical** inline edge (`start`) so it mirrors correctly
under the Hebrew (RTL) default, and SHALL clear the bottom-anchored map attribution and the
search-area legend so it never overlaps them.

Moving the control SHALL be presentation-only: the recenter handler, its enabled/disabled
verdict, the accessible label, and the tap-target size are unchanged, and no translation string
is added or altered.

#### Scenario: The map recenter control sits in a thumb-reachable bottom corner

- **WHEN** a participant views the navigation map on a phone
- **THEN** the recenter control appears in the bottom inline-start corner, remains tappable, and
  does not overlap the map attribution or the search-area legend

#### Scenario: The control mirrors correctly under RTL

- **WHEN** the app is in its Hebrew (RTL) default
- **THEN** the recenter control hugs the bottom reading-start (right) corner via a logical inline
  edge, with no physical left/right offset introduced

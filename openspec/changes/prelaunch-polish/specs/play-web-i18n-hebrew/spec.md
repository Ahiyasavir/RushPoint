## MODIFIED Requirements

### Requirement: Public leaderboard is displayed whenever boardCode is set
The routing logic in `apps/play-web/src/App.tsx` SHALL display the `PublicLeaderboardScreen`
whenever `boardCode` is truthy, regardless of whether a play session also exists.
Previously the condition was `boardCode && !session`, which prevented a user with an active
session (e.g. a finished participant) from viewing a leaderboard shared link.

After this change, the condition SHALL be `!!boardCode` (i.e. `boardCode` alone without the
`!session` guard). The `PublicLeaderboardScreen` component already provides an `onJoin`
callback that calls `setBoardCode(null)`, which restores the session/play screen — that
behavior SHALL be preserved and is not changed by this fix.

#### Scenario: boardCode set without session → leaderboard shown
- **WHEN** `boardCode` is `"ABCD123"` and `session` is `null`
- **THEN** `PublicLeaderboardScreen` is rendered

#### Scenario: boardCode set WITH session → leaderboard still shown
- **WHEN** `boardCode` is `"ABCD123"` and `session` is a valid `Session` object
- **THEN** `PublicLeaderboardScreen` is rendered (not the play screen)

#### Scenario: No boardCode → leaderboard NOT shown
- **WHEN** `boardCode` is `null`
- **THEN** `PublicLeaderboardScreen` is NOT rendered

#### Scenario: onJoin callback clears boardCode
- **GIVEN** `PublicLeaderboardScreen` is displayed (boardCode is set)
- **WHEN** the user presses the join/play button (`onJoin` is called)
- **THEN** `setBoardCode(null)` is called
- **THEN** the play/join screen is rendered


### Requirement: LINK_CODE is evaluated at component mount, not at module load
The `LINK_CODE` constant in `JoinScreen.tsx` SHALL be moved inside the `JoinScreen` component
body and evaluated using a `useState` initializer
(`useState(() => new URLSearchParams(...).get('code') ?? null)`) or equivalent, rather than
the current module-level (line 8) evaluation.

This ensures the code is read from the current `window.location.search` at mount time rather
than once at bundle-parse time, which is fragile in a single-page application where the URL
can differ between module load and component mount.

No behavior change is expected for the initial render of the component; this is a correctness
improvement for robustness in hot-module-reload, test environments, and future SPA routing
changes.

#### Scenario: LINK_CODE reads correct URL at mount
- **WHEN** `JoinScreen` is mounted with `?code=RUSH42` in the URL
- **THEN** `linkCode` (previously `LINK_CODE`) equals `"RUSH42"`

#### Scenario: LINK_CODE is not frozen at module-load time
- **WHEN** the module is loaded with one URL and the component is mounted later with a different URL
- **THEN** `linkCode` reflects the URL at component mount time
- **THEN** no module-level side-effects read `window.location.search`

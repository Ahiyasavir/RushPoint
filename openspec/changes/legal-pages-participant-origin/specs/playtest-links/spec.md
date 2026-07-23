## MODIFIED Requirements

### Requirement: The reverse proxy routes the v2 apps and emulator under one origin
`scripts/proxy.mjs` SHALL route requests under a single origin to the v2 `creator-web` and `play-web`
dev servers and to the emulator services, replacing the stale v1 mobile/admin routing.

The public legal paths `/terms` and `/privacy` — including their trailing-slash and query-string
forms — SHALL be routed to the participant app, which owns them, so that the tunnel origin behaves
the same as the production participant site. The emulator routing rules are substring matches, so
this SHALL be asserted explicitly rather than left to fall through to the default branch.

The `/creator` prefixed routing SHALL be unchanged, so `/creator/terms` and `/creator/privacy`
continue to reach the creator console.

#### Scenario: Proxy routing targets
- **WHEN** `resolveProxyTarget` is given a Firestore/Auth/Functions/Storage path
- **THEN** it returns the corresponding emulator port
- **WHEN** it is given a `/creator` prefixed path
- **THEN** it targets the creator-web dev server (5180)
- **WHEN** it is given any other path
- **THEN** it targets the play-web dev server (5181)

#### Scenario: Root legal paths reach the participant app
- **WHEN** `resolveProxyTarget` is given `/terms`, `/privacy`, `/terms/` or `/privacy?lang=en`
- **THEN** it targets the play-web dev server (5181)

#### Scenario: Creator legal paths still reach the creator console
- **WHEN** `resolveProxyTarget` is given `/creator/terms` or `/creator/privacy`
- **THEN** it targets the creator-web dev server (5180)

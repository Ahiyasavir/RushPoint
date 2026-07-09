# Playtest Links

## ADDED Requirements

### Requirement: One command runs the full stack and prints a creator link and a join link
`npm run playtest` SHALL boot the full v2 stack (emulator + seed + creator-web + play-web) behind a
single public origin and MUST print two real, openable links: the creator console and a join-a-game
page. The join link MUST carry the seeded run's `?code=<accessCode>` so testers land on the join screen.

#### Scenario: Playtest prints two openable links
- **WHEN** the developer runs `npm run playtest` and the tunnel comes up
- **THEN** a creator-console URL and a join URL (with `?code=<accessCode>`) are printed

#### Scenario: A remote phone can open the join link
- **WHEN** a tester on a different network opens the printed join link
- **THEN** they reach the join screen for the seeded live run and can play

#### Scenario: Link building is correct
- **WHEN** `buildPlaytestLinks(baseUrl, accessCode)` is called
- **THEN** it returns `creatorUrl = baseUrl + '/creator'` and `joinUrl = baseUrl + '/?code=' + accessCode`
- **AND** with no access code the join URL is just the base play URL

### Requirement: The emulator host is configurable for remote clients
The clients SHALL resolve the Firebase emulator host from configuration (`resolveEmulatorHost`)
instead of a hardcoded address, defaulting to `127.0.0.1` for normal local dev and using the page
origin in playtest so remote devices reach the backend through the tunnel.

#### Scenario: Default local host is preserved
- **WHEN** `resolveEmulatorHost` is called with no override
- **THEN** it returns `127.0.0.1` (normal `dev:all` behavior unchanged)

#### Scenario: Playtest uses the tunnel origin
- **WHEN** `resolveEmulatorHost` is called in playtest mode with a page origin
- **THEN** it returns the origin's hostname so remote clients connect through the tunnel

### Requirement: The reverse proxy routes the v2 apps and emulator under one origin
`scripts/proxy.mjs` SHALL route requests under a single origin to the v2 `creator-web` and `play-web`
dev servers and to the emulator services, replacing the stale v1 mobile/admin routing.

#### Scenario: Proxy routing targets
- **WHEN** `resolveProxyTarget` is given a Firestore/Auth/Functions/Storage path
- **THEN** it returns the corresponding emulator port
- **WHEN** it is given a `/creator` prefixed path
- **THEN** it targets the creator-web dev server (5180)
- **WHEN** it is given any other path
- **THEN** it targets the play-web dev server (5181)

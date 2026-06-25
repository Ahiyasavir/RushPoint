# Run Recap

## ADDED Requirements

### Requirement: getRunRecap returns the competition summary with everyone's photos
A new `getRunRecap` callable SHALL resolve a run by access code and return an aggregate recap: the
final standings (rank, team, score, total time), the collected photos across **all** teams, and
headline stats (team count, photo count, winner name). The standings ordering MUST reuse the shared
ranking logic so the recap cannot drift from the leaderboard.

#### Scenario: Owner gets standings and photos
- **WHEN** the run owner calls `getRunRecap` for a finalized run
- **THEN** the response contains ordered standings and the approved photos from every team
- **AND** the stats report the correct team count, photo count, and winner

### Requirement: Public recap is gated to published runs
`getRunRecap` SHALL allow the owner to read any of their runs, but allow a non-owner only when the run
is `published` — the same gate as `getPublicLeaderboard`. A `?recap=<accessCode>` public route renders
the shareable recap page using this gate.

#### Scenario: Unpublished run is private
- **WHEN** a non-owner calls `getRunRecap` for an unpublished run
- **THEN** the call is denied (or returns no recap) and no standings or photos are exposed

#### Scenario: Published run is publicly shareable
- **WHEN** the run is `published` and a non-owner opens `?recap=<accessCode>`
- **THEN** the public recap page renders the standings and photo montage

### Requirement: Recap photos respect moderation and retention
The recap SHALL include only approved/correct photo submissions and MUST exclude `rejected` and
`photo_pending` ones. A photo whose `photoUrl` is absent or cleared (e.g. after the 90-day PII prune)
MUST be treated as "no photo" — the standings still return and the call never errors.

#### Scenario: Rejected and pending photos are excluded
- **WHEN** a team has a rejected photo and another team has a pending photo
- **THEN** neither appears in the recap's photo list

#### Scenario: Pruned run keeps standings, drops photos
- **WHEN** a run's PII has been pruned and `getRunRecap` is called
- **THEN** the photo list is empty
- **AND** the standings and stats still return without error

### Requirement: Recap renders a branded photo montage
The client SHALL render the recap as standings plus a photo montage, and a "Share recap" action MUST
produce a single branded collage image that tiles the photos via a deterministic grid and carries the
shared brand stamp (logo + app link + QR) from the `share-branding` capability.

#### Scenario: Share recap produces a branded collage
- **WHEN** an organizer taps "Share recap"
- **THEN** a collage image is generated tiling the run's photos in a balanced grid
- **AND** it carries the RushPoint logo, app link, and a scannable QR before reaching the share sheet

#### Scenario: Montage grid is balanced and bounded
- **WHEN** `computeMontageGrid` is called for N photos and a canvas size
- **THEN** the returned cells are non-overlapping, inside the canvas, and balanced toward a square
- **AND** beyond the tile cap the overflow count is reported rather than overflowing the canvas

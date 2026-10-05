# standings-reach-phones Specification

## Purpose
TBD - created by archiving change deploy-feedback-2026-10-05. Update Purpose after archive.
## Requirements
### Requirement: Published standings reach the phones at once

When the standings change from unpublished to published, the server SHALL stamp every team
document of the run once (`boardPublishedAt`), so each phone's existing listener refreshes. A
refresh that does not change the published state SHALL NOT stamp.

#### Scenario: Publishing to the players
- **WHEN** the organizer publishes the standings
- **THEN** every team document carries `boardPublishedAt` and the phones show the board without waiting for their 60 s poll


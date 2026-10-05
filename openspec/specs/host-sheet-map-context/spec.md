# host-sheet-map-context Specification

## Purpose
TBD - created by archiving change deploy-feedback-2026-10-05. Update Purpose after archive.
## Requirements
### Requirement: The host sheet map always shows where it is

The host sheet SHALL draw its detail map at zoom 16 or further out, from retina tiles, and SHALL
draw beside it an overview of the same spot three zoom levels further out, with the detail map's
frame marked, whenever the detail map is not already at country scale.

#### Scenario: A station in open fields
- **WHEN** a game's only located station is in open land, where zoom 16 shows no names
- **THEN** the overview below the map names the nearby town and roads, with an orange frame around the detail area

#### Scenario: Stations in a town
- **WHEN** the stations are in a town
- **THEN** the detail map shows the streets, never closer than zoom 16


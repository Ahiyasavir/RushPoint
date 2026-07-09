# White-Label Pro

## ADDED Requirements

### Requirement: A white-label entitlement replaces RushPoint branding on run share surfaces
A server-validated white-label entitlement SHALL let a creator set their own brand (logo + name) and
suppress the "Powered by RushPoint" footer and wordmark on their run's share surfaces (finish footer,
story card, recap collage, podium share). The decision MUST come from `resolveRunBrand`, never a
client toggle.

#### Scenario: White-label run shows the creator brand
- **WHEN** a run has an active white-label entitlement with a valid brand
- **THEN** share surfaces show the creator's logo/name and the RushPoint footer is hidden

#### Scenario: Standard run keeps RushPoint branding
- **WHEN** a run has no white-label entitlement
- **THEN** share surfaces show RushPoint branding and the "Powered by RushPoint" footer

#### Scenario: White-label without a brand falls back safely
- **WHEN** the entitlement is white-label but no valid brand is configured
- **THEN** `resolveRunBrand` falls back to RushPoint branding (no half-branded state)

### Requirement: The entitlement is sealed onto the run at launch
`launchRun` SHALL seal the white-label entitlement and brand onto the run, so a later plan change
does not alter an in-flight run. The entitlement MUST be server-validated, not client-asserted.

#### Scenario: Entitlement sealed at launch
- **WHEN** a creator with an active white-label entitlement launches a run
- **THEN** `run.whiteLabel` is true and the brand is sealed onto the run

#### Scenario: Client cannot fake the entitlement
- **WHEN** a client without the entitlement attempts to launch a white-label run
- **THEN** the run is not white-labeled (the server ignores the client claim)

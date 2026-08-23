## MODIFIED Requirements

### Requirement: The accepted upload origins SHALL NOT depend on a single environment variable

The accepted-origin set for stored upload URLs SHALL include a compiled-in canonical set of
RushPoint upload origins, unioned with any origin supplied by configuration. An absent or
changed configuration value SHALL NOT make a URL minted by this platform unrecognisable.

For a host in the canonical set, the `http://` form SHALL be recognised for object-path
extraction in addition to the `https://` form, so a URL minted by a proxy-derived fallback
is understood rather than treated as foreign. Origins outside the canonical set and outside
the configured value SHALL remain refused in every mode.

The existing guarantees are unchanged: `gs://` and the project's Firebase Storage download
origins remain accepted, the emulator/tunnel shape remains gated behind the caller's
`allowLocalEmulator` opt-in, path traversal remains rejected segment-wise in every shape,
and `requireStorageUrl`'s `runs/{runId}/teams/{uid}/` prefix guard applies identically in
every mode.

#### Scenario: The canonical origin is accepted with no configuration set
- **WHEN** `isFirebaseStorageUrl('https://api.rush-point.com/uploads/gameMedia/u/games/g/t-1.jpg', {})` is called
- **THEN** it returns `true`

#### Scenario: The http form of a canonical host is accepted
- **WHEN** the same URL is supplied with an `http://` scheme
- **THEN** it returns `true`

#### Scenario: An arbitrary origin is still refused
- **WHEN** `isFirebaseStorageUrl('https://evil.example/uploads/x.jpg', { vpsOrigins: ['https://api.rush-point.com'] })` is called
- **THEN** it returns `false`

#### Scenario: Traversal is still rejected on a canonical origin
- **WHEN** a canonical-origin URL whose object path contains a `..` segment is supplied
- **THEN** it returns `false`

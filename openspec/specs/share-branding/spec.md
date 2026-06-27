# share-branding Specification

## Purpose
TBD - created by archiving change share-branding. Update Purpose after archive.
## Requirements
### Requirement: Every shared image carries the brand stamp
A single reusable watermark helper SHALL composite the RushPoint **logo mark** and the app URL onto
every image the app shares — the finish/brag story card, the run-recap collage, and an individual
shared task photo. The stamp MUST be placed at the side/edge of the image so it never covers the
subject, and its position MUST be computed by a deterministic, DOM-free layout function so it is
unit-testable.

#### Scenario: Story card uses the shared stamp
- **WHEN** a participant shares their finish/brag story card
- **THEN** the rendered image carries the logo mark and the app URL via the shared watermark helper
- **AND** the brand elements sit within the image margins, clear of the center subject band

#### Scenario: Layout is deterministic and non-overlapping
- **WHEN** `computeWatermarkLayout` is called for a given canvas size
- **THEN** the logo box, the QR box, and the URL line are all inside the configured margin
- **AND** the logo box and the QR box do not overlap each other

### Requirement: Every shared image carries a scannable QR
Every shared image SHALL include a machine-readable QR code that resolves to the correct destination,
generated client-side (no server round-trip, no static asset). The target resolution is a pure
function: an access code yields the joinable URL, a game id yields the promo URL, and neither yields
the generic app URL.

#### Scenario: QR target resolves by context
- **WHEN** `resolveShareQrTarget` is given an `accessCode`
- **THEN** it returns the joinable URL (`<playBaseUrl>/?code=<accessCode>`)
- **WHEN** it is given only a `gameId`
- **THEN** it returns the promo URL (`<playBaseUrl>/?game=<gameId>`)
- **WHEN** it is given neither
- **THEN** it returns the generic app base URL

#### Scenario: Scanning a shared image opens the destination
- **WHEN** a viewer scans the QR on a shared image
- **THEN** their browser opens the promo/join/play page for that game

### Requirement: Participants can share an individual task photo, watermarked
The app SHALL let a participant share an individual photo they captured during the run; the shared
image MUST pass through the same brand stamp (logo + URL + QR) before reaching the native share sheet,
download, or clipboard.

#### Scenario: Sharing a task photo brands it
- **WHEN** a participant taps "share" on a completed photo task
- **THEN** the photo is composited with the brand stamp and routed to the native share sheet (mobile)
  or downloaded (desktop)

### Requirement: Branding degrades gracefully and never blocks a share
If the logo image cannot load, the stamp SHALL fall back to the existing text wordmark; if compositing
a cross-origin photo onto a canvas taints it, the share path MUST fall back to sharing the original
image/URL with a branded caption rather than failing.

#### Scenario: Missing logo falls back to text
- **WHEN** the logo image fails to load during a share
- **THEN** the watermark renders the `RUSHPOINT` text wordmark instead
- **AND** the share still completes

#### Scenario: Tainted canvas falls back without failing
- **WHEN** compositing a cross-origin photo causes `toBlob` to fail
- **THEN** the share falls back to the original URL plus a branded caption and does not throw


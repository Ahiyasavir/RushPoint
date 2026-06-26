# pwa-installability Specification

## Purpose
TBD - created by archiving change play-web-store-readiness. Update Purpose after archive.
## Requirements
### Requirement: Participant PWA is installable to store standards
`apps/play-web` SHALL declare a web manifest that passes installability checks: required fields
`name`, `short_name`, `start_url`, a valid `display` (`standalone`/`fullscreen`/`minimal-ui`),
`theme_color`, `background_color`, and a non-empty `icons` array. The manifest MUST declare raster
PNG icons — a `192×192` (`purpose: any`), a `512×512` (`purpose: any`), and a separate `512×512`
(`purpose: maskable`) — splitting the original conflicting single `any maskable` SVG entry so that
Chrome's install prompt fires and `bubblewrap` can build a TWA.

#### Scenario: Manifest exposes a complete, installable icon set
- **WHEN** the manifest is parsed
- **THEN** it contains ≥1 PNG icon at `192×192`, ≥1 PNG `512×512` with `purpose` containing `any`,
  and ≥1 PNG `512×512` with `purpose` containing `maskable`
- **AND** no single icon entry mixes both `any` and `maskable` in one `purpose` string

#### Scenario: Declared icons exist at their declared pixel size
- **WHEN** the test reads each declared PNG icon's IHDR header from disk under `apps/play-web/public/`
- **THEN** every file exists and its real width/height equal the `sizes` declared in the manifest

#### Scenario: Declared icons are cached by the service worker
- **WHEN** the test inspects `sw.js`
- **THEN** every declared icon `src` is present in the service worker `SHELL` array (no install 404)

### Requirement: Brand mark rasterizes filter-free and reproducibly
The redesigned `icon.svg` ("Velocity Compass") SHALL be the single source of truth and MUST use only
gradients, strokes, opacity, and transforms — no `<filter>` primitives — so it rasterizes
byte-stable through `sharp`/resvg. A repeatable generator script (`scripts/gen-pwa-icons.mjs`, run
via `npm run icons`) MUST produce the committed PNG assets from that SVG, with squircle corners baked
into the `any` variants and a full-bleed square for the `maskable` variant.

#### Scenario: Generator reproduces the committed icons
- **WHEN** `npm run icons` is run against the source `icon.svg`
- **THEN** it regenerates `icon-192.png`, `icon-512.png`, and `icon-512-maskable.png` deterministically

#### Scenario: Source SVG contains no filter primitives
- **WHEN** the source `icon.svg` is inspected
- **THEN** it contains no `feGaussianBlur`/`feDropShadow`/`feColorMatrix`/`<filter>` elements


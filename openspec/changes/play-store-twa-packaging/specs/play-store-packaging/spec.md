# play-store-packaging

Deterministic generation and validation of the artifacts Google Play requires to publish `play-web` as a Trusted Web Activity (TWA): the Digital Asset Links payload that proves origin ownership, and the web-manifest install-readiness check. All logic is pure (no I/O, no emulator) so it is fully unit-testable and can gate a submission via `play:store:check`.

## ADDED Requirements

### Requirement: Digital Asset Links payload generation

The system SHALL provide a pure function that builds the Google Digital Asset Links (`assetlinks.json`) payload from an Android package name and one or more SHA-256 signing-certificate fingerprints. The output MUST be a JSON-serializable array of statements where each statement grants `delegate_permission/common.handle_all_urls` to the given package with the given fingerprints, matching the format Google's TWA verification requires.

#### Scenario: Single fingerprint produces a valid statement

- **WHEN** the generator is called with package `app.rushpoint.play` and one fingerprint
- **THEN** it returns an array with exactly one statement whose `relation` is `["delegate_permission/common.handle_all_urls"]`, whose `target.namespace` is `android_app`, whose `target.package_name` equals `app.rushpoint.play`, and whose `target.sha256_cert_fingerprints` contains that one fingerprint

#### Scenario: Multiple fingerprints (upload key + Play App Signing key)

- **WHEN** the generator is called with two fingerprints (the local upload key and the Play-managed app-signing key)
- **THEN** both fingerprints appear in a single statement's `sha256_cert_fingerprints` array, deduplicated, preserving verification for both keys

#### Scenario: Fingerprint is normalized to canonical form

- **WHEN** a fingerprint is provided in lowercase or without the standard colon separators
- **THEN** the generator normalizes it to uppercase colon-separated hex pairs (e.g. `AA:BB:...`) so it matches what Google expects

#### Scenario: Invalid input is rejected

- **WHEN** the generator is called with an empty package name, a package name that is not a valid Android application id, or a fingerprint that is not 32 hex-encoded bytes
- **THEN** it throws a descriptive error rather than emitting a malformed statement

### Requirement: Digital Asset Links payload validation

The system SHALL provide a pure function that validates a parsed `assetlinks.json` value and reports whether it is a well-formed, non-empty Asset Links payload usable for TWA verification, returning the specific problems when it is not.

#### Scenario: Empty file is reported as not-ready

- **WHEN** the validator is given an empty array `[]` (the current committed state of `apps/play-web/public/.well-known/assetlinks.json`)
- **THEN** it reports the payload as invalid with a reason indicating no statements are present

#### Scenario: Statement missing the required relation or fingerprints is rejected

- **WHEN** the validator is given a statement that lacks the `delegate_permission/common.handle_all_urls` relation, omits the `android_app` namespace, or has an empty `sha256_cert_fingerprints` array
- **THEN** it reports the payload as invalid and names the missing field

#### Scenario: A correctly generated payload validates

- **WHEN** the validator is given the output of the generation function for a valid package + fingerprint
- **THEN** it reports the payload as valid with no problems

### Requirement: Web-manifest TWA install-readiness validation

The system SHALL provide a pure function that validates a web app manifest object against the fields Google Play's TWA/PWA install criteria require, returning a pass/fail result plus the list of missing or non-conforming fields. It MUST require: a non-empty `name`, a `short_name`, `display` of `standalone` (or `fullscreen`), a `start_url`, a `theme_color`, a `background_color`, at least one icon of 512×512 with purpose including `any`, and at least one icon of 512×512 with purpose including `maskable`.

#### Scenario: The current play-web manifest passes

- **WHEN** the validator is run against `apps/play-web/public/manifest.webmanifest` (which declares name, short_name, standalone, start_url, theme/background colors, a 512 `any` icon, and a 512 `maskable` icon)
- **THEN** it returns a passing result with no missing fields

#### Scenario: Missing maskable icon fails

- **WHEN** the validator is run against a manifest that has a 512 `any` icon but no icon whose purpose includes `maskable`
- **THEN** it fails and lists the missing maskable-icon requirement (Play rejects/penalizes installs without one)

#### Scenario: Non-standalone display fails

- **WHEN** the validator is run against a manifest whose `display` is `browser`
- **THEN** it fails and names `display` as non-conforming, because a TWA must launch outside the browser chrome

### Requirement: Pre-submission check command

The system SHALL provide an `npm run play:store:check` command that runs the manifest and Asset Links validators against the real repository files and exits non-zero if either is not submission-ready, so a broken or empty `assetlinks.json` cannot reach a Play upload unnoticed.

#### Scenario: Check fails while assetlinks is empty

- **WHEN** `play:store:check` runs and `apps/play-web/public/.well-known/assetlinks.json` is still `[]`
- **THEN** the command exits non-zero and prints that the Asset Links file has no statements and must be generated with the signing fingerprint

#### Scenario: Check passes once artifacts are ready

- **WHEN** the manifest is install-ready and `assetlinks.json` contains a valid statement for the configured package
- **THEN** the command exits zero, confirming the web-side artifacts are ready for the TWA build

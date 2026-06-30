# Crash Reporting

## ADDED Requirements

### Requirement: A real crash provider is wired behind the client seam, DSN-gated
Both creator-web and play-web SHALL register a real crash reporter (Sentry) behind the existing
`setCrashReporter` seam during `initTelemetry()`, activated only when `VITE_SENTRY_DSN` is set. The
provider SDK MUST be loaded via a dynamic `import()` so it stays out of the main bundle. When the DSN
is absent, behavior MUST be identical to today's console-only reporting (no SDK loaded, no network).

#### Scenario: With a DSN, crashes ship to the provider
- **WHEN** `VITE_SENTRY_DSN` is set and `initTelemetry()` runs
- **THEN** the provider SDK is dynamically imported and registered via `setCrashReporter`
- **AND** a subsequent `reportError(...)` is forwarded to the provider

#### Scenario: Without a DSN, behavior is unchanged
- **WHEN** `VITE_SENTRY_DSN` is absent
- **THEN** no provider SDK is loaded and `reportError(...)` logs only to the console
- **AND** no network request is made

### Requirement: play-web has a telemetry funnel matching creator-web
play-web SHALL provide a `services/telemetry.ts` funnel (`reportError`, `setCrashReporter`,
`initTelemetry`) that installs global `error` and `unhandledrejection` handlers, and its
`ErrorBoundary` SHALL route caught render errors through `reportError`. Async/promise crashes during
play MUST therefore be captured the same way creator-web captures them.

#### Scenario: A play-web render crash is funneled
- **WHEN** a component under play-web's `ErrorBoundary` throws during render
- **THEN** `reportError` is invoked with the error and a `boundary` tag

#### Scenario: A play-web unhandled rejection is captured
- **WHEN** a promise rejects with no handler after `initTelemetry()` has run
- **THEN** the global `unhandledrejection` handler routes it through `reportError`

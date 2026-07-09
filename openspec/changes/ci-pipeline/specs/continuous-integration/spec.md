# Continuous Integration

## ADDED Requirements

### Requirement: Every PR and push to main runs the full documented gate set
The repository SHALL provide a GitHub Actions workflow that runs on every `pull_request` and every
`push` to `main`, executing the project's documented required gates. A fast lane SHALL run
`typecheck`, `lint`, `test`, `creator:build`, `play:build`, and `i18n:check` without the emulator; a
separate lane SHALL run `e2e` and `test:rules` against the Firebase emulator suite. Any failing gate
blocks the workflow.

#### Scenario: A red gate blocks the workflow
- **WHEN** a pull request introduces a failure in any gate (e.g. a type error or a red e2e)
- **THEN** the corresponding CI job fails
- **AND** the failure is visible as a required check on the pull request

#### Scenario: A clean PR passes both lanes
- **WHEN** a pull request passes every gate locally
- **THEN** both the fast lane and the emulator lane complete successfully in CI

### Requirement: The emulator lane provisions Java 21 and builds functions first
The emulator lane SHALL set up JDK 21 (the Firebase emulator requirement) and build the Cloud
Functions before starting the emulator, encoding the known "stale `functions/lib`" footgun so CI cannot
hit it. The emulator lane SHALL run keyless using the repository's emulator-safe defaults (no
production secrets required).

#### Scenario: Functions are built before the emulator starts
- **WHEN** the emulator lane runs
- **THEN** `functions` is compiled before `e2e` / `test:rules` invoke the emulator

#### Scenario: The emulator lane needs no production secrets
- **WHEN** the emulator lane runs on a fork or a branch without repository secrets
- **THEN** `e2e` and `test:rules` still execute against the emulator with default config

### Requirement: Strict i18n is enforced on UI-touching PRs
On pull requests that change UI surfaces (`i18n.ts` or components), CI SHALL run
`i18n:check:strict` so that new UI introduces zero new hardcoded-string findings, matching the
repository's i18n rule. The non-strict `i18n:check` PART A dictionary gate SHALL run on all PRs.

#### Scenario: A UI PR with a new hardcoded string fails strict i18n
- **WHEN** a pull request adds a user-facing string that bypasses `t.*`
- **THEN** the `i18n:check:strict` step fails on that PR

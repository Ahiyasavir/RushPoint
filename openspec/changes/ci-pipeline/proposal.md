# Proposal — Continuous-integration pipeline (gates on every PR)

## Why

The project defines a **rigorous, mandatory gate set** in CLAUDE.md and `openspec/config.yaml` —
`typecheck`, `lint`, `test`, `creator:build`, `play:build`, `e2e`, `i18n:check`, `test:rules` — but
**nothing enforces it automatically**: there is **no `.github/workflows/` directory at all**. Every
gate is run by hand on a developer machine. That means a regression (a broken `play:build`, a
red e2e, an i18n parity error, a rules hole) can land on `main` whenever someone forgets a gate or
runs a subset. For a multi-tenant platform handling **real payments and live events**, "the gates are
documented but unenforced" is the single biggest process gap relative to a production SaaS.

This change adds a **GitHub Actions CI pipeline** that runs the exact same gates on every pull request
and on pushes to `main`, so the documented standard becomes the *enforced* standard. It writes no
product code — it codifies the existing "required gates" list into automation, including the parts that
need a Java 21 + Firebase emulator runner (`e2e`, `test:rules`).

## What Changes

> Process/infra only. No product behavior changes. The documented gates become enforced.

**P0 — the core CI workflow**
- A `.github/workflows/ci.yml` runs on `pull_request` and `push` to `main`. It installs the npm
  workspaces with a cached `npm ci`, then runs the **fast lane** as required checks:
  `typecheck` · `lint` · `test` · `creator:build` · `play:build` · `i18n:check`.
- Builds the Cloud Functions before any emulator step (the documented "stale `functions/lib`" footgun).

**P0 — the emulator lane (e2e + rules)**
- A job sets up **JDK 21** and the Firebase emulator suite, seeds, and runs `npm run e2e` and
  `npm run test:rules` against it — the same lifecycle a developer runs locally, now on every PR.
- Concurrency-cancels superseded runs; caches `~/.npm` and the Firebase emulator binaries.

**P1 — strict i18n on changed UI + status surfacing**
- The i18n job runs `i18n:check` (PART A hard gate) and, on PRs that touch UI, `i18n:check:strict`
  (zero new hardcoded strings), matching the repo rule.
- A branch-protection note (docs) describes marking these checks **required** so `main` can't merge red.

## Capabilities

### New Capabilities
- `continuous-integration`: every PR and every push to `main` runs the project's full documented gate
  set (fast lane + emulator lane) automatically, blocking merge on any failure.

### Modified Capabilities
<!-- None — codifies existing gates into automation; no runtime spec changes. -->

## Surfaces touched

- **CI (new):** `.github/workflows/ci.yml` (fast lane + emulator lane jobs). Optionally a small
  `.github/workflows/` README / `CONTRIBUTING.md` note on required checks + branch protection.
- **Possibly `package.json`:** add a convenience aggregate script (e.g. `npm run ci:fast`) **only if**
  it simplifies the workflow; prefer calling the existing scripts directly to avoid drift.
- **No application source, types, rules, or env changes.** The workflow runs against emulator defaults
  (the repo's client configs already bake in emulator-safe defaults; no secrets required for the
  emulator lane).

## Non-goals

- **No deployment / CD** — this is CI (verify), not continuous *deployment*. Shipping to Firebase
  Hosting/Functions is a separate change (and needs real project credentials/secrets).
- **No coverage gate / coverage upload** — pairs naturally with `callable-test-coverage` later, but is
  not added here.
- **No required-secrets in CI** — the emulator lane runs keyless (emulator-safe defaults). Anything
  needing real Stripe/MapTiler/Sentry keys is out of scope (those jobs would need repo secrets).
- **No matrix across Node versions** — the project targets Node 20; CI pins Node 20 to match.
- **No auto-formatting / auto-fix commits** — CI verifies; it does not mutate the PR.

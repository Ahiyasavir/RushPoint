# Contributing — CI gates & branch protection

RushPoint enforces its documented "Required gates" (see `CLAUDE.md`) automatically via
[`.github/workflows/ci.yml`](workflows/ci.yml). Every pull request and every push to `main`
runs the same gates a developer runs locally. **Do not merge a PR with a red gate.**

## What CI runs

Two parallel jobs:

| Job | Steps | Needs |
|---|---|---|
| **fast** | `npm ci` → `typecheck` → `lint` → `test` → `creator:build` → `play:build` → `i18n:check` → (`i18n:check:strict` *on UI PRs only*) | Node 20 |
| **emulator** | `npm ci` → build shared + functions → `e2e` → `test:rules` (each wrapped in `firebase emulators:exec`) | Node 20 + Java 21 + Firebase Emulator Suite |

The strict i18n step runs only when a PR touches `**/i18n.ts` or `**/components/**` (UI surfaces),
matching the repo rule that *new* UI must add zero new hardcoded strings.

## Required status checks (branch protection)

Configure these on `main` under **Settings → Branches → Branch protection rules** so `main`
cannot merge while a gate is red:

1. Enable **Require a pull request before merging**.
2. Enable **Require status checks to pass before merging** and mark these checks **required**:
   - `Fast gates (typecheck · lint · test · builds · i18n)`
   - `Emulator gates (e2e + rules)`
3. Enable **Require branches to be up to date before merging** (so a stale PR is re-tested
   against the latest `main` before it can merge).
4. (Recommended) Enable **Do not allow bypassing the above settings** so the rule applies to
   everyone, including admins.

> The strict i18n step is part of the **fast** job, so it is covered by marking that job
> required — there is no separate check to add for it.

## Notes

- The emulator job runs **keyless**: the repo's client configs bake in emulator-safe defaults,
  so no Stripe/MapTiler/Firebase secrets are required for `e2e` / `test:rules`.
- CI **verifies**; it never mutates the PR (no auto-format / auto-fix commits).
- Cloud Functions are built **before** the emulator starts (the stale `functions/lib` footgun).

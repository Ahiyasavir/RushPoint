# Proposal: run-summary-report

## Why

In a family playtest the creator finished a run and asked *"where does the player feedback
go?"* — nothing pulled the standings, completion stats, and the post-game feedback into one
place a creator would naturally look for after a run ends, and there was no path for that recap
to reach them by email. Today the pieces exist but are scattered across three separate finished-run
panels (`getRunRecap`, `getRunAnalytics`, `getRunFeedbackSummary`), and none of it leaves the app.

So this change (a) delivers an **in-app owner-facing run summary NOW** so nothing is lost, and
(b) wires a **real, single email seam** that sends the summary to the organizer the moment a mail
provider credential is present in `functions/.env`, and is a graceful, observable no-op otherwise
(no secret is ever hardcoded; no socket is opened without a key).

## What Changes

- **Pure composer (`composeRunSummary`)** — a dependency-free shared helper that assembles ONE
  `RunSummary` object (final standings + completion stats + feedback digest) from the outputs of the
  **existing** aggregators `buildRunRecap`, `computeRunAnalytics`, and `computeFeedbackSummary`. It
  recomputes nothing — it consumes their results, so scoring/ranking stays single-sourced.
- **New callable `getRunSummary`** (owner-only, resolved by access code, same gate as
  `getRunAnalytics`) — reads game/run/teams/feedback docs, runs the three existing aggregators, and
  returns `composeRunSummary(...)` for an in-app summary panel. As a NEW callable it ships with an
  e2e scenario (the callable-coverage guard fails a callable that is never invoked).
- **In-app Run Summary panel** in the creator RunConsole (finished runs) — a single consolidated
  recap (podium standings + completion headline + feedback digest) with a note that it will also be
  emailed to the creator once email is enabled. New EN + HE i18n keys.
- **Real email seam** — a single `sendRunSummaryEmail(summary, recipient)` function that composes the
  summary via the pure `formatRunSummaryEmail` and dispatches it through Resend's HTTP API with ONE
  `fetch` (no npm dependency, no SMTP socket). `RUN_SUMMARY_EMAIL_ENABLED` defaults **ON** (`!== 'false'`);
  a run only actually sends when a `RESEND_API_KEY` **and** a recipient are both present, otherwise it
  logs a `logBestEffort` breadcrumb and returns without opening a socket. It NEVER throws and NEVER
  hardcodes a secret. `finalizeRun` invokes it **best-effort AFTER the commit**, wrapped in try/catch,
  so a send (or its absence) can never affect finalize.

## Setup (to enable email delivery)

Entering an API key is the user's action (cannot be automated). Add to `functions/.env`:

```
RESEND_API_KEY=re_xxx                              # from resend.com (free tier); enables delivery
RUN_SUMMARY_EMAIL_TO=spendora.tracker@gmail.com    # optional — override recipient (else owner's users/{uid}.email)
RUN_SUMMARY_EMAIL_FROM=onboarding@resend.dev        # optional — sender (default onboarding@resend.dev sandbox)
RUN_SUMMARY_EMAIL_ENABLED=false                     # optional — set to hard-disable (default ON)
```

With no `RESEND_API_KEY` set (the emulator / e2e env), the send branch is never entered: the seam
logs a breadcrumb and returns, so no network socket is opened under test.

## Non-goals

- No change to scoring, ranking, recap, analytics, or feedback aggregation math — all reused.
- No change to `finalizeRun`'s transaction/commit; the seam call is strictly post-commit best-effort.
- No new participant-facing surface; the summary is organizer-only.

## Capabilities

### New Capabilities
- `run-summary-report`: after a run, the organizer can retrieve one consolidated summary object
  (standings + completion stats + feedback digest) in-app, and finalize best-effort hands that same
  summary to a single email seam that is a safe no-op until a provider is configured.

## Impact

- **Surfaces touched:** shared (`packages/shared/src/runSummary.ts` + index export), functions
  (`runs/index.ts` new `getRunSummary` callable + a post-commit seam call in `finalizeRun`;
  `runs/runSummaryEmail.ts` new seam + flag; `index.ts` re-export), creator-web
  (`services/calls.ts` wrapper, `pages/RunConsolePage.tsx` panel, `i18n.ts` EN+HE keys).
- **Callables affected:** one new (`getRunSummary`); `finalizeRun` gains a best-effort post-commit
  seam call (return shape unchanged).
- **Tests:** pure-logic (`scripts/test-run-summary.ts`) for `composeRunSummary`; an e2e scenario that
  finalizes a run and asserts `getRunSummary` returns standings + completion + feedback digest and is
  organizer-only (keeps the callable-coverage guard green).

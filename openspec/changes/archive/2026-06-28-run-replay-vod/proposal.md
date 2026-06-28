# Proposal — Run replay / VOD

## Why

After an event, organizers and participants want to relive it — and a rich, shareable replay is both
a keepsake and a paid upsell. A **run replay** reconstructs the whole event as a timeline: every
team's path, task completions, photos, and score progression, rendered as a scrollable page (and an
exportable summary). It is the natural premium artifact of a finished run.

## What Changes

> Observable behavior. A new owner-only replay aggregate + a replay page; optionally a paid unlock.

- A new **`getRunReplay`** callable returns the full timeline of a finished run: a chronologically
  ordered event stream (team started, task completed, photo submitted, score milestone, finish) plus
  per-team summaries. Owner-only; PII-retention-aware.
- A **replay page** renders the timeline with a scrubber, per-team filtering, the photo gallery, and
  the score-over-time chart.
- The replay can be **unlocked as a paid artifact** (credit/Pro) and shared via a link; the export is
  a print-friendly page (PDF via the browser print path — no server rendering).

## Capabilities

### New Capabilities
- `run-replay`: a `getRunReplay` timeline aggregate of a finished run and a scrollable replay page
  with a scrubber, photo gallery, and score-over-time chart.

### Modified Capabilities
<!-- None -->

## Surfaces touched

- **Callable:** new `getRunReplay(runId)` in `functions/src/runs/index.ts` (owner-only, finished run)
  + re-export + wrapper.
- **shared:** `buildRunTimeline(teams, run)` pure aggregator (events sorted by time; score series);
  `RunReplay` types — the TDD lever.
- **creator-web:** a Replay page in the RunConsole (timeline + scrubber + gallery + chart).
- **Tests:** `scripts/test-run-replay.ts` (timeline ordering + score series); e2e for the callable.

## Non-goals

- No server-side video rendering — the replay is an interactive page; export uses browser print.
- No real-time replay during a live run (finished runs only).
- No team-level PII beyond what survives the 90-day prune (pruned runs show aggregates only).

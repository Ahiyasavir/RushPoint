## Why

`functions/src/runs/index.ts` has grown to **2,972 lines** and now mixes roughly eight
unrelated domains in one file — run lifecycle (launch/join/start/finalize), task
completion + routing, leaderboard/recap/analytics, hot zones + capture zones + discovery
POIs, trackables, run feedback + surveys, and multi-device/controller management. It is a
realized god-file: navigating it, reviewing a diff against it, and reasoning about which
callables share state are all harder than they should be, and the single-file blast radius
makes every change to it riskier than the change itself warrants.

Two concrete correctness hazards live inside that sprawl:

- The **stage-completion block** (required-task-count check → auto-skip the leftover tasks →
  final-stage detection → scheduled-release unlock of the next stage) is **copy-pasted
  verbatim** in two places: inside `completeTaskForTeam` (the hot completion path) and inside
  `sweepExpiredInFlight` — whose own comment literally reads *"Stage completion — mirror of
  completeTaskForTeam's stageDone block."* A third, partial variant of the same unlock logic
  lives in `computeStageUnlock`. Three hand-kept copies of a subtle rule is a drift-waiting-
  to-happen defect, not a cosmetic one: a fix applied to one copy silently leaves the others
  wrong.
- `requireAuth` — the one-line "reject unauthenticated calls" guard — is **defined five
  separate times** with identical bodies (`functions/src/index.ts`,
  `functions/src/runs/index.ts`, `functions/src/payments/index.ts`,
  `functions/src/games/index.ts`, `functions/src/users/index.ts`). This change consolidates
  at least the three called out by review (index, runs, payments) — and, since the bodies are
  byte-identical, the other two as well — behind one shared helper.

This is a **behavior-preserving refactor**: no callable's inputs, outputs, side effects,
authz, or scoring change. The goal is purely to split the god-file into focused modules, kill
the duplicated stage-completion logic, and give auth one home.

## What Changes

- **Split `functions/src/runs/index.ts` into focused modules** under `functions/src/runs/`
  (`lifecycle.ts`, `tasks.ts`, `leaderboard.ts`, `zones.ts`, `trackables.ts`, `feedback.ts`,
  `devices.ts`, plus a small internal `helpers.ts`), extending the modular pattern already
  present in that directory (`sanitizeTask.ts`, `teamDevices.ts`, `feedbackSummary.ts`,
  `leaderboardThrottle.ts`). `functions/src/runs/index.ts` becomes a **thin barrel** that
  re-exports every callable and every internal helper the rest of the codebase already imports
  from it — so `functions/src/index.ts`'s import list and the property test's
  `import { buildRankings } from '../runs/index'` keep working unchanged.
- **Extract the duplicated stage-completion block into one shared helper**
  (`applyStageCompletion(...)` in `functions/src/runs/helpers.ts`), and rewrite both the
  `completeTaskForTeam` copy and the `sweepExpiredInFlight` copy to call it, so the two (three,
  counting the partial unlock) can no longer drift.
- **Consolidate `requireAuth` into one shared helper** (`functions/src/auth.ts`) imported by
  `functions/src/index.ts`, `functions/src/runs/*`, `functions/src/payments/index.ts` (and the
  identical `games`/`users` copies), removing the duplicate definitions.
- **No callables added, removed, renamed, or resignatured. No Firestore schema, rules, or
  index changes. No client-side changes.** The re-export surface of `functions/src/index.ts`
  is identical before and after — the callable-coverage guard in `npm run e2e` (66/66) stays
  at the same count.

## Capabilities

### New Capabilities
- `runs-module-structure`: a maintainability contract that locks in the post-refactor
  invariants — single-source stage-completion logic, a single shared auth helper, and the
  barrel-export contract that keeps the public callable surface stable.

### Modified Capabilities
(none — no observable runtime behavior changes; this is a structural refactor. Existing
capability specs such as `hot-zone-bonus`, scheduled-release, task-expiry, and the run
lifecycle continue to describe the unchanged behavior.)

## Impact

- **Surfaces touched: backend only** (`functions/`). No shared types, no creator-web, no
  play-web, no `firestore.rules`, no new env var.
- `functions/src/runs/index.ts` (2,972 lines) → thin barrel re-exporting the new modules.
- New files: `functions/src/runs/lifecycle.ts`, `tasks.ts`, `leaderboard.ts`, `zones.ts`,
  `trackables.ts`, `feedback.ts`, `devices.ts`, `helpers.ts`, and
  `functions/src/auth.ts`, plus a co-located unit test
  `functions/src/runs/helpers.test.ts` for the extracted stage-completion helper.
- `functions/src/index.ts`, `functions/src/payments/index.ts`,
  `functions/src/games/index.ts`, `functions/src/users/index.ts` — each loses its local
  `requireAuth` definition and imports the shared one from `functions/src/auth.ts`.
- No callable wrapper (`services/calls.ts`) work — no callable signatures change.

## Non-goals

- **No behavior change of any kind.** Scoring, routing math, authz decisions, rate limits,
  error codes/messages, and Firestore writes are all preserved exactly. The existing
  `npm run e2e` lifecycle + invariant suite and `npm test` are the proof of this and must stay
  green with **zero modifications**.
- **Not fixing the `sweepExpiredInFlight` / `completeTaskForTeam` slot-release divergence.**
  The sweep path today does not release station slots for auto-skipped assigned tasks the way
  the completion path does; the extracted helper preserves each caller's current behavior
  exactly. Whether the sweep *should* release those slots is a separate behavioral question
  captured in Open Questions, not decided here.
- **No consolidation of `assertAdmin` / `assertStaffOrOwner`** or other larger auth helpers —
  only the trivially-identical `requireAuth` is unified in this pass.
- **No re-architecture of routing, scoring, or the transaction model.** Functions move file to
  file; their bodies are unchanged except for the two mechanical call-site edits (stage-
  completion extraction, requireAuth import).
- **No public API / callable surface change.** `completeTaskForTeam` and the routing helpers
  stay internal (never re-exported as Cloud Function triggers), exactly as today.

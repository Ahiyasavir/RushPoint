# Post-Game Feedback — proposal

## Why

The creator is about to run real playtests and has zero structured signal from players: no way to
learn what was fun, what broke, whether the content landed, or whether the game actually bonded
the group — except chasing people on WhatsApp. The finish screen already holds players at their
happiest, most captive moment (trophy + "waiting for the host to finalize"), and today that moment
is wasted. A delightful 30-second survey there, rolled up into a per-run summary for the creator,
turns every playtest into a feedback engine.

## What Changes

- **Playful post-game survey on the participant finish screen** — one question at a time, big
  emoji/chip taps that auto-advance (no forms, no typing until the last step), a progress strip,
  fully skippable. Dimensions: overall experience, content interest, team bonding, difficulty
  fit, how smoothly it ran (with "what went wrong" chips when it didn't), would-recommend, and one
  optional free-text box for suggestions/bugs. Appears from the moment the team finishes —
  including the "waiting for the host to finalize" dead time. Full HE/EN.
- **Per-player, not per-team** — every attached phone (shared-team-devices) submits its own
  response, so a team of five yields up to five samples. One response per player, server-enforced.
- **New callables**: `submitRunFeedback` (participant; validated, rate-limited, duplicate-proof,
  server-write to a run-scoped `feedback` collection) and `getRunFeedbackSummary` (owner-only;
  returns computed aggregates + every individual response for drill-down).
- **Creator feedback panel in the Run Console** — loads automatically once the run is finished:
  response rate, average score per dimension, recommend distribution, "what went wrong" issue
  counts, and the full list of free-text comments with each respondent's team/name — click any
  row for the complete individual response.
- **Firestore rules**: the new `feedback` subcollection is owner-read-only, client-writes denied
  (standard CF-only pattern).

**Not BREAKING** — additive only; runs without responses just show an empty state.

## Non-goals

- No email/push notification to the creator (no notification infra exists; the summary lives in
  the Run Console which the creator is already watching at game end).
- No mid-game feedback, no in-task ratings, no support chat.
- No cross-run/cross-game feedback analytics (per-run only, this change).
- No CSV export (drill-down on screen only; export is a cheap follow-up if needed).
- No editing/updating a submitted response (one shot; duplicates rejected).
- No survey builder — the questions are a fixed, curated set (creator-configurable surveys are a
  possible v2).

## Surfaces touched

Shared types + a pure aggregation module (`@rushpoint/shared` types, `functions/src/runs/`) ·
2 new callables in `functions/runs` (typed wrappers + e2e coverage) · `firestore.rules` ·
play-web (FinalScreen + new `PostGameSurvey` component, `services/calls.ts`, `i18n.ts`) ·
creator-web (RunConsolePage feedback panel, `services/calls.ts`, `i18n.ts`) · rate-limit budget.

## Capabilities

### New Capabilities
- `post-game-feedback`: the participant survey (content, UX contract, submission rules,
  per-player-once enforcement), the run-scoped feedback store, the owner-only aggregation
  callable, and the creator's summary + drill-down panel.

### Modified Capabilities

<!-- none — existing requirements unchanged. New UI complies with finalscreen-i18n and
     ui-text-standards as written; run-analytics stays a separate, untouched panel. -->

## Impact

- `packages/shared/src/types/index.ts` — `RunFeedback` doc type + `FIRESTORE_PATHS.feedback*`.
- `packages/shared/src/rateLimit.ts` — budgets for the 2 new callables.
- `functions/src/runs/feedbackSummary.ts` (new, pure) — validation + aggregation logic (vitest).
- `functions/src/runs/index.ts` — `submitRunFeedback`, `getRunFeedbackSummary`; re-exports in
  `functions/src/index.ts`.
- `firestore.rules` — `feedback/{docId}` match block.
- `apps/play-web` — `components/PostGameSurvey.tsx` (new), `screens/FinalScreen.tsx` (mount),
  `services/calls.ts`, `i18n.ts` (HE+EN `final.survey*`).
- `apps/creator-web` — `pages/RunConsolePage.tsx` (FeedbackPanel), `services/calls.ts`,
  `i18n.ts` (HE+EN `runConsole.feedback*`).
- `scripts/e2e-verify.mjs` — a new `scenario('post-game feedback', …)` block.

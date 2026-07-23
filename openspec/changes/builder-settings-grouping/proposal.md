# Proposal — builder-settings-grouping

## Why

The Builder's Settings tab (`StepDetails`, `BuilderPage.tsx:639`) is disciplined almost everywhere:
Instructions, Presentation, Webhook, Safe zone, Scoring and Registration are all collapsed
`Advanced` sections (`:664-670,708-744`). But wedged between them sit **four raw checkbox toggles,
each with one or two help paragraphs, always expanded**:

- Instant play (`allowInstantPlay`, `:672-677`)
- Live photo feed plus a responsibility line (`photoFeedEnabled`, `:680-687`)
- Power ups (`powerUpsEnabled`, `:689-695`)
- Manual leaderboard reveal (`manualLeaderboardReveal`, `:701-706`)

That is roughly seven lines of explanatory prose and four controls stacked flat in the middle of the
panel: the single densest, least scannable region of the Builder's settings, and inconsistent with
the collapse pattern used directly above and below it.

The panel also mixes disclosure tiers in a way a creator cannot predict: Mode and Short description
are flat (correct, they are first order), but Tags is flat while Instructions right below it is
collapsed. There is no clear rule for what is always visible and what folds away.

## What Changes

**One collapsed "Game features" section replaces the four flat toggles, and the disclosure tiers are
normalized into a predictable two tier layout.** This is presentation only.

- The four game feature toggles move, unchanged, into a single collapsed `Advanced` section titled
  "Game features" (reusing the existing `Advanced` primitive at `components/ui.tsx:202`). Its `meta`
  slot carries an "N on" badge so an enabled feature is still visible at rest without expanding.
- A new pure helper, `apps/creator-web/src/lib/gameFeatureToggles.ts`, decides how many of the four
  features are on for the badge, honoring each toggle's real default (photo feed counts as on when
  absent; the other three count as off when absent), so the badge cannot drift from the actual run
  behavior.
- Tags folds into the collapsed set alongside the other sections. Mode and Short description stay
  flat as the panel's "Essentials". The result reads as: Essentials always visible, then a tidy
  stack of consistently collapsed, labelled sections.

## What does not change

- **Every one of the four feature switches stays reachable and settable.** `allowInstantPlay`,
  `photoFeedEnabled`, `powerUpsEnabled` and `manualLeaderboardReveal` each still toggle real run
  behavior; each is one click on a labelled section header away, and the "N on" badge shows how many
  are enabled without expanding.
- **No change to what saves.** All four fields already persist via `BUILDER_EDITABLE_FIELDS`
  (`lib/savePayload.ts:50,52,54,57`); this change does not touch `savePayload.ts` or
  `BUILDER_EDITABLE_FIELDS`. The controls, their `checked`/`onChange` wiring, their defaults and
  their help copy are carried over verbatim.
- **No backend, no callable, no layout data.** `lib/runConsoleLayout.ts` is untouched.

## Impact

- Affected specs: `builder-settings` (new)
- Affected code: `apps/creator-web/src/pages/BuilderPage.tsx` (reflow `StepDetails`),
  `apps/creator-web/src/lib/gameFeatureToggles.ts` (new pure helper),
  `apps/creator-web/src/i18n.ts` (additive: one "Game features" section title key plus an
  "N on" badge label, HE and EN), `scripts/test-game-feature-toggles.ts` (new)
- Surfaces touched: **creator-web only**. No shared types, no callable, no rules, no savePayload.

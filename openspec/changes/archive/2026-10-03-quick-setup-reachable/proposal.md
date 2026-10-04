## Why

A creator who builds a game on a phone with "compose one for me" at prep level 2 or
higher cannot reach Quick Setup at all, and is then left with a readiness list that
names the same missing pin six times. Both were measured on 2026-10-02 at 375x812
(docs/auto-build-setup-research-2026-10-02.md §1.1-1.2), not inferred.

The root cause of the first is a one-line interaction between two effects in
`BuilderPage`. The landing from the new-game wizard deliberately DEFERS the Quick
Setup invitation to the next visit, and writes nothing so the offer stays intact.
But the persist effect then writes the untouched `idle` state to `localStorage` on
that same first mount, and the load effect reads ANY stored record as "the creator
already decided". So the invitation is never offered on any later visit. On a desktop
the header pill still reaches the flow; on a phone the pill is not rendered and the
`⋯` menu has no entry, so the flow is unreachable.

## What Changes

- An untouched Quick Setup state (status `idle`, nothing deferred, no progress) is
  not a decision. It is neither persisted, nor read back as one. This also heals
  creators who already carry a stored `idle` record from before the fix.
- The Builder's phone `⋯` menu gains a "Quick Setup" entry whenever the game has
  setup steps, so the flow is reachable on a phone without relying on the
  auto-invite.
- The readiness list groups identical problems: one row "6 missions have no spot on
  the map" instead of six identical rows. Activating the row still opens the first
  offending mission.
- The reveal screen ("your game is ready") says honestly what is left before
  launch, in the same grouped words ("before launch: place 6 missions on the map").
- The new-game path cards and the questionnaire chips get accessible names.

## Capabilities

### New Capabilities

- `quick-setup-reachable`: Quick Setup stays reachable on every device, and the
  readiness surfaces speak in grouped problems rather than one row per mission.

### Modified Capabilities

None. The quick-setup-wizard behaviour this corrects was never specified as a
requirement in `openspec/specs`.

## Impact

- `apps/creator-web/src/lib/quickSetup.ts` — a pure `isQuickSetupDecision`.
- `apps/creator-web/src/lib/gameReadiness.ts` — a pure `groupReadinessIssues`.
- `apps/creator-web/src/pages/BuilderPage.tsx` — load/persist effects, phone menu
  entry, grouped readiness rows.
- `apps/creator-web/src/components/SmartBuildReveal.tsx`, `DashboardPage.tsx` — the
  "left before launch" line.
- `NewGameWizard.tsx`, the questionnaire chips — accessible names.
- i18n (HE + EN). No server change, no callable, no data migration.

## Why

RushPoint leans on color as the *only* signal in several high-traffic spots — active vs.
inactive map pins, leaderboard podium ranks, progress bars, error text — which excludes
color-blind players, and key controls lack aria-labels for screen readers. Accessible
gamification is both an ethics/reach issue and an emerging expectation for 2025-2026 apps.

## What Changes

- A persisted **colorblind-safe / high-contrast mode** toggle (play-web, localStorage,
  mirroring the language toggle; surfaced on the Join screen and creator Settings).
- When on, the highest-traffic status indicators add a **non-color cue** (icon / shape /
  text) so meaning survives without color: map pins (active gets a ring + label), the
  progress bar (checkmarks on done segments), podium rows (rank number always shown).
- An **aria pass** on the main play flow (Join / Play / Final) and key controls: map-mode
  toggle (`role="switch"` + `aria-checked`), map pins (`role`/`aria-label`), progress bar
  (`role="progressbar"` + values), quick-adjust and rank rows.

## Capabilities

### New Capabilities
- `accessibility-colorblind`: a persisted colorblind/high-contrast preference that adds
  non-color cues to status indicators, plus an aria/role/label pass on the core play flow.

## Non-goals
- Not a full WCAG-AA certification pass — targets the highest-traffic color-only signals and
  the primary flow, not every screen.
- No server/theme rework — the toggle is a client preference; no palette overhaul, just
  redundant cues + aria.

## Surfaces touched
- **play-web:** `store.ts` (load/save preference), `i18nContext.tsx` (expose `colorblind` +
  setter), `NavMap`, `components/ui.tsx` `Progress`, `FinalScreen`/`PublicLeaderboardScreen`
  podium, `MapModeToggle`, Join/Play/Final aria; new `t.*` keys.
- **creator-web:** a Settings toggle mirroring the preference (localStorage) + i18n.
- **Tests:** pure `a11yCues` helper test if any cue logic is extracted; otherwise
  preview-based verification + `npm run i18n:check`. No backend/shared-data change.

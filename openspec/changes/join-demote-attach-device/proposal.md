## Why

In team-mode, the participant registration step opens with a full-width **50/50 segmented control**
forcing a choice between "New team" (`joinModeCreate`) and "My team is already in"
(`joinModeAttach`) before the player does anything (`JoinScreen.tsx`, the segmented toggle driving
the `joinMode === 'attach'` branch). The overwhelming common case is **create** a fresh team;
**attach** only applies to a *second phone* joining a team that already registered
(shared-team-devices). First-timers are forced to parse and pick a path most of them will never
take. (Solo mode never shows this control — good.)

## What Changes

- Make **create the clear primary path**: the registration step opens directly on the create form
  (team name + members + registration fields), no up-front toggle.
- **Demote attach** to a small secondary text affordance (a link, reusing the existing
  `t.devices.joinModeAttach` copy) shown under the primary Join button: tapping it flips
  `joinMode` to `attach` and reveals the existing device-code attach form.
- From the attach form, a small secondary link (reusing `t.devices.joinModeCreate`) flips back to
  create, so the path is fully reversible.
- Remove the equal-weight segmented control.

## What does NOT change

- **The attach ability is fully preserved.** Same `joinMode` state, same attach form
  (`t.devices.attachExplain`, team-code + member-name inputs), same `attachAction`/`attachCta`,
  same callable. It is reached one tap later via a demoted link instead of a co-equal tab —
  nothing is removed and nothing becomes unreachable.
- **The create form is unchanged** (team-name card, member list, registration fields, `submitAction`,
  `joinCta`).
- **Solo mode is unchanged** (it never rendered the toggle).
- No backend change, no new callable.

## Impact

- `apps/play-web` — `src/screens/JoinScreen.tsx` (replace the segmented control with default-create
  + demoted attach link; add a back-to-create link on the attach form). `src/i18n.ts` — reuses
  existing `devices.joinModeCreate` / `devices.joinModeAttach`; at most one small new link-prompt
  key if the design wants a distinct affordance sentence.
- **Not touched:** `functions/`, `packages/shared`, `apps/creator-web`.

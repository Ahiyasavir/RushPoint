## Why

The user's standing priority for waits: **"the loading after pressing something is very confusing
because nothing is not happenning basically... try making it more intresting and that you are
advancing and not staying in place"** and **"make it intresting in creative way, not only show
loading because its boring and not inviting."**

We already shipped exactly this treatment on the **participant** side — the `Working` component
(`apps/play-web/src/components/Working.tsx`) rotates 2-4 branded status lines over an advancing bar
during multi-second waits. The **creator** side never got it, and its single longest, most
anxious-feeling wait is **launching a run**: the creator presses "Launch run", then a network
round-trip saves the game and calls `launchRun` (create run + mint access code + open the gates).
Today **nothing changes on screen** during that wait — the two launch call sites do not even set a
`loading` flag on the button (`saveAndLaunch` in `BuilderPage.tsx`, `launch` in `DashboardPage.tsx`
both `await launchRun(...)` with no pending UI). The creator stares at an unchanged screen and
wonders whether the click registered — the precise "nothing is happening" complaint.

## What Changes

- Add a creator-side **launch "liftoff"** progress treatment: while a launch is in flight, show an
  engaging, visibly **advancing** multi-step indicator that reads as forward motion toward a live
  run, instead of an unchanged screen (or a bare spinner).
- A short sequence of rotating, pre-translated status lines ("preparing your run" → "creating the
  join code" → "opening the gates") over a bar that reads as motion, in the creator's **dark**
  theme and RushPoint's voice.
- **Honest about being indeterminate.** `launchRun` is one round-trip; the steps are *reassurance*,
  not real telemetry, and the design says so plainly. The bar is an indeterminate sweep (or a
  static fill under reduced motion), never a fake precise percentage.
- **Reduced motion degrades** to a single static label + static bar fill, mirroring how the
  play-web `Working` component handles `prefers-reduced-motion`.
- Wire it into **both** launch call sites (Builder header launch + test-run; Dashboard launch) so
  the two can't drift.

## What does NOT change

- **No backend, no callable change.** `launchRun` and its wrapper (`services/calls.ts`) are
  untouched; this is purely creator-web presentation while the existing promise is in flight.
- **No new dependency, no bundle regression.** CSS-only animation, reusing `ui.tsx` primitives.
- The participant-side `Working` component is **not** imported into creator-web (separate app,
  light theme). Creator-web gets its own small dark-theme component + pure rotation helper.
- Scope is the **launch-run wait only** — no other creator wait (save, publish, purchase) is in
  scope here.

## Impact

- `apps/creator-web` — new `src/components/LaunchLiftoff.tsx`, new pure `src/lib/launchLiftoff.ts`,
  a rotation keyframe in `src/index.css`, a new `launch` i18n namespace (HE+EN) in `src/i18n.ts`,
  and the `launching` state wiring in `src/pages/BuilderPage.tsx` + `src/pages/DashboardPage.tsx`.
- `scripts/test-launch-liftoff.ts` — new auto-discovered pure-logic test for the rotation helper.
- **Not touched:** `functions/`, `packages/shared`, `apps/play-web`, `services/calls.ts`.

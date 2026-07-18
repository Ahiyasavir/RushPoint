# Tasks: fix-play-screen-hierarchy

## 1. Reorder the active racing return (PlayScreen.tsx)

- [ ] Move the `activeStage &&` NavMap `<Suspense>` block and the task block
      (`TaskRunner` + `LockedTasksList`, plus the `StageDropCountdown` / `noActiveStage` fallbacks) so
      they render immediately **after** the share-progress button and **before** `LiveOps`. Change the
      task block's outer `flex-1` to a non-growing container so it no longer stretches to fill the page.
- [ ] Wrap `LiveOps`, `FeedSection`, `ChatSection`, `TrackablesPanel`, `ZonesPanel`,
      `TeamDevicesPanel`, and the non-controller viewing banner in a single secondary region:
      `<div className="mt-4 max-h-[60vh] overflow-y-auto -mx-1 px-1">…</div>`. Preserve every existing
      conditional (`photoFeedEnabled`, `hasTeammateDevices`, `!isController`) and every prop exactly.
- [ ] Leave `ReconnectingPill`, `StoryInterstitial`, `PowerUpToast`, `Header`, the test-drive banner,
      `Progress`, `InRunAlerts`, the streak chip, the share button, and the trailing SOS button
      untouched (no conflict with `fix-play-offline-continuity`'s pill).

## 2. Enlarge the primary task text (TaskRunner.tsx)

- [ ] Task title: `text-xl font-bold` → `text-2xl font-bold`.
- [ ] Task description: `text-zinc-400 text-sm` → `text-zinc-300 text-base leading-relaxed`
      (reversed zinc scale = darker/higher-contrast on the light theme).
- [ ] `smart.longInstructions`: `text-zinc-400 text-sm` → `text-zinc-300 text-base`.
- [ ] Static Tailwind class strings only (no `text-${x}`); logical spacing classes only.

## 3. Verify (gates + preview)

- [ ] `npm run typecheck` green.
- [ ] `npm run lint` green (0 errors).
- [ ] `npm run creator:build` green.
- [ ] `npm run play:build` green (don't let a play-web break slip through).
- [ ] `npm run i18n:check` clean (PART A hard gate; zero new PART B findings — no strings added).
- [ ] Preview verification (running launched team): task card is top-most + legible, secondary
      panels are below and scroll within their own region, the main screen does not scroll to reach
      the task, and the ReconnectingPill overlay still renders on top. Capture a screenshot.

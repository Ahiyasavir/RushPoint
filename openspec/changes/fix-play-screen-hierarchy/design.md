# Design: fix-play-screen-hierarchy

## Files touched

- `apps/play-web/src/screens/PlayScreen.tsx` — reorder the active (`team.launched`) return so the
  primary task block is top-most and the secondary panels move into a bounded scroll region below it.
- `apps/play-web/src/components/TaskRunner.tsx` — enlarge the task title + description for legibility.

No new component files, no new i18n keys, no backend or type change.

## Current active-return order (anchor: PlayScreen.tsx return at ~line 375)

```
375  <Screen>
377    <ReconnectingPill .../>          ← fixed overlay (fix-play-offline-continuity) — DO NOT MOVE
378    <StoryInterstitial .../>         ← fixed overlay modal — leave as-is
379    <PowerUpToast .../>              ← fixed overlay — leave as-is
380    <Header .../>                    ← keep at top
382    {test-drive banner}              ← keep near top
387    <Progress .../>                  ← keep near top
388    <InRunAlerts .../>               ← safety (hot zone / OOB) — keep near top
389    {streak chip}                    ← keep near top (compact)
397    {share progress button}         ← keep near top (compact)
402    <LiveOps .../>                   ← SECONDARY — move down
404    <FeedSection .../>               ← SECONDARY — move down
408    <ChatSection .../>               ← SECONDARY — move down
410    <TrackablesPanel .../>           ← SECONDARY — move down
412    <ZonesPanel .../>                ← SECONDARY (territory capture) — move down
414    <TeamDevicesPanel .../>          ← SECONDARY — move down
417    {viewing banner}                 ← keep (role hint) — move with devices region
423    <NavMap .../>                    ← PRIMARY context — move UP with the task
429    <TaskRunner/> + <LockedTasksList/> ← PRIMARY TASK — move UP to the top
442    <SOS button/>                    ← keep last (safety action)
```

## Target active-return order

```
<Screen>
  <ReconnectingPill/>            (unchanged fixed overlay)
  <StoryInterstitial/>          (unchanged fixed overlay)
  <PowerUpToast/>               (unchanged fixed overlay)
  <Header/>
  {test-drive banner}
  <Progress/>
  <InRunAlerts/>                (safety stays high)
  {streak chip}
  {share progress button}

  ── PRIMARY (top, prominent) ──
  <NavMap/>                     (map for the active stage — the task's spatial context)
  <TaskRunner/> + <LockedTasksList/>   (the task card — first thing the player reads/acts on)

  ── SECONDARY (below, self-scrolling) ──
  <div class="mt-4 space-y-0 max-h-[60vh] overflow-y-auto -mx-1 px-1">
    {!isController && viewing banner}
    <LiveOps/>
    {photoFeed && <FeedSection/>}
    <ChatSection/>
    <TrackablesPanel/>
    <ZonesPanel/>
    {teammate devices && <TeamDevicesPanel/>}
  </div>

  <SOS button/>                 (unchanged, last)
```

### Why this order fixes each complaint
- **Complaint 2 (buried/small):** the task card is now the first substantial block after the
  compact header row, and its type is enlarged (below), so it reads as the focal point.
- **Complaint 3 (inverted priority):** territory capture, trackables, feed, and chat now sit
  strictly *below* the task, in a visibly secondary region.
- **Complaint 1 (scroll):** the secondary panels — the bulk of the vertical content — live inside a
  `max-h-[60vh] overflow-y-auto` region, so they scroll *within themselves* rather than pushing the
  page. The header, map, and task stay put; the player never has to scroll the page to reach the
  task. The `-mx-1 px-1` keeps panel focus rings from clipping against the scroll edge.

## Concrete JSX moves (PlayScreen.tsx)

1. **Cut** the `activeStage &&` NavMap `<Suspense>` block (lines ~423-427) and the
   `<div className="flex-1">…TaskRunner…LockedTasksList…StageDropCountdown…noActiveStage…</div>`
   block (lines ~429-440), and **paste** them immediately **after** the share-progress button
   (currently line ~400), before `LiveOps`.
   - Change the task container from `flex-1` to a plain `<div>` (or `mb-4`). `flex-1` was what let
     the task stretch to fill leftover space at the bottom; now that it is near the top, it must not
     greedily expand and push the secondary region off-screen. The secondary region owns the
     remaining space instead.
2. **Wrap** the six secondary panels (LiveOps, FeedSection, ChatSection, TrackablesPanel, ZonesPanel,
   TeamDevicesPanel) plus the non-controller viewing banner in a single secondary container:
   ```tsx
   <div className="mt-4 max-h-[60vh] overflow-y-auto -mx-1 px-1">
     {!isController && (
       <div dir="auto" className="mb-3 rounded-lg bg-app-raised border border-glass-border px-3 py-2 text-sm text-zinc-400 flex items-center gap-2">
         👀 {t.devices.viewingBanner({ name: controllerName })}
       </div>
     )}
     <LiveOps ctx={session} leaderboard={state.run.leaderboard} myTeamId={team.id} lang={lang} timeOnly={game.scoringPreset === 'time_only'} />
     {state.game.photoFeedEnabled !== false && myUid && <FeedSection ctx={session} myUid={myUid} />}
     <ChatSection ctx={session} teamId={team.id} />
     <TrackablesPanel ctx={session} myTeamId={team.id} isController={isController} />
     <ZonesPanel ctx={session} myTeamId={team.id} isController={isController} me={me} />
     {hasTeammateDevices && myUid && (
       <TeamDevicesPanel team={team} myUid={myUid} ctx={session} onChanged={refresh} />
     )}
   </div>
   ```
   The `viewing banner` moves inside this region (it is a role hint, secondary). Nothing is removed;
   the conditionals (`photoFeedEnabled`, `hasTeammateDevices`, `!isController`) are preserved exactly.
3. Leave `ReconnectingPill`, `StoryInterstitial`, `PowerUpToast`, `Header`, test-drive banner,
   `Progress`, `InRunAlerts`, streak chip, share button, and the trailing SOS button untouched in
   place. All `fixed` overlays are position-independent, so moving in-flow siblings cannot disturb
   `fix-play-offline-continuity`'s pill.

## Typography changes (TaskRunner.tsx, the task Card at ~line 336)

- Title (line 338): `text-xl font-bold` → `text-2xl font-bold` (larger, unmistakably the headline).
- Description (line 339): `text-zinc-400 text-sm` → `text-zinc-300 text-base leading-relaxed`.
  - play-web **reverses the zinc scale** for the light "Warm Trail" theme, so `text-zinc-300` renders
    *darker* (more contrast) than `text-zinc-400`. Bumping the size to `text-base` and the weight of
    color makes the primary instruction legible for kids/parents at arm's length.
- `smart.longInstructions` (line 341) similarly `text-zinc-400 text-sm` → `text-zinc-300 text-base`
  so the long-form instructions match the description's legibility.
- All are static class strings (no `text-${x}`), satisfying the Tailwind rule.

## RTL / i18n

- All moved text already flows through `t.*` (`t.devices.viewingBanner`, panel titles inside their
  own components) — no string is hardcoded and no dictionary key is added or changed.
- The task card and panels already use `dir="auto"` for user-authored content; enlarging the font
  does not change directionality. No `ms-`/`me-` changes are required by the reorder, but any new
  spacing added uses logical classes (`mt-`, `mb-`, `-mx-`/`px-` are direction-neutral).
- Because `.tsx` files change, `npm run i18n:check` is a mandatory gate (PART A must stay clean; the
  change adds zero new PART B findings since it introduces no hardcoded strings).

## Test strategy

UI-only; verified via the preview tools per CLAUDE.md (no component test runner in play-web):
1. Boot the stack, join and launch a team into an active stage with at least one secondary panel
   populated (e.g. a run with a capture zone or trackable).
2. Confirm the **task card is the first substantial block** below the compact header row, with the
   enlarged/legible title + description, and the map directly above it.
3. Confirm **territory capture, trackables, feed, and chat render below** the task, inside a region
   that scrolls independently (scrolling it does not move the header/task).
4. Confirm the **main screen does not need scrolling to reach the task** at a typical phone height,
   and that the ReconnectingPill overlay still appears on top (offline continuity intact).
5. Confirm read-only (viewer) role still shows the viewing banner (now in the secondary region) and
   the task card read-only.

## Gates

`npm run typecheck` · `npm run lint` · `npm run creator:build` · `npm run play:build` ·
`npm run i18n:check` (mandatory after UI change) — all green. Preview-screenshot verification as
above. (No `npm run e2e` needed: no callable/logic surface changes.)

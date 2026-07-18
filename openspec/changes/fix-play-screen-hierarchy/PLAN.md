# PLAN — fix-play-screen-hierarchy (implementation anchors)

Concrete, line-anchored edit plan for the implementer. Two files change. No i18n dictionary change,
no backend change. Line numbers are current-tree anchors (they will drift as you edit; match on the
surrounding JSX, not the number).

## File A — `apps/play-web/src/screens/PlayScreen.tsx` (active `team.launched` return, ~375-444)

### A1. Move the PRIMARY task block up (map + task)

Cut these two blocks:
- **NavMap** (~423-427):
  ```tsx
  {activeStage && (
    <Suspense fallback={<div className="h-52 mb-4 rounded-xl bg-app-card border border-glass-border animate-pulse" />}>
      <NavMap targets={targets} me={me} hotZone={state.run.hotZone} accent={accent} className="h-52 mb-4" />
    </Suspense>
  )}
  ```
- **Task block** (~429-440) — and change the outer `flex-1` to `mb-4` (must not greedily grow now
  that it sits near the top):
  ```tsx
  <div className="mb-4">        {/* was: className="flex-1" */}
    {activeStage ? (
      <>
        <TaskRunner session={session} state={state} stage={activeStage} onChanged={refresh} readOnly={!isController} />
        <LockedTasksList stage={activeStage} state={state} />
      </>
    ) : state.nextStageReleaseAt && state.nextStageReleaseAt > Date.now() ? (
      <StageDropCountdown releaseAt={state.nextStageReleaseAt} onOpen={refresh} />
    ) : (
      <p className="text-center text-zinc-500 mt-10">{t.play.noActiveStage}</p>
    )}
  </div>
  ```

Paste both **immediately after the share-progress `<button>`** (~397-400) and **before** the
`<LiveOps …/>` line (~402). Order within the primary group: NavMap first, then the task block.

### A2. Wrap the SECONDARY panels in a bounded scroll region

Replace the run of siblings currently at ~402-421 (LiveOps, FeedSection, ChatSection, TrackablesPanel,
ZonesPanel, TeamDevicesPanel, and the `!isController` viewing banner) with a single wrapper. The
viewing banner (~417-421) moves **inside** this region:

```tsx
<div className="mt-4 max-h-[60vh] overflow-y-auto -mx-1 px-1">
  {!isController && (
    <div dir="auto" className="mb-3 rounded-lg bg-app-raised border border-glass-border px-3 py-2 text-sm text-zinc-400 flex items-center gap-2">
      👀 {t.devices.viewingBanner({ name: controllerName })}
    </div>
  )}
  <LiveOps ctx={session} leaderboard={state.run.leaderboard} myTeamId={team.id} lang={lang} timeOnly={game.scoringPreset === 'time_only'} />
  {state.game.photoFeedEnabled !== false && myUid && (
    <FeedSection ctx={session} myUid={myUid} />
  )}
  <ChatSection ctx={session} teamId={team.id} />
  <TrackablesPanel ctx={session} myTeamId={team.id} isController={isController} />
  <ZonesPanel ctx={session} myTeamId={team.id} isController={isController} me={me} />
  {hasTeammateDevices && myUid && (
    <TeamDevicesPanel team={team} myUid={myUid} ctx={session} onChanged={refresh} />
  )}
</div>
```

Preserve every conditional and prop exactly as above. Keep the trailing
`<Button variant="danger" className="mt-4" onClick={sos}>SOS</Button>` (~442) as the last child.

### A3. Leave untouched (top of the return, ~375-400)

`ReconnectingPill` (377), `StoryInterstitial` (378), `PowerUpToast` (379), `Header` (380-381),
test-drive banner (382-386), `Progress` (387), `InRunAlerts` (388), streak chip (389-396), share
button (397-400). The three fixed overlays are position-independent, so `fix-play-offline-continuity`
is unaffected.

### Resulting child order of `<Screen>`

ReconnectingPill · StoryInterstitial · PowerUpToast · Header · test-drive banner · Progress ·
InRunAlerts · streak chip · share button · **NavMap · task block** · **secondary scroll region** · SOS.

## File B — `apps/play-web/src/components/TaskRunner.tsx` (task Card, ~336-341)

Legibility bumps (static classes only):

| Line | Element | Before | After |
|---|---|---|---|
| ~338 | title `<h2>` | `text-xl font-bold mb-2` | `text-2xl font-bold mb-2` |
| ~339 | description `<p>` | `text-zinc-400 text-sm mb-3` | `text-zinc-300 text-base leading-relaxed mb-3` |
| ~341 | `smart.longInstructions` `<p>` | `text-zinc-400 text-sm mb-3` | `text-zinc-300 text-base mb-3` |

Reversed zinc scale (light theme) ⇒ `text-zinc-300` is darker/higher-contrast than `text-zinc-400`.
Both `<p>` keep `dir="auto"` for RTL user content. No behavior change.

## New i18n keys

**None.** No user-facing string is added or changed. All moved text already routes through `t.*`
(`t.devices.viewingBanner`, panel-internal titles). `npm run i18n:check` still runs (a `.tsx`
changed) and must stay clean: PART A hard-gate green, zero new PART B findings.

## Gate list (run after both edits)

1. `npm run typecheck` — green.
2. `npm run lint` — 0 errors.
3. `npm run creator:build` — green.
4. `npm run play:build` — green.
5. `npm run i18n:check` — clean (mandatory after any UI change).
6. **Preview screenshot** (launched team, active stage, a populated secondary panel): task card
   top-most + enlarged/legible, secondary panels below and scrolling within their own region, main
   screen reaches the task without page scroll, ReconnectingPill overlay still on top.

(No `npm run e2e` — no callable/logic surface changes.)

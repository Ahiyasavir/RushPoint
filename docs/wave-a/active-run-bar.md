# Wave A · Task 8 — persistent floating active-run control bar

## 1. SDD — spec

### Problem
A creator who launches a run and then navigates away (Dashboard, Gallery, Builder, Settings)
loses every quick control over that live run. Re-entering means remembering the game, going to
`/live`, and clicking through. Ending a run is even further away. During a real event this is
the single most time-critical surface, so it must follow the creator everywhere.

### Requirement
A persistent floating control bar, mounted app-wide (outside `<main>`, sibling of `DialogHost`
/`ToastHost`), shown **whenever the authenticated creator has at least one LIVE run**, offering:
- **Re-enter run** → navigates to `/run/:gameId/:runId` of the featured run.
- **End run** → confirmation dialog → `finalizeRun({gameId, runId})`, button busy while in flight.

### Behavioural spec (SHALL)

1. The bar SHALL render only when the creator is authenticated AND `listLiveRuns` returned ≥1 run.
2. The bar SHALL feature exactly one run: the most recently launched LIVE run (`launchedAt` desc,
   `null` sorts last, stable tie-break on `runId`). When >1 run is live it SHALL show a
   "+N more" affordance linking to `/live` instead of duplicating per-run controls.
3. The bar SHALL NOT render on the run console of the run it features (`/run/:gameId/:runId`) —
   the console already owns those controls — nor on `/live` (the overview lists them all).
4. On the Builder route (`/build/*`) the bar SHALL render in a **compact collapsed pill** anchored
   bottom-start, because the Builder is an `h-screen overflow-hidden` 3-pane workspace whose panels
   run to the viewport edge. Clicking the pill expands it to the full bar. This keeps the Builder's
   own chrome uncovered while still exposing the escape hatch.
5. Ending a run SHALL require an explicit confirmation (`dialog.confirm`, `danger`) naming the run
   title, SHALL show a busy state on the button until `finalizeRun` settles (that callable is being
   made non-blocking by a concurrent change, so the UI must not assume it is instant), SHALL toast
   success/failure, and SHALL immediately refresh the shared live-run list.
6. Polling SHALL be shared: **exactly one** `listLiveRuns` timer exists process-wide no matter how
   many components consume the hook (the bar + `RunsOverviewPage` are both mounted on `/live`).
7. Polling SHALL pause while `document.visibilityState === 'hidden'` and SHALL fire an immediate
   catch-up poll on becoming visible again. Polling SHALL stop when the last consumer unmounts.
8. Every string SHALL come from `t.liveRuns.*` in both the HE and EN dictionaries; layout SHALL use
   logical Tailwind utilities (`ms-/me-/start-/end-`) and static class strings only.

### Design
- `src/hooks/liveRunsPolling.ts` — **pure**, dependency-free module holding the policy decisions
  (poll interval, pause-when-hidden, run selection, bar visibility). Testable in the existing
  node-env vitest lane without pulling in React or Firebase.
- `src/hooks/useLiveRuns.ts` — a module-level singleton store (subscriber set + refcount + one
  `setInterval`) plus the `useLiveRuns()` React binding. First subscriber starts the loop, last one
  stops it; a `visibilitychange` listener pauses/resumes. Exposes `{ runs, errored, refresh }`.
- `src/components/ActiveRunBar.tsx` — presentational bar; consumes `useLiveRuns()` +
  `useLocation()` + `useNavigate()`, `dialog.confirm`, `finalizeRun`, `toast`.
- `src/App.tsx` — mounts `<ActiveRunBar />` next to `<DialogHost />`.
- `src/pages/RunsOverviewPage.tsx` — its private 10s loop is deleted and replaced by the same hook,
  so route + bar share one timer (requirement 6).

### Non-goals
Per-run controls beyond re-enter/end; any change to `functions/`; any new callable.

## 2. TDD plan

Lane: creator-web `vitest` (node env, `src/**/*.test.ts`) — the UI itself is verified through the
preview tools, so the *policy* is what gets unit-tested. RED first, then implement.

`src/hooks/__tests__/liveRunsPolling.test.ts`

| # | Test | Asserts spec |
|---|------|--------------|
| 1 | `pollIntervalMs` is 10s and `pollDelayFor({hidden:false})` returns it | 6 |
| 2 | `pollDelayFor({hidden:true})` returns `null` (paused) | 7 |
| 3 | `pollDelayFor({subscribers:0})` returns `null` | 6, 7 |
| 4 | `selectFeaturedRun([])` → `null`; single run → that run | 1, 2 |
| 5 | `selectFeaturedRun` picks the newest `launchedAt`, `null` launchedAt sorts last | 2 |
| 6 | `selectFeaturedRun` tie-breaks deterministically on `runId` | 2 |
| 7 | `shouldShowBar` false with no runs / not authed | 1 |
| 8 | `shouldShowBar` false on `/run/g1/r1` when featured run is `g1/r1`, true when it is a different run | 3 |
| 9 | `shouldShowBar` false on `/live` | 3 |
| 10 | `barMode('/build/x')` → `'compact'`, other routes → `'full'` | 4 |

Run with `npm test -w @rushpoint/creator-web` (aggregated by root `npm test` via turbo).
Manual verification (preview tools, owner runs the gates): launch a run → bar appears on Dashboard,
Gallery, Settings; compact pill in the Builder; absent on that run's console and on `/live`;
End run asks for confirmation, shows a spinner, then the bar disappears.

## 3. Implementation notes

- **No double polling**: `useLiveRuns` never owns a timer. The timer lives in one module-level
  store; `subscribe()` bumps a refcount and starts the interval on 0→1, `unsubscribe()` clears it on
  1→0. Both `ActiveRunBar` and `RunsOverviewPage` call `useLiveRuns()`, so `/live` (both mounted)
  still issues exactly one `listLiveRuns` per 10s window. A fresh subscriber gets the cached
  snapshot synchronously and only triggers a network fetch if the cache is stale (> one interval).
- **Cost control**: the loop is gated on `useAuth().user` (the store is only started by mounted
  consumers, which only exist inside the authed shell) and pauses entirely while the tab is hidden.
- **Builder**: compact collapsed pill at `bottom-4 start-4` (logical), `z-30` — below `ToastHost`
  (`z-40`) and `DialogHost` (`z-50`), and offset to `bottom-20` on small screens so it never sits
  under the mobile toast stack.

# Design — run-console-live-stream-resilience

## 1. Current code, audited (grounded, the tree moved)

- **Teams poll** — `RunConsolePage.tsx:159-169`:
  ```ts
  const loadTeams = useCallback(async () => {
    if (!gameId || !runId) return;
    const { teams } = await listRunTeams({ gameId, runId });
    setTeams(teams);
  }, [gameId, runId]);

  useEffect(() => {
    void loadTeams();
    const id = setInterval(() => void loadTeams(), 5000);
    return () => clearInterval(id);
  }, [loadTeams]);
  ```
  No try/catch. `teams` feeds: the teams table, `rankedScoreById` fallback (`:460-462`),
  `buildAttentionContext` / `classifyTeamAttention` / `attentionCount` (`:469-475`),
  `finishedTeamIds` (`:234`), `overduePhotoCount` (`:502-504`), the plan's `teamCount`/`attentionTeamCount`
  (`:510-524`) and the signal chips (`:546-562`). A rejection freezes all of it silently.

- **Alerts listener** — `:124-145`, error handler `() => undefined` at `:144`. On success it sets
  `alerts` and (past the first snapshot baseline) calls `playAlert()` on a new id.

- **The photo listener is the pattern to mirror** — `:215-230`: `const [photoLoadError, setPhotoLoadError]
  = useState(false)`, cleared at the top of the effect and on each good snapshot (`:218`, `:221`), set
  in the error arm with a `console.warn` (`:227-228`). `surveyError` (`:292-300`) is the same shape.

- **Audio** — `unlockAudio()` called only in `startAll` (`:356`) and `invite` (`:386`). The drop path
  is `lib/sound.ts:44-47`: `playAlert` calls `unlockAudio()` then `if (!ctx || ctx.state !== 'running')
  return;`. `unlockAudio` (`sound.ts:24-33`) is idempotent, wrapped in try/catch, and a no-op where
  Web Audio is missing.

## 2. Finding 1 — teams poll resilience + stale indicator

**State (additive):**
```ts
const [teamsStale, setTeamsStale] = useState(false);
const [lastTeamsSyncAt, setLastTeamsSyncAt] = useState<number | null>(null);
```

**`loadTeams` gains try/catch (cadence and data shape unchanged):**
```ts
const loadTeams = useCallback(async () => {
  if (!gameId || !runId) return;
  try {
    const { teams } = await listRunTeams({ gameId, runId });
    setTeams(teams);            // last-known replaced only on SUCCESS
    setLastTeamsSyncAt(Date.now());
    setTeamsStale(false);
  } catch (e) {
    console.warn('[RunConsole] teams poll failed', e);
    setTeamsStale(true);        // keep the last `teams` on screen, just mark it stale
  }
}, [gameId, runId]);
```
On failure `setTeams` is **not** called, so the last-known board stays. The 5s interval and
`void loadTeams()` invocation are unchanged.

**The stale verdict is a pure helper** so the "is the board stale" decision is unit-testable
(creator-web has no component test runner, CLAUDE.md):
```ts
// apps/creator-web/src/lib/streamFreshness.ts
export const TEAMS_POLL_INTERVAL_MS = 5000;
export const TEAMS_STALE_AFTER_MS = TEAMS_POLL_INTERVAL_MS * 2; // ~2 missed polls

/** True when the board should be shown as stale: an explicit error flag, OR the last good
 *  sync is older than the tolerance. Total: never synced yet (null) is NOT stale on its own
 *  (initial load owns that with its spinner); a non-finite/absent `now` is treated as fresh. */
export function isTeamsStale(
  lastSyncAt: number | null,
  now: number,
  hadError: boolean,
  staleAfterMs: number = TEAMS_STALE_AFTER_MS,
): boolean;

/** Whole seconds since the last good sync, clamped to >= 0; null when never synced. Total. */
export function secondsSinceSync(lastSyncAt: number | null, now: number): number | null;
```
Rules (encoded + tested): `hadError === true` ⇒ stale. Else stale iff `lastSyncAt` is a finite number
and `now - lastSyncAt > staleAfterMs`. `lastSyncAt === null` with `hadError === false` ⇒ NOT stale
(the initial spinner covers first load). Non-finite `now` or `lastSyncAt` ⇒ NOT stale (fail toward
"looks fine" is wrong here — but a non-finite clock cannot compute an age, and the `hadError` path
still catches a real failure, so the helper never throws and never renders a garbage age).
`secondsSinceSync` returns `null` for a null `lastSyncAt`, else `max(0, floor((now - lastSyncAt)/1000))`.

**Render:** a small line on the **teams panel header** (the existing panel, not a new one) shown when
`isTeamsStale(lastTeamsSyncAt, Date.now(), teamsStale)`:
> `t.runConsole.teamsReconnecting` + (age != null ? " · " + `t.runConsole.lastUpdatedAgo({ seconds })` : "")

Unobtrusive (small, muted, `role="status"` like the survey error at `:2737`). It does not gate or
disable anything; the board still renders its last-known rows underneath.

## 3. Finding 2 — alerts stream error surfaced

**State (additive):** `const [alertsStreamError, setAlertsStreamError] = useState(false);`

In the alerts effect (`:124-145`): clear the flag at the top and inside the success snapshot
(mirroring the photo listener), and set it in the error arm:
```ts
setAlertsStreamError(false);          // top of effect
return onSnapshot(ref, (snap) => {
  ...
  setAlertsStreamError(false);        // good snapshot
  setAlerts(rows);
}, (err) => {
  console.warn('[RunConsole] alerts listener error', err);
  setAlertsStreamError(true);
});
```

**Render:** the alerts panel only mounts when `alertCount > 0` (`buildRunConsolePlan`), so a dead
stream sitting at zero alerts would be invisible there. Surface the notice in the **pinned zone**
(always rendered) as a one-line `role="status"` warning:
> `t.runConsole.alertsStreamInterrupted`

This is a conditional child in the already-pinned region, not a new catalogued panel — the
`runConsoleLayout.ts` plan is unchanged (no new `PanelId`, no rail-section edit). Last-known alerts,
the audible cue and the title flash all keep working; this only adds the degraded-state signal.

## 4. Finding 3 — unlock audio on first console interaction

Add one effect near the top of the component:
```ts
useEffect(() => {
  const unlock = () => {
    unlockAudio();               // idempotent no-op if already running / unavailable
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  return () => {
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
}, []);
```
Any first gesture (a click anywhere, a keypress) now unlocks the context, so a creator who opens an
already-live run and never presses Start/Invite still gets the SOS cue. The existing `unlockAudio()`
calls in `startAll`/`invite` stay (they are idempotent). No visible UI, no i18n.

Optional (NOT specced as required): an explicit "enable sound" affordance in the pinned zone while the
context is still suspended. The invisible first-gesture unlock covers the reported failure with zero
new copy, so the required scope stops there.

## 5. Overlap note for the implementer (play-web finish-polish lane)

Finding 3 touches **`apps/creator-web/src/lib/sound.ts`** only by *calling* its already-exported,
already-idempotent `unlockAudio()` — no edit to that file is required. A separate in-flight lane
(`finish-moment-polish`) is editing **`apps/play-web/src/lib/sound.ts`** and `FinalScreen`, which is a
**different file** in a different app. There is no shared file. Still, before touching any `sound.ts`,
the implementer should re-read the creator-web copy (`apps/creator-web/src/lib/sound.ts`) to confirm
`unlockAudio` is still exported and idempotent, since the tree moves under this branch.

## 6. i18n keys (HE + EN, no em-dash, no en-dash, no spaced hyphen)

Two new `runConsole` (`rc.*`) keys, added to BOTH language maps in `apps/creator-web/src/i18n.ts`
(re-read immediately before editing; the file is contended):

| key | Hebrew | English |
|---|---|---|
| `teamsReconnecting` | `מתחבר מחדש, ייתכן שהנתונים אינם מעודכנים` | `Reconnecting, data may be out of date` |
| `lastUpdatedAgo` | `({ seconds }) => `עודכן לפני ${seconds} שניות`` | `({ seconds }) => `Updated ${seconds}s ago`` |
| `alertsStreamInterrupted` | `פיד ההתראות נקטע, מתחבר מחדש` | `Alerts feed interrupted, reconnecting` |

(Three entries: `lastUpdatedAgo` is a function key like the sibling `skipTaskDone` at `:688`.) Finding
3 adds **no** i18n. All copy uses commas, never a dash. HE stays Hebrew, EN stays English so
`i18n:check:strict` PART A passes; the strings are routed through `t.*` so PART B adds nothing.

## 7. Test strategy

**Lane: pure (unit).** `scripts/test-run-console-freshness.ts`, auto-discovered by
`scripts/run-unit-tests.mjs` (`npm test`). Assertions on `streamFreshness.ts`:

1. `isTeamsStale(t, t+1000, false)` is `false` (fresh, within tolerance).
2. `isTeamsStale(t, t + TEAMS_STALE_AFTER_MS + 1, false)` is `true` (aged out).
3. `isTeamsStale(anything, anything, true)` is `true` (explicit error wins).
4. `isTeamsStale(null, now, false)` is `false` (never synced, no error — spinner owns first load).
5. Non-finite `now` / `lastSyncAt` ⇒ `false` and no throw.
6. `secondsSinceSync(null, now)` is `null`; `secondsSinceSync(t, t+2600)` is `2`; a negative delta
   clamps to `0`; totality sweep (`NaN`, `Infinity`, non-numbers) never throws.
7. Wiring guard (source scan): `i18n.ts` defines `teamsReconnecting`, `lastUpdatedAgo` and
   `alertsStreamInterrupted` in BOTH language maps.

**Lane: UI (wiring, no component runner).** Findings 2 and 3 and the render wiring for finding 1 are
gated by `npm run typecheck`, `npm run lint`, `npm run creator:build`, `npm run play:build`,
`npm run i18n:check:strict` (clean, zero new PART B), plus a manual preview check:
- Teams panel shows the "reconnecting / updated N s ago" line when the poll fails, and the last-known
  rows stay on screen (do not blank).
- A dead alerts stream shows the pinned "alerts feed interrupted" notice even with zero active alerts.
- Opening an already-live run and clicking anywhere once, then raising an SOS, plays the audible cue.

**Lane: e2e.** Nothing owed. No callable added or changed, no `Task` field, `ALLOWED_TASK_KEYS`
untouched.

# Design — run-console-run-not-found

## Current state

`apps/creator-web/src/pages/RunConsolePage.tsx`:

- `:108` — `const [run, setRun] = useState<Run | null>(null);`
- `:133-137` — the run-doc listener:

  ```ts
  // Live run doc (owner can read directly)
  useEffect(() => {
    if (!gameId || !runId) return;
    const ref = doc(db, `users/${ownerUid}/games/${gameId}/runs/${runId}`);
    return onSnapshot(ref, (snap) => snap.exists() && setRun(snap.data() as Run));
  }, [gameId, runId, ownerUid]);
  ```

  Only sets state when the doc exists; **no `onError`**. `run` stays `null` on any non-resolving run.

- `:514` — `if (!run) return <Spinner label={t.runConsole.loadingRun} />;` — the unconditional guard
  that becomes a permanent spinner.

Reference idiom already in the codebase — `WalletPage.tsx:85-96` escapes a stuck spinner into a card:

```tsx
if (!status) {
  if (!statusErr) return <Spinner label={w.loading} />;
  return (
    <div className="max-w-2xl mx-auto animate-fade-up">
      <Card className="p-8 text-center">
        <div className="text-3xl mb-3">⚠️</div>
        <p className="text-sm text-[--ink-2] mb-4">{w.statusFailed}</p>
        <Button onClick={() => void loadStatus()}>{w.retry}</Button>
      </Card>
    </div>
  );
}
```

The run-console version differs in the action: **back to Runs**, not retry (see Non-goals).

## The fix

1. **Two state flags** next to `run` (`:108`):
   ```ts
   const [runNotFound, setRunNotFound] = useState(false);
   const [runLoadErr, setRunLoadErr] = useState(false);
   ```

2. **Run-doc listener** (`:136`) gains a not-found guard and an `onError`:
   ```ts
   return onSnapshot(
     ref,
     (snap) => {
       if (snap.exists()) { setRun(snap.data() as Run); setRunNotFound(false); setRunLoadErr(false); }
       else { setRunNotFound(true); }        // fires ONLY after a real snapshot => never pre-first-snapshot
     },
     (e) => { console.warn('[runConsole] run-doc listener failed:', e); setRunLoadErr(true); },
   );
   ```
   The `else` branch is the key guard from the finding: `notFound` is set only when a snapshot
   actually arrives reporting `!exists()`, so the normal "first snapshot has not landed yet" state
   (both flags `false`, `run` still `null`) is not misread as not-found. A later good snapshot clears
   both flags so a transient blip that recovers returns to the live console.

3. **Render guard** (`:514`) replaces the unconditional spinner:
   ```tsx
   if (!run) {
     if (runNotFound || runLoadErr) {
       return (
         <div className="max-w-2xl mx-auto animate-fade-up">
           <Card className="p-8 text-center">
             <div className="text-3xl mb-3">⚠️</div>
             <p className="text-sm text-[--ink-2] mb-4">{t.runConsole.runNotFound}</p>
             <Button onClick={() => nav('/live')}>{t.runConsole.backToRuns}</Button>
           </Card>
         </div>
       );
     }
     return <Spinner label={t.runConsole.loadingRun} />;
   }
   ```
   `nav` is `useNavigate()` from `react-router-dom` (the page already imports `useParams` from it at
   `:2`; RunsOverview is mounted at `/live` in `App.tsx:182`). `Card`/`Button` are the same kit the
   Wallet card uses.

## Coexistence with run-console-live-stream-resilience

The RunConsole was recently changed by **run-console-live-stream-resilience**, which hardened two
**different** listeners: the **teams poll** (`loadTeams`, wrapped in try/catch with a `teamsStale`
signal) and the **alerts `onSnapshot`** (`:146+`, `alertsStreamError` flag). This change touches only
the **run-doc `onSnapshot` at `:136`** and its render guard at `:514`. There is no overlap:

- Different `useEffect` (the run-doc effect at `:133-137` vs. the alerts effect at `:146+` and the
  teams poll effect elsewhere).
- Different state (`runNotFound`/`runLoadErr` are new; `teamsStale`/`lastTeamsSyncAt`/
  `alertsStreamError` are the stream-resilience change's and are not read or written here).
- Different render site (the `!run` early return at `:514` vs. the stream-resilience change's
  panel-local stale line and pinned alerts-interrupted notice, both of which render **after** `run`
  is non-null). Because those indicators only render once the console body renders (past the `!run`
  guard), the not-found card short-circuits before them and never competes with them.

So the two changes are additive and independent; applying this one does not modify any line the
stream-resilience change added.

## Test strategy

The change is UI wiring (state flags + two render branches) plus i18n strings; per the house rules
creator-web UI has no component test runner, so verification is:

- An i18n wiring guard: `i18n.ts` defines `runNotFound` and `backToRuns` in BOTH the HE and EN
  `runConsole` maps — enforced by `npm run i18n:check` (PART A dictionary parity is a hard gate) and
  confirmed by `i18n:check:strict` (no new PART B hardcoded strings; all copy routes through `t.*`).
- Preview check (creator-web, manual): open a run URL with a bogus `runId` → the ⚠️ not-found card
  renders with a working "back to Runs" button (lands on `/live`), instead of a permanent spinner; a
  valid run still loads the live console unchanged; a run that loads then has its doc removed shows
  the card on the next snapshot.
- No pure-logic helper is introduced (the not-found decision is two boolean flags set directly in the
  snapshot callbacks), so there is no `scripts/test-*.ts` to add; no callable changes, so no e2e is
  owed.

## i18n (HE + EN, additive, no em-dash / en-dash / spaced-hyphen)

Under `runConsole` in `apps/creator-web/src/i18n.ts`:

| key          | Hebrew (HE)                                   | English (EN)                          |
|--------------|-----------------------------------------------|---------------------------------------|
| `runNotFound`| `לא ניתן לטעון את הריצה. ייתכן שהיא הוסרה.`     | `This run could not be loaded. It may have been removed.` |
| `backToRuns` | `חזרה לריצות`                                  | `Back to runs`                        |

(Values are the design intent; the implementer re-reads `i18n.ts` immediately before editing since it
is contended, and keeps HE fully Hebrew / EN fully English.)

## Risk

Low. Additive state + an additive render branch on an existing early return; the happy path and the
other two hardened listeners are untouched. The single correctness point is the `notFound`-only-after-
a-real-snapshot guard, which the design encodes directly.

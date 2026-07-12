# Design: fix-play-offline-continuity

## Files touched

- `apps/play-web/src/lib/syncError.ts` (new, pure, dependency-free):
  ```ts
  // A team-state sync failure is FATAL (replace the screen) only for these codes;
  // everything else (unavailable/internal/deadline-exceeded/offline network error)
  // is transient → keep last state + show "reconnecting".
  export function isFatalSyncError(code: string | undefined): boolean {
    return /not-found|permission-denied|unauthenticated/.test(code ?? '');
  }
  ```
- `apps/play-web/src/screens/PlayScreen.tsx`:
  - `const [reconnecting, setReconnecting] = useState(false)` + `const hasState = useRef(false)`.
  - `refresh()` success: `setState(s); hasState.current = true; setErr(''); setReconnecting(false)`.
  - `refresh()` catch: read `code = (e as {code?:string}).code`; if `hasState.current && !isFatalSyncError(code)` → `setReconnecting(true)` (keep last state, no blocking error); else `setErr(...)`.
  - New effect: `window.addEventListener('online', onOnline)` → immediate `void refresh()`;
    `'offline'` → `setReconnecting(true)`. While `reconnecting`, a short retry timer (3 s) calls
    `refresh()` until it succeeds (cleared on success/unmount), so recovery doesn't wait for the 12 s
    fallback.
  - Render (in the populated branch, below `ConnectionBanner`): when `reconnecting`, a small
    non-blocking pill `t.play.reconnecting` (a spinner + text), never a full-screen takeover.
- `apps/play-web/src/i18n.ts`: add `play.reconnecting` (HE: "מתחבר מחדש…", EN: "Reconnecting…").

## Test strategy

- **Pure (`scripts/test-sync-error.ts`, tsx, no emulator, auto-run by `npm test`):**
  `isFatalSyncError` is true for `functions/not-found`, `functions/permission-denied`,
  `functions/unauthenticated`; false for `functions/unavailable`, `functions/internal`,
  `functions/deadline-exceeded`, `undefined`, `''` (a network error). RED before the module exists.
- **UI (preview tools):** load the play screen with state; emulate offline (dev-tools/`online:false`)
  → the last state stays and the "reconnecting" pill shows (no full-screen error); restore online →
  an immediate refresh clears the pill. Screenshot as proof.
- **i18n:** `npm run i18n:check` clean (new key is real HE/EN, routed through `t.*`).

## Gates

`npm run typecheck` · `npm test` · `npm run lint` · `npm run creator:build` · `npm run play:build` ·
`npm run i18n:check`.

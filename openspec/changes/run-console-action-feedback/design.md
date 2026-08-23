# Design — run-console-action-feedback

## 1. Current code, audited (grounded, the tree moved)

- **`letTeamBackIn`** — `RunConsolePage.tsx:631-634`:
  ```ts
  async function letTeamBackIn(team: RunTeamRow) {
    try { await clearTeamOutOfBounds({ ...ctx, teamId: team.id, reason: 'staff release' }); await loadTeams(); }
    catch { await dialog.alert(rc.letBackInFailed); }
  }
  ```
  Success path reloads the table and says nothing.

- **`skipTeamStage`** — `:636-642`:
  ```ts
  async function skipTeamStage(team: RunTeamRow) {
    if (!(await confirmAction('skipStage'))) return;
    try { await skipStage({ gameId: gameId!, runId: runId!, teamId: team.id }); await loadTeams(); }
    catch { await dialog.alert(rc.skipFailed); }
  }
  ```
  Confirmed, then silent on success.

- **The pattern to mirror — `skipTeamTask`** (`:648-655`) already does it right:
  ```ts
  await skipTaskForTeam({ ...ctx, teamId: team.id, reason: 'staff skip' });
  await loadTeams();
  toast.success(rc.skipTaskDone({ team: team.displayName }));
  ```

- **`ack`** — `:414-423`, no `busy`; button — `:685-691`:
  ```tsx
  <Button
    variant={runActionVariant('acknowledgeAlert')}
    className="min-h-0 px-2.5 py-1 text-xs rounded-lg ms-auto"
    onClick={() => ack(a.id)}
  >
    {rc.acknowledge}
  </Button>
  ```
  No `disabled`, so a double-tap between tap and the next snapshot double-fires the callable.

- **The guard to reuse — `useAsyncAction`** (`hooks/useAsyncAction.ts:69-89`): `run(...)` is
  single-flight; with a `keyOf` it is single-flight PER KEY (so a different alert row can still act
  while one is in flight); it exposes `busy`, `isBusy(key)` and `busyKeys`. The photo review queue
  already uses this per-row (`:1936` in the review render).

## 2. Finding 4 — success toasts on skipStage and letTeamBackIn

Add a `toast.success(...)` on the success path of each, after `loadTeams()`, mirroring `skipTeamTask`:

```ts
// skipTeamStage
await skipStage({ gameId: gameId!, runId: runId!, teamId: team.id });
await loadTeams();
toast.success(rc.skipStageDone({ team: team.displayName }));

// letTeamBackIn
await clearTeamOutOfBounds({ ...ctx, teamId: team.id, reason: 'staff release' });
await loadTeams();
toast.success(rc.letBackInDone({ team: team.displayName }));
```

The `confirmAction('skipStage')` gate and the unconfirmed safety release are unchanged; only the
success signal is added. The existing `dialog.alert(rc.skipFailed)` / `rc.letBackInFailed` failure
arms stay.

## 3. Finding 5 — in-flight guard on acknowledge

Wrap `ack` in a per-alert-keyed `useAsyncAction` so a second tap on the same alert while its call is in
flight is dropped, and disable the button for that row:

```ts
const ackAction = useAsyncAction(ack, (alertId: string) => alertId);
```
```tsx
<Button
  variant={runActionVariant('acknowledgeAlert')}
  className="min-h-0 px-2.5 py-1 text-xs rounded-lg ms-auto"
  disabled={ackAction.isBusy(a.id)}
  onClick={() => void ackAction.run(a.id)}
>
  {rc.acknowledge}
</Button>
```
Per-key keying matches the photo-queue precedent so acknowledging one alert does not disable the
others. `ack`'s internal `confirmAction('acknowledgeAlert')` and `reportFailure(e, 'acknowledgeAlert')`
are unchanged. Acknowledge behavior is otherwise identical.

## 4. i18n keys (HE + EN, no em-dash, no en-dash, no spaced hyphen)

Two new `runConsole` (`rc.*`) function keys, added to BOTH language maps in
`apps/creator-web/src/i18n.ts` (re-read immediately before editing; the file is contended). They match
the shape of the sibling `skipTaskDone` (`:688` / `:2196`):

| key | Hebrew | English |
|---|---|---|
| `skipStageDone` | `({ team }) => `השלב של ${team} דולג.`` | `({ team }) => `${team}'s stage was skipped.`` |
| `letBackInDone` | `({ team }) => `${team} חזרה למשחק.`` | `({ team }) => `${team} is back in play.`` |

Finding 5 adds **no** i18n (`rc.acknowledge` is reused; the guard is behavioural). Copy uses a period,
never a dash. HE stays Hebrew, EN stays English so `i18n:check:strict` PART A passes; routed through
`t.*` so PART B adds nothing.

## 5. Test strategy

There is no extractable pure decision here — both fixes are UI wiring (a toast call and a button
disabled state), so there is no new `scripts/test-*.ts` unit lane. This is the UI lane per CLAUDE.md
(no component test runner). Gates:

- `npm run typecheck`, `npm run lint`, `npm run creator:build`, `npm run play:build`.
- `npm run i18n:check:strict` clean, zero new PART B (the two new strings are HE/EN correct and routed
  through `t.*`).
- Manual preview check (creator-web):
  - Skipping a team's stage shows a success toast; letting an out-of-bounds team back in shows a
    "back in play" toast.
  - Double-tapping Acknowledge on a raised SOS fires the callable once (the button disables during the
    call); acknowledging one alert does not disable the acknowledge button on other alert rows.

**Lane: e2e.** Nothing owed. No callable added or changed, no `Task` field, `ALLOWED_TASK_KEYS`
untouched.

## 6. Non-decisions worth recording

- **No new pure helper for the toasts.** Adding a `toast.success` after an existing `loadTeams()` is a
  one-line wiring change with no branch worth unit-testing; forcing a helper here would be ceremony.
- **Per-key guard, not a global busy.** A global `busy` on acknowledge would disable every alert's
  button while one is in flight; the photo-queue precedent (per-row key) is the right shape for a list.
- **`runConsoleActions.ts` untouched.** Severity/consequence classification is unchanged; only the
  feedback after a successful call is added.

## Context

`apps/creator-web` already owns three feedback mechanisms, all mounted at the app root and all
usable from anywhere without prop drilling:

- `components/dialog.tsx` — `dialog.alert / confirm / prompt`, promise-returning, blocking. Used for
  anything the creator must acknowledge.
- `components/toast.tsx` — `toast.success / error / info`, non-blocking, `aria-live="polite"`,
  auto-dismissing. Used for routine outcomes.
- `hooks/useAsyncAction.ts` — `createAsyncGuard`, an in-flight guard that survives two clicks in the
  same React batch, keyed so one row of a list never blocks another. It deliberately **does not**
  swallow rejections (`useAsyncAction.ts:35-38`), so it composes with any handler.

`lib/callErrors.ts` already establishes the house rule for turning a rejection into copy: read the
error's `code`, never its message; log the original; render a localized string. `WalletPage` uses it
(`:62`, `:73`). Nothing generalises it beyond billing.

The audit (see the proposal) found the gaps are concentrated in exactly two files. Everything else
either reports correctly or is deliberately quiet.

### Audit result, in full

**Confirmed silent failures — to fix (ranked by damage):**

| # | Site | Shape | What the creator sees today |
|---|---|---|---|
| 1 | `BuilderPage.tsx:227-244` `save()` | `catch { setStatus('unsaved') }` | The same amber "unsaved" dot as an ordinary pending save. No reason, no retry, no distinction. Loses game content. |
| 2 | `RunConsolePage.tsx:411-424` `adjustScore` | no `try` at all | Nothing. Table keeps the old score; the creator believes the correction landed. |
| 3 | `RunConsolePage.tsx:323-327` `refreshStandings` | `try`/`finally`, no `catch` | Nothing, on failure *or* success. |
| 4 | `RunConsolePage.tsx:1434-1437` `FeedConsole.hide` | `.catch(() => undefined)` | Nothing. Photo believed hidden, still projected. |
| 5 | `RunConsolePage.tsx:1517-1523` `ChatHQ.reply` | `catch { }` | Draft is kept, but nothing says the reply failed. |
| 6 | `RunConsolePage.tsx:1004-1014` hot zone `activate` / `deactivate` | `try`/`finally`, no `catch` | Nothing. |
| 7 | `RunConsolePage.tsx:1167-1171` `TrackablesConsole.create` | `try`/`finally`, no `catch` | Nothing (the input does keep its text). |
| 8 | `RunConsolePage.tsx:1218-1224` `ZonesConsole.create` | `try`/`finally`, no `catch` | Nothing. |
| 9 | `RunConsolePage.tsx:1225-1228` `ZonesConsole.remove` | `.catch(() => undefined)` | The refetch makes the zone reappear, unexplained. |
| 10 | `RunConsolePage.tsx:328-330` `ack` | `catch { }` | The alert stays on screen — self-evident but unexplained. |

**Checked and already correct — not findings** (each reports success *and* failure, or was covered
by the earlier `play-no-silent-failures` / `wave-b/async-action-guard` passes):
`DashboardPage` `load` / `newGame` / `launch` / `remove` / `togglePublish` (`:162-303`);
`TrashPage` `load` / `restore` / `purge` (`:34-69`); `WalletPage` `loadStatus` / `buy` / `goPro`
(`:31-75`, via `classifyBillingError`); `SettingsPage` profile / email / password / export / delete
(`:125-475`, all through `StatusLine`); `GalleryPage` search / copy / optimistic like **with
rollback** (`:84-146`); `TaskLibrary.run` (`:54-64`); `PhotoReviewConsole.review`
(`RunConsolePage.tsx:1285-1301`, with an explicit comment refusing optimistic removal);
`RunConsolePage` `startAll` / `finalize` / `invite` / `revealStandings` / `letTeamBackIn` /
`skipTeamStage` / `sendAnnouncement` / flash mission (`:294-346`, `:430-439`, `:918-968`);
`ActiveRunBar.onEnd` (`:41-58`); `AuthGate` sign-in / Google / reset (`:130-174`);
`BuilderPage` `exportToFile` / `importFromFile` / `saveAndLaunch` (`:298-362`);
`TaskWizard` media upload (`:650-665`); `LocationPicker.runSearch` (`:135-147`).

**Intentionally quiet — correct, and out of scope:** the 15 s leaderboard re-poll
(`RunConsolePage.tsx:133-140`); `listLiveRuns` polling (`hooks/useLiveRuns.ts:37-44`, surfaces an
`errored` flag instead); `getRunSurveyResults` / `getRunTrackables` / `getRunZones` /
`getGame`-for-titles background loads (`:245-269`, `:1155-1160`, `:1209-1214`) which degrade to an
empty panel; `incrementTaskCopyCount` (`TaskLibrary.tsx:69`); `claimReferral` (`AuthGate.tsx:67`);
`ensureBoardPublished` (`:338-342`); the feed and chat `onSnapshot` error callbacks; every
clipboard, `QRCode.toDataURL` and `localStorage` guard.

## Goals / Non-Goals

**Goals**
- One pure, total function that turns any thrown value into an actionable, localized outcome.
- Every confirmed site above routed through the existing `toast` / `dialog` / save-banner surfaces.
- The Builder's failed save distinguishable from a pending save, with an explicit retry.

**Non-Goals** — see the proposal. No server change, no offline queue, no auto-retry, no refactor of
already-correct handlers, no edit to `lib/callErrors.ts`.

## Decisions

### D1 — A new pure module rather than extending `lib/callErrors.ts`

`classifyCallError` / `classifyBillingError` are imported by `scripts/test-failure-visibility.ts`,
which is outside this change's ownership. Adding a union member there would widen a contract another
lane asserts against. Instead `lib/callFeedback.ts` is new and additive, and re-uses the same
code-only reading rule. `callErrors.ts` is not modified.

### D2 — Signature: `describeCallFailure(error, opts?) → CallFailure`

```ts
type CallFailureKey = 'offline' | 'notAllowed' | 'rateLimited' | 'rejected' | 'generic';
interface CallFailure { key: CallFailureKey; severity: 'error' | 'warning'; retryable: boolean }
describeCallFailure(e: unknown, opts?: { online?: boolean }): CallFailure
```

Mapping, by bare Firebase code (the `functions/` prefix stripped, exactly as `callErrors.ts` does):

| code | key | severity | retryable |
|---|---|---|---|
| `unavailable`, `deadline-exceeded`, `internal`, `aborted`, `cancelled` | `offline` | `warning` | yes |
| `permission-denied`, `unauthenticated` | `notAllowed` | `error` | **no** |
| `resource-exhausted` | `rateLimited` | `warning` | yes |
| `failed-precondition`, `invalid-argument`, `out-of-range`, `already-exists`, `not-found` | `rejected` | `error` | **no** |
| anything else / no code | `generic` | `error` | yes |

`retryable: false` is the load-bearing part: it is what stops the Builder from offering "try again"
on a signed-out session, where retrying is guaranteed to fail again and only hides the real fix.

**Offline detection without reading message text.** A network failure that never reaches the
callable arrives as a bare `TypeError` with no `code`, which would otherwise land on `generic`. Its
message ("Failed to fetch", "NetworkError when attempting to fetch resource") is browser- and
locale-dependent, so sniffing it is both fragile and against the house rule. Instead the caller may
pass `opts.online` (production callers pass `navigator.onLine`); when it is explicitly `false` and
the error carries no recognised code, the result is `offline`. Injectable, so the test needs no DOM.

`severity` is advisory for the call site (it maps to `toast.error` vs the save banner's tone); it is
returned rather than inferred so the mapping stays in one testable place.

### D3 — Copy lives in one new `t.callFailure` dictionary group

Five keys — `offline`, `notAllowed`, `rateLimited`, `rejected`, `generic` — in HE and EN, plus the
Builder's save-banner strings. Each is a sentence a creator can act on, not a restatement of the
code: `notAllowed` tells them to sign in again; `offline` tells them the work is still on screen and
to retry when the connection is back. The Hebrew is written as Hebrew, in the console's existing
direct second-person-plural tone, not glossed from the English.

Rendering is `t.callFailure[describeCallFailure(e).key]`, the shape `WalletPage` already uses.

### D4 — The Builder's save banner is the one new piece of UI

`SaveStatus` gains a `'failed'` member. When `save()` rejects:

- the header dot turns red and reads a distinct word (HE "לא נשמר" → "השמירה נכשלה"), so a *failed*
  save can never be mistaken for a *pending* one;
- a banner strip under the header states the reason from `t.callFailure[...]` and — only when
  `retryable` — offers a **Retry** button that calls `save()` again directly, so the creator does not
  have to type a character to re-arm the debounce;
- the banner clears the moment a save succeeds.

A toast is deliberately **not** used here: a toast auto-dismisses after 3.2 s, and the whole failure
of this bug class is that a creator looks up ten minutes later. The banner persists until resolved.

`saveAndLaunch` / `exportToFile` already `await save()` and alert `b.saveFailed` on `false`; that
stays, and now the banner also carries the reason.

### D5 — Everything else uses `toast.error`, and successes are added only where absent

Live-ops actions are frequent and mid-event; a modal for each would be worse than the bug. Each
confirmed site gets `catch (e) { console.error(...); toast.error(t.callFailure[describeCallFailure(e).key]) }`.
Two also gain the missing success signal: `refreshStandings` (a toast, so the refresh button stops
being indistinguishable from a no-op) and `adjustScore`. `hideFeedItem` and `deleteZone` keep their
existing refetch — the point is only that a failure now speaks.

`ack` (SOS acknowledgement) is upgraded from `catch { }` to a toast: the alert staying on screen is
a hint, not a message, and an SOS is not a place for hints.

### D6 — What is NOT changed, and why

Raw `e.message` is still rendered by `DashboardPage` `launch`/`remove` (`:265`, `:287`) and
`GalleryPage` (`:100`, `:126`, `:144`) — deliberately, because those server messages name a concrete
thing (the access code of the run blocking a delete). Those handlers *do* make failure visible, so
they are not silent failures and are out of this change's scope; they are recorded here so the next
audit does not re-open them. The Builder's own raw-message alerts (`:219`, `:311`, `:330`, `:353`)
are likewise left alone: they are visible failures, and rewriting the launch handler's
`/credit|pro/i` message test is a separate change.

## Risks / Trade-offs

- **Toast fatigue at a live event.** Mitigated by keeping every background poll quiet (D6 / the
  proposal's quiet list) and by toasting only creator-initiated actions, which are inherently rate-
  limited by the human pressing the button.
- **`opts.online` is a hint, not a fact.** `navigator.onLine === true` on a captive-portal Wi-Fi. It
  is only ever used to *upgrade* an otherwise-generic error to `offline`, never to suppress one.
- **A fifth dictionary group grows `i18n.ts`.** Accepted: it replaces five ad-hoc per-site strings
  that would otherwise be written five times.

## Test Strategy

**Lane: pure logic, vitest in `apps/creator-web`** (`vitest.config.ts` already includes
`src/**/*.test.ts`, node environment, run by `turbo run test` inside `npm test`). No emulator, no
DOM, no fixtures on disk — the classifier is a pure function of its argument.

New file `apps/creator-web/src/lib/__tests__/callFeedback.test.ts`:

1. **Every mapped code** → its key, severity and `retryable` flag: `permission-denied`,
   `unauthenticated`, `failed-precondition`, `deadline-exceeded`, `unavailable`,
   `resource-exhausted`, `invalid-argument`, `not-found`, `already-exists`, `out-of-range`,
   `internal`, `aborted`, `cancelled`.
2. **The `functions/` prefix is stripped** — `{ code: 'functions/permission-denied' }` must equal
   `{ code: 'permission-denied' }`.
3. **Offline / network**: a bare `TypeError` with `opts.online === false` → `offline`, retryable;
   the same `TypeError` with `online === true` → `generic`; `{ code: 'unavailable' }` → `offline`
   regardless of `online`, proving a real code always beats the hint.
4. **Totality on hostile input** — an unknown code (`'teapot'`), an unknown error shape
   (`{ nope: 1 }`), a plain `Error`, a thrown **string**, a thrown number, `null`, and `undefined`.
   None may throw; each must yield a defined key.
5. **The actionability invariant**, asserted as a loop over every key: each maps to a **non-empty**
   entry in BOTH the HE and EN `callFailure` dictionaries, the HE entry contains a Hebrew letter,
   the EN entry contains none, and no entry contains a raw code fragment (`'-'`-joined Firebase
   codes such as `permission-denied`), a `'functions/'` prefix, or the word `Error`/`Firebase`.
   This is the test that makes "never a bare error code shown to a creator" a gate rather than a
   promise. It imports the real `HE`/`EN` maps, so a future key added without copy fails here.
6. **`retryable` is false exactly for the non-retryable keys** (`notAllowed`, `rejected`) — the
   property the Builder's Retry button depends on.

`scripts/test-failure-visibility.ts` and `src/lib/__tests__/i18nDictionary.test.ts` already assert
adjacent invariants and must stay green unchanged — proof that `callErrors.ts` was not disturbed and
that HE/EN parity holds for the new group.

**UI verification.** There is no component test runner in creator-web and **no browser run is
possible in this session** (a live playtest stack owns the ports and must not be disturbed), so the
Builder banner and the toasts are verified by build + typecheck + lint + the i18n gates only. The
banner's behaviour is stated in the delta spec so it can be exercised in a later manual pass.

**Gates** (all must be green, none of them emulator-bound):
`npm run typecheck` · `npm run lint` · `npm test` · `npm run creator:build` · `npm run play:build` ·
`npm run i18n:check` · `npm run i18n:check:strict` (PART B must stay at zero) · `npm run bundle:budget`.

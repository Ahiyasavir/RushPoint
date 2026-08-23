## Why

The participant app got a "no silent failures" pass (commit `fefebaf`). The **creator console never
did** — and the creator console is where a person's *work* lives. A player who loses a tap loses a
tap; a creator who loses a save loses an evening, and finds out at the event, in front of people.

Verified in this working tree, by reading every user-initiated mutation in `apps/creator-web/src`:

1. **The Builder's autosave swallows its own failure.** `pages/BuilderPage.tsx:227-244` is the ONLY
   write path for game content — every stage, task, answer key and coordinate reaches Firestore
   through this one `updateGame`. Its rejection handler is `catch { setStatus('unsaved'); return
   false; }`. Nothing is logged, nothing is shown, and `'unsaved'` renders the **same amber dot and
   the same word** the header shows during the ordinary 1.2 s autosave debounce. A creator who is
   signed out mid-session, offline, or hitting `deadline-exceeded` sees a dot that looks normal,
   keeps building for twenty minutes, and loses all of it. Worse: the retry only re-arms on the next
   `game` change (`:247-254`), so a creator who *stops typing* after a failed save is never retried
   and never told.
2. **A live run's manual score correction has no error path at all.**
   `pages/RunConsolePage.tsx:411-424` — `await adjustTeamScore(...)` with no `try`, invoked as
   `void adjustScore(team)` (`:504`). A rejection is an unhandled promise rejection: no toast, no
   dialog, and `loadTeams()` never runs, so the table keeps showing the old number and the creator
   believes the correction landed. At a live event this is a wrong winner.
3. **Publishing the standings to the teams / the TV screen cannot fail visibly.**
   `RunConsolePage.tsx:323-327` is `try { await refreshLeaderboard(...) } finally { setBusy(false) }`
   — a `finally` with no `catch`. Both call sites (`:523` the "visible to teams" toggle, `:697` the
   refresh button) call it un-awaited. It also has no success feedback, so even the happy path is
   indistinguishable from a no-op.
4. **Moderation of the public photo feed fails silently.** `RunConsolePage.tsx:1434-1437` —
   `hideFeedItem(...).catch(() => undefined)`. A creator hides a photo that should not be on a
   projected feed, the call is rejected, and nothing says so.
5. Four more in the same file with the same shape: HQ's chat reply (`:1517-1523`, `catch { }`), the
   hot-zone activate/deactivate (`:1004-1014`, `finally` with no `catch`), trackable creation
   (`:1167-1171`), zone creation and deletion (`:1218-1228`), and the SOS acknowledgement
   (`:328-330`).

The common denominator is not carelessness — it is that **the creator console has no shared way to
say "that did not work."** `dialog`, `toast` and `useAsyncAction` all exist and are used correctly
elsewhere (Dashboard, Trash, Wallet, Settings and the photo-review queue are all clean). What is
missing is one pure, total mapping from *a rejection* to *something a creator can read and act on*,
so a handler is a one-liner instead of a judgement call each time.

## What Changes

**Every user-initiated mutation in the creator console reports its outcome.**
- A failure is always visible — never only a colour, never only a console line, never nothing.
- The message is actionable and localized: what happened, and what to do. Never a raw Firebase
  message, never a bare error code, never a stack.
- The Builder's autosave, specifically, stops being ambiguous: a *failed* save is visually and
  verbally distinct from a *pending* save, names the reason, and offers an explicit retry that does
  not require the creator to type another character to trigger.
- Content-bearing failures are announced in the loudest register available (the save banner /
  dialog); routine live-ops failures use a toast; genuinely background work stays quiet.

**One pure classifier decides the message.** A new `apps/creator-web/src/lib/callFeedback.ts`
exposes a total function from an arbitrary thrown value to `{ key, severity, retryable }`. It is
total by construction — a plain `Error`, a thrown string, `undefined`, an unrecognised object and a
`FirebaseError` all yield an actionable key. It reads the error's `code` only; free-form message
text is never rendered (it goes to `console.error`, as `lib/callErrors.ts` already does for
billing).

**What stays quiet, deliberately.** Background polls and best-effort telemetry are *correct* as they
are and are explicitly out of scope: the 15 s leaderboard re-poll (`RunConsolePage.tsx:133-140`),
the `listLiveRuns` poll (`hooks/useLiveRuns.ts:37-44`, which already exposes an `errored` flag), the
task copy-count ping (`components/TaskLibrary.tsx:69`), the referral claim on sign-in
(`components/AuthGate.tsx:67`), `ensureBoardPublished` (`:338-342`, a side effect of copying a link,
whose failure is reported by the toggle the creator can still press), and every `localStorage`
guard. Turning these into toasts would produce a toast storm at exactly the moment a host needs a
quiet screen.

## Non-goals

- **No new callable, no server change.** Nothing in `functions/`, `packages/shared/`,
  `firestore.rules` or `storage.rules` is touched. This change is entirely client-side feedback.
- **No offline write queue.** A failed save stays failed and says so; it is not persisted for later
  replay. That is a separate, larger change.
- **No automatic retry loops.** Retry stays a deliberate creator action, so a permission failure
  cannot become a hammering loop against a live backend.
- **No restructuring of working components.** Handlers that already report success and failure
  (Dashboard, Trash, Wallet, Settings, photo review, gallery search/copy/like, `ActiveRunBar`) are
  left exactly as they are.
- **No change to `lib/callErrors.ts`.** Its `classifyCallError` / `classifyBillingError` contract is
  asserted by `scripts/test-failure-visibility.ts`; the new classifier is additive and separate.

## Surfaces touched

`apps/creator-web` only: `src/lib/callFeedback.ts` (new), `src/lib/__tests__/callFeedback.test.ts`
(new), `src/pages/BuilderPage.tsx`, `src/pages/RunConsolePage.tsx`, `src/i18n.ts` (Hebrew + English).

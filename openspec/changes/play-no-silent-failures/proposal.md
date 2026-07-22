## Why

A UI/UX audit of both apps found one failure mode repeated across every surface: **an action fails
and the person is told nothing, or is told something they cannot act on.** Several of these are
unrecoverable dead ends that happen *during* a live event, in front of participants, with no
developer nearby.

The worst of them, each verified against the current tree:

- **The staff Broadcast button is disabled on the wrong field.** `StaffConsole.tsx:628` gates the
  button on `!msg.trim()` — the **English** box — in a Hebrew-first product. A Hebrew-speaking
  volunteer fills the Hebrew box (`msgHe`) and the button stays greyed out with no explanation.
  There is no error to read because nothing was attempted.
- **A failed broadcast to 40 teams is invisible.** `StaffConsole.tsx:609-615` `send()` has no
  try/catch, and `useAsyncAction.run` deliberately re-throws (`useAsyncAction.ts:117`), so a
  rejected `pushAnnouncement` surfaces as an unhandled rejection in the console and nothing at all
  on screen. The composer even clears the draft *before* the call can fail.
- **An expired staff session is a dead end with an English error.** `StaffConsole.tsx:220/256/263/271/281`
  all write `e.message` straight into `readErr`, rendered untranslated at `:305`, and `readErr` is
  never cleared. A volunteer whose custom token expired reads "Missing or insufficient permissions"
  in English, forever, with no path back to the PIN screen — while the *correct* code-to-copy
  mapping already exists 100 lines above at `:119-127`.
- **The billing page can spin forever.** `WalletPage.tsx:25` `loadStatus()` has no catch and `:63`
  returns `<Spinner/>` while `!status`, so one failed `getWalletStatus` is a permanent spinner on
  the page where a creator pays. `DashboardPage.tsx:79-88` already handles exactly this correctly.
- **A stranger's first-ever tap fails silently.** `GamePromoScreen.tsx:40` is
  `} catch { setStarting(false); }` — the button un-presses and nothing else happens.
- **Point-awarding actions fail silently mid-run.** `PlayScreen.tsx:793` (capture zone) and `:745`
  (trackable pickup) are empty catch blocks; `:789` returns with no message when GPS has not fixed.
- **Errors and progress are indistinguishable.** `TaskRunner.tsx:648`/`:553` render one `msg` sink
  in identical neutral grey for both "Too far (120m away)" and "Uploading photo…", with no
  `aria-live`, so a screen-reader user hears neither.
- **"Finding your next task…" is a motionless sentence** (`TaskRunner.tsx:258`) that can sit for the
  ~70s callable deadline with no spinner and no retry — while the retry button it needs already
  exists twelve lines below at `:224-232`.
- **"No active stage."** (`PlayScreen.tsx:491`) is a bare sentence and a terminal dead end, while
  the recovery pattern (icon + explanation + `{t.common.tryAgain}` → `refresh()`) already exists at
  `PlayScreen.tsx:330-337`.

None of this requires new backend behavior. Every fix is a client-side surfacing of information the
system already has, and in most cases the correct pattern already exists elsewhere in the same file.

## What Changes

**Every failure is visible, distinguishable, and recoverable.**

- **Errors read as errors.** The participant task card splits its single message sink into
  *neutral progress* and *error* channels: errors render in `text-rp-alert` with a ⚠ prefix,
  progress stays neutral, and the region is `role="status" aria-live="polite"`. The classification
  is derived from the existing `submitError()` helper (`TaskRunner.tsx:179`), which already knows
  which strings are server rejections.
- **No motionless waits.** "Finding your next task" shows the spinner used elsewhere and, after
  ~12 s, reveals the same retry affordance the `routingError` branch already uses.
- **No terminal sentences.** "No active stage" becomes the icon + explanation + retry pattern
  already used for the load-failure state.
- **Point-awarding actions report.** Capture-zone and trackable actions surface an inline failure
  line instead of swallowing the rejection, and say so explicitly when GPS has not fixed yet.
- **Chat says when a send failed.** The draft is still kept; a "couldn't send, tap to retry" line
  now says why the message did not appear.

**The staff console stops failing volunteers.**

- Broadcast is enabled when **either** language box has content, with **Hebrew as the primary
  field** and English marked optional. When only Hebrew is filled, the Hebrew text is sent as the
  announcement body as well, so English-reading participants see the message rather than an empty
  bubble (participants prefer `messageHe` when it exists — `LiveOps.tsx:136`).
- A failed broadcast shows a localized error and **keeps the draft**.
- Every staff-side rejection routes through one `staffError()` mapper that mirrors the existing,
  correct sign-in mapping. `permission-denied` / `unauthenticated` map to "your staff session
  expired" **plus a button that clears the staff session and returns to the PIN screen**. The error
  line clears on the next successful snapshot.

**Public routes and the creator console stop dead-ending.**

- Instant play reports its failure with a retry and a nudge toward "I have a code", and uses the
  `loading` prop the `Button` primitive already supports rather than a hand-rolled label swap.
- The public leaderboard offers a retry (its `load` is already a stable `useCallback`), and its
  share/copy action confirms the copy.
- The wallet page recovers from a failed status load instead of spinning, and maps purchase and
  subscription rejections **by error code** to localized copy, logging the real error.
- Template pick and publish/unpublish failures in the creator dashboard surface a localized
  message; a failed template pick re-opens the picker so the creator's choice is not lost.

## Capabilities

### New Capabilities
- `failure-visibility`: Every user-initiated action in both apps that can fail reports its outcome
  in the user's language, distinguishes an error from progress (visually and to assistive tech),
  and leaves at least one way forward — a retry, a recovery action, or a preserved draft. No
  surface renders a raw server message, and no surface can reach a state with no next step.

### Modified Capabilities
<!-- None. This change adds no requirements to an existing spec; it establishes error-reporting
     behavior that no current capability specifies. -->

## Impact

- **Surfaces touched:** `apps/play-web` and `apps/creator-web` **only**. No callables, no Firestore
  rules, no `packages/shared` types, no changes to any server contract. `pushAnnouncement` is called
  with the same payload shape as today (`message` is still always a non-empty string).
- **Files:** play-web — `components/TaskRunner.tsx`, `components/ChatPanel.tsx`,
  `screens/PlayScreen.tsx`, `screens/StaffConsole.tsx`, `screens/GamePromoScreen.tsx`,
  `screens/PublicLeaderboardScreen.tsx`, new `lib/failureCopy.ts`, `i18n.ts`.
  creator-web — `pages/WalletPage.tsx`, `pages/DashboardPage.tsx`, new `lib/callErrors.ts`,
  `i18n.ts`.
- **New pure logic (the TDD surface):** a message classifier (error vs progress), a staff error-code
  mapper, and a creator billing error-code mapper. All three are pure functions with no React and no
  Firebase, tested in the existing `npm test` lane before any component is edited.
- **Risk:** the broadcast change alters which text reaches participants when a volunteer fills only
  Hebrew. Today that case cannot happen (the button is disabled), so there is no regression path —
  only a previously unreachable state becoming reachable and correct.
- **Gates:** `npm run e2e` is **excluded** — this change touches no callable and no server behavior,
  and the emulator is deliberately not started (a live playtest tunnel owns it).

## Non-goals

- **No new callable, no callable signature change, no Firestore rule change.** If a fix appeared to
  need one, it was dropped rather than invented.
- **No redesign.** Layout, colours, spacing and copy tone stay as they are except where a message
  must newly appear.
- **No touch-target, RTL, or dialog-accessibility work** — that is a separate change.
- **No "navigate here" hand-off** — that is a separate change.
- **No retry-on-a-timer / offline queueing.** Retries stay user-initiated.
- **No change to what the server rejects or why.** Only how the rejection is presented.

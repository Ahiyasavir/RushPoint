# Proposal — run-console-run-not-found

## Why

The creator Run Console can get stuck on a **permanent "loading run" spinner** with no error and no
way out. The live run-doc listener is:

```ts
return onSnapshot(ref, (snap) => snap.exists() && setRun(snap.data() as Run));
```

(`apps/creator-web/src/pages/RunConsolePage.tsx:136`). It only ever calls `setRun` when the document
**exists**, and it has **no error callback**. So whenever the run doc does not resolve — a bookmarked
run that was purged, a run whose game was soft-deleted, a mistyped id in the URL, or a transient
Firestore permission blip during a token refresh — `run` stays `null` forever and the page renders
`<Spinner label={t.runConsole.loadingRun} />` (`:514`) indefinitely. No error, no "not found", no
exit.

This is exactly the permanent-spinner failure class the team already fixed on WalletPage
(`WalletPage.tsx:85-96`, which escapes the spinner into an error card), but the Run Console still has
it. It is the top finding of the v4 edge-state hunt: the operator opens a run URL that no longer
resolves and stares at a spinner that will never complete.

## What Changes

Give the run-doc listener an error path and a not-found branch, mirroring the existing Wallet error
card.

- Add an `onError` handler to the run-doc `onSnapshot`. On a listener error, set a `loadErr` flag.
- Distinguish "first snapshot has not arrived yet" from "the doc does not exist". Add a `notFound`
  flag that is only set when a snapshot **actually fires** with `!snap.exists()` (never before the
  first snapshot arrives), so a normal not-yet-loaded state is not misread as not-found.
- Replace the unconditional `if (!run) return <Spinner .../>` with:
  - still `null` and neither flag set → the existing spinner (unchanged happy-path loading);
  - `notFound` or `loadErr` set → a clear card (⚠️ + a localized "this run could not be loaded / may
    have been removed" message) with a button back to the Runs list (`/live`, RunsOverview), mirroring
    the Wallet/Builder error cards (`Card` + `Button`).

## What does NOT change

- **The happy path is unchanged.** When the doc exists, the first snapshot sets `run` and the console
  renders exactly as today; the spinner still shows during the normal pre-first-snapshot moment.
- **The other RunConsole listeners are untouched.** The recently-shipped
  `run-console-live-stream-resilience` change hardened the **teams poll** and the **alerts
  onSnapshot** (two different listeners); this change touches only the **run-doc** listener at `:136`.
  The two coexist without conflict — see design §"Coexistence".
- No callable, no backend, no shared type, no Firestore rule, no `savePayload`, no play-web.

## Non-goals

- No retry button on the not-found card (a purged/soft-deleted run will not come back; the exit is
  "back to Runs"). A transient permission blip resolves on the listener's own auto-retry if the doc
  becomes readable again; the card is the honest state when it does not.
- No change to how runs are purged or soft-deleted, and no change to the run-doc data shape.

## Impact

- Affected specs: `run-console-run-resolution` (new)
- Affected code: `apps/creator-web/src/pages/RunConsolePage.tsx` (run-doc listener `:136` gains
  `onError` + a not-found guard; the `:514` spinner guard gains a not-found/error branch; two new
  state flags), `apps/creator-web/src/i18n.ts` (additive: a not-found title/message + a back-to-runs
  button label under `runConsole`, HE + EN)
- Surfaces touched: **creator-web only**. No shared types, no callable, no rules, no play-web.

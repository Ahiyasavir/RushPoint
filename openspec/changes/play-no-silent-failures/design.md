## Context

Three distinct decisions repeat across the ten-odd sites this change touches, and each one is a
pure, testable function that the components then merely render. Pushing them out of the components
is what makes this change TDD-able at all — play-web has no component test runner, so anything left
inside a `.tsx` can only be eyeballed.

The three:

1. **Is this message an error or progress?** `TaskRunner`'s `msg` state carries both.
2. **What does this rejection mean to a staff volunteer?** Firebase error codes → localized copy +
   whether the session must be re-established.
3. **What does this rejection mean to a paying creator?** Billing error codes → localized copy.

Everything else in this change is applying an existing in-repo pattern to a site that lacks it.

## Goals / Non-Goals

**Goals**
- No empty `catch` on a user-initiated action in the touched files.
- No raw server string reaches a rendered node.
- Every failed state offers a retry, a recovery action, or a preserved draft.
- The three classifiers above are pure and covered by tests written **before** the components change.

**Non-Goals**
- No callable, rules, or shared-type change (hard constraint; if one seemed required, stop and report).
- No layout/visual redesign beyond adding the message nodes and colouring existing ones.
- No automatic retry, backoff, or offline queueing.
- Touch targets, RTL, dialog a11y, and the navigation hand-off are separate changes.

## Decisions

### D1 — `submitError()` returns the classification, it does not gain a second copy of the mapping

`TaskRunner.tsx:179` already decides "is this a recognized server rejection or the generic
fallback". Rather than adding a parallel `isError(msg)` string matcher (which would rot the moment
a translation changes), `submitError` is refactored to return `{ text, isError: true }` and a new
`setMsg`-shaped helper records the flag alongside the text.

Concretely, `TaskRunner`'s `const [msg, setMsg] = useState('')` becomes
`const [msg, setMsg] = useState<TaskMessage | null>(null)` where
`type TaskMessage = { text: string; tone: 'error' | 'progress' }`, and every existing `setMsg(x)`
call site is rewritten to name its tone explicitly. This is mechanical and total: the compiler
finds every site.

Tone assignment at the existing call sites:
- `progress` — `t.task.uploadingPhoto`, `t.task.uploadingAudio`, `t.task.approved`,
  `t.task.pendingReview`, `t.task.arrivalUnlocked`, `t.task.hintRevealedFree`, `t.task.stepOf(...)`.
- `error` — everything returned by `submitError(...)`, plus `t.task.wrongCode`, `t.task.notQuite`,
  `t.task.orderingWrong`, `t.task.notThereYet`, `t.task.gpsWarning`, `t.task.offlineSubmit`,
  `t.task.arrivalNeedsOnline`, `t.task.photoSaveRetry`.

`t.task.notThereYet` / `t.task.notQuite` are "wrong answer" outcomes, not system faults; they are
still classified `error` because the audit's concern is that the player must be able to tell "the
thing I did did not work" from "the thing I did is progressing", and a wrong answer is the former.

**Pure unit under test:** `taskMessageClass(tone)` in `apps/play-web/src/lib/failureCopy.ts` →
the class-name string. Tested for: an error tone yields the alert colour, a progress tone yields the
neutral colour, and the returned strings are static Tailwind literals (no interpolation) so the
JIT can see them.

The rendering sites (`TaskRunner.tsx:648` and the sealed-card variant at `:553`) become:

```tsx
{msg && (
  <p role="status" aria-live="polite" className={taskMessageClass(msg.tone)}>
    {msg.tone === 'error' ? `⚠ ${msg.text}` : msg.text}
  </p>
)}
```

The ⚠ prefix is a literal glyph, not copy, so it needs no i18n key — but it is applied in the
component (not baked into the dictionary) so the dictionaries stay clean for `i18n:check`.

### D2 — One `staffError()` mapper, modelled on the sign-in mapper that already works

`StaffConsole.tsx:119-127` already does the right thing for sign-in: strip the `functions/` prefix
from `e.code`, switch on the bare code, fall through to generic localized copy. The five sites that
do the wrong thing (`:220`, `:256`, `:263`, `:271`, `:281` — two snapshot `onSnapshot` error
callbacks and the `review` / `ack` / `adjust` catches) all get routed through one helper.

Because the mapper must also tell the caller *whether the session is dead*, it returns a discriminant
rather than a string:

```ts
// apps/play-web/src/lib/failureCopy.ts
export type StaffFailure = { key: StaffFailureKey; sessionExpired: boolean };
export type StaffFailureKey =
  | 'sessionExpired' | 'notFound' | 'rateLimited' | 'offline' | 'generic';

export function classifyStaffError(e: unknown): StaffFailure;
```

Mapping (the pure unit under test):

| bare code | key | `sessionExpired` |
|---|---|---|
| `permission-denied` | `sessionExpired` | `true` |
| `unauthenticated` | `sessionExpired` | `true` |
| `not-found` | `notFound` | `false` |
| `resource-exhausted` | `rateLimited` | `false` |
| `unavailable`, `deadline-exceeded` | `offline` | `false` |
| anything else / no code / non-Error | `generic` | `false` |

The code is read from `e.code` when present (Firebase `FirebaseError` and `HttpsError` both carry
it) and, only as a fallback, from a `functions/<code>` prefix inside `e.message`. It never reads
free-form message text — that is exactly the leak this change removes.

`StaffDashboard` holds `const [readErr, setReadErr] = useState<StaffFailure | null>(null)`, renders
`t.staff[failure.key]`, and renders an extra "return to sign-in" `Button` calling
`clearStaffSession()` + `onSignOut()` when `failure.sessionExpired`. Both `onSnapshot` success paths
call `setReadErr(null)` as their first statement, which satisfies the "clears on recovery"
requirement without any extra bookkeeping.

`clearStaffSession` already exists in `store.ts` (it is what `onSignOut` uses); this reuses it.

### D3 — Broadcast: Hebrew primary, `message` always non-empty

The composer's fields swap order (Hebrew first, autofocus; English second, labelled optional) and
the disable predicate becomes `busy || (!msg.trim() && !msgHe.trim())`.

The payload rule is a one-line pure function so it can be asserted directly:

```ts
export function announcementPayload(en: string, he: string):
  { message: string; messageHe?: string } | null;
```

- both empty → `null` (caller does not dispatch)
- English only → `{ message: en }`
- Hebrew only → `{ message: he, messageHe: he }`
- both → `{ message: en, messageHe: he }`

The Hebrew-only case duplicating into `message` is the load-bearing decision. **Verified**:
`LiveOps.tsx:136` renders `lang === 'he' && a.messageHe ? a.messageHe : a.message`, so an
English-language participant reads `message`. Sending `{ messageHe: he }` with an empty `message`
would render an **empty announcement bubble** to every English-language participant. Duplicating is
strictly better than empty, requires no callable change (`message` stays a required non-empty
string), and mirrors what the volunteer intends: broadcast this text to everyone.

`send()` is wrapped in try/catch. On success it clears both drafts and shows the existing `sent`
confirmation; on failure it sets a localized error and **leaves both drafts intact** — note this
inverts the current order, which clears the drafts before the call can reject.

### D4 — Creator billing errors mapped by code, not by message

`WalletPage.tsx:44,52` currently render `e.message`. A new
`apps/creator-web/src/lib/callErrors.ts` exports `classifyBillingError(e): BillingFailureKey`
(`'insufficientFunds' | 'rateLimited' | 'offline' | 'notConfigured' | 'generic'`), read from `e.code`
exactly as in D2. The page renders `w[key]` and `console.error`s the original. The same module
exports the generic `classifyCallError` used by `DashboardPage`'s new catches.

`loadStatus()` gains a catch that sets a `statusError` flag; `:63`'s `if (!status) return <Spinner/>`
becomes `if (!status) return statusError ? <ErrorState onRetry={loadStatus}/> : <Spinner/>`,
matching `DashboardPage.tsx:79-88`'s existing shape (escape the spinner, log the real error, show
localized copy).

### D5 — Routing wait: a 12-second reveal, expressed as a pure state machine

`TaskRunner.tsx:258`'s bare `<Card>{t.task.routing}</Card>` gains the spinner markup already used at
`PlayScreen.tsx:339` and a retry button that fires the *existing*
`setRoutingAttempt((n) => n + 1)` from `:224-232`.

The "after ~12 s" rule is a `useEffect` + `setTimeout` keyed on `routingAttempt` (so each retry
restarts the clock), but the decision itself is extracted:

```ts
export function shouldOfferRetry(waitedMs: number, attempt: number): boolean;
```

`waitedMs >= 12_000`, or `attempt > 0` (once a player has retried once, the option stays visible
immediately rather than making them wait another 12 s to try again). Tested at the boundary
(11_999 / 12_000), at attempt 0 vs 1, and for negative/NaN inputs.

### D6 — Everything else is pattern application, not new design

| Site | Existing pattern reused |
|---|---|
| `PlayScreen.tsx:491` no-active-stage | `PlayScreen.tsx:330-337` (icon + copy + `t.common.tryAgain` → `refresh()`) |
| `PlayScreen.tsx:745` / `:793` / `:789` | a keyed `errors: Record<string,string>` beside the existing `useAsyncAction` key, rendered inline per row |
| `ChatPanel.tsx:47-52` | a `sendFailed` boolean → one line above the composer; draft already preserved |
| `GamePromoScreen.tsx:40` / `:172` | `Button`'s `loading` prop (`ui.tsx:35`) + an error line + the existing `t.promo.haveCode` CTA |
| `PublicLeaderboardScreen.tsx:73-86` | a retry `Button` calling the already-stable `load` callback (`:26`) |
| `PublicLeaderboardScreen.tsx:60` | the `copied` state pattern from `GamePromoScreen.tsx:19,25,182` |
| `DashboardPage.tsx:101-111` / `:152-155` | `try/catch` + `dialog.alert` (already used at `:83-88`) and `toast.error` (already used at `GalleryPage.tsx:75`) |

## Risks / Trade-offs

- **Mechanical churn in `TaskRunner.tsx`.** Retyping `msg` touches ~20 call sites. Mitigated by
  doing it as one compiler-driven pass with no behavior change other than the tone label, and by
  the fact that TypeScript makes a missed site a build error rather than a runtime one.
- **`t.task.notQuite` now reads as an error.** A wrong quiz answer will look more alarming than it
  did. Accepted: the audit's finding is that players cannot tell a failure from progress, and a
  rejected answer *is* a failure of the attempt.
- **Duplicating Hebrew into `message`** means an English participant may see Hebrew. Accepted, and
  strictly better than the alternative (an empty bubble). The composer's copy tells the volunteer
  that the English field is optional and what happens if they skip it.
- **A `sessionExpired` mapping could fire on a transient Firestore hiccup**, offering a sign-out the
  volunteer does not need. Mitigated by mapping only `permission-denied` / `unauthenticated` (which
  Firestore does not emit transiently) and by making the recovery a *button*, never automatic.

## Test Strategy

**Lane:** `scripts/test-failure-visibility.ts` — a `tsx` assertion script picked up automatically by
`scripts/run-unit-tests.mjs`, therefore inside `npm test`. play-web has no vitest config of its own;
several existing scripts (`test-gps-error-ux.ts`, `test-sync-error.ts`, `test-upload-resiliency.ts`)
already import play-web `src/lib` modules this way, so this matches the house lane. The creator-web
mapper is asserted from the same script (creator-web's `vitest.config.ts` only globs
`src/**/*.test.ts` for the Builder-redesign suite; adding a second entry point there is unnecessary
when the aggregator already covers it).

The new modules are deliberately React-free and Firebase-free so the script can import them directly.

**RED assertions, written and failing before any component edit:**

*`taskMessageClass`*
- `taskMessageClass('error')` contains `text-rp-alert`; `taskMessageClass('progress')` does not.
- Both return static class strings containing no `${`.

*`classifyStaffError`*
- `{ code: 'permission-denied' }` → `{ key: 'sessionExpired', sessionExpired: true }`.
- `{ code: 'functions/unauthenticated' }` → same (prefix stripped).
- `{ code: 'not-found' }` → `notFound`, not expired.
- `{ code: 'resource-exhausted' }` → `rateLimited`.
- `{ code: 'unavailable' }` and `{ code: 'deadline-exceeded' }` → `offline`.
- `new Error('Missing or insufficient permissions')` with **no** code → `generic`
  (**the leak guard**: message text must never be classified, and must never be echoed).
- `undefined`, `null`, `'a string'`, `{}` → `generic`, never a throw.
- Every returned `key` exists in **both** `he` and `en` `t.staff` dictionaries (imported from
  `apps/play-web/src/i18n.ts`) — this is what stops a mapper key drifting away from its copy.

*`announcementPayload`*
- `('', '')` → `null`.
- `('Go', '')` → `{ message: 'Go' }`, no `messageHe`.
- `('', 'לכו')` → `{ message: 'לכו', messageHe: 'לכו' }` (**the participant-visibility guard**).
- `('Go', 'לכו')` → `{ message: 'Go', messageHe: 'לכו' }`.
- Whitespace-only input in either field counts as empty.
- The result's `message` is never the empty string when the result is non-null.

*`shouldOfferRetry`*
- `(11_999, 0)` false; `(12_000, 0)` true; `(0, 1)` true; `(NaN, 0)` false; `(-1, 0)` false.

*`classifyBillingError`* (creator-web)
- `{ code: 'failed-precondition' }` → `insufficientFunds`; `{ code: 'resource-exhausted' }` →
  `rateLimited`; `{ code: 'unavailable' }` → `offline`; `{ code: 'unimplemented' }` →
  `notConfigured`; unknown/absent → `generic`; never throws.
- Every returned key exists in both `he` and `en` `t.wallet` dictionaries.

**UI verification** (no runner exists, so this is explicit and manual-by-inspection):
- `npm run play:build` and `npm run creator:build` must pass — this is what proves the exhaustive
  `TaskMessage` retype landed on every call site.
- `npm run i18n:check` must be clean (PART A hard gate) and `npm run i18n:check:strict` must stay at
  its pre-change baseline of **zero** findings — every string added here goes through `t.*`.
- `npm test` also runs `scripts/test-no-dashes.ts`, so the new copy must avoid `—`, `–`, ` - `.

**Explicitly excluded:** `npm run e2e`. This change alters no callable, no payload shape, and no
server behavior, so the emulator suite cannot observe it; and the emulator must not be started (a
live playtest tunnel owns it).

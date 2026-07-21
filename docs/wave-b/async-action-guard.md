# Wave B — async action guard (button double click / re-entrancy)

## 1. Proposal (what & why)

**Reported as:** "implement debouncing, disabled states, or loading spinners across
interactive buttons".

**Verified correction.** The `Button` primitives in both apps already do this right:

* `apps/creator-web/src/components/ui.tsx` L28-70 — `loading` prop, `disabled={disabled || loading}`,
  `aria-busy`, inline spinner.
* `apps/play-web/src/components/ui.tsx` L5-41 — same contract.

The primitives are **not** the defect and were not touched.

**The real defect.** 133 raw `<button>` elements bypass the primitive (80 creator-web,
53 play-web). More importantly, *every* async handler in both apps guards itself with a
`useState` busy flag:

```ts
async function launch(g) { setBusy(true); try { await launchRun(...) } finally { setBusy(false) } }
```

`setBusy(true)` is **asynchronous**. Two clicks dispatched inside the same React batch (a
double tap, or a jittery tap on a phone) both observe `busy === false` and both fire the
callable. The disabled attribute only lands after the re-render. That is a genuine
double-mutation window on `launchRun`, `purchaseCredits`, `adjustTeamScore`,
`captureZone`, `joinRun`, `pushAnnouncement`, … — several of which are non idempotent.

A *timing* debounce (300 ms) does not fix this either: a slow callable can run for 20 s,
and the second click at t=400 ms would still get through. The fix must be an **in flight
guard**, held for the whole duration of the promise.

## 2. Design (how)

Two layers, one new file per app, no shared package touched:

* `apps/creator-web/src/hooks/useAsyncAction.ts`
* `apps/play-web/src/hooks/useAsyncAction.ts`

(identical content; duplicated because `packages/shared` is owned by another agent and is
a backend-facing package anyway.)

### Layer 1 — `createAsyncGuard(onChange?)` — pure, no React

```ts
interface AsyncGuard {
  readonly busy: boolean;              // any key in flight
  readonly alive: boolean;             // false after dispose()
  isBusy(key?: string): boolean;
  mount(): void;                       // re-arm (StrictMode double invoke)
  dispose(): void;                     // unmount: stop notifying, drop keys
  run<T>(fn: () => T | Promise<T>, key?: string): Promise<T | undefined>;
}
```

* `run` on an already in flight key **does not invoke `fn` at all** and resolves
  `undefined` immediately. That is the double click fix, and it is a guard, not a timer.
* the key defaults to `''`, so a plain action is single flight; a keyed action (per team,
  per zone, per package) stays concurrent across different keys, preserving today's
  `busyKey` UX in the staff console and the play screen panels.
* `finally` always releases the key, so the guard **re-arms after both resolve and reject**.
* `fn`'s rejection is re-thrown unchanged — nothing is swallowed, every existing
  `try/catch` + localized Hebrew error message keeps working.
* `onChange` is only called while `alive`, so nothing writes state after unmount.

Pure, dependency free, and unit tested directly.

### Layer 2 — `useAsyncAction(fn, keyOf?)` — the React wrapper

```ts
const { run, busy, isBusy, busyKeys, error } = useAsyncAction(fn, keyOf?)
```

* `run(...args)` → `Promise<R | undefined>`; ignored while in flight.
* `busy` → pass straight to `<Button loading={busy}>` / `disabled`.
* `isBusy(key)` → for keyed lists.
* `error` → last rejection (also re-thrown).
* a `useEffect` mount/dispose pair makes it unmount safe (participants navigate away mid
  call constantly) and StrictMode safe.
* `fn` and `keyOf` are held in refs, so `run` is referentially stable and closures stay fresh.

### Scope rule applied to call sites

Only **async / non idempotent** handlers were converted: callable, network, upload,
purchase, share write, claim, acknowledge. Pure UI buttons (tab switch, expand/collapse,
modal close, language/sound/colorblind toggle, navigation, add/remove a member row,
survey answer chips) were deliberately left as raw `<button>`s — converting them would be
the cosmetic mass migration the user explicitly ruled out.

## 3. Tasks (RED → GREEN → REFACTOR)

1. RED — `scripts/test-async-action-guard.ts` (auto discovered by
   `scripts/run-unit-tests.mjs`), asserting the guard contract against **both** app copies
   so they can never drift. Proven failing first (module not found).
2. GREEN — add the two `useAsyncAction.ts` files.
3. REFACTOR — route the qualifying call sites through the hook.

## 4. Call sites — guarded vs. deliberately left alone

### `apps/creator-web/src/pages/DashboardPage.tsx`

| line (orig) | control | verdict |
|---|---|---|
| 394 | template tile → `newGame` (`createGame` + `updateGame`) | **guarded** |
| 268 | `Button` Launch → `launchRun` | **guarded** (`loading`) |
| 274-281 | raw Test run → `launchRun` | **guarded** (raw kept: 4-up grid layout) |
| 282-287 | raw Publish/Unpublish → `publishGame` | **guarded** (was fully unguarded) |
| 294-299 | raw Delete → `deleteGame` | **guarded** (was fully unguarded) |
| 416 | `ShareSheet onPublish` → `publishGame` | **guarded** |
| 262 | Edit → `nav()` | left: pure navigation |
| 308, 357 | create tile / quick cards → `setPicking` / `nav()` | left: pure UI |
| 385 | modal ✕ | left: pure UI |

### `apps/creator-web/src/pages/GalleryPage.tsx`

| 102 | `Button` Search → `searchGallery`/`searchTaskLibrary` | **guarded** (`loading`) |
| 125 | Copy → `duplicateGame` | **guarded**, keyed by game id (per card spinner preserved) |
| 82, 90 | tab / list-map view | left: pure UI |
| 111, 133 | clear search | left: pure UI (`setQ('')`) |

Note: the 350 ms search-as-you-type **debounce effect deliberately keeps calling the raw
`run`**. Guarding it would silently drop the newest query whenever a slow search was still
in flight, leaving the gallery stale behind what the user typed. Only the explicit search
button / Enter key go through the guard.

### `apps/creator-web/src/pages/WalletPage.tsx`

| 115 | Buy package → `purchaseCredits` (money) | **guarded**, keyed by package id |
| 135, 138 | Go Pro month/year → `subscribePro` (money) | **guarded**, keyed |
| 149 | Invite → `setInviting` | left: pure UI |

### `apps/creator-web/src/components/ShareSheet.tsx`

| 58 | raw "publish now" → `onPublish` (`publishGame`) | **guarded** (raw kept: inline link inside a sentence) |
| 70 | Copy link | left: clipboard only, idempotent |
| 75 | native share | left: opens the OS sheet, no mutation |
| 51 | ✕ | left: pure UI |

### `apps/play-web/src/screens/JoinScreen.tsx`

| 237 | Continue → `getJoinInfo` (also Enter key, L229) | **guarded** (`loading`) |
| 423 | Join → `joinRun` | **guarded** (`loading`) |
| 352 | Attach → `joinTeamAsDevice` | **guarded** (`loading`) |
| 177, 189, 201 | sound / colorblind / language toggles | left: pure UI |
| 246 | staff link, 319 join-mode tabs, 404/408 member rows | left: pure UI |

### `apps/play-web/src/screens/StaffConsole.tsx`

| 119 | Sign in → `staffSignIn` (+ Enter, L115) | **guarded** (`loading`) |
| 280 | raw Ack → `acknowledgeAlert` | **guarded**, keyed by alert id |
| 315/322 | raw Approve/Reject → `reviewStationSubmission` | **guarded**, keyed `teamId:taskId` |
| 351 | raw ±5/±10 → `adjustTeamScore` | **guarded**, keyed by team id |
| 498 | raw chat send → `sendTeamChatMessage` (+ Enter, L491) | **guarded** |
| 564 | Broadcast → `pushAnnouncement` | **guarded** (`loading`) |
| 122, 251 | back to join / sign out | left: local session only |
| 449, 470, 524 | section + thread expanders | left: pure UI |

### `apps/play-web/src/screens/PlayScreen.tsx`

| 235 | SOS → `triggerSOS` (safety critical, was fully unguarded) | **guarded** |
| 415 | raw Share progress → `shareStoryCard` (lazy chunk + canvas + `navigator.share`) | **guarded** (raw kept: inline text link) |
| 722/727 | raw pick up / drop → `pickUpTrackable` / `dropTrackable` | **guarded**, keyed by trackable id |
| 769 | raw Capture → `captureZone` | **guarded**, keyed by zone id |
| 875 | Leave | left: confirm dialog + local `clearSession` |
| 567, 597, 658 | panel toggles | left: pure UI |

### `apps/play-web/src/components/TeamDevicesPanel.tsx`

| 89 | raw Transfer → `transferController` | **guarded**, keyed by target uid |
| 102 | raw Take control → `claimController` | **guarded** |
| 55 | panel expander, 71 copy code | left: pure UI / clipboard |

### `apps/play-web/src/components/PostGameSurvey.tsx`

| 199 | Send → `submitRunFeedback` | **guarded** (`loading`) |
| 106, 173, 196 | dismiss / next / skip | left: pure UI |
| 161, 218, 246 | answer chips + emoji scale | left: pure UI (already double-tap safe via the cleared `advanceTimer`) |

## 5. i18n

**No new user facing strings were added.** Every guarded control reuses its existing
`t.*` key, and the spinner comes from the `Button` primitive (no text). Nothing for the
orchestrator to add to `i18n.ts`.

## 6. Gates run (per the ownership rules — no `verify`, no `shared:build`)

* `npx tsx scripts/test-async-action-guard.ts` — RED first (module not found), then
  **44/44 PASS** (22 assertions × both app copies).
* `npx tsc --noEmit` in `apps/creator-web` — clean.
* `npx tsc --noEmit` in `apps/play-web` — clean.
* `npx eslint` on every creator-web file touched — **0 errors**, 1 warning
  (`DashboardPage` L90 `useEffect` missing `load` dep) which is **pre-existing**.
* `npx vitest run` in `apps/creator-web` — 27/27 pass.

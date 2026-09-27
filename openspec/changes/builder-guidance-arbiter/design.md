## Context

Five guidance surfaces render into one Builder screen, each added by a different change, each
with its own trigger and its own persistence:

| Surface | Lives in | Trigger | Currently yields to |
|---|---|---|---|
| First-launch confirm | `BuilderPage.tsx` (`dialog.confirm`, ~L657) | first launch press | nothing |
| הקמה מהירה | `components/QuickSetup.tsx` + `lib/quickSetup.ts` | auto-invite on a templated game; `status` in `idle/welcome/intro/running/closed/done` | nothing |
| Guided tour | `components/CreatorTour.tsx`, mounted in `App.tsx` | signup + `POST_SIGNUP_TOUR_DELAY_MS` (2000 ms), or the nav "?" via the `rp-tour-restart` window event | nothing |
| First-open spotlight | `components/BuilderSpotlight.tsx` | first Builder open, decided ONCE after a 700 ms settle | tour (`isCreatorTourRunning()`), quick setup (`quickSetupActive` prop) |
| Ready nudge | `BuilderPage.tsx` (~L1395) | desktop only, `readiness.length === 0 && playCount === 0` | nothing |

Two of the ten pairs yield, by two different mechanisms — a module-level mutable flag read across
a component boundary, and a boolean prop. `CreatorTour.tsx` contains no reference to quick setup,
and `restartCreatorTour()` is a bare `window.dispatchEvent` fired from the global nav, so the help
button can start the tour on top of anything. The spotlight's 700 ms one-shot decision cannot see
the tour's 2000 ms auto-start, so even its wired yield is not reliable.

Constraint that shapes the whole design: the tour is mounted in `App.tsx`, OUTSIDE `BuilderPage`.
Any arbiter that both can consult must live above them.

## Goals / Non-Goals

**Goals:**
- One declared priority order, in one file, that all five surfaces obey.
- A creator's explicit help request is honoured, just later — never drawn over, never dropped.
- Delete `isCreatorTourRunning()` and the render-time module-global mutation behind it.
- The decision is pure, total and exhaustively tested, in the shape of `missionEditorNavAction`.

**Non-Goals:**
- Merging surfaces, changing copy, changing who qualifies, or changing any `localStorage` record.
- A general queue. Only the explicitly-requested tour is deferred; everything else that loses
  simply does not show and waits for its own next natural trigger.
- Any server, shared-type, callable, rules or play-web change. This is creator-web only.

## Decisions

### D1 — A pure arbiter module, priority-ordered, not pairwise

New `apps/creator-web/src/lib/builderGuidance.ts`:

```ts
export type GuidanceSurface =
  | 'launch-confirm' | 'quick-setup' | 'tour' | 'spotlight' | 'ready-nudge';

/** Highest priority first. The ONLY place order is expressed. */
export const GUIDANCE_PRIORITY: readonly GuidanceSurface[] = [...];

/** Which candidate wins, or null. Total; never throws. */
export function activeGuidance(
  candidates: Iterable<GuidanceSurface> | null | undefined,
): GuidanceSurface | null;
```

Priority, highest first, with the reason each sits where it does:

1. `launch-confirm` — a modal answering an action the creator took one keystroke ago. Suppressing
   it would strand a launch.
2. `quick-setup` — an in-progress multi-step flow the creator explicitly accepted; interrupting it
   loses their place in a sequence the app is walking them through.
3. `tour` — user-initiated or a deliberate post-signup welcome, but it is a tour of a screen, not
   a step of the creator's own work.
4. `spotlight` — a two-step explainer, one-shot, already written to yield.
5. `ready-nudge` — a passive status banner with no interaction cost to postponing.

*Alternative rejected:* complete the pairwise matrix instead. Ten pairs, each a place for the next
surface to be forgotten, and the two that exist already disagree on mechanism. A single ordered
list is the only representation where adding a sixth surface is one line rather than five.

*Alternative rejected:* z-index / DOM probing. `CreatorTour.tsx`'s own comment already rejects it —
it breaks silently the next time markup changes.

### D2 — Candidacy is registered into a context, not read across components

New `GuidanceProvider` (`components/GuidanceProvider.tsx`), mounted in `App.tsx` ABOVE both
`<CreatorTour />` and the routed Builder. It holds a `Set<GuidanceSurface>` of surfaces that
currently *want* to be on screen and exposes:

- `useGuidanceCandidate(surface, wants: boolean)` — a surface declares its own eligibility; the
  hook adds/removes it from the set.
- `useGuidanceVisible(surface): boolean` — `activeGuidance(set) === surface`.

This makes the decision reactive by construction (spec requirement "re-evaluated, not
snapshotted"): when the tour registers at 2000 ms, the spotlight's `useGuidanceVisible` flips to
`false` on that same render. It also removes the `quickSetupActive` prop and the
`isCreatorTourRunning()` import, which is the whole cross-component reach.

*Alternative rejected:* lift the state into `BuilderPage`. The tour is not inside it.

### D3 — The deferred help request

`restartCreatorTour()` keeps its name and its window event (Settings also fires it), but the
provider owns the outcome. Context gains `requestTour(source: 'help' | 'auto')`:

- `auto` → register candidacy; if it loses, drop it. Never queued (spec: an auto-start that loses
  is not queued — an unrequested tour appearing minutes later is a bug, not a feature).
- `help` → register candidacy; if it loses, set `pendingTourRequest = true` and surface a brief
  acknowledgement so the button is not a dead control (CLAUDE.md: a user-initiated action that
  resolves silently is a dead button). When the higher-priority surface clears, the pending flag
  starts the tour and is consumed.

The acknowledgement is the one new user-facing string; it goes through `t.*` in BOTH dictionaries.

### D4 — Suppressed is not seen

Every surface's "seen" record must stay on its own *finish* path. `BuilderSpotlight` currently
writes `spotlightSeenKey` in `finish()` — that stays; the suppression path (`useGuidanceVisible`
false) must not reach it. Same for the tour record and the quick-setup record. Encoded as an
explicit assertion in the test file, because this is the one way this change could silently cost a
creator their onboarding.

### D5 — `launch-confirm` is transient, not rendered

It is an awaited `dialog.confirm(...)`, so it has no render to gate. It registers candidacy for
the duration of the await via the same hook, driven by a small piece of state set immediately
before and cleared in a `finally`. That is enough to suppress the ready nudge and to make a
concurrent help request defer.

## Test strategy

- **Pure, RED first:** `scripts/test-builder-guidance.ts` (auto-discovered by
  `scripts/run-unit-tests.mjs`). It asserts:
  - **Exhaustive**: all 2^5 = 32 subsets of the five surfaces produce exactly one winner (or null
    for the empty set), and that winner is the first member of `GUIDANCE_PRIORITY` present. No
    case implicit — the same standard as the `missionEditorNavAction` table.
  - The deferred-tour table over {help, auto} x {wins, loses} → start now / hold / drop.
  - Totality: `null`, `undefined`, an empty iterable, duplicates, and an unrecognised surface name
    all resolve to a defined value and never throw; an unrecognised name never wins.
  - `GUIDANCE_PRIORITY` contains every member of `GuidanceSurface` exactly once (a new surface
    that is not ranked fails the gate rather than defaulting to invisible).
- **Regression:** `scripts/test-builder-spotlight.ts`, `scripts/test-quick-setup-flow.ts` and
  `scripts/test-creator-tour.ts` must stay green — their decision logic is untouched; only the
  visibility gate moves.
- **UI, in the preview at 375 px and 1280 px:** open the Builder on a templated game (quick setup
  wins, no spotlight); press "?" mid-step (tour defers, acknowledgement shows, tour starts on
  close); ready nudge appears only on an otherwise-quiet ready game; no combination shows two.
- **Gates:** the full `npm run verify` (all nine), with `npm run i18n:check:strict` clean and zero
  new PART B findings for the acknowledgement string. `npm run e2e` as a regression check only —
  no callable changes.

## Risks / Trade-offs

- **A surface silently never shows because it forgot to register.** → `GUIDANCE_PRIORITY`
  completeness is asserted against the `GuidanceSurface` union in the test, and each of the five
  call sites is named in `tasks.md` so none is converted by halves.
- **The provider re-renders the whole app on every candidacy change.** → The set changes only when
  a guidance surface starts or stops, which is a handful of times per session; the context value
  is memoised on the derived winner, not the set.
- **Deferred tour fires at a moment the creator has forgotten asking.** → It fires on the *close*
  of the surface that blocked it, which is within seconds, and the acknowledgement told them it
  would. It is dropped if the Builder is left.
- **`launch-confirm`'s candidacy leaks if the await throws.** → cleared in `finally`.
- **Real-device behaviour is unverifiable here**, as with stages A and B: overlay stacking on iOS
  Safari with the software keyboard open is not reproducible in the preview. Flagged in the final
  report rather than claimed.

## Migration Plan

Pure front-end; no data, no deploy ordering. Rollback is reverting the commit — the surfaces'
own triggers and records are untouched, so a rollback restores the old ad-hoc behaviour exactly.

## Open Questions

- Should the deferred acknowledgement be a toast or an inline line on the help button? Resolved in
  implementation by using whatever the console already has for transient acknowledgements rather
  than introducing a new pattern.
